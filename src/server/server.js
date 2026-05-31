/**
 * Server-mode entry point (Fly.io / Railway / Render / any Linux container).
 *
 * The desktop app entry is src/main/main.js, which `require('electron')` and
 * spins up a BrowserWindow. That won't run headless on a Linux server. This
 * file does the same backend work *without* Electron:
 *
 *   1. Set USER_DATA_PATH (defaults to /data) so the DB + attachments live
 *      on a mounted persistent volume.
 *   2. Stub out the `electron` module via a require-hook — any handler that
 *      `require('electron')` gets a minimal object that satisfies the
 *      surface they actually touch (app.getPath, shell.openPath, etc.).
 *   3. Initialise the SQLite database (same init.js the desktop uses).
 *   4. Register every IPC handler. The patched ipcMain from webServer.js
 *      mirrors each registration as an HTTP /api/invoke route, so the React
 *      frontend (served as static files) keeps working unchanged.
 *   5. Start the Express server on PORT (default 3002).
 *
 * Nothing in this file is desktop-specific — same code path runs in Docker.
 */

const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// 1. Persistent data location
// ---------------------------------------------------------------------------
// init.js builds DB_PATH from process.env.APPDATA || process.env.HOME. We
// override APPDATA so the resulting path lands under our volume mount.
// USER_DATA_PATH wins over both — make it explicit for whoever deploys this.
const DATA_DIR = process.env.USER_DATA_PATH || '/data';
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
// init.js does: path.join(APPDATA, 'TaskTango', 'tasktango.db').
// Setting APPDATA = DATA_DIR makes that resolve to <DATA_DIR>/TaskTango/...
process.env.APPDATA = DATA_DIR;

// ---------------------------------------------------------------------------
// 2. Electron stub
// ---------------------------------------------------------------------------
// We expose only what the handlers actually touch. If you see a runtime
// error like "Cannot read properties of undefined (reading 'foo')" coming
// from a handler that worked fine in Electron, add that property here.
const noop = () => {};
const electronStub = {
  app: {
    getPath: (name) => {
      // Route every Electron path request into our volume so files don't
      // scatter across the container's ephemeral filesystem.
      if (name === 'userData') return DATA_DIR;
      if (name === 'logs')     return path.join(DATA_DIR, 'logs');
      if (name === 'temp')     return path.join(DATA_DIR, 'tmp');
      if (name === 'downloads') return path.join(DATA_DIR, 'downloads');
      return path.join(DATA_DIR, name);
    },
    getName:    () => 'TaskTango',
    getVersion: () => '4.4.0-server',
    on:         noop,
    once:       noop,
    quit:       () => process.exit(0),
    disableHardwareAcceleration: noop,
    commandLine: { appendSwitch: noop }
  },
  // Minimal ipcMain — webServer.js will patch this further for HTTP mirroring.
  // We use a Map under the hood; the patched version (see registerAll() below)
  // adds the channel/handler to its own map and also calls our originalHandle.
  ipcMain: (() => {
    const channels = new Map();
    return {
      handle:        (ch, fn) => channels.set(ch, fn),
      on:            (ch, fn) => channels.set('on:' + ch, fn),
      removeHandler: (ch) => channels.delete(ch),
      __channels: channels // exposed for debugging only
    };
  })(),
  BrowserWindow: class { constructor() {} loadURL() {} on() {} },
  Menu:          { buildFromTemplate: () => ({}), setApplicationMenu: noop },
  shell: {
    // In server mode there's no OS shell to open files in. Handlers that try
    // this (chat:openAttachment, training-guide links) will silently no-op.
    // The client-side download path (chat:readAttachment → base64) still works.
    openPath:     async () => '',
    openExternal: async () => true,
    showItemInFolder: noop,
    beep: noop
  },
  dialog: {
    showMessageBox: async () => ({ response: 0 }),
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true, filePath: '' }),
    showErrorBox:   noop
  },
  Notification: class { constructor() {} show() {} close() {} },
  session: { defaultSession: { setPermissionRequestHandler: noop } },
  // Renderer-only APIs — handler files don't touch these but keep the shape
  // so they don't crash if someone accidentally imports.
  contextBridge: { exposeInMainWorld: noop },
  ipcRenderer:   { invoke: async () => null, on: noop, send: noop }
};

