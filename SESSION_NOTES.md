# TaskTango — Session Handover Notes

Use this to ramp a new chat session quickly. Last updated end of V4.4.3 deploy.

---

## Where we are right now

- **Live web app**: https://tasktango.fly.dev (Fly.io, region `bom` / Mumbai, single 512 MB shared-cpu-1x machine, 1 GB persistent volume `tasktango_data` mounted at `/data`).
- **Latest desktop build**: `dist/TaskTango-Production-V4.3.zip` (~143 MB, Electron).
- **GitHub**: https://github.com/Guninderwalia/TT.git — `main` branch is the source of truth.
- **Default admin login** (re-seeded on fresh DB): `admin` / `password` — forced change on first login.
- **Office timezone**: default `Asia/Kolkata`, configurable in Settings page.

---

## Current backlog (V4.4.4 — queued, NOT started)

User wants these batched into the next build. Do NOT start coding without an explicit "build" instruction.

1. **"Wipe Test Data" button** in Admin Settings — one click clears all employee-generated data (attendance, time_logs, leave_requests, events, notifications, audit, chat, payroll, documents, employee_skills, banking, employment_records) but keeps roles, leave_types, settings, and the admin user. Add a type-to-confirm dialog.
2. **Presence dot on employee names** in chat + calls. Three states: 🟢 working (signed in, no break, has live SSE conn) · 🟡 on-break · ⚫ offline. Add a backend `chat:getPresence({userIds})` handler that combines the SSE subscriber map + today's attendance + today's time_log. Show dots on: conversation list, contacts list, open thread header, call ringing dialog, in-call peer badge. Poll every 30s + push SSE updates on connect/disconnect.
3. **Video call resizable + non-blocking** — add a minimize ➖ button on the in-call control bar. Minimized state = small draggable floating PiP window (~320×240) in the corner with remote video + tiny mute/end/expand controls. Rest of the app fully interactive. Position persists in localStorage.
4. **Hide Edit/Delete on Time Log History for non-admins** — `TimeLogging.jsx` is shared between employee/admin/lead views. Add a `canEdit` prop (default `false`); `AdminTimeLogging.jsx` passes `true`. Personal view + `LeadTimeLogging.jsx` keep default.
5. **Performance Review PDF**: replace "Employee ID" row with the employee's department **Team Lead** name. Also use the lead's name in the "Reviewed by" signature line (currently shows whoever clicked Download). Look up via `departments` + `employees` state already loaded in `AdminPerformanceReview.jsx`. PDF builder is `src/utils/pdf/pdfGenerator.js`, function `buildPerformanceReviewDoc` (~line 408 for the "Employee ID" row, ~line 476 for the signature).

When user says "build", ship them all as V4.4.4: bump `PRODUCT_VERSION` in `src/main/main.js`, run `fly deploy --remote-only`, no zip needed (web-only — they only ship desktop zips on explicit request).

---

## Architecture in one breath

- **Electron desktop app** + **web mode** running off the **same** React frontend.
- **Backend handlers** live in `src/main/handlers/*.js`, each exporting `register(ipcMain, db, store?)`.
- **Desktop entry**: `src/main/main.js` — boots Electron, creates BrowserWindow, registers handlers.
- **Server entry**: `src/server/server.js` (NEW in V4.4) — stubs `electron` via Module._load hook, sets `process.env.APPDATA = USER_DATA_PATH` (default `/data`), registers same handlers, starts Express on `:8080`.
- **HTTP bridge**: `src/main/webServer.js` patches `ipcMain.handle` so every IPC handler is auto-exposed as `POST /api/invoke {channel, args}`. Same Express server serves the React build statically + does SSE chat at `/api/chat/stream`.
- **Web client → backend**: `public/web-electron-shim.js` polyfills `window.electron` in the browser, forwarding each call to `/api/invoke`. Must be kept in sync with `src/main/preload.js` (add a method to one → add to the other).
- **DB**: SQLite via the `sqlite3` native module, file at `<USER_DATA_PATH>/TaskTango/tasktango.db`. Schema in `src/db/schema.sql` + migrations in `src/db/migrations.js`.

---

## Critical conventions (gotchas I learned the hard way)

1. **Office timezone**: ALL time stamping goes through `src/utils/officeTime.js` — `getOfficeDate()`, `getOfficeHHMM()`, `getOfficeHHMMSS()`. Default `Asia/Kolkata`. Renderer uses the same helpers (App.jsx applies the setting on mount). If you use `new Date().toISOString().split('T')[0]` directly you'll mismatch the backend and queries for "today" will return nothing. Internet time sync hits worldtimeapi.org → timeapi.io fallback.

2. **Binary over the wire = base64**: Every binary payload (employee export .xlsx, employee documents, chat attachments, DB backup) is base64-encoded on the backend and base64-decoded in the renderer before being wrapped in a Blob. Node `Buffer`s do NOT survive JSON-over-HTTP cleanly — they round-trip as `{"type":"Buffer","data":[...]}` and downstream Blob construction produces garbage. Pattern set in V4.4.1/V4.4.2.

