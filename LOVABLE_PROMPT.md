# TaskTango — Lovable Re-platform Prompt

Paste this verbatim as your initial prompt in Lovable. Use the "Iteration tips"
at the bottom to extend it once the base is generated.

---

## What I want you to build

**TaskTango** is a comprehensive HR & Employee Management web app for small-to-mid
businesses (10–200 employees). I'm re-platforming an existing Electron desktop app
to a Supabase-backed web app. Build it as **React + Vite + TypeScript** with
**Supabase** for Postgres, Auth, Storage, Realtime, and Edge Functions. Use
**Tailwind + shadcn/ui** for components. Theme is dark (navy/gold), with a light
mode toggle.

The app has **four roles**, all stored in a `roles` table with these names:
`Admin`, `MD` (treated same as Admin), `Lead` (department lead), `Manager`, `Employee` (default).

---

## High-level architecture

- **Auth**: Supabase Auth (email + password). First-login force-change-password.
  Admin can reset any user's password. Idle timeout: auto-logout after 30 min.
- **Database**: Postgres via Supabase. Use Row Level Security on every table.
- **File storage**: Supabase Storage buckets — `profile-pictures`, `chat-attachments`, `employee-documents`.
- **Real-time**: Supabase Realtime channels for chat messages and WebRTC call signaling.
- **Edge Functions**: use for anything beyond simple CRUD — payroll calculation, leave-balance
  rollover, performance KPIs, attendance aggregations, audit logging.
- **All times** stored as UTC; display in a configurable office timezone (default
  `Asia/Kolkata`; admin can change in Settings to any IANA zone). On every time-stamp
  action, fetch true UTC from a public time API (e.g. `worldtimeapi.org`) and cache
  the offset hourly so user laptop-clock drift doesn't poison timestamps.

---

## Postgres schema

Create these tables with RLS. All `id` columns are `uuid` defaulted to `gen_random_uuid()`.
All tables have `created_at` and `updated_at timestamptz default now()`.

### Identity & org
- `roles` — id, name unique, description.
- `departments` — id, name unique, description, lead_id (fk users), created_at.
- `users` — id (also matches auth.users.id), username unique, email, full_name,
  role_id (fk roles), department_id (fk departments, nullable), is_department_lead bool,
  is_first_login bool default true, profile_picture_url (Supabase Storage URL), phone,
  date_of_birth date, status text default 'active' check in ('active','inactive'),
  last_login_at timestamptz, **last_working_day date, exit_reason text, exit_notes text**
  (offboarding metadata). Sync with auth.users via trigger.
- `employment_records` — one row per user. user_id unique fk, start_date, end_date,
  employment_type default 'Permanent', base_salary numeric(12,2), currency default 'INR',
  is_probation bool default true, probation_end_date, start_time time default '09:00',
  end_time time default '18:00'.
- `banking_details` — user_id unique fk, bank_name, account_number, account_holder, ifsc_code, routing_code.

### Attendance & time
- `attendance` — id, user_id, date, sign_in_time time, sign_out_time time,
  status text default 'Present' (Present/Absent/Leave/Half-day), hours_worked numeric(5,2),
  is_late bool, late_hours numeric(5,2), is_early_departure bool, early_departure_hours numeric(5,2),
  is_half_day bool, notes. UNIQUE(user_id, date).
- `time_logs` — id, user_id, date, start_time, break_start_time, break_end_time, end_time,
  total_hours numeric(5,2), break_duration numeric(5,2), net_hours numeric(5,2).
  UNIQUE(user_id, date). Trigger: when attendance.sign_in_time / sign_out_time are
  set, mirror to time_logs.start_time / end_time on the same date.
- `events` — id, user_id, date, time, end_time time, activity_type, notes. Activity types:
  `admin_work, file_work, break, calls, compliance, internal_meeting, external_meeting,
  training_given, training_received, social_media, asset_finance, unforced_break`.

### Leave
- `leave_types` — id, name unique, annual_entitlement int default 25, description,
  carry_forward_enabled bool default false, max_carry_forward_days int default 0,
  expiry_months_after_year_end int default 0, encashment_enabled bool default false.
