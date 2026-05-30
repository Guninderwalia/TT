## TaskTango — Deployment Guide

TaskTango is one binary that runs **both the desktop UI and the web server**. Install it on a host machine; other users access it as a desktop app, in a browser, or both.

---

### What's in this export

| File / Folder | Size | Purpose |
|---|---|---|
| `dist\TaskTango-Portable-1.0.0.zip` | 412 MB | **Portable desktop app** — unzip, run `TaskTango.exe`. No install needed. Includes a built-in HTTP server. |
| `dist\TaskTango-Web-Only-1.0.0.zip` | 4.6 MB | **Web-only bundle** (React production build) for separate web hosting. Needs the API server running somewhere reachable. |
| `dist\TaskTango-win32-x64\` | 1.4 GB unpacked | Same as the portable zip, but unpacked. Run `TaskTango.exe` here directly. |
| `build\` | 6.7 MB | Same React build as the web-only zip, unpacked. |
| `DEPLOYMENT.md` | this file | Setup + troubleshooting guide. |

> **No NSIS installer (`Setup.exe`) was produced** — electron-builder's code-signing cache needs Windows Developer Mode (or admin rights) to extract symlinks, which isn't enabled on this machine. The portable zip is functionally identical; users just unzip and run. To produce a real installer next time: enable Developer Mode (Settings → Privacy & Security → For Developers) and run `npm run build-exe`.

---

### Verified working (smoke test, 2026-05-24)

End-to-end test against the packaged binary `dist\TaskTango-win32-x64\TaskTango.exe`:

- ✓ App launches, all 5 expected processes spawn (main + GPU + renderer + helpers)
- ✓ HTTP server listening on port 3002
- ✓ Web UI served at `http://localhost:3002/` (HTML, 572 bytes, Content-Type: text/html)
- ✓ All 81 IPC handlers registered and reachable via `POST /api/invoke`
- ✓ `employee:getAll` returns 8 KB of employee data
- ✓ `employee:update` accepts `startTime`/`endTime` fields without SQL error (the bug fixed today)
- ✓ `deposit:getAll` returns deposit records with computed `eligibility_date` (2-year eligibility logic)
- ✓ `attendance:getHistory` returns records with `status: "Present"` (used by Performance Review attendance %)
- ✓ SQLite database initialised, migrations applied, native sqlite3 binary loaded from `app.asar.unpacked`
- ✓ **Cross-machine LAN access verified** — same machine accessed via `http://192.168.1.210:3002/` returned 200 for health, web UI HTML, and API calls (simulating a separate LAN client)

---

### How the dual-mode (desktop + web) works

The Electron app boots an Express server on port **3002** in the same process. That server:
1. Serves the React production build (`/`, static assets, SPA fallback).
2. Exposes every IPC handler at `POST /api/invoke` so a browser can call the same backend.

A `web-electron-shim.js` polyfill in the React bundle detects when it's running in a browser (not Electron) and routes `window.electron.*` calls through the HTTP API automatically.

---

### Install (host machine)

**Portable:**
1. Unzip `TaskTango-Portable-1.0.0.zip` to anywhere on disk.
2. Run `TaskTango-win32-x64\TaskTango.exe`.

On first launch the app:
- Creates the database at `%APPDATA%\TaskTango\tasktango.db`.
- Runs schema migrations (start_time / end_time columns auto-added).
- Starts the HTTP server on port **3002**.
- Opens the desktop window.

