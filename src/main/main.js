const { app, BrowserWindow, ipcMain, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const excelUtils = require('../utils/excelUtils');
const { patchIpcMain, startServer: startWebServer } = require('./webServer');

// ============================================================================
// APPLICATION MENU + TRAINING GUIDES
//   Replaces the default Electron menu (File / Edit / View / Window / Help)
//   with a minimal File + Help menu. The Help menu shows ONE role-specific
//   training guide based on whoever is currently logged in. Performance
//   Review Scoring Guide is always present (everyone needs it).
// ============================================================================
const PRODUCT_NAME      = 'TaskTango';
const PRODUCT_VERSION   = 'Production v4.5';
const PRODUCT_DEVELOPER = 'Guninder Ahluwalia';

// Tracked across the session so the menu can show the right guide for the
// currently-logged-in user. Renderer notifies via 'user:roleChanged'.
let currentRoleClass = null; // 'admin' | 'lead' | 'user' | null

// Locate a training guide bundled with the install. Tries several candidate
// locations because the file might sit at the app root, the resources root
// or — in dev — relative to the source tree.
function locateGuide(filename) {
  const candidates = [
    path.join(process.resourcesPath || '', '..', 'training-guides', filename),
    path.join(process.resourcesPath || '', 'training-guides', filename),
    path.join(app.getAppPath(), '..', 'training-guides', filename),
    path.join(app.getAppPath(), 'training-guides', filename),
    path.join(__dirname, '..', '..', '..', '..', 'training-guides', filename),
    path.join(__dirname, '..', '..', '..', 'training-guides', filename),
  ];
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return c; } catch (_) {}
  }
  return null;
}

async function openGuide(filename) {
  const full = locateGuide(filename);
  if (!full) {
    await dialog.showMessageBox({
      type: 'warning',
      title: 'Training Guide Not Found',
      message: `Couldn't find ${filename}.`,
      detail: 'The training guide should live in a "training-guides" folder next to TaskTango.exe. Re-extract the zip if needed.'
    });
    return;
  }
  try { await shell.openPath(full); }
  catch (err) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Could not open guide',
      message: err.message || String(err)
    });
  }
}

function showAboutDialog() {
  return dialog.showMessageBox({
    type: 'info',
    title: `About ${PRODUCT_NAME}`,
    message: `${PRODUCT_NAME} ${PRODUCT_VERSION}`,
    detail:
      `Developed by ${PRODUCT_DEVELOPER}\n\n` +
      'HR & Employee Management Suite.\n\n' +
      'Use Help → Training Guide for a quick walkthrough of your dashboard.'
  });
}