- `leave_balances` — id, user_id, leave_type_id, year, total_allocated, used, carried_forward,
  remaining, manual_override bool default false. UNIQUE(user_id, leave_type_id, year).
- `leave_requests` — id, user_id, leave_type_id, start_date, end_date, days_count, reason,
  status text default 'pending' (pending/approved/rejected/cancelled), requested_at,
  approved_by fk, approved_at, rejected_reason. Also support half-day requests (is_half_day,
  half_day_session 'morning'|'afternoon').
- `leave_balance_rollover_log` — audit row for each year-end rollover applied. user_id,
  leave_type_id, from_year, to_year, prev_remaining, carried_forward, encashed, forfeited,
  policy_snapshot jsonb, applied_at. UNIQUE(user_id, leave_type_id, to_year).

### Holidays
- `public_holidays` — id, holiday_name, date unique, description.

### Payroll
- `payroll` — id, user_id, payroll_month, payroll_year, base_salary, overtime_amount,
  bonus_amount, reimbursement_amount, attendance_deduction, probation_deposit_deduction,
  other_deductions, gross_amount, net_amount, status default 'Pending', processed_date, notes.
  UNIQUE(user_id, payroll_month, payroll_year).
- `monthly_expenses` — id, user_id, payroll_id fk, category, amount, description.
- `salary_increments` — id, user_id, prev_salary, new_salary, increment_date, reason, approved_by fk.

### Security deposits (probation)
- `probation_deposits` — id, user_id unique, deposit_amount, deduction_start_month,
  deduction_end_month, status default 'held' (held/released), released_date, notes.

### Overtime
- `overtime` — id, user_id, date, hours, rate_multiplier default 1.5, amount, status default 'pending',
  approved_by fk.

### Performance reviews
- `manager_reviews` — id, user_id unique, manager_id fk, rating int, comments, review_date.
- `predefined_skills` — id, name unique, category default 'soft'.
- `employee_skills` — id, user_id, skill_id, rating int, assessed_by fk, assessment_date.
  UNIQUE(user_id, skill_id).

### Documents
- `employee_documents` — id, user_id, uploaded_by fk, file_name, mime_type, file_size,
  storage_path (Supabase Storage), category (offer_letter/contract/id_proof/other), uploaded_at.

### Chat
- `chat_conversations` — id, type default 'direct', name, last_message_at.
- `chat_participants` — id, conversation_id fk, user_id fk, last_read_at. UNIQUE(conversation_id, user_id).
- `chat_messages` — id, conversation_id fk, sender_id fk, content text, sent_at,
  attachment_path text, attachment_name text, attachment_size int, attachment_mime text.

### Notifications
- `notifications` — id, user_id, title, message, type (info/success/warning/error), related_id, is_read default false.

### Audit
- `audit_logs` — id, user_id, action text, entity_type text, entity_id, old_value jsonb,
  new_value jsonb, ip_address, timestamp. Write a row from every mutating Edge Function.

### Settings
- `settings` — key text primary key, value text, updated_at. Seed with:
  `company_name`, `default_annual_leave='25'`, `probation_months='3'`, `working_hours_start='09:00'`,
  `working_hours_end='18:00'`, `office_timezone='Asia/Kolkata'`.

---

## RLS policies (sketch)

- Admins/MD: full read/write on everything.
- Leads: read all their department's data (employees, attendance, leave_requests, time_logs,
  events, manager_reviews, employee_skills). Write on attendance, leave_requests
  (approve/reject for their dept), manager_reviews for their team.
- Managers: same as Leads but possibly cross-department (your call).
- Employees: read/write **only their own** rows in attendance, time_logs, events,
  leave_requests, leave_balances, employee_documents. Read-only on departments,
  public_holidays, settings, leave_types. Can read chat messages from conversations
  they're a participant of, can insert messages where sender_id = auth.uid().