// Patch Node's require so `require('electron')` returns our stub. This must
// happen BEFORE any file that imports a handler gets loaded.
const Module = require('module');
const origLoad = Module._load;
Module._load = function patched(request, parent, ...rest) {
  if (request === 'electron') return electronStub;
  return origLoad.call(this, request, parent, ...rest);
};

// ---------------------------------------------------------------------------
// 3. Minimal SimpleStore replacement
// ---------------------------------------------------------------------------
// The desktop's SimpleStore (defined inline in main.js) is a JSON-backed
// fallback used by a couple of handlers (notably holidayHandlers) when the
// SQLite DB isn't ready. On a fresh container, the DB IS ready, so the
// store fallback is unused — a no-op stub satisfies the constructor surface.
class StubStore {
  constructor() {
    this.dataDir = path.join(DATA_DIR, 'data');
    try { fs.mkdirSync(this.dataDir, { recursive: true }); } catch (_) {}
    this.data = {};
  }
  get(key, defaultValue) {
    return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : defaultValue;
  }
  set(key, value) { this.data[key] = value; }
  delete(key) { delete this.data[key]; }
}
const store = new StubStore();

// ---------------------------------------------------------------------------
// 4. Bring up DB + handlers
// ---------------------------------------------------------------------------
const { ipcMain } = electronStub;
const { initializeDatabase } = require('../db/init');
const { patchIpcMain, startServer } = require('../main/webServer');

async function registerAll(db) {
  // patchIpcMain decorates ipcMain.handle so each registration also lands in
  // the webServer's handler map for HTTP dispatch.
  patchIpcMain(ipcMain);

  // Auth — gates the rest of the API. Goes first so even if a later handler
  // explodes, the user can still log in to see what's broken.
  require('./handlers/authHandlers').register(ipcMain, db);

  // Mirror of main.js registerDatabaseHandlers — exact same order so any
  // intentional overrides between modules still resolve the same way.
  require('./handlers/holidayHandlers').register(ipcMain, db, store);
  require('./handlers/attendanceHandlers').register(ipcMain, db);
  require('./handlers/leaveHandlers').register(ipcMain, db);
  require('./handlers/eventHandlers').register(ipcMain, db);
  require('./handlers/auditHandlers').register(ipcMain, db);
  require('./handlers/depositHandlers').register(ipcMain, db);
  require('./handlers/employeeHandlers').register(ipcMain, db);
  require('./handlers/timelogHandlers').register(ipcMain, db);
  require('./handlers/reviewHandlers').register(ipcMain, db);
  require('./handlers/skillHandlers').register(ipcMain, db);
  require('./handlers/notificationHandlers').register(ipcMain, db);
  require('./handlers/settingsHandlers').register(ipcMain, db);
  require('./handlers/departmentHandlers').register(ipcMain, db);
  require('./handlers/documentHandlers').register(ipcMain, db);

  // v4.4.1 — Excel parse/validate handlers (previously inline in main.js, so
  // server mode never had them). employee:bulkCreate IS in employeeHandlers.
  require('./handlers/excelHandlers').register(ipcMain);

  const chatHandlers = require('./handlers/chatHandlers');
  chatHandlers.register(ipcMain, db);
  // webServer's SSE route reads this global to wire chat realtime.
  global.__chatHandlers = chatHandlers;

  // The require paths above are relative to this file — but the actual files
  // live under src/main/handlers. The line `require('./handlers/...')` would
  // resolve to src/server/handlers, which doesn't exist. We rewrite once
  // upstream of the call site so the rest of the function reads naturally.
}

