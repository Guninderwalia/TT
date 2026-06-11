# Task Tango Pulse — v2 Change Plan

**Branch:** `pulse-v2` (local only — nothing deploys until explicitly approved)
**Restore point:** tag `v1.0-prod-snapshot-2026-06-11` + DB backup at `TaskTango-backups/2026-06-11/tasktango-PROD-2026-06-11.db`
**Workflow:** build + test everything locally on this branch → review → then merge to `main` and `fly deploy`.

> Note: the original request skipped item numbers **2** and **11**. Listed items are 1, 3, 4, 5, 6, 7, 8, 9, 10, 12 plus two unnumbered (calendar visibility, remove employee event-delete) plus the AI agent. 13 work items total.

---

## A. Attendance & Breaks

### 4. Break status wrong + writes to previous day + show break in graphs
- **Symptoms:** starting a break still shows "Currently Working"; the break is recorded against the *previous* day; break time not visible on bar graphs.
- **Root cause (likely):** break start/end are stamped against the wrong office date (date-rollover/timezone), and/or the live-status derivation isn't picking up an in-progress break because the row is on yesterday's date.
- **Work:** fix the date the break is written to (use `getOfficeDate()` consistently); confirm `deriveTeamMemberStatus` flips to **On Break** when `breakStartTime && !breakEndTime`; add a break segment/series to the weekly hours bar chart.
- **Files:** `timelogHandlers.js`, `attendanceHandlers.js`, `DashboardCharts.jsx`, employee break UI.
- **DB:** none (uses existing `break_start_time` / `break_end_time`). *See item 10 for multiple-breaks schema.*
- **Effort:** ~3–4 hrs · **Risk:** medium (date logic).

### 10. Break safeguards: confirm before starting, 30-min cap, multiple smaller breaks
- **Work:** confirmation dialog before "Start Break" (same pattern as the sign-out guard); a 30-minute cap (**decision needed — warn vs auto-end**); allow more than one break per day so breaks can be taken in parts.
- **Files:** employee break UI, `timelogHandlers.js`.
- **DB:** **multiple breaks needs a schema change** — new `time_log_breaks` table (id, time_log_id, break_start, break_end) instead of the single break_start/break_end pair. Net-hours calc updated to sum all break segments.
- **Effort:** ~3–5 hrs · **Risk:** medium (schema migration + back-compat with existing single-break rows).

---

## B. Time Logging

### 1. Single-digit times (7:15) not accepted — only 07:15 works
- **Root cause:** a time parse/normalize path requires two leading digits somewhere in the validation chain even though the input pattern allows 1–2.
- **Work:** normalize `H:MM` → `HH:MM` on blur/submit; accept single-digit hours everywhere times are parsed.
- **Files:** `TimeLogging.jsx` (normalizeTime / validateTimes), `timelogHandlers.js`.
- **DB:** none. **Effort:** ~1 hr · **Risk:** low.

---

## C. Leave Management

### 7. Attach supporting document when applying for leave
- **Work:** add an optional file attachment to the leave request form (reuse the proven chat-attachment pipeline: base64 → save to disk → store path). Show a download link on the approval screen.
- **Files:** `LeaveRequestForm.jsx`, `leaveHandlers.js`, leave approval views, preload + web shim.
- **DB:** add `attachment_path/name/size/mime` to `leave_requests` (nullable, additive).
- **Effort:** ~2–3 hrs · **Risk:** low.

### 9. New "Saturday Off" leave type + "Type" filter on upcoming leaves
- **Work:** seed a new leave type (**name + paid/unpaid + entitlement — decision needed**, default "Saturday Off", does not deduct annual balance); add a **Type** dropdown filter to the upcoming-leaves list.
- **Files:** `src/db/init.js` (seed) or a migration, leave list/calendar views, `leaveHandlers.js`.
- **DB:** insert leave type row (idempotent). **Effort:** ~2–3 hrs · **Risk:** low.

---

## D. Attendance Management (Admin)

### 8. Department filter in Attendance Management
- **Good news:** the backend `attendance:getByDate` already accepts `departmentId`. Mostly a UI add.
- **Work:** add a Department dropdown to the admin Attendance screen (calendar + table views) and pass the selected department through.
- **Files:** `AttendanceTracker.jsx`.
- **DB:** none. **Effort:** ~1–2 hrs · **Risk:** low.

---

## E. Payroll