Use `auth.uid()` everywhere. Build a Postgres function `is_admin(uid)` and
`is_lead_of(uid, dept_id)` for cleaner policies.

---

## Roles & navigation

Three dashboards, picked at login based on `role.name`:

### Admin / MD dashboard
Sidebar: Dashboard · Employees · Departments · Attendance · Holidays · Leave Approvals ·
Time Logging · Performance Review · Payroll · Security Deposits · Audit Logs · Settings.

Dashboard widgets:
- Stat cards: Total Employees, Departments, Activity Logs, Payroll Management (clickable).
- **Live Employee Status** (Chart.js doughnut + roster list) — every active employee with
  their current status (Working / On Break / Signed Off / Not Started / Absent / On Leave),
  derived from today's attendance + time_logs row. Realtime: subscribe to changes.
- Analytics: stacked area chart of attendance trend last 30 days; doughnut for headcount by
  department; doughnut for today's attendance status.
- Probation ending soon table (next 30 days).
- Celebrations: birthdays + work anniversaries in the next 30 days.
- Upcoming approved leaves (company-wide).

### Lead dashboard
Sidebar (team): Team Members · Team Attendance · Leave Approvals · Team Performance · Team Time Logging.
Sidebar (personal): My Time Logging · My Attendance · My Leave Requests · My Performance · My Documents.

Dashboard widgets:
- Profile card.
- My Quick Stats: Log Time · Annual Leave Balance · Punctuality · Performance Score.
- Team Overview: Team Size · Present Today · Absent Today · On Leave · Pending Approvals.
- Live Team Status (same widget, dept-scoped).
- Analytics: team weekly attendance (stacked bar 7 days); team today (doughnut); My Hours
  last 12 weeks (line).
- Team birthdays/anniversaries (dept-scoped).
- Team upcoming leaves.

### Employee dashboard
Sidebar: Dashboard · My Profile · My Attendance · My Leave Requests · My Time Logging ·
My Performance · My Documents.

Widgets: profile card, leave balance per type, punctuality score, sign-in/out card,
today's status, my hours last 12 weeks.

---

## Detailed modules

### Employees (admin only)
List with search/filter/sort by department, status. Add/edit modal with: full name, email,
phone, username, department, role, base salary, joining date, probation flag, probation
end, work start/end times, bank details (encrypted at rest by Supabase), profile picture
upload. Bulk import via XLSX. Export to XLSX.

**Offboarding flow** (replaces delete): modal collects last_working_day, exit_reason
(Resignation/Termination/Contract End/Retirement), exit_notes, and an HR checklist (Final
salary processed, Security deposit refunded, Equipment returned, System access revoked).
On confirm: set status='inactive', write users.last_working_day/exit_reason/exit_notes,
update employment_records.end_date, auto-cancel pending leave_requests with start_date >
last_working_day, write audit log including checklist snapshot.

"Past Employees" toggle: list inactive users with Reactivate action that flips status
back to active and clears exit metadata.

### Departments
CRUD. Admin assigns a lead (sets users.is_department_lead = true on that user).

### Attendance
Calendar grid view per month with employee rows / day columns. Click a cell to mark
Present/Absent/Leave/Half-day. Sign In / Sign Out buttons on the employee dashboard
write to attendance AND mirror to time_logs.start_time/end_time. Late (after 09:00 office
time) and early departure (before 17:00) flags are auto-computed. Admin can bulk-mark a
date range. Filter by department.

### Time Logging
Per-day row per user. **Button-based UI** — no manual typing.
- Start Work / End Work come from attendance Sign In / Sign Out (read-only pills in the UI).
- Start Break / End Break buttons stamp the current time (office zone) into time_logs.
- Calculations: total_hours, break_duration (includes any event of activity_type='break'),
  net_hours. Auto-saved on every click.
- Daily activity log: add Events with start time + end time + activity type + notes. Show
  totals breakdown as a Bar chart per day / per week (7 days) / per month (30 days) / compare
  this-week-vs-last-week. **Export the graph to PDF** (using pdfMake-equivalent or
  react-pdf — capture the chart as PNG via Chart.js `toBase64Image()`).
