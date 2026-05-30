# Deploying TaskTango to Fly.io

End-to-end guide. Assumes you have the GitHub repo and a working V4.3 build.

> ⚠️ **Before any of this works, the app needs a small server-mode refactor**
> (≈ half a day of focused work). The current `src/main/main.js` requires
> Electron which won't run headless on a Linux server. Part 2 below walks
> through the refactor. Skip to Part 3 only if I've already done that for you
> (it'd ship as V4.4).

---

## Part 1 — Prerequisites

### 1.1 Install the Fly CLI

**Windows (PowerShell, run as admin):**
```powershell
iwr https://fly.io/install.ps1 -useb | iex
```

Close + reopen PowerShell, then verify:
```
fly version
```

### 1.2 Sign up + log in

```
fly auth signup
# (or `fly auth login` if you already have an account)
```

You'll need a credit card on file — Fly has a free tier that covers a small
office, but they require a card to prevent abuse.

### 1.3 Make sure your GitHub repo is up to date

```
cd C:\Users\GOD\Documents\TaskTango
git status
git add -A
git commit -m "Prep for Fly.io deploy"
git push
```

---

## Part 2 — Server-mode refactor (skip if already done)

The whole point: replace `require('electron')` calls in main with a thin
stub so the app runs as a plain Node process.

### 2.1 Create `src/server/server.js`

```js
// Server-mode entry point for Fly.io / Railway / Render / VPS.
// Stubs out Electron's main-process APIs, initialises the DB, registers
// all IPC handlers (which the patched ipcMain mirrors as HTTP routes),
// and starts the Express web server.

const path = require('path');
const fs = require('fs');

// Persistent data directory — Fly mounts a volume here.
const DATA_DIR = process.env.USER_DATA_PATH || '/data';
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}

// In-memory map that ipcMain.handle() would normally talk to. The
// patched ipcMain in webServer.js will read from this same map.
const handlers = new Map();

// Stubbed Electron surface — only the bits the handlers actually touch.
const electronStub = {
  app: {
    getPath: (name) => {
      // Map every Electron path request into our persistent volume.
      if (name === 'userData') return DATA_DIR;
      if (name === 'logs')     return path.join(DATA_DIR, 'logs');
      if (name === 'temp')     return path.join(DATA_DIR, 'tmp');
      return path.join(DATA_DIR, name);
    },
    disableHardwareAcceleration: () => {},
    commandLine: { appendSwitch: () => {} },
    on: () => {},
    quit: () => process.exit(0)
  },
  ipcMain: {
    handle: (channel, fn) => { handlers.set(channel, fn); },
    on:     (channel, fn) => { handlers.set('on:' + channel, fn); },
    removeHandler: (channel) => { handlers.delete(channel); }
  },
  BrowserWindow: class { constructor() { /* no-op in server mode */ } },
  Menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => {} },
  dialog: {
    showMessageBox: async () => ({ response: 0 }),
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true, filePath: '' })
  },
  shell: {
    openPath: async () => '',
    openExternal: async () => true
  },
  Notification: class {
    constructor() {} show() {} close() {}
  },
  session: { defaultSession: { setPermissionRequestHandler: () => {} } }
};

// Patch Node's require() so any file doing `require('electron')` gets
// our stub. Must happen before any handler file is loaded.
const Module = require('module');
const origResolve = Module._resolveFilename;
const origLoad = Module._load;
Module._load = function patched(request, parent, ...rest) {
  if (request === 'electron') return electronStub;
  return origLoad.call(this, request, parent, ...rest);
};

// Now safely import everything that depends on Electron.
const { patchIpcMain, startServer } = require('../main/webServer');
const { initializeDatabase } = require('../db/init');

(async () => {
  console.log('[SERVER] Initialising database in', DATA_DIR);
  let db;
  try {
    // The init module reads app.getPath('userData') which our stub
    // routes to DATA_DIR.
    db = await initializeDatabase();
    console.log('[SERVER] ✓ Database ready');
  } catch (err) {
    console.error('[SERVER] DB init failed:', err);
    process.exit(1);
  }

  patchIpcMain(electronStub.ipcMain);

  // Load the same auth + handler registration the desktop app uses.
  // These read from electronStub.ipcMain.handle() which feeds `handlers`.
  try {
    // Path matches what main.js does — adjust if your layout differs.
    const authMod = require('../main/auth');
    if (typeof authMod.initializeAuth === 'function') {
      await authMod.initializeAuth(db);
    }
  } catch (_) { /* auth module name may differ — that's fine */ }

  // Load every handler file so all channels are registered.
  const handlersDir = path.join(__dirname, '..', 'main', 'handlers');
  for (const f of fs.readdirSync(handlersDir).filter(n => n.endsWith('.js'))) {
    try {
      const mod = require(path.join(handlersDir, f));
      if (typeof mod.register === 'function') {
        mod.register(electronStub.ipcMain, db);
      }
    } catch (err) {
      console.error(`[SERVER] Failed to load handler ${f}:`, err.message);
    }
  }

  const port = Number(process.env.PORT) || 3002;
  await startServer(port);
  console.log(`[SERVER] ✓ TaskTango listening on :${port}`);
  console.log(`[SERVER] ✓ Data dir: ${DATA_DIR}`);
})();
```

### 2.2 Add the start script

In `package.json` add to `"scripts"`:

```json
"start": "node src/server/server.js",
"server-build": "npm run react-build"
```

### 2.3 Make the chat-attachments path use the same env

Open `src/main/handlers/chatHandlers.js` — the `attachmentsDir()` function
already uses `app.getPath('userData')`, which our stub redirects to
`/data`. No change needed there. Same for any other handler that calls
`app.getPath`.

### 2.4 Quick local sanity test

Build the React frontend and run server mode:

```
npm install
npm run react-build
$env:USER_DATA_PATH = ".\local-data"     # PowerShell
npm start
```

Visit `http://localhost:3002` — you should get the login screen and be
able to log in (default admin / `password`, forced password change first
login).

---

## Part 3 — Containerize

### 3.1 Create `Dockerfile` in repo root

```dockerfile
FROM node:20-bookworm-slim

# Native modules (sqlite3, bcrypt) need build tools at install time.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first so the layer caches when only source changes.
COPY package*.json ./
RUN npm install --omit=dev

# Copy source.
COPY . .

# Build the React frontend (served by webServer.js).
RUN npm run react-build

# Persistent data lives here; Fly mounts the volume at this path.
ENV USER_DATA_PATH=/data
ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "src/server/server.js"]
```

### 3.2 Create `.dockerignore` in repo root

```
node_modules
build
dist
local-data
.git
.env*
*.zip
*.exe
```

### 3.3 Local Docker test (optional but recommended)

```
docker build -t tasktango .
docker run --rm -p 8080:8080 -v ${PWD}/local-data:/data tasktango
```

Visit `http://localhost:8080` — same login flow.

---

## Part 4 — Fly.io setup

### 4.1 Launch (creates the app, does NOT deploy)

From the repo root:

```
fly launch --no-deploy
```

Walk through the prompts:
- **App name**: `tasktango` (or pick your own — must be globally unique on Fly)
- **Organization**: personal
- **Region**: pick the one closest to your users:
  - `lhr` — London
  - `bom` — Mumbai
  - `sin` — Singapore
  - `iad` — US East
  - etc. (`fly platform regions` to see all)
- **PostgreSQL?**: No
- **Redis?**: No
- **Deploy now?**: No

This creates a `fly.toml` in your repo.

### 4.2 Edit `fly.toml`

Replace the auto-generated file with this (keep your `app = "..."` line and
your chosen `primary_region`):

```toml
app = "tasktango"
primary_region = "lhr"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1

[[mounts]]
  source = "tasktango_data"
  destination = "/data"

[env]
  NODE_ENV = "production"
  USER_DATA_PATH = "/data"
  # Default office timezone — admins can change via Settings later.
  OFFICE_TIMEZONE = "Asia/Kolkata"

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 512
```

Important: `auto_stop_machines = false` because chat SSE needs a
persistently-running instance — if Fly shuts the machine down between
requests, chat breaks.

### 4.3 Create the persistent volume

```
fly volumes create tasktango_data --size 1 --region lhr
```

(1 GB; bump later with `fly volumes extend ...` if you outgrow it.)

### 4.4 Deploy

```
fly deploy
```

This builds the Docker image on Fly's builder, pushes it, and starts the
machine. First build takes ~5 min (Node 20 base + sqlite3 native compile).
Subsequent deploys are much faster.

### 4.5 Watch the logs

```
fly logs
```

You should see:
```
[DB]   ✓ Database initialized successfully
[SERVER] ✓ TaskTango listening on :8080
```

### 4.6 Open it

```
fly apps open
```

Or visit `https://tasktango.fly.dev` directly. You'll get HTTPS for free —
that means **WebRTC calls work** (unlike `http://lan-ip` deployments).

---

## Part 5 — First-run admin login

The DB seeds itself on first boot (per `src/db/init.js`). Log in as:

- **Username**: `admin`
- **Password**: `password`

You'll be forced to set a new password immediately. Then create departments,
add employees, etc.

---

## Part 6 — Custom domain (optional)

If you own `tasktango.yourcompany.com`:

```
fly certs create tasktango.yourcompany.com
fly certs show tasktango.yourcompany.com
```

It tells you which DNS records to set at your domain registrar. Add the
`CNAME` and `A` records as instructed. SSL certificate provisions
automatically within a few minutes.

---

## Part 7 — Useful follow-on commands

```
fly logs                           # tail live logs
fly status                         # machine + health
fly ssh console                    # shell inside the running container
fly scale memory 1024              # bump to 1 GB RAM
fly volumes list                   # check disk usage
fly secrets set FOO=bar            # add an env var without exposing it in fly.toml
fly releases                       # deploy history
fly machine restart <id>           # restart after a code change without redeploy
fly deploy --no-cache              # rebuild from scratch if you hit weird caching
```

---

## Part 8 — Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Build fails on `sqlite3` | Native compile needs build tools | Already covered by the apt-get line in the Dockerfile |
| 502 / app crashes on boot | Stub didn't cover an Electron API a handler uses | `fly logs` will show the exact `require('electron').something is undefined` — add it to `electronStub` |
| File uploads disappear after redeploy | Wrote to a path outside `/data` | Make sure every handler that writes files uses `app.getPath('userData')` (which routes to `/data`) |
| Chat realtime drops | Machine auto-stopped | Confirm `auto_stop_machines = false` in fly.toml |
| Calls fail to connect | LAN browser at `http://lan-ip` blocking `getUserMedia` | Use the Fly HTTPS URL instead |
| Custom domain not working | DNS not propagated | `dig tasktango.yourcompany.com` to verify; certs take 1–10 min |

---

## Estimated cost

A small office (10–30 active users, light chat, occasional calls) on the
config above:

- **Fly Machine**: ~£0–4/month (free allowance covers 1 shared-cpu-1x machine
  with 256 MB; bump to 512 MB and you start paying ~£3/month)
- **Persistent volume**: ~£0.15/GB-month = £0.15 for 1 GB
- **Outbound bandwidth**: free up to 100 GB/month

Total realistically: **£3–7/month**.

---

## What's still NOT included (defer to follow-on tasks)

- **TURN server** for WebRTC — STUN alone works on most networks but not
  symmetric NATs. Fly hosts can run coturn; ~£3/month extra.
- **Daily off-site DB backup** — set a `fly cron` (Fly Machines schedules)
  to `pg_dump` (or in our case, `cp /data/tasktango.db`) to S3 / R2.
- **Sentry / error tracking** — wire `@sentry/node` in `server.js`.
- **Custom email sender for password resets** — Supabase Auth would handle
  this for free; on our stack you'd hook up SendGrid / Postmark.