function buildAppMenu() {
  const help = [
    {
      label: '📊 Performance Review Scoring Guide',
      click: () => openGuide('Performance_Review_Scoring_Guide.html')
    }
  ];

  // Add ONE role-specific guide based on the currently logged-in user.
  if (currentRoleClass === 'admin') {
    help.push({
      label: '🛡️ Administrator Training Guide',
      click: () => openGuide('Admin_Training_Guide.html')
    });
  } else if (currentRoleClass === 'lead') {
    help.push({
      label: '🧭 Department Lead Training Guide',
      click: () => openGuide('Lead_Training_Guide.html')
    });
  } else if (currentRoleClass === 'user') {
    help.push({
      label: '🧑‍💼 Employee Training Guide',
      click: () => openGuide('Employee_Training_Guide.html')
    });
  }
  // If nobody is logged in yet, no role guide is shown — just Performance.

  help.push({ type: 'separator' });
  // Two non-clickable info lines so the version AND the developer credit are
  // visible at a glance without having to open the About dialog.
  help.push({
    label: `Version: ${PRODUCT_VERSION}`,
    enabled: false
  });
  help.push({
    label: `Developed by ${PRODUCT_DEVELOPER}`,
    enabled: false
  });
  help.push({
    label: `About ${PRODUCT_NAME}`,
    click: showAboutDialog
  });

  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Exit',
          accelerator: 'Alt+F4',
          click: () => app.quit()
        }
      ]
    },
    {
      label: 'Help',
      submenu: help
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Renderer tells us who's logged in (or null on logout) so we can rebuild
// the Help submenu with the right training guide for them.
ipcMain.on('user:roleChanged', (_event, roleClass) => {
  const next = (roleClass || '').toLowerCase();
  currentRoleClass = ['admin', 'lead', 'user'].includes(next) ? next : null;
  buildAppMenu();
});

// Disable hardware acceleration to avoid GPU process crashes on systems where
// the GPU driver / Windows configuration causes Chromium to fail rendering.
// Must be called before app is ready.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-software-rasterizer');

// Patch ipcMain so all subsequent handle() calls automatically register HTTP endpoints
patchIpcMain(ipcMain);

let mainWindow;

// Simple JSON-based data store
class SimpleStore {
  constructor() {
    this.dataDir = path.join(app.getPath('userData'), 'data');
    this.dataFile = path.join(this.dataDir, 'store.json');

    // Create data directory if it doesn't exist
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    this.data = this.loadData();
  }

  loadData() {
    try {
      if (fs.existsSync(this.dataFile)) {
        const content = fs.readFileSync(this.dataFile, 'utf-8');
        const loadedData = JSON.parse(content);

        // Merge loaded data with default collections to ensure new collections exist
        return this.mergeWithDefaults(loadedData);
      }
    } catch (error) {
      console.error('[STORE] Error loading data:', error);
    }

    // Initialize with demo data
    return this.getDefaultData();
  }

  getDefaultData() {
    return {
      passwordChanges: {}, // Track which users have changed their password
      departments: [
        { id: '1', name: 'IT Department', description: 'Information Technology' },
        { id: '2', name: 'HR Department', description: 'Human Resources' },
        { id: '3', name: 'Finance Department', description: 'Finance & Accounting' }
      ],
      employees: [
        // Administrators/MD - Full Access
        {
          id: '1',
          fullName: 'Administrator',
          email: 'admin@tasktango.com',
          phone: '+44 20 7946 0958',
          departmentId: '1',
          role: 'Administrator',
          baseSalary: 150000,
          isLead: false,
          bankAccountNumber: '****1234',
          bankName: 'HSBC',
          accountName: 'Administrator Account',
          ifscCode: 'HSBC0001',
          status: 'active'
        },
        {
          id: 'md-1',
          fullName: 'Guninder Walia',
          email: 'guninderwalia@gmail.com',
          phone: '+91 98765 43210',
          departmentId: null,
          role: 'MD',
          baseSalary: 200000,
          isLead: false,
          bankAccountNumber: '****5678',
          bankName: 'State Bank of India',
          accountName: 'Guninder Walia',
          ifscCode: 'SBIN0001234',
          status: 'active'
        },
        // Team Lead - Department Only Access
        {
          id: '2',
          fullName: 'John Mitchell',
          email: 'john.mitchell@tasktango.com',
          phone: '+44 20 1234 5678',
          departmentId: '1',
          role: 'Lead',
          baseSalary: 80000,
          isLead: true,
          bankAccountNumber: '****9012',
          bankName: 'Barclays',
          accountName: 'John Mitchell',
          ifscCode: 'BARC0001',
          status: 'active'
        },
        // Team Lead - Department Only Access
        {
          id: '4',
          fullName: 'Prachi',
          email: 'prachi@123',
          phone: '2345234553',
          departmentId: '1',
          role: 'Lead',
          baseSalary: 75000,
          isLead: true,
          bankAccountNumber: '****2352',
          bankName: 'Evergrow Bank',
          accountName: 'Prachi Account',
          ifscCode: 'SDFASDFA',
          status: 'active'
        },
        {
          id: '5',
          fullName: 'Kiranjot',
          email: 'kwalia@kiran.com',
          phone: '+91 8968511277',
          departmentId: '2',
          role: 'Manager',
          baseSalary: 85000,
          isLead: true,
          bankAccountNumber: '****5324',
          bankName: 'ICICI Bank',
          accountName: 'Kiranjot Account',
          ifscCode: 'ASDF23423',
          status: 'active'
        },
        // Employees - View Only with Masked Salary
        {
          id: '3',
          fullName: 'Sarah Johnson',
          email: 'sarah.johnson@tasktango.com',
          phone: '+44 20 2345 6789',
          departmentId: '1',
          role: 'User',
          baseSalary: 55000,
          isLead: false,
          bankAccountNumber: '****3456',
          bankName: 'Lloyds',
          accountName: 'Sarah Johnson',
          ifscCode: 'LLOY0001',
          status: 'active'
        }
      ],
      attendance: [],
      leave: [],
      payroll: [],
      auditLogs: [],
      timeLogs: [],
      holidays: [],
      managerReviews: [
        {
          id: Date.now().toString(),
          employeeId: '3',
          managerId: '1',
          rating: 4,
          reviewDate: new Date().toISOString(),
          comments: 'Strong performer with excellent communication skills',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      employeeSkills: [
        // Skills for Sarah Johnson (emp id 3)
        { id: '1001', employeeId: '3', skillId: 'communication', rating: 5, assessmentDate: new Date().toISOString(), assessedBy: '1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: '1002', employeeId: '3', skillId: 'teamwork', rating: 4, assessmentDate: new Date().toISOString(), assessedBy: '1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: '1003', employeeId: '3', skillId: 'problem-solving', rating: 4, assessmentDate: new Date().toISOString(), assessedBy: '1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: '1004', employeeId: '3', skillId: 'time-management', rating: 3, assessmentDate: new Date().toISOString(), assessedBy: '1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      ],
      predefinedSkills: [
        { id: 'communication', name: 'Communication', category: 'soft' },
        { id: 'problem-solving', name: 'Problem Solving', category: 'soft' },
        { id: 'teamwork', name: 'Teamwork', category: 'soft' },
        { id: 'leadership', name: 'Leadership', category: 'soft' },
        { id: 'time-management', name: 'Time Management', category: 'soft' },
        { id: 'attention-to-detail', name: 'Attention to Detail', category: 'soft' },
        { id: 'adaptability', name: 'Adaptability', category: 'soft' },
        { id: 'technical-expertise', name: 'Technical Expertise', category: 'technical' }
      ]
    };
  }

  mergeWithDefaults(loadedData) {
    const defaults = this.getDefaultData();
    const merged = { ...loadedData };

    // Ensure all required collections exist
    const requiredCollections = [
      'departments', 'employees', 'attendance', 'leave', 'payroll', 'auditLogs',
      'timeLogs', 'managerReviews', 'employeeSkills', 'predefinedSkills', 'passwordChanges', 'holidays'
    ];

    for (const collection of requiredCollections) {
      if (!merged[collection]) {
        merged[collection] = defaults[collection];
      }
    }

    return merged;
  }

  saveData() {
    try {
      fs.writeFileSync(this.dataFile, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (error) {
      console.error('[STORE] Error saving data:', error);
    }
  }

  get(key, defaultValue = null) {
    return this.data[key] !== undefined ? this.data[key] : defaultValue;
  }

  set(key, value) {
    this.data[key] = value;
    this.saveData();
  }

  has(key) {
    return key in this.data;
  }
}

const store = new SimpleStore();

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.js');
  const iconPath = path.join(__dirname, '../assets/logo.png');
  console.log('[MAIN] Preload path:', preloadPath);
  console.log('[MAIN] Icon path:', iconPath);

  const isDev = process.env.NODE_ENV === 'development';

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath,
      enableRemoteModule: false,
      sandbox: true
    }
  });

  // Replace the default Electron menu (File / Edit / View / Window / Help)
  // with our minimal one. Rebuilt later when a user logs in so the right
  // role's training guide appears.
  buildAppMenu();

  // Allow the renderer to access the camera and microphone for voice/video
  // calls. Without this, getUserMedia rejects with "permission denied" inside
  // Electron (Chromium's default policy is deny for media in a packaged app).
  // We only auto-grant 'media' — every other permission still gets the default
  // deny so we don't accidentally widen the surface.
  try {
    mainWindow.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
      if (permission === 'media') return callback(true);
      return callback(false);
    });
  } catch (e) {
    console.warn('[MAIN] Could not set permission request handler:', e.message);
  }

  console.log('[MAIN] BrowserWindow created');

  // In development, load from localhost:3001 (React dev server)
  // In production, load from the built files
  const startUrl = isDev
    ? 'http://localhost:3001'
    : `file://${path.join(__dirname, '../../build/index.html')}`;

  console.log('[MAIN] Loading URL:', startUrl);
  mainWindow.loadURL(startUrl);

  // DevTools is no longer opened automatically. Press Ctrl+Shift+I (or F12)
  // inside the app to open it on demand. Uncomment the next line to bring it
  // back during debugging.
  // mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[MAIN] Page loaded, renderer process ready');
    console.log('[MAIN] Preload should have already exposed window.electron');
  });

  // Forward all renderer console messages to the main process stdout so
  // we can see errors even when DevTools isn't open.
  mainWindow.webContents.on('console-message', (event, level, message, line, source) => {
    const levels = ['LOG', 'WARN', 'ERROR', 'INFO'];
    const tag = levels[level] || 'LOG';
    console.log(`[RENDERER ${tag}] ${message} (${source}:${line})`);
  });

  mainWindow.webContents.on('did-fail-load', (event, code, desc, url) => {
    console.error(`[MAIN] did-fail-load: ${code} ${desc} for ${url}`);
  });

  mainWindow.webContents.on('preload-error', (event, preloadPath, error) => {
    console.error('[MAIN] Preload error:', preloadPath, error);
  });

  mainWindow.webContents.on('crashed', () => {
    console.error('[MAIN] WebContents crashed');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Listen for preload completion message
ipcMain.on('preload-complete', (event, data) => {
  console.log('[MAIN] Preload completed:', data);
});

app.on('ready', async () => {
  console.log('[STORE] ✓ SimpleStore initialized');

  // Initialize database and auth
  let db = null;
  try {
    const { initializeDatabase } = require('../db/init');
    db = await initializeDatabase();
    console.log('[DB] ✓ Database initialized successfully');
  } catch (error) {
    console.error('[DB] Failed to initialize database:', error);
    console.log('[DB] Continuing with demo authentication and store-based handlers...');
  }

  try {
    await initializeAuth(db);
    await registerDatabaseHandlers(db); // Pass null db if not initialized, handlers will use store
  } catch (error) {
    console.error('[INIT] Error during auth/handlers initialization:', error);
  }

  // Start the HTTP API server so the web version can use the same backend
  try {
    await startWebServer(3002);
  } catch (error) {
    console.error('[WEB-SERVER] Failed to start:', error);
  }

  // v4.3: pull true UTC from a public time source so timestamps don't drift
  // when an employee's laptop clock is wrong or set to a different zone.
  // Fire-and-forget — we don't block startup on a network call. The first
  // sign-in might be a tick early if the sync hasn't landed yet, but the
  // office-zone formatter still produces consistent strings either way.
  try {
    const { syncOfficeTimeFromInternet, setOfficeTimezone, getOfficeTimezone } = require('../utils/officeTime');
    // Read the admin-configured timezone setting, if any, and apply it so
    // every backend timestamp uses the same zone the renderer expects.
    if (db) {
      try {
        const row = await db.get(`SELECT value FROM settings WHERE key = 'office_timezone'`);
        if (row?.value) {
          if (setOfficeTimezone(row.value)) {
            console.log(`[TIME] ✓ Office timezone set to ${row.value}`);
          } else {
            console.warn(`[TIME] Invalid office_timezone "${row.value}" in settings, keeping default ${getOfficeTimezone()}`);
          }
        } else {
          console.log(`[TIME] ✓ Office timezone defaulting to ${getOfficeTimezone()}`);
        }
      } catch (e) { /* settings table not migrated yet — fine, default used */ }
    }
    syncOfficeTimeFromInternet().then((r) => {
      if (r.success) {
        console.log(`[TIME] ✓ Internet time synced from ${r.source} (offset ${Math.round(r.offsetMs)} ms)`);
      } else {
        console.log('[TIME] Internet time sync failed — using local clock.');
      }
    }).catch(() => { /* never break startup on a time-sync failure */ });
    // Re-sync hourly so a long-running session can't drift.
    setInterval(() => {
      syncOfficeTimeFromInternet().catch(() => {});
    }, 60 * 60 * 1000);
  } catch (e) {
    console.warn('[TIME] Time-sync utility unavailable:', e.message);
  }

  // v4.5 — Hourly background jobs (auto-mark absent / probation flip /
  // auto-sign-out). Same scheduler runs in server mode too.
  try {
    if (db) require('./cronJobs').start(db);
  } catch (e) {
    console.warn('[CRON] scheduler unavailable:', e.message);
  }

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// ============================================================================
// REGISTER ALL DATABASE HANDLERS
// ============================================================================
async function registerDatabaseHandlers(db) {
  try {
    // Register holiday handlers (works with both db and store)
    const { register: registerHolidayHandlers } = require('./handlers/holidayHandlers');
    registerHolidayHandlers(ipcMain, db, store);
    console.log('[HOLIDAY] ✓ Holiday handlers registered');

    // Register attendance handlers
    const { register: registerAttendanceHandlers } = require('./handlers/attendanceHandlers');
    registerAttendanceHandlers(ipcMain, db);
    console.log('[ATTENDANCE] ✓ Attendance handlers registered');

    // Register leave handlers
    const { register: registerLeaveHandlers } = require('./handlers/leaveHandlers');
    registerLeaveHandlers(ipcMain, db);
    console.log('[LEAVE] ✓ Leave handlers registered');

    // Register event handlers
    const { register: registerEventHandlers } = require('./handlers/eventHandlers');
    registerEventHandlers(ipcMain, db);
    console.log('[EVENTS] ✓ Event handlers registered');

    // Register SQLite-backed audit handlers. The store-based inline handler
    // in main.js wrote to a JSON file that the new dashboard can't query;
    // this one reads from the same audit_logs table that login/logout and
    // the new employee/leave audit hooks write to.
    const { register: registerAuditHandlers } = require('./handlers/auditHandlers');
    registerAuditHandlers(ipcMain, db);
    console.log('[AUDIT] ✓ Audit handlers registered');

    const { register: registerDepositHandlers } = require('./handlers/depositHandlers');
    registerDepositHandlers(ipcMain, db);
    console.log('[DEPOSITS] ✓ Deposit handlers registered');

    // Sync any latest JSON-store edits into SQLite before we let the DB-backed
    // employee handlers take over. Without this, edits made through the old
    // store-based handlers (e.g. joining date changes) would diverge from the
    // SQLite data that the leave/payroll handlers read.
    try {
      await syncJsonStoreToSqlite(db);
    } catch (e) {
      console.error('[SYNC] Failed to sync JSON store into SQLite:', e);
    }

    // Register database-backed employee handlers LAST so they override the
    // inline SimpleStore versions (our patchIpcMain replaces older handlers).
    const { register: registerEmployeeHandlers } = require('./handlers/employeeHandlers');
    registerEmployeeHandlers(ipcMain, db);
    console.log('[EMPLOYEES] ✓ Database-backed employee handlers registered');

    // SQLite-backed time logging — replaces store.get('timeLogs') versions
    // so Consistency / Lateness in the performance review read from SQLite.
    const { register: registerTimeLogHandlers } = require('./handlers/timelogHandlers');
    registerTimeLogHandlers(ipcMain, db);
    console.log('[TIMELOG] ✓ Database-backed time logging handlers registered');

    // SQLite-backed manager reviews — replaces store.get('managerReviews').
    const { register: registerReviewHandlers } = require('./handlers/reviewHandlers');
    registerReviewHandlers(ipcMain, db);
    console.log('[REVIEW] ✓ Database-backed review handlers registered');

    // SQLite-backed skills — replaces store.get('employeeSkills') /
    // store.get('predefinedSkills'). predefined_skills is seeded at init.
    const { register: registerSkillHandlers } = require('./handlers/skillHandlers');
    registerSkillHandlers(ipcMain, db);
    console.log('[SKILL] ✓ Database-backed skill handlers registered');

    // Notification handlers — surface the existing notifications table to
    // the renderer for the bell-icon dropdown.
    const { register: registerNotificationHandlers } = require('./handlers/notificationHandlers');
    registerNotificationHandlers(ipcMain, db);
    console.log('[NOTIF] ✓ Notification handlers registered');

    // Settings handlers — key/value store + DB backup endpoint.
    const { register: registerSettingsHandlers } = require('./handlers/settingsHandlers');
    registerSettingsHandlers(ipcMain, db);
    console.log('[SETTINGS] ✓ Settings handlers registered');

    // Database-backed department handlers — overrides the inline JSON-store
    // versions earlier in main.js. Without this, fresh-seeded installs (no
    // JSON store) return empty department lists and "Employee not found"
    // from assignLead because every department lookup is against an empty
    // in-memory map.
    const { register: registerDepartmentHandlers } = require('./handlers/departmentHandlers');
    registerDepartmentHandlers(ipcMain, db);
    console.log('[DEPARTMENTS] ✓ Database-backed department handlers registered');

    // Employee document attachments (contracts, ID copies, offer letters)
    const { register: registerDocumentHandlers } = require('./handlers/documentHandlers');
    registerDocumentHandlers(ipcMain, db);
    console.log('[DOCUMENTS] ✓ Document attachment handlers registered');

    // Direct-message chat between employees
    const chatHandlers = require('./handlers/chatHandlers');
    chatHandlers.register(ipcMain, db);
    // Expose subscribe helpers so the web server can wire up the SSE endpoint.
    global.__chatHandlers = chatHandlers;
    console.log('[CHAT] ✓ Chat handlers registered');

    // Register other database handlers as needed
  } catch (error) {
    console.error('[HANDLERS] Error registering database handlers:', error);
  }
}

// ============================================================================
// SYNC: Push any newer JSON-store edits into SQLite
// ============================================================================
// The JSON store is the legacy data source. Until all handlers are switched to
// SQLite, edits made through old code paths land there only. This function
// reads the JSON store and overwrites the corresponding SQLite rows so the two
// match. Runs on every startup (idempotent).
async function syncJsonStoreToSqlite(db) {
  const storeEmployees = store.get('employees', []);
  if (storeEmployees.length === 0) return;

  let updated = 0;
  for (const emp of storeEmployees) {
    if (!emp.id) continue;

    // Does the user exist in SQLite?
    const sqlUser = await db.get('SELECT id FROM users WHERE id = ?', [emp.id]);
    if (!sqlUser) continue;

    // Update users table fields the store might have edited
    if (emp.fullName || emp.email || emp.phone || emp.departmentId) {
      await db.run(
        `UPDATE users
            SET full_name = COALESCE(?, full_name),
                email = COALESCE(?, email),
                phone = COALESCE(?, phone),
                department_id = COALESCE(?, department_id)
          WHERE id = ?`,
        [emp.fullName || null, emp.email || null, emp.phone || null, emp.departmentId || null, emp.id]
      );
    }

    // Update employment_records.start_date (the joining date) if the store has one
    const storeJoiningDate = emp.joiningDate || emp.startDate;
    const cleanDate = typeof storeJoiningDate === 'string'
      ? storeJoiningDate.split('T')[0]
      : null;

    if (cleanDate) {
      const existing = await db.get(
        'SELECT id, start_date FROM employment_records WHERE user_id = ?',
        [emp.id]
      );
      if (existing) {
        if (existing.start_date !== cleanDate) {
          await db.run(
            'UPDATE employment_records SET start_date = ? WHERE id = ?',
            [cleanDate, existing.id]
          );
          updated++;
        }
      } else {
        await db.run(
          `INSERT INTO employment_records (id, user_id, start_date, employment_type, base_salary, is_probation)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            require('uuid').v4(),
            emp.id,
            cleanDate,
            emp.employmentType || (emp.probationCompleted ? 'Permanent' : 'Probation'),
            emp.baseSalary || 0,
            emp.probationCompleted ? 0 : 1
          ]
        );
        updated++;
      }
    }

    // Update base_salary if the store has one
    if (emp.baseSalary != null) {
      await db.run(
        'UPDATE employment_records SET base_salary = ? WHERE user_id = ?',
        [emp.baseSalary, emp.id]
      );
    }
  }

  if (updated > 0) {
    console.log(`[SYNC] ✓ Synced ${updated} employment_records row(s) from JSON store to SQLite`);
  } else {
    console.log('[SYNC] ✓ JSON store and SQLite are already in sync');
  }
}

// ============================================================================
// AUDIT LOGGING
// ============================================================================
function logAction(action, entityType, entityId, oldValue, newValue) {
  try {
    const logs = store.get('auditLogs', []);
    const logEntry = {
      id: Date.now().toString(),
      action,
      entityType,
      entityId,
      oldValue,
      newValue,
      timestamp: new Date().toISOString(),
      userId: null
    };
    logs.push(logEntry);
    store.set('auditLogs', logs);
  } catch (error) {
    console.error('[AUDIT] Error logging action:', error);
  }
}

// ============================================================================
// AUTHENTICATION HANDLERS - USING DATABASE
// ============================================================================
// Note: Real auth handlers are registered from authHandlers.js
// If database fails to initialize, fallback to demo credentials
let authDbReady = false;
let demoAuthActive = false;
let currentUser = null; // Track current user in demo mode

async function initializeAuth(db) {
  try {
    if (db) {
      const { register: registerAuthHandlers } = require('./handlers/authHandlers');
      registerAuthHandlers(ipcMain, db);
      authDbReady = true;
      console.log('[AUTH] ✓ Database authentication initialized');
      return;
    }
  } catch (error) {
    console.error('[AUTH] Error initializing database auth:', error);
  }

  // Fallback to demo authentication if database unavailable
  console.log('[AUTH] Using demo authentication (database not available)');
  demoAuthActive = true;

  ipcMain.handle('auth:login', async (event, { email, password }) => {
    try {
      // Get all employees from store
      const employees = store.get('employees', []);
      const passwordChanges = store.get('passwordChanges', {});

      // Find employee by email (case-insensitive)
      const employee = employees.find(emp => emp.email && emp.email.toLowerCase() === email.toLowerCase());

      if (!employee) {
        console.log('[AUTH] ✗ Employee not found for email:', email);
        return { success: false, message: 'Invalid credentials' };
      }

      console.log('[AUTH] Found employee:', employee.fullName, '| Role:', employee.role);

      // Check if employee is active
      if (employee.status === 'inactive') {
        console.log('[AUTH] ✗ Employee is inactive:', email);
        return { success: false, message: 'User account is inactive' };
      }

      // Check password - accept both default 'password' and any custom password they set
      const hasChangedPassword = passwordChanges[employee.id];
      const passwordValid = hasChangedPassword
        ? (password === passwordChanges[employee.id])
        : (password === 'password');

      if (!passwordValid) {
        console.log('[AUTH] ✗ Invalid password for:', email);
        return { success: false, message: 'Invalid credentials' };
      }

      // Map employee data to user object with role_name from the role field
      const user = {
        id: employee.id,
        email: employee.email,
        fullName: employee.fullName || employee.name,
        role_name: employee.role || 'User',
        departmentId: employee.departmentId,
        department_id: employee.departmentId,
        status: employee.status,
        is_first_login: hasChangedPassword ? 0 : 1
      };

      console.log('[AUTH] ✓ Login successful');
      console.log('[AUTH] Email:', email);
      console.log('[AUTH] Name:', user.fullName);
      console.log('[AUTH] Role:', user.role_name);
      console.log('[AUTH] Has changed password:', hasChangedPassword);
      console.log('[AUTH] Is first login:', user.is_first_login);

      // Track current user for password changes
      currentUser = user;

      return { success: true, user, isFirstLogin: user.is_first_login === 1 };
    } catch (error) {
      console.error('[AUTH] Login error:', error);
      return { success: false, message: 'Authentication failed' };
    }
  });

  ipcMain.handle('auth:logout', async () => {
    currentUser = null;
    return { success: true };
  });

  ipcMain.handle('auth:getCurrentUser', async () => currentUser);

  ipcMain.handle('auth:changePassword', async (event, { oldPassword, newPassword, confirmPassword }) => {
    try {
      if (!currentUser) {
        return { success: false, message: 'No user logged in' };
      }
      if (newPassword !== confirmPassword) {
        return { success: false, message: 'Passwords do not match' };
      }

      // Store the new password for this user
      const passwordChanges = store.get('passwordChanges', {});
      passwordChanges[currentUser.id] = newPassword;
      store.set('passwordChanges', passwordChanges);

      console.log('[AUTH] ✓ Password changed for user:', currentUser.email);
      return { success: true, message: 'Password changed successfully' };
    } catch (error) {
      console.error('[AUTH] Password change error:', error);
      return { success: false, message: 'Failed to change password' };
    }
  });

  ipcMain.handle('auth:changePasswordFirstLogin', async (event, { newPassword, confirmPassword }) => {
    try {
      if (!currentUser) {
        return { success: false, message: 'No user logged in' };
      }
      if (newPassword !== confirmPassword) {
        return { success: false, message: 'Passwords do not match' };
      }

      // Store the new password for this user
      const passwordChanges = store.get('passwordChanges', {});
      passwordChanges[currentUser.id] = newPassword;
      store.set('passwordChanges', passwordChanges);

      console.log('[AUTH] ✓ First login password set for user:', currentUser.email);
      return { success: true, message: 'Password set successfully' };
    } catch (error) {
      console.error('[AUTH] First login password error:', error);
      return { success: false, message: 'Failed to set password' };
    }
  });
  ipcMain.handle('auth:validatePassword', async (event, { password }) => ({
    isValid: password && password.length >= 8,
    errors: password && password.length >= 8 ? [] : ['Minimum 8 characters required'],
    strength: { label: 'Good', percentage: 75, score: 3, maxScore: 5 }
  }));
  ipcMain.handle('auth:createUser', async () => ({ success: false, message: 'Demo mode: user creation not supported' }));
  ipcMain.handle('auth:resetUserPassword', async () => ({ success: false, message: 'Demo mode: password reset not supported' }));
  ipcMain.handle('auth:getPasswordRules', async () => ({
    minLength: 8,
    requireUppercase: false,
    requireLowercase: false,
    requireNumbers: false,
    requireSpecialChars: false
  }));
}

// ============================================================================
// DEPARTMENT HANDLERS
// ============================================================================
ipcMain.handle('department:getAll', async () => {
  try {
    const departments = store.get('departments', []);
    console.log('[DEPT] Retrieved', departments.length, 'departments');
    return { success: true, data: departments };
  } catch (error) {
    console.error('[DEPT] Error getting departments:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('department:create', async (event, { name, description }) => {
  try {
    const departments = store.get('departments', []);
    const newDepartment = {
      id: Date.now().toString(),
      name,
      description,
      createdAt: new Date().toISOString(),
      lead: null
    };
    departments.push(newDepartment);
    store.set('departments', departments);

    logAction('CREATE', 'DEPARTMENT', newDepartment.id, null, newDepartment);
    console.log('[DEPT] ✓ Created department:', newDepartment.name);

    return { success: true, data: newDepartment };
  } catch (error) {
    console.error('[DEPT] Error creating department:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('department:update', async (event, { id, name, description }) => {
  try {
    const departments = store.get('departments', []);
    const deptIndex = departments.findIndex(d => d.id === id);
    if (deptIndex === -1) {
      return { success: false, error: 'Department not found' };
    }
    const oldValue = { ...departments[deptIndex] };
    departments[deptIndex] = { ...departments[deptIndex], name, description };
    store.set('departments', departments);

    logAction('UPDATE', 'DEPARTMENT', id, oldValue, departments[deptIndex]);
    console.log('[DEPT] ✓ Updated department:', id);

    return { success: true, data: departments[deptIndex] };
  } catch (error) {
    console.error('[DEPT] Error updating department:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('department:assignLead', async (event, { departmentId, userId }) => {
  try {
    console.log('\n[DEPT] ================================================');
    console.log('[DEPT] ASSIGNING TEAM LEAD');
    console.log('[DEPT] Department ID:', departmentId);
    console.log('[DEPT] User ID:', userId);

    const departments = store.get('departments', []);
    const employees = store.get('employees', []);

    console.log('[DEPT] Total departments in store:', departments.length);
    console.log('[DEPT] Total employees in store:', employees.length);

    // Find department
    const deptIndex = departments.findIndex(d => d.id === departmentId);
    console.log('[DEPT] Department found:', deptIndex !== -1, '| Index:', deptIndex);

    if (deptIndex === -1) {
      console.error('[DEPT] ✗ FAILED: Department not found');
      return { success: false, error: 'Department not found' };
    }
    console.log('[DEPT] Department:', departments[deptIndex].name);

    // Find employee
    const employee = employees.find(e => e.id === userId);
    console.log('[DEPT] Employee found:', employee ? 'YES' : 'NO');

    if (!employee) {
      console.error('[DEPT] ✗ FAILED: Employee not found');
      console.error('[DEPT] Searched for ID:', userId);
      console.log('[DEPT] Available employees:');
      employees.forEach((e, i) => {
        console.log(`  [${i}] ID: ${e.id} | Name: ${e.fullName || e.full_name || 'NO NAME'} | DeptID: ${e.departmentId}`);
      });
      return { success: false, error: 'Employee not found' };
    }

    console.log('[DEPT] Employee details:');
    console.log('[DEPT]   ID:', employee.id);
    console.log('[DEPT]   Name:', employee.fullName || employee.full_name);
    console.log('[DEPT]   Email:', employee.email);
    console.log('[DEPT]   Department:', employee.departmentId);

    // Assign team lead
    const oldValue = { ...departments[deptIndex] };
    departments[deptIndex].lead = userId;
    departments[deptIndex].lead_name = employee.fullName || employee.full_name;

    console.log('[DEPT] Saving to database...');
    store.set('departments', departments);
    console.log('[DEPT] ✓ Saved successfully');

    console.log('[DEPT] Updated department object:');
    console.log('[DEPT]   Name:', departments[deptIndex].name);
    console.log('[DEPT]   Team Lead ID:', departments[deptIndex].lead);
    console.log('[DEPT]   Team Lead Name:', departments[deptIndex].lead_name);

    logAction('ASSIGN_LEAD', 'DEPARTMENT', departmentId, oldValue, departments[deptIndex]);
    console.log('[DEPT] ✓ TEAM LEAD ASSIGNMENT SUCCESSFUL');
    console.log('[DEPT] ================================================\n');

    return { success: true, data: departments[deptIndex] };
  } catch (error) {
    console.error('[DEPT] ✗ EXCEPTION:', error.message);
    console.error('[DEPT] Stack:', error.stack);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('department:delete', async (event, { id }) => {
  try {
    const departments = store.get('departments', []);
    const deptIndex = departments.findIndex(d => d.id === id);
    if (deptIndex === -1) {
      return { success: false, error: 'Department not found' };
    }

    const deletedDept = departments[deptIndex];
    departments.splice(deptIndex, 1);
    store.set('departments', departments);

    logAction('DELETE', 'DEPARTMENT', id, deletedDept, null);
    console.log('[DEPT] ✓ Deleted department:', id);

    return { success: true, data: deletedDept };
  } catch (error) {
    console.error('[DEPT] Error deleting department:', error);
    return { success: false, error: error.message };
  }
});

// ============================================================================
// EMPLOYEE HANDLERS
// ============================================================================
ipcMain.handle('employee:getAll', async () => {
  try {
    const employees = store.get('employees', []);
    const departments = store.get('departments', []);

    // Enrich every employee with department name + normalized field names
    const enriched = employees.map((employee) => {
      const department = departments.find(d => d.id === employee.departmentId);
      return {
        ...employee,
        department_name: department ? department.name : (employee.department_name || null),
        department_id: employee.departmentId || employee.department_id || null,
        joiningDate: employee.joiningDate || employee.startDate || employee.start_date || employee.createdAt || null,
        base_salary: employee.baseSalary || employee.base_salary || 0,
        employment_type: employee.employmentType || employee.employment_type || (employee.probationCompleted ? 'Permanent' : 'Probation'),
        is_probation: employee.is_probation !== undefined
          ? employee.is_probation
          : (employee.probationCompleted ? 0 : 1),
        full_name: employee.fullName || employee.full_name || null,
        role_name: employee.role || employee.role_name || 'User'
      };
    });

    console.log('[EMP] Retrieved', enriched.length, 'employees (enriched)');
    return { success: true, data: enriched };
  } catch (error) {
    console.error('[EMP] Error getting employees:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('employee:getById', async (event, { id }) => {
  try {
    const employees = store.get('employees', []);
    const employee = employees.find(e => e.id === id);
    if (!employee) {
      return { success: false, error: 'Employee not found' };
    }

    // Enrich employee data with department name and normalize field names
    // so the frontend (which expects DB-style names like department_name,
    // joiningDate, base_salary, employment_type) gets consistent data.
    const departments = store.get('departments', []);
    const department = departments.find(d => d.id === employee.departmentId);

    const enriched = {
      ...employee,
      // Department info
      department_name: department ? department.name : (employee.department_name || null),
      department_id: employee.departmentId || employee.department_id || null,

      // Joining date (try multiple known field names)
      joiningDate: employee.joiningDate || employee.startDate || employee.start_date || employee.createdAt || null,

      // Base salary (frontend uses base_salary, store uses baseSalary)
      base_salary: employee.baseSalary || employee.base_salary || 0,

      // Employment type
      employment_type: employee.employmentType || employee.employment_type || (employee.probationCompleted ? 'Permanent' : 'Probation'),

      // Probation status (frontend uses is_probation)
      is_probation: employee.is_probation !== undefined
        ? employee.is_probation
        : (employee.probationCompleted ? 0 : 1),

      // Banking details normalization
      bankAccountNumber: employee.bankAccountNumber || employee.bank_account_number || null,
      ifscCode: employee.ifscCode || employee.ifsc_code || null,
      bankName: employee.bankName || employee.bank_name || null,

      // Name/email normalization
      full_name: employee.fullName || employee.full_name || null,
      role_name: employee.role || employee.role_name || 'User'
    };

    console.log('[EMP] getById enriched:', {
      id: enriched.id,
      department_name: enriched.department_name,
      joiningDate: enriched.joiningDate,
      employment_type: enriched.employment_type,
      base_salary: enriched.base_salary
    });

    return { success: true, data: enriched };
  } catch (error) {
    console.error('[EMP] Error getting employee:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('employee:getByDepartment', async (event, { departmentId }) => {
  try {
    const employees = store.get('employees', []);
    const deptEmployees = employees.filter(e => e.departmentId === departmentId);
    return { success: true, data: deptEmployees };
  } catch (error) {
    console.error('[EMP] Error getting dept employees:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('employee:create', async (event, data) => {
  try {
    const employees = store.get('employees', []);
    const newEmployee = {
      id: Date.now().toString(),
      ...data,
      createdAt: new Date().toISOString(),
      status: 'active'
    };
    employees.push(newEmployee);
    store.set('employees', employees);

    logAction('CREATE', 'EMPLOYEE', newEmployee.id, null, newEmployee);
    console.log('[EMP] ✓ Created employee:', newEmployee.id);

    return { success: true, data: newEmployee };
  } catch (error) {
    console.error('[EMP] Error creating employee:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('employee:update', async (event, { id, ...data }) => {
  try {
    const employees = store.get('employees', []);
    const empIndex = employees.findIndex(e => e.id === id);
    if (empIndex === -1) {
      return { success: false, error: 'Employee not found' };
    }
    const oldValue = { ...employees[empIndex] };
    employees[empIndex] = { ...employees[empIndex], ...data };
    store.set('employees', employees);

    logAction('UPDATE', 'EMPLOYEE', id, oldValue, employees[empIndex]);
    console.log('[EMP] ✓ Updated employee:', id);

    return { success: true, data: employees[empIndex] };
  } catch (error) {
    console.error('[EMP] Error updating employee:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('employee:delete', async (event, { id }) => {
  try {
    const employees = store.get('employees', []);
    const empIndex = employees.findIndex(e => e.id === id);
    if (empIndex === -1) {
      return { success: false, error: 'Employee not found' };
    }
    const deleted = employees[empIndex];
    employees.splice(empIndex, 1);
    store.set('employees', employees);

    logAction('DELETE', 'EMPLOYEE', id, deleted, null);
    console.log('[EMP] ✓ Deleted employee:', id);

    return { success: true };
  } catch (error) {
    console.error('[EMP] Error deleting employee:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('employee:updateBankingDetails', async (event, { userId, ...details }) => {
  try {
    const employees = store.get('employees', []);
    const empIndex = employees.findIndex(e => e.id === userId);
    if (empIndex === -1) {
      return { success: false, error: 'Employee not found' };
    }
    const oldValue = { ...employees[empIndex] };
    employees[empIndex].bankingDetails = details;
    store.set('employees', employees);

    logAction('UPDATE_BANKING', 'EMPLOYEE', userId, oldValue, employees[empIndex]);
    console.log('[EMP] ✓ Updated banking details:', userId);

    return { success: true, data: employees[empIndex] };
  } catch (error) {
    console.error('[EMP] Error updating banking details:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('employee:import', async (event, { csvData }) => {
  try {
    const employees = store.get('employees', []);
    // Basic CSV parsing
    const lines = csvData.trim().split('\n');
    const imported = [];

    for (let i = 1; i < lines.length; i++) {
      const [name, email, departmentId, role] = lines[i].split(',').map(x => x.trim());
      if (name && email) {
        const newEmployee = {
          id: Date.now().toString() + i,
          fullName: name,
          email,
          departmentId,
          role: role || 'Employee',
          createdAt: new Date().toISOString(),
          status: 'active'
        };
        employees.push(newEmployee);
        imported.push(newEmployee);
      }
    }

    store.set('employees', employees);
    console.log('[EMP] ✓ Imported', imported.length, 'employees');

    return { success: true, data: imported };
  } catch (error) {
    console.error('[EMP] Error importing employees:', error);
    return { success: false, error: error.message };
  }
});

// ============================================================================
// ATTENDANCE HANDLERS
// ============================================================================
ipcMain.handle('attendance:signIn', async (event) => {
  try {
    const attendance = store.get('attendance', []);
    const today = new Date().toISOString().split('T')[0];
    const newRecord = {
      id: Date.now().toString(),
      userId: null,
      date: today,
      signInTime: new Date().toISOString(),
      signOutTime: null,
      status: 'present',
      notes: ''
    };
    attendance.push(newRecord);
    store.set('attendance', attendance);

    return { success: true, data: newRecord };
  } catch (error) {
    console.error('[ATT] Error signing in:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('attendance:signOut', async (event) => {
  try {
    const attendance = store.get('attendance', []);
    const today = new Date().toISOString().split('T')[0];
    const record = attendance.find(a => a.date === today && !a.signOutTime);
    if (!record) {
      return { success: false, error: 'No sign-in record found' };
    }
    record.signOutTime = new Date().toISOString();
    store.set('attendance', attendance);

    return { success: true, data: record };
  } catch (error) {
    console.error('[ATT] Error signing out:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('attendance:getHistory', async (event, { userId, startDate, endDate }) => {
  try {
    const attendance = store.get('attendance', []);
    const filtered = attendance.filter(a =>
      a.userId === userId && a.date >= startDate && a.date <= endDate
    );
    return { success: true, data: filtered };
  } catch (error) {
    console.error('[ATT] Error getting history:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('attendance:getByDate', async (event, { date }) => {
  try {
    const attendance = store.get('attendance', []);
    const filtered = attendance.filter(a => a.date === date);
    return { success: true, data: filtered };
  } catch (error) {
    console.error('[ATT] Error getting by date:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('attendance:create', async (event, { id, userId, date, signInTime, signOutTime, status, notes }) => {
  try {
    const attendance = store.get('attendance', []);
    const newRecord = {
      id,
      userId,
      date,
      signInTime,
      signOutTime,
      status,
      notes,
      createdAt: new Date().toISOString()
    };
    attendance.push(newRecord);
    store.set('attendance', attendance);

    logAction('CREATE', 'ATTENDANCE', id, null, newRecord);
    console.log('[ATT] ✓ Created attendance:', id);

    return { success: true, data: newRecord };
  } catch (error) {
    console.error('[ATT] Error creating attendance:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('attendance:updateStatus', async (event, { attendanceId, status, notes, signInTime, signOutTime }) => {
  try {
    const attendance = store.get('attendance', []);
    const record = attendance.find(a => a.id === attendanceId);
    if (!record) {
      return { success: false, error: 'Attendance record not found' };
    }
    const oldValue = { ...record };
    record.status = status;
    record.notes = notes;
    if (signInTime) record.signInTime = signInTime;
    if (signOutTime) record.signOutTime = signOutTime;
    store.set('attendance', attendance);

    logAction('UPDATE_STATUS', 'ATTENDANCE', attendanceId, oldValue, record);

    return { success: true, data: record };
  } catch (error) {
    console.error('[ATT] Error updating status:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('attendance:markHalfDay', async (event, { attendanceId }) => {
  try {
    const attendance = store.get('attendance', []);
    const record = attendance.find(a => a.id === attendanceId);
    if (!record) {
      return { success: false, error: 'Attendance record not found' };
    }
    const oldValue = { ...record };
    record.status = 'half-day';
    store.set('attendance', attendance);

    logAction('MARK_HALFDAY', 'ATTENDANCE', attendanceId, oldValue, record);

    return { success: true, data: record };
  } catch (error) {
    console.error('[ATT] Error marking half day:', error);
    return { success: false, error: error.message };
  }
});

// ============================================================================
// LEAVE HANDLERS
// ============================================================================
ipcMain.handle('leave:request', async (event, { leaveTypeId, startDate, endDate, reason }) => {
  try {
    const leave = store.get('leave', []);
    const newRequest = {
      id: Date.now().toString(),
      leaveTypeId,
      startDate,
      endDate,
      reason,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    leave.push(newRequest);
    store.set('leave', leave);

    logAction('REQUEST', 'LEAVE', newRequest.id, null, newRequest);

    return { success: true, data: newRequest };
  } catch (error) {
    console.error('[LEAVE] Error requesting leave:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('leave:getBalance', async (event, { userId }) => {
  return { success: true, data: { userId, balance: 20, used: 5, remaining: 15 } };
});

ipcMain.handle('leave:getRequests', async (event, { userId }) => {
  try {
    const leave = store.get('leave', []);
    const filtered = leave.filter(l => l.userId === userId);
    return { success: true, data: filtered };
  } catch (error) {
    console.error('[LEAVE] Error getting requests:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('leave:approveRequest', async (event, { requestId, notes }) => {
  try {
    const leave = store.get('leave', []);
    const request = leave.find(l => l.id === requestId);
    if (!request) {
      return { success: false, error: 'Leave request not found' };
    }
    const oldValue = { ...request };
    request.status = 'approved';
    request.approvalNotes = notes;
    store.set('leave', leave);

    logAction('APPROVE', 'LEAVE', requestId, oldValue, request);

    return { success: true, data: request };
  } catch (error) {
    console.error('[LEAVE] Error approving leave:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('leave:rejectRequest', async (event, { requestId, reason }) => {
  try {
    const leave = store.get('leave', []);
    const request = leave.find(l => l.id === requestId);
    if (!request) {
      return { success: false, error: 'Leave request not found' };
    }
    const oldValue = { ...request };
    request.status = 'rejected';
    request.rejectionReason = reason;
    store.set('leave', leave);

    logAction('REJECT', 'LEAVE', requestId, oldValue, request);

    return { success: true, data: request };
  } catch (error) {
    console.error('[LEAVE] Error rejecting leave:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('leave:getDepartmentRequests', async (event, { departmentId }) => {
  try {
    const leave = store.get('leave', []);
    return { success: true, data: leave };
  } catch (error) {
    console.error('[LEAVE] Error getting department requests:', error);
    return { success: false, error: error.message };
  }
});

// ============================================================================
// PAYROLL HANDLERS
// ============================================================================
ipcMain.handle('payroll:getData', async (event, { userId, month, year }) => {
  return {
    success: true,
    data: {
      userId, month, year,
      baseSalary: 50000,
      deductions: 5000,
      netSalary: 45000
    }
  };
});

ipcMain.handle('payroll:processMonthly', async (event, { month, year }) => {
  try {
    const payroll = store.get('payroll', []);
    const processRecord = {
      id: Date.now().toString(),
      month,
      year,
      processedAt: new Date().toISOString(),
      status: 'completed',
      employeesProcessed: 0
    };
    payroll.push(processRecord);
    store.set('payroll', payroll);

    return { success: true, data: processRecord };
  } catch (error) {
    console.error('[PAYROLL] Error processing payroll:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('payroll:addExpense', async (event, { payrollId, category, amount, description }) => {
  try {
    const expense = {
      id: Date.now().toString(),
      payrollId,
      category,
      amount,
      description,
      createdAt: new Date().toISOString()
    };
    return { success: true, data: expense };
  } catch (error) {
    console.error('[PAYROLL] Error adding expense:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('payroll:getHistory', async (event, { userId }) => {
  return { success: true, data: [] };
});

// ============================================================================
// AUDIT HANDLERS
// ============================================================================
ipcMain.handle('audit:getLogs', async (event, filters) => {
  try {
    const logs = store.get('auditLogs', []);
    let filtered = logs;
    if (filters && filters.userId) {
      filtered = filtered.filter(l => l.userId === filters.userId);
    }
    if (filters && filters.entityType) {
      filtered = filtered.filter(l => l.entityType === filters.entityType);
    }
    if (filters && filters.startDate) {
      filtered = filtered.filter(l => l.timestamp >= filters.startDate);
    }
    return { success: true, data: filtered.slice(-100) };
  } catch (error) {
    console.error('[AUDIT] Error getting logs:', error);
    return { success: false, error: error.message };
  }
});

// ============================================================================
// SYSTEM HANDLERS
// ============================================================================
ipcMain.handle('system:getVersion', async () => {
  return { success: true, version: '1.0.0' };
});

ipcMain.handle('system:getInfo', async () => {
  return {
    success: true,
    data: {
      platform: process.platform,
      nodeVersion: process.version
    }
  };
});

ipcMain.handle('system:openFilePicker', async () => {
  try {
    return { success: true, path: null };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ============================================================================
// EXCEL IMPORT/EXPORT HANDLERS
// ============================================================================
ipcMain.handle('excel:generateTemplate', async () => {
  try {
    const templateBuffer = excelUtils.generateEmployeeTemplate();
    console.log('[EXCEL] ✓ Generated employee template');
    return { success: true, data: templateBuffer };
  } catch (error) {
    console.error('[EXCEL] Error generating template:', error);
    return { success: false, error: error.message };
  }
});

// v4.4.1 — excel:parseFile + excel:validateData moved to
// src/main/handlers/excelHandlers.js so the server-mode entry can register
// them too. Registered here for the desktop path.
require('./handlers/excelHandlers').register(ipcMain);

ipcMain.handle('employee:bulkCreate', async (event, { employees }) => {
  try {
    console.log('[EXCEL] Starting bulk employee creation...');
    const storedEmployees = store.get('employees', []);
    const departments = store.get('departments', []);
    const departmentMap = new Map(departments.map(d => [d.name, d.id]));

    const results = {
      success: [],
      failed: []
    };

    for (const emp of employees) {
      try {
        // Map department name to ID
        const departmentId = departmentMap.get(emp.department);
        if (!departmentId) {
          results.failed.push({
            employee: emp,
            error: `Department "${emp.department}" not found`
          });
          continue;
        }

        // Create employee record
        const newEmployee = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          fullName: emp.fullName,
          email: emp.email,
          phone: emp.phone || '',
          username: emp.username || emp.fullName.toLowerCase().replace(/\s+/g, '_'),
          departmentId: departmentId,
          role: emp.role || 'Employee',
          baseSalary: emp.baseSalary || 0,
          isLead: emp.isTeamLead || false,
          bankAccountNumber: emp.bankAccountNumber || '',
          ifscCode: emp.ifscCode || '',
          createdAt: new Date().toISOString(),
          status: 'active'
        };

        storedEmployees.push(newEmployee);

        // If marked as team lead, assign to department
        if (emp.isTeamLead) {
          const dept = departments.find(d => d.id === departmentId);
          if (dept) {
            dept.lead = newEmployee.id;
            dept.lead_name = newEmployee.fullName;
            console.log(`[EXCEL] ✓ Assigned ${newEmployee.fullName} as team lead for ${dept.name}`);
          }
        }

        results.success.push({
          employee: newEmployee,
          message: `Created successfully`
        });

        logAction('CREATE', 'EMPLOYEE', newEmployee.id, null, newEmployee);
      } catch (error) {
        results.failed.push({
          employee: emp,
          error: error.message
        });
      }
    }

    // Save all changes
    store.set('employees', storedEmployees);
    store.set('departments', departments);

    console.log(`[EXCEL] ✓ Bulk creation complete: ${results.success.length} created, ${results.failed.length} failed`);

    return {
      success: results.failed.length === 0,
      data: results,
      summary: {
        created: results.success.length,
        failed: results.failed.length,
        total: employees.length
      }
    };
  } catch (error) {
    console.error('[EXCEL] Error in bulk creation:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('excel:exportEmployees', async () => {
  try {
    console.log('[EXCEL] Exporting employees to Excel...');
    const employees = store.get('employees', []);
    const departments = store.get('departments', []);

    const exportBuffer = excelUtils.exportEmployeeData(employees, departments);
    console.log(`[EXCEL] ✓ Exported ${employees.length} employees to Excel`);
    return { success: true, data: exportBuffer };
  } catch (error) {
    console.error('[EXCEL] Error exporting employees:', error);
    return { success: false, error: error.message };
  }
});

// ============================================================================
// TIME LOGGING HANDLERS
// ============================================================================
ipcMain.handle('timelogging:createTimeLog', async (event, { userId, date, startTime, breakStartTime, breakEndTime, endTime }) => {
  try {
    const timeLogs = store.get('timeLogs', []);

    // Check if a log already exists for this user and date
    const existingLogIndex = timeLogs.findIndex(l => l.userId === userId && l.date === date);

    let newLog;
    if (existingLogIndex !== -1) {
      // Update existing log
      const oldValue = { ...timeLogs[existingLogIndex] };
      newLog = {
        ...timeLogs[existingLogIndex],
        startTime,
        breakStartTime,
        breakEndTime,
        endTime,
        updatedAt: new Date().toISOString()
      };
      timeLogs[existingLogIndex] = newLog;
      logAction('UPDATE', 'TIME_LOG', newLog.id, oldValue, newLog);
      console.log('[TIMELOG] ✓ Updated time log:', newLog.id);
    } else {
      // Create new log
      newLog = {
        id: Date.now().toString(),
        userId,
        date,
        startTime,
        breakStartTime,
        breakEndTime,
        endTime,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      timeLogs.push(newLog);
      logAction('CREATE', 'TIME_LOG', newLog.id, null, newLog);
      console.log('[TIMELOG] ✓ Created time log:', newLog.id);
    }

    store.set('timeLogs', timeLogs);
    return { success: true, data: newLog };
  } catch (error) {
    console.error('[TIMELOG] Error creating/updating time log:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('timelogging:getTimeLogs', async (event, { userId, startDate, endDate }) => {
  try {
    const timeLogs = store.get('timeLogs', []);
    const filtered = timeLogs.filter(log =>
      log.userId === userId && log.date >= startDate && log.date <= endDate
    );
    console.log('[TIMELOG] ✓ Retrieved', filtered.length, 'time logs');
    return { success: true, data: filtered };
  } catch (error) {
    console.error('[TIMELOG] Error getting time logs:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('timelogging:updateTimeLog', async (event, { logId, startTime, breakStartTime, breakEndTime, endTime }) => {
  try {
    const timeLogs = store.get('timeLogs', []);
    const logIndex = timeLogs.findIndex(l => l.id === logId);

    if (logIndex === -1) {
      return { success: false, error: 'Time log not found' };
    }

    const oldValue = { ...timeLogs[logIndex] };
    timeLogs[logIndex] = {
      ...timeLogs[logIndex],
      startTime,
      breakStartTime,
      breakEndTime,
      endTime,
      updatedAt: new Date().toISOString()
    };

    store.set('timeLogs', timeLogs);
    logAction('UPDATE', 'TIME_LOG', logId, oldValue, timeLogs[logIndex]);
    console.log('[TIMELOG] ✓ Updated time log:', logId);

    return { success: true, data: timeLogs[logIndex] };
  } catch (error) {
    console.error('[TIMELOG] Error updating time log:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('timelogging:deleteTimeLog', async (event, { logId }) => {
  try {
    const timeLogs = store.get('timeLogs', []);
    const logIndex = timeLogs.findIndex(l => l.id === logId);

    if (logIndex === -1) {
      return { success: false, error: 'Time log not found' };
    }

    const deleted = timeLogs[logIndex];
    timeLogs.splice(logIndex, 1);
    store.set('timeLogs', timeLogs);

    logAction('DELETE', 'TIME_LOG', logId, deleted, null);
    console.log('[TIMELOG] ✓ Deleted time log:', logId);

    return { success: true, data: deleted };
  } catch (error) {
    console.error('[TIMELOG] Error deleting time log:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('timelogging:getUserTimeLogs', async (event, { userId, month, year }) => {
  try {
    const timeLogs = store.get('timeLogs', []);
    const filtered = timeLogs.filter(log => {
      const logDate = new Date(log.date);
      return log.userId === userId &&
             logDate.getMonth() === month - 1 &&
             logDate.getFullYear() === year;
    });
    console.log('[TIMELOG] ✓ Retrieved', filtered.length, 'time logs for user');
    return { success: true, data: filtered };
  } catch (error) {
    console.error('[TIMELOG] Error getting user time logs:', error);
    return { success: false, error: error.message };
  }
});

// ============================================================================
// MANAGER REVIEWS HANDLERS
// ============================================================================
ipcMain.handle('review:create', async (event, { employeeId, rating, comments }) => {
  try {
    const reviews = store.get('managerReviews', []);

    // Check if review already exists for this employee
    const existingIndex = reviews.findIndex(r => r.employeeId === employeeId);

    let newReview;
    if (existingIndex !== -1) {
      // Update existing review
      const oldValue = { ...reviews[existingIndex] };
      newReview = {
        ...reviews[existingIndex],
        rating,
        comments: comments || '',
        updatedAt: new Date().toISOString()
      };
      reviews[existingIndex] = newReview;
      logAction('UPDATE', 'MANAGER_REVIEW', newReview.id, oldValue, newReview);
    } else {
      // Create new review
      newReview = {
        id: Date.now().toString(),
        employeeId,
        managerId: currentUser?.id || 'admin',
        rating,
        comments: comments || '',
        reviewDate: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      reviews.push(newReview);
      logAction('CREATE', 'MANAGER_REVIEW', newReview.id, null, newReview);
    }

    store.set('managerReviews', reviews);
    return { success: true, data: newReview };
  } catch (error) {
    console.error('[REVIEW] Error creating/updating review:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('review:update', async (event, { reviewId, rating, comments }) => {
  try {
    const reviews = store.get('managerReviews', []);
    const reviewIndex = reviews.findIndex(r => r.id === reviewId);

    if (reviewIndex === -1) {
      return { success: false, error: 'Review not found' };
    }

    const oldValue = { ...reviews[reviewIndex] };
    const updatedReview = {
      ...reviews[reviewIndex],
      rating,
      comments: comments || '',
      updatedAt: new Date().toISOString()
    };
    reviews[reviewIndex] = updatedReview;

    store.set('managerReviews', reviews);
    logAction('UPDATE', 'MANAGER_REVIEW', reviewId, oldValue, updatedReview);

    return { success: true, data: updatedReview };
  } catch (error) {
    console.error('[REVIEW] Error updating review:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('review:getLatestByEmployee', async (event, { employeeId }) => {
  try {
    const reviews = store.get('managerReviews', []);
    const review = reviews.find(r => r.employeeId === employeeId);
    return { success: true, data: review || null };
  } catch (error) {
    console.error('[REVIEW] Error getting review:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('review:getAll', async (event, {}) => {
  try {
    const reviews = store.get('managerReviews', []);
    return { success: true, data: reviews };
  } catch (error) {
    console.error('[REVIEW] Error getting all reviews:', error);
    return { success: false, error: error.message };
  }
});

// ============================================================================
// SKILL ASSESSMENT HANDLERS
// ============================================================================
ipcMain.handle('skill:assess', async (event, { employeeId, skillId, rating }) => {
  try {
    const skills = store.get('employeeSkills', []);
    const skillKey = `${employeeId}-${skillId}`;
    const existingIndex = skills.findIndex(s => s.employeeId === employeeId && s.skillId === skillId);

    let newSkill;
    if (existingIndex !== -1) {
      // Update existing skill
      const oldValue = { ...skills[existingIndex] };
      newSkill = {
        ...skills[existingIndex],
        rating,
        assessmentDate: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      skills[existingIndex] = newSkill;
      logAction('UPDATE', 'SKILL_ASSESSMENT', newSkill.id, oldValue, newSkill);
    } else {
      // Create new skill assessment
      newSkill = {
        id: Date.now().toString() + Math.random().toString(36),
        employeeId,
        skillId,
        rating,
        assessmentDate: new Date().toISOString(),
        assessedBy: currentUser?.id || 'admin',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      skills.push(newSkill);
      logAction('CREATE', 'SKILL_ASSESSMENT', newSkill.id, null, newSkill);
    }

    store.set('employeeSkills', skills);
    return { success: true, data: newSkill };
  } catch (error) {
    console.error('[SKILL] Error assessing skill:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('skill:getByEmployee', async (event, { employeeId }) => {
  try {
    const skills = store.get('employeeSkills', []);
    console.log(`[SKILL] Getting skills for employee: ${employeeId} (type: ${typeof employeeId})`);
    console.log(`[SKILL] Total skills in store: ${skills.length}`);

    // Convert both to strings for comparison to handle type mismatches
    const employeeIdStr = String(employeeId);
    const employeeSkills = skills.filter(s => {
      const storedIdStr = String(s.employeeId);
      const match = storedIdStr === employeeIdStr;
      if (match) {
        console.log(`[SKILL]   ✓ Found skill: ${s.skillId} = ${s.rating}`);
      }
      return match;
    });

    console.log(`[SKILL] Found ${employeeSkills.length} skills for employee ${employeeId}`);
    return { success: true, data: employeeSkills };
  } catch (error) {
    console.error('[SKILL] Error getting employee skills:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('skill:getList', async (event, {}) => {
  try {
    const skills = store.get('predefinedSkills', []);
    return { success: true, data: skills };
  } catch (error) {
    console.error('[SKILL] Error getting skills list:', error);
    return { success: false, error: error.message };
  }
});

// ============================================================================
// DEBUG HANDLERS
// ============================================================================
ipcMain.handle('debug:getStoreData', async () => {
  try {
    console.log('\n[DEBUG] ================================================');
    console.log('[DEBUG] STORE DATA DUMP');
    console.log('[DEBUG] ================================================');

    const departments = store.get('departments', []);
    const employees = store.get('employees', []);

    console.log('[DEBUG] DEPARTMENTS:');
    departments.forEach((dept, i) => {
      console.log(`[DEBUG] [${i}] ${dept.name}`);
      console.log(`[DEBUG]      ID: ${dept.id}`);
      console.log(`[DEBUG]      Lead: ${dept.lead || 'null'}`);
      console.log(`[DEBUG]      Lead Name: ${dept.lead_name || 'null'}`);
    });

    console.log('\n[DEBUG] EMPLOYEES:');
    employees.forEach((emp, i) => {
      console.log(`[DEBUG] [${i}] ${emp.fullName || emp.full_name}`);
      console.log(`[DEBUG]      ID: ${emp.id}`);
      console.log(`[DEBUG]      isLead: ${emp.isLead || false}`);
      console.log(`[DEBUG]      Department: ${emp.departmentId}`);
    });

    console.log('[DEBUG] ================================================\n');

    return {
      success: true,
      data: {
        departments,
        employees
      }
    };
  } catch (error) {
    console.error('[DEBUG] Error:', error);
    return { success: false, error: error.message };
  }
});