- Admin TimeLogging view: dropdown to pick employee, then see their full time-log.
- Lead TimeLogging view: same, but employee dropdown scoped to the lead's department.

### Holidays
Admin CRUD on public_holidays. Per-month list and a list view.

### Leave Approvals
Employee submits leave_request → assigned to their lead → lead approves or rejects → if
approved by lead it goes to admin for final approval. Track approvals via approved_by /
approved_at. Show count of pending requests on dashboards.

**Leave types** are admin-configurable with rollover policy per type:
carry_forward_enabled, max_carry_forward_days, expiry_months_after_year_end,
encashment_enabled. On 1 Jan, run a rollover Edge Function that:
1. Reads each user's leave_balance for the previous year.
2. Per the type's policy: carries forward up to max_carry_forward_days; the rest is
   encashed (logged) or forfeited.
3. Writes a `leave_balance_rollover_log` row (used as the idempotency guard).
4. Creates the new year's leave_balance row with `carried_forward` populated.

### Payroll
Monthly run per employee: gross = base + overtime + bonus + reimbursement; deductions =
attendance (per-day rate × unpaid leave days) + probation deposit (if held) + other; net =
gross − deductions. Status: Pending → Paid. Generate PDF salary slip per employee.

### Performance Review
Per employee, for a date range. KPIs:
- **Attendance %** = (attended days) / (working days)
- **Punctuality %** based on per-employee expected start_time vs actual sign_in
- **Consistency %** based on time_log hours vs expected (start_time → end_time minus break)
- **Manager rating** /5
- **Avg skill rating** /5
- **Overall score**: 10% × attendance + 10% × punctuality + 10% × consistency + 10% ×
  (100 − lateness impact) + 20% × (manager rating × 20) + 40% × (avg skill × 20)

Filters: date range, department, **employee** (pick one), default first-of-month to today.
Show as a table with bars per metric. Export each review as PDF.

### Security Deposits
For employees still on probation, hold a deposit (default 20% of monthly salary for N
months). Track held/released. Released on end of probation or refunded as part of
offboarding.

### Audit Logs
Read-only list of all mutating actions across the app. Filter by user / action / entity
type / date. Admin only.

### Settings (admin)
- Company name
- Default annual leave (days/year)
- Probation length (months)
- Default working start / end times
- Office timezone (dropdown: Asia/Kolkata default, then Europe/London, Europe/Berlin,
  America/New_York, America/Chicago, America/Denver, America/Los_Angeles, Australia/Sydney,
  Asia/Singapore, Asia/Dubai, UTC)
- Leave Rollover Policy table — one row per leave type with the four policy columns
- Download DB backup (Postgres `pg_dump` via Edge Function; or just CSV exports per table)

---

## Chat (Supabase Realtime)

- Direct (1:1) chats between any two active employees.
- Sidebar: chat icon next to notification bell on every dashboard header.
- Compose features: text, emoji picker (curated ~80 popular emojis, no library), file
  attachment (10 MB max, image previews inline, other files open via blob URL).
- Realtime: subscribe to `chat_messages` table inserts filtered to user's conversations.
- Unread badge with pulse animation on the launcher.
- Auto-open most recent unread conversation when launcher clicked.
- Desktop notification (HTML5 `Notification` API) when window unfocused / chat closed.
- Beep sound (Web Audio API sine chirp) on incoming message when chat panel closed.
- Last-read tracking via chat_participants.last_read_at.

---

## Voice / Video calling (WebRTC)

1:1 only. Audio (📞) and video (🎥) buttons in the chat thread header.

- **Signaling** via a Supabase Realtime channel named `call:{conversationId}`. Send/receive
  `offer`, `answer`, `ice`, `hangup`, `reject` events.
- **STUN**: Google's public servers (`stun:stun.l.google.com:19302`, `stun:stun1.l.google.com:19302`).
  Add a note in code that TURN can be added later if NAT traversal fails.