// Override the path joining inside registerAll by using a wrapper that maps
// './handlers/X' → '../main/handlers/X'. Simpler than rewriting every line.
const originalRequire = Module.prototype.require;
Module.prototype.require = function (specifier) {
  if (typeof specifier === 'string' && specifier.startsWith('./handlers/')) {
    return originalRequire.call(this, '../main/handlers/' + specifier.slice('./handlers/'.length));
  }
  return originalRequire.call(this, specifier);
};

// ---------------------------------------------------------------------------
// 5. Read the configured office timezone + sync internet time
// ---------------------------------------------------------------------------
async function applyTimezone(db) {
  try {
    const { setOfficeTimezone, syncOfficeTimeFromInternet, getOfficeTimezone } = require('../utils/officeTime');
    if (db) {
      // Settings live in app_settings (not "settings"). Lazy-create the
      // table so fresh installs don't error out before the first user
      // visits the Settings page.
      await db.run(`CREATE TABLE IF NOT EXISTS app_settings (
        key   TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      // Also honour OFFICE_TIMEZONE env var when no DB row exists yet —
      // useful on first deploy before an admin has visited Settings.
      const envTz = process.env.OFFICE_TIMEZONE;
      const row = await db.get(`SELECT value FROM app_settings WHERE key = 'office_timezone'`);
      const tz = (row?.value && row.value.trim()) || (envTz && envTz.trim()) || null;
      if (tz) {
        if (setOfficeTimezone(tz)) {
          console.log(`[TIME] ✓ Office timezone set to ${tz}`);
        } else {
          console.warn(`[TIME] Invalid timezone "${tz}", keeping default ${getOfficeTimezone()}`);
        }
      } else {
        console.log(`[TIME] ✓ Office timezone defaulting to ${getOfficeTimezone()}`);
      }
    }
    syncOfficeTimeFromInternet().then(r => {
      if (r.success) console.log(`[TIME] ✓ Internet time synced from ${r.source} (offset ${Math.round(r.offsetMs)} ms)`);
      else           console.log('[TIME] Internet time sync failed — using local clock.');
    }).catch(() => {});
    setInterval(() => {
      require('../utils/officeTime').syncOfficeTimeFromInternet().catch(() => {});
    }, 60 * 60 * 1000);
  } catch (e) {
    console.warn('[TIME] timezone setup failed:', e.message);
  }
}

// ---------------------------------------------------------------------------
// 6. Boot
// ---------------------------------------------------------------------------
(async () => {
  console.log(`[SERVER] Starting TaskTango server mode (data dir: ${DATA_DIR})`);
  let db;
  try {
    db = await initializeDatabase();
    console.log('[SERVER] ✓ Database ready');
  } catch (err) {
    console.error('[SERVER] DB init failed:', err);
    process.exit(1);
  }

  try {
    await registerAll(db);
    console.log('[SERVER] ✓ All handlers registered');
  } catch (err) {
    console.error('[SERVER] Handler registration failed:', err);
    process.exit(1);
  }

  await applyTimezone(db);

  // v4.5 — Hourly background jobs: auto-mark absent, probation auto-flip,
  // auto-sign-out at end of office day. Runs once immediately on startup
  // to catch up after a redeploy.
  try {
    require('../main/cronJobs').start(db);
  } catch (e) {
    console.warn('[CRON] scheduler unavailable:', e.message);
  }

  const port = Number(process.env.PORT) || 3002;
  try {
    await startServer(port);
    console.log(`[SERVER] ✓ TaskTango listening on http://0.0.0.0:${port}`);
  } catch (err) {
    console.error('[SERVER] Web server failed to start:', err);
    process.exit(1);
  }
})();

// Graceful shutdown so Fly's "restart machine" doesn't kill mid-write.
process.on('SIGTERM', () => { console.log('[SERVER] SIGTERM — shutting down'); process.exit(0); });
process.on('SIGINT',  () => { console.log('[SERVER] SIGINT — shutting down');  process.exit(0); });