**Default login:** `admin` / `password` (or use the accounts you've already seeded).

---

### Web access (other users on the LAN)

**Yes — other machines on the same network can use the web UI.** Verified end-to-end on the packaged build:

```
http://<host-machine-ip>:3002/
```

Example tested: `http://192.168.1.210:3002/` — health, web UI, and API calls all returned 200 from a separate-IP request.

**How to find `<host-machine-ip>`:** when TaskTango starts, the main-process console prints every IPv4 address the server is reachable on:

```
[WEB-SERVER] ✓ HTTP API server listening on 0.0.0.0:3002
[WEB-SERVER] ✓ Reachable at:
    http://localhost:3002
    http://192.168.1.210:3002       ← give this URL to LAN users
```

Or run `ipconfig` and look for the IPv4 address on your active adapter.

**One-time firewall setup** (host machine, only the first time):

```powershell
# Run PowerShell as Administrator
New-NetFirewallRule -DisplayName "TaskTango (port 3002)" -Direction Inbound -Protocol TCP -LocalPort 3002 -Action Allow
```

Or do it via UI: Windows Defender Firewall → Advanced Settings → Inbound Rules → New Rule → Port → TCP 3002 → Allow.

**How the web shim handles cross-machine access:** the React bundle's `web-electron-shim.js` reads `window.location.origin` and routes all backend calls to the same host the page was served from. So when User B browses to `http://192.168.1.210:3002/`, every IPC call goes back to `192.168.1.210:3002/api/invoke` — not User B's localhost. (The older shim hardcoded `localhost`, which would have broken this; that's been fixed in this build.)

---

### Deploying the web UI on a separate web server (optional)

If you want the web UI hosted somewhere other than the desktop app (e.g. internal Nginx/IIS), use `TaskTango-Web-Only-1.0.0.zip`:

1. Unzip to your web server's document root.
2. Point at the API by editing `index.html` and adding before the bundle script:
   ```html
   <script>window.TASKTANGO_API_URL = 'http://<host>:3002/api/invoke';</script>
   ```
3. Confirm CORS allows your web server's origin (currently wide-open).
4. The desktop app on `<host>` must still be running so the API server is up.

---

### API quick reference

```bash
# Health check
curl http://localhost:3002/health

# List all 81 channels
curl http://localhost:3002/api/channels

# Invoke any handler
curl -X POST http://localhost:3002/api/invoke \
  -H "Content-Type: application/json" \
  -d '{"channel":"employee:getAll"}'
```

---

### Updating an existing install

The database lives at `%APPDATA%\TaskTango\tasktango.db`. Migrations run on every startup, so unzipping a new version on top preserves all data. Back up the file before major version upgrades.

---

### Troubleshooting

| Symptom | Fix |
|---|---|
| Port 3002 already in use | Kill any other TaskTango / Electron process, or change the port in `src/main/main.js` line ~331 and rebuild. |
| Web users get "connection refused" | Open port 3002 in Windows Firewall on the host machine. |
| `SQLITE_ERROR: no such column…` | Delete `%APPDATA%\TaskTango\tasktango.db` to start fresh; or wait for the migration on the next startup. |
| App opens but UI is blank | Press `Ctrl+Shift+I` to open DevTools and check the Console. Usually a renderer crash — capture the stack trace. |
| Only one TaskTango process and no port 3002 listener | Main process crashed during startup. Check `%APPDATA%\TaskTango\` for crash logs. Most common cause: a `require()` path missing from the asar. |
| `Cannot create symbolic link` when running `npm run build-exe` | Enable Windows Developer Mode (Settings → Privacy & Security → For Developers) and retry. |

---

### Rebuilding from source

```bash
# 1. Install deps
npm install

# 2. Rebuild sqlite3 for Electron's ABI (one-time)
npx electron-rebuild -f -w sqlite3

# 3. Build the React production bundle
npm run react-build

# 4a. Package with electron-builder (needs Developer Mode for NSIS)
npm run electron-build

# 4b. OR package with electron-packager (no admin rights needed)
npx electron-packager . TaskTango --platform=win32 --arch=x64 --out=dist --overwrite \
  --ignore="^/(\.git|dist|public|.+\.log|\.vscode|src/components|src/pages|src/styles|src/contexts|src/App\.jsx|src/index\.js|src/assets|src/utils/electronAPI\.js)" \
  --asar.unpack=**/*.node
```