- **Camera/mic**: `navigator.mediaDevices.getUserMedia({ audio: true, video })`.
  Web app is over HTTPS, so this is fine. Show a friendly error if denied.
- **Ring tone**: looped two-tone Web Audio pattern while ringing.
- **UI**: ringing dialog with Accept/Decline; in-call view with remote video full-screen,
  local PiP, mute/camera/end controls.
- On end: write a chat_messages row with "📞 Call ended" / "📞 Missed call" / "📞 Call declined"
  so the conversation log reflects it.

---

## Notifications

- Lead receives a notification when their team member submits a leave request.
- Admin receives a notification when a lead approves a leave request (needs final approval).
- Employee receives a notification when their leave is approved or rejected.
- Bell icon in header shows unread count; dropdown lists last 25; "Mark all as read" link.

---

## Settings the user expects on the front-end

- Theme toggle (dark / light) — persisted in localStorage.
- Office timezone (read from `settings.office_timezone` on app boot).
- Help menu items linking to training guides (HTML files in `/public/training-guides/`).

---

## Mobile responsiveness

- Tablet (≤900 px): sidebar collapses to a top bar.
- Phone (≤540 px): nav becomes icon-only, modals near-full-width, data tables horizontally
  scrollable. Stat-card grids stack to one column.

---

## Build order (do this exactly)

1. **Schema first**: create all tables + RLS policies. Seed roles, leave_types, settings.
2. **Auth + profile**: Supabase Auth, first-login password change flow, profile picture
   upload to Storage.
3. **Employees module**: CRUD + bulk import + offboarding modal.
4. **Departments module**: CRUD + lead assignment.
5. **Attendance**: sign in/out + calendar grid + admin bulk-mark.
6. **Time logging**: button-based UI + events + activity graph + PDF export.
7. **Leave**: types/balances/requests + approval flow + rollover Edge Function.
8. **Payroll**: monthly run + salary slip PDF.
9. **Performance review**: KPI calc + filters + per-employee drill-down + review PDF.
10. **Security deposits**: hold/release.
11. **Holidays**: CRUD.
12. **Documents**: upload/list/download per employee.
13. **Notifications**: bell + dropdown + insertion from approval flows.
14. **Audit log**: middleware that writes from every Edge Function mutation.
15. **Settings page** with all the keys above + office timezone dropdown + DB backup.
16. **Chat**: tables → realtime → composer → emoji/file → notifications/beep.
17. **Calls**: realtime signaling channel → WebRTC peer connection → UI.
18. **Dashboards**: stat cards, all charts, live status widget, celebrations.
19. **Training guides**: ship 4 HTML files in /public.
20. **Mobile responsive pass**.

For each module:
- Define Postgres tables + RLS.
- Wrap mutations in Edge Functions where logic is needed (everything beyond CRUD).
- Build the React UI with shadcn components.
- Add audit_logs entries for every mutation.

---

## Iteration tips (after the initial generation)

Lovable will not get all 80 handlers right in one pass. After the base generates,
iterate per module with prompts like:

- "Add the offboarding modal exactly as spec'd: 4-item HR checklist, auto-cancel
   pending leaves after last working day, audit log row with checklist snapshot."
- "Add the live employee status widget on the admin dashboard with a Chart.js doughnut +
   roster list. Status comes from today's attendance + time_logs row."
- "Add the WebRTC call signaling over a Supabase Realtime channel named
   `call:{conversationId}` with offer/answer/ice/hangup/reject events."
- "Add the leave rollover Edge Function scheduled for 1 Jan; idempotency guarded by
   the leave_balance_rollover_log table."

Keep each follow-up scoped to one module and reference the relevant section of this spec.

---

## Out of scope (do NOT build)

- Anything Electron-specific (Menu, dialog, shell, ipcMain, BrowserWindow).
- Native SQLite — we're using Postgres.
- Local filesystem storage — everything goes through Supabase Storage.
- Self-hosted SSE — Supabase Realtime replaces it.
- Bcryptjs auth — Supabase Auth replaces it.
- A "web shim" layer — there's only one runtime now (the browser).