### 5. "Mark Paid" button per employee per month
- **Work:** a Mark Paid / Mark Unpaid toggle in the salary section, with a paid date + who marked it, and a visible Paid badge. Audited.
- **Files:** `PayrollManager.jsx`, `payrollHandlers.js`.
- **DB:** add `is_paid`, `paid_at`, `paid_by` to `payroll`.
- **Effort:** ~2–3 hrs · **Risk:** low.

### 6. Partial-day income (e.g. Rajan worked 4 hrs but counted as full day)
- **Decision needed** — three options:
  - **Auto pro-rate:** day's pay = (hours worked ÷ standard day hours) × daily rate, applied automatically.
  - **Manual adjustment:** admin sets a day-value/percentage per employee per day.
  - **Hybrid (recommended):** auto-suggest the pro-rated value, admin can override. Half-day already partially exists — extend it to arbitrary fractions.
- **Files:** `payrollHandlers.js`, attendance ↔ payroll calc, `PayrollManager.jsx`.
- **DB:** possibly a `day_value`/`worked_fraction` field on attendance or a payroll adjustment row.
- **Effort:** ~3–5 hrs · **Risk:** medium (touches money).

---

## F. Charts / Export

### 3. Graph export is white-themed; add "Export PDF" (replace Print)
- **Work:** replace the print flow with an **Export PDF** button that renders the dark dashboard correctly (html2canvas with the dark background captured, or render charts on a styled canvas → jsPDF). Existing `pdfGenerator.js` / `pdfmake` can assemble the PDF.
- **Files:** dashboard chart toolbar, `pdfGenerator.js` (or a new export util).
- **DB:** none. **Effort:** ~2–3 hrs · **Risk:** low–medium (rendering fidelity).

---

## G. Calendar / Events Permissions

### 12. Department calendar visible to everyone
- **Work:** ensure all roles (incl. employees) can *view* the department calendar.
- **Files:** calendar component + route guards, `eventHandlers.js` read path.
- **DB:** none. **Effort:** ~1–2 hrs · **Risk:** low.

### (unnumbered) Remove employees' ability to delete events from event logs
- **Work:** gate the delete-event button + the `event:delete` handler to admin/lead only (server-side enforced, like the reset-password fix).
- **Files:** event log UI, `eventHandlers.js`.
- **DB:** none. **Effort:** ~1 hr · **Risk:** low.

---

## H. Ask Pulse — AI assistant (Gemini)

- **Work:** new `ai:askPulse` handler calling Google Gemini; API key stored as a Fly secret; a persistent conversation table; an "Ask Pulse" panel in the UI (sidebar item or floating bubble); rate-limit + error handling; a system persona that knows it's inside Task Tango Pulse.
- **Decisions needed:** (a) free vs paid Gemini tier — **free tier may use inputs to train Google's models**, which matters if employees paste HR/PII data; paid tier opts out for a few $/month; (b) where Ask Pulse lives in the UI; (c) you'll need to provide a Gemini API key.
- **DB:** `pulse_conversations` (user_id, thread, messages).
- **Effort:** ~5–6 hrs · **Risk:** medium (external dependency, rate limits, privacy).

---

## Rough totals
~35–45 hours across 13 items. Suggested order: quick wins first (1, 8, 12, remove-event-delete), then leave (7, 9), payroll (5, 6), breaks (4, 10), export (3), and Ask Pulse last (largest + needs API key).

## Decisions (locked 2026-06-11)
1. **Ask Pulse:** build **last**, **free Gemini** tier. API key supplied later (Fly secret `GEMINI_API_KEY`).
2. **Item 6:** **Hybrid** — auto-suggest pro-rated value, admin can override per day.
3. **Item 10:** 30-min break = **warn, do not force-end**. Confirmation before start; multiple breaks allowed.
4. **Item 9:** "Saturday Off" **deducts** from annual leave balance (treated as paid leave).

## Build order (each committed separately on pulse-v2)
1. Time logging single-digit fix (item 1)
2. Department filter in Attendance Mgmt (item 8)
3. Department calendar visible to all (item 12)
4. Remove employee event-delete (unnumbered)
5. Leave attachment (item 7)
6. Saturday Off leave type + Type filter (item 9)
7. Mark Paid button (item 5)
8. Partial-day pay hybrid (item 6)
9. Break status/date fix + break in graphs (item 4)
10. Break safeguards: confirm + 30-min warn + multiple breaks (item 10)
11. Export PDF for charts (item 3)
12. Ask Pulse AI (Gemini) — last