3. **UNIQUE(user_id, date) UPSERTs**: Attendance and time_logs rows are upserted using `ON CONFLICT(user_id, date) DO UPDATE` — NOT `ON CONFLICT(id)`. The synthetic `{userId}-{date}` ID used by the calendar grid doesn't match the UUIDs created by sign-in flow, so id-based conflict targeting fails the unique pair constraint and saves silently fail. Fixed in V3.5.1, but if you write new handlers that touch these tables, use the (user_id, date) conflict target.

4. **SDP serialization for WebRTC**: `RTCSessionDescription` doesn't survive Electron IPC's structured clone — explicitly serialize as `{ type: sdp.type, sdp: sdp.sdp }` before sending through `callSignal`. Fixed in V4.2.

5. **Call stream attach timing**: `pc.ontrack` fires before the in-call `<video>` element exists in the DOM. Stash the stream in `remoteStreamRef`, then re-attach via a `useEffect` keyed on `callState`. Fixed in V4.4.2.

6. **mediaDevices secure-context**: `navigator.mediaDevices` is undefined on `http://<lan-ip>` (insecure) origins. Only works on HTTPS or localhost. Fly's HTTPS unblocks this. There's a friendly guard `ensureMediaSupport()` in `ChatWidget.jsx`.

7. **Excel handlers**: `excel:parseFile` and `excel:validateData` USED to be inline in `main.js`. As of V4.4.1 they're in `src/main/handlers/excelHandlers.js` so server mode picks them up.

8. **`employee:bulkCreate`** is in `employeeHandlers.js` (SQLite-backed). There was an older JSON-store version inline in `main.js` — the patched ipcMain replaces it.

9. **Existing `dist/` in git is huge**. The `dist/TaskTango-Production-V4.3/` folder is tracked (~400 MB of binaries). `.gitignore` now excludes `dist/`, `node_modules/`, `temp_asar/` (846 MB!), `~$*` Excel lockfiles, `*.zip`, `*.exe`. Don't accidentally re-track these.

10. **Demo seed data**: A fresh DB auto-seeds via `src/db/init.js` — creates roles, default departments (IT/HR/Finance), default leave types, admin user (`admin`/`password`). Wiping the DB file gives a clean re-seeded install.

---

## Versions shipped this session (chronological)

| Ver | Highlights |
|---|---|
| **V3** | Mobile-responsive CSS · dashboard analytics charts · offboarding flow · perf-review tweaks · chat icon in header |
| **V3.1** | Training-guides packaging fix |
| **V3.2** | Chat: pulse badge · auto-open latest unread · desktop notifications |
| **V3.3** | Chat: emoji picker |
| **V3.4** | Chat: file attachments (image preview + open) |
| **V3.5** | Training guides updated for V10→V3 changes |
| **V3.5.1** | Attendance UNIQUE-constraint fix · web shim missing methods added (charts, offboard, chat attachment) |
| **V4.0** | Voice + video calling (WebRTC + STUN + SSE signaling) |
| **V4.1** | Button-based time logging · lead time-log view · live team-status widget · chat beep + ring tones · mediaDevices guard |
| **V4.2** | SDP serialization fix · admin company-wide live status widget · multi-break events in net hours |
| **V4.2.1** | Activity duration shows minutes in brackets — "0.42h (25 min)" |
| **V4.3** | Office timezone (Asia/Kolkata default, configurable) · internet time sync · removed Start/End Work buttons · sign-in/out → time_logs · PDF export of activity graphs · timezone selector in Settings |
| **V4.4** | Server-mode entry (`src/server/server.js`) · Dockerfile (`node:20-trixie-slim`) · `fly.toml` · live on Fly.io |
| **V4.4.1** | Employee import/export fixed on web mode (excel:parseFile + validateData moved out of main.js inline · base64 wire format for export) |
| **V4.4.2** | Calls now two-way (stream stash + useEffect attach) · chat non-image attachment download (browser blob instead of shell.openPath) · DB backup base64 |
| **V4.4.3** | Sign-in revert fixed (office-zone "today" everywhere) · audited and fixed every renderer `new Date().toISOString().split('T')[0]` that drives data fetching |

---

## Daily ops cheatsheet

### Run locally (Electron desktop)
```powershell
cd C:\Users\GOD\Documents\TaskTango
npm install
npm run electron-dev
```

### Run locally (server mode, like Fly)
```powershell
$env:USER_DATA_PATH = ".\local-data"
npm run react-build
npm start
# Visit http://localhost:3002
```

### Build the desktop .zip
```powershell
npm run electron-build
# Then 7zip dist/win-unpacked/* into dist/TaskTango-Production-VX.Y.zip
& "node_modules\7zip-bin\win\x64\7za.exe" a -tzip -mx=5 "dist/TaskTango-Production-VX.Y.zip" "dist/win-unpacked/*"
```

### Deploy to Fly
```powershell
fly deploy --remote-only        # ~3 min with cached layers
fly logs                        # tail live logs
fly status                      # machine health
fly ssh console -a tasktango    # shell into the running container
fly volumes snapshots create tasktango_data   # take a backup point
```

### Cleanup options (when user wants to wipe test data)

**Full wipe** (re-seeds demo data on restart):
```powershell
fly ssh console -a tasktango
rm /data/TaskTango/tasktango.db
exit
fly machine restart d8d1500c724368
```

**Snapshot restore**:
```powershell
fly volumes snapshots list tasktango_data
fly volumes create tasktango_data_v2 --snapshot-id <id> --region bom
# Update fly.toml [[mounts]] source = "tasktango_data_v2" → fly deploy
```

---

## User preferences & working style (important)

- **Moves fast**: gives one bug per message, expects me to fix and either ship or queue. Has been deferring snapshot/wipe questions.
- **"dont zip till i ask"** — once told this, don't build desktop .zip until they say "zip now". Web builds (Fly) are fine if obvious.
- **"build"** = ship the accumulated backlog. Else keep adding to it.
- Doesn't like long explanations when no decision is needed. Likes the tabular bug-status summaries.
- Trusts me to make architectural calls but wants the trade-offs surfaced (e.g. WebRTC TURN cost, Supabase re-platform vs. Fly).
- Two-machine call testing: they've been testing calls between two browsers / users named like "Administrator" → suggests same-machine two-tab testing.
- Asks "is this on Github" → repo is at https://github.com/Guninderwalia/TT.git, only `main` branch active.
- Has a Fly account at admin@tasktango.co (which is also the domain they own, so they could add a custom domain later).
- **No payment method on Fly yet** — got a warning during launch about HA being disabled. Suggest adding a card when they go to production for failover.

---

## Things NOT yet built but discussed

- **TURN server** for WebRTC across symmetric NATs (currently STUN-only — works LAN + most home networks). ~£3/month for self-hosted coturn, or Twilio managed service.
- **Custom domain** for the Fly app (`fly certs create yourdomain.com`).
- **Supabase re-platform** — full Lovable prompt is saved at `LOVABLE_PROMPT.md` for if they ever want to go that route.
- **Daily off-site DB backups** to S3/R2 (Fly's volume snapshots cover daily auto-snapshots but on-volume; external would be safer).
- **Email integration** (#28 from the original master roadmap) — user explicitly declined this earlier.
- **Console.log cleanup** (#19 from the punch list — 34 leftover statements, mostly in db/init.js / webServer.js / migrateFromStore.js, some intentional).
- **More PDF templates** (#27 — salary slip exists, offer letter exists, performance review exists; nothing else asked for).

---

## File pointers for the new agent

| File | Purpose |
|---|---|
| `src/main/main.js` | Desktop Electron entry. ~800 lines. Has SimpleStore class for JSON-store fallback. Calls `initializeAuth(db)` + `registerDatabaseHandlers(db)` to bring everything up. |
| `src/server/server.js` | Server entry for Fly/Docker. Stubs `electron`, mirrors registration list from `main.js`. |
| `src/main/webServer.js` | Express server + `patchIpcMain` decorator + SSE for chat. Serves React build statically. |
| `src/main/preload.js` | Electron preload — exposes `window.electron.*` API to the renderer. ~250 methods. |
| `public/web-electron-shim.js` | Browser polyfill — must mirror preload exactly. ~400 lines. |
| `src/main/handlers/*.js` | All IPC handlers. Each module exports `register(ipcMain, db, store?)`. |
| `src/db/init.js` | DB initialization + seeding. DB_PATH built from `process.env.APPDATA || process.env.HOME`. |
| `src/db/migrations.js` | Idempotent column-additive migrations. Add new ones to the `runMigrations` call list. |
| `src/db/schema.sql` | The canonical schema (used on first install). |
| `src/utils/officeTime.js` | Timezone helpers + internet-time sync. Used in both main and renderer. |
| `src/utils/excelUtils.js` | Excel parse + export logic. Pure functions. |
| `src/utils/pdf/pdfGenerator.js` | pdfMake docDefinition builders + lazy loader. |
| `src/components/common/ChatWidget.jsx` | Chat + calls. ~1500 lines. The biggest single component. |
| `src/components/common/DashboardCharts.jsx` | All Chart.js widgets + `deriveTeamMemberStatus` helper. |
| `src/components/admin/EmployeeManager.jsx` | The 1500-line beast — CRUD + import + export + offboarding wired together. |
| `Dockerfile` + `fly.toml` | Production container config for Fly.io. |
| `FLY_DEPLOY.md` | Step-by-step deploy guide (mostly historical — already done). |
| `LOVABLE_PROMPT.md` | The Supabase re-platform spec if they ever want to migrate. |

---

## Open questions for the user (when continuing)

- Confirm V4.4.4 backlog before shipping (5 items listed at top of this file).
- Decide on Lead time-log edit permissions: should leads correct team members' logs, or strictly admin-only?
- Decide on `LeadTimeLogging` employee `canEdit` value (currently planned as `false`).
- Whether to also strip "Add Event" button from employee own-view (only admin-allowed events?).
- Whether to add a "Mark all read" or threading to chat at some point.
- Whether to add a TURN server (cost vs. coverage trade-off already explained).
