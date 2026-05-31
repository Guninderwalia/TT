/**
 * Background cron jobs.
 *
 * Three scheduled chores, all running on a single hourly tick to keep things
 * predictable and easy to reason about:
 *
 *   1. Auto-mark Absent — for every active employee with NO sign_in_time
 *      today AND no existing attendance row in (Absent / Leave), once the
 *      office clock has rolled past their start_time + 30-min grace, write
 *      status='Absent' so HR doesn't have to chase them.
 *
 *   2. Probation auto-flip — when an employee's probation_end_date has
 *      passed, set is_probation=0 so they don't keep appearing in the
 *      "Probation Ending Soon" reminder forever.
 *
 *   3. Auto-sign-out — once the office clock is past 23:00, any employee
 *      who signed IN today but never signed OUT gets a synthetic sign_out
 *      stamped at their default end_time. Flagged in the audit log as
 *      AUTO_SIGN_OUT so admin knows it was the system, not the user.
 *
 * Registered from both Electron main.js and src/server/server.js so the
 * same scheduled work happens in desktop AND server mode. Each job is
 * idempotent — running it twice in the same window is a no-op.
 */

const { writeAudit } = require('./handlers/_auditHelper');

// Office-time helpers (the one source of truth for "today" / "now").
const officeTime = require('../utils/officeTime');

// Compare two HH:MM strings — returns true if `a` >= `b`.
function hhmmGte(a, b) {
  if (!a || !b) return false;
  return String(a).slice(0, 5) >= String(b).slice(0, 5);
}

// v4.7.1 — Exported so the chat presence helper + dashboard widgets can
// use the same definition of "non-working day" the cron does. Keeping
// one source of truth here avoids drift.
module.exports.isNonWorkingDay = (db, today) => isNonWorkingDay(db, today);

// Returns true if `today` is a non-working day for the company:
//   - Saturday or Sunday (the default weekend, until a per-employee weekly
//     schedule is added in a later release), OR
//   - listed in the public_holidays table.
// Admin can override the weekend default via the app_settings key
// `non_working_dow` — comma-separated day-of-week numbers (0=Sun, 6=Sat).
async function isNonWorkingDay(db, today) {
  try {
    // Day-of-week from the office-date string (YYYY-MM-DD). Build at noon UTC
    // to avoid timezone slippage either side of midnight.
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay();

    let nonWorkDow = [0, 6]; // default Sat/Sun
    try {
      const row = await db.get(
        `SELECT value FROM app_settings WHERE key = 'non_working_dow'`
      );
      if (row && row.value) {
        const parsed = String(row.value).split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
        if (parsed.length > 0) nonWorkDow = parsed;
      }
    } catch (_) { /* settings table optional */ }
    if (nonWorkDow.includes(dow)) return { skip: true, reason: `weekend (dow=${dow})` };

    const hol = await db.get(
      `SELECT holiday_name FROM public_holidays WHERE date = ?`,
      [today]
    );
    if (hol) return { skip: true, reason: `public holiday (${hol.holiday_name})` };

    return { skip: false };
  } catch (e) {
    console.warn('[CRON] isNonWorkingDay check failed:', e.message);
    return { skip: false };
  }
}

async function runAutoMarkAbsent(db) {
  try {
    const today = officeTime.getOfficeDate();
    const nowHHMM = officeTime.getOfficeHHMM();

    // Skip on weekends and public holidays — running the cron on a non-working
    // day was the v4.5 bug that turned every dashboard red on Sunday morning.
    const check = await isNonWorkingDay(db, today);
    if (check.skip) {
      console.log(`[CRON] Skipping auto-mark-absent for ${today} — ${check.reason}`);
      return;
    }

    // Active employees with no attendance row today.
    // (employment_records.start_time gives the per-employee expected start.)
    const candidates = await db.all(
      `SELECT u.id, COALESCE(er.start_time, '09:00') AS expected_start
         FROM users u
         LEFT JOIN employment_records er ON er.user_id = u.id
        WHERE u.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM attendance a WHERE a.user_id = u.id AND a.date = ?
          )`,
      [today]
    );
    let marked = 0;
    for (const c of candidates) {
      // 30-minute grace period after their expected start time.
      const [sh, sm] = String(c.expected_start || '09:00').split(':').map(Number);
      const cutoffMins = (sh * 60 + sm) + 30;
      const [nh, nm] = nowHHMM.split(':').map(Number);
      const nowMins = nh * 60 + nm;
      if (nowMins < cutoffMins) continue;

      const id = `${c.id}-${today}`;
      await db.run(
        `INSERT INTO attendance (id, user_id, date, status)
         VALUES (?, ?, ?, 'Absent')
         ON CONFLICT(user_id, date) DO NOTHING`,
        [id, c.id, today]
      );
      try {
        await writeAudit(db, 'system', {
          action: 'ATTENDANCE_AUTO_ABSENT',
          entityType: 'ATTENDANCE',
          entityId: id,
          oldValue: null,
          newValue: { date: today, status: 'Absent', reason: 'No sign-in by start_time + 30 min' }
        });
      } catch (_) {}
      marked++;
    }
    if (marked > 0) console.log(`[CRON] Auto-marked ${marked} employee(s) Absent for ${today}`);
  } catch (e) {
    console.error('[CRON] auto-mark-absent failed:', e);
  }
}

async function runProbationFlip(db) {
  try {
    const today = officeTime.getOfficeDate();
    const rows = await db.all(
      `SELECT er.id, er.user_id, er.probation_end_date
         FROM employment_records er
         JOIN users u ON u.id = er.user_id
        WHERE er.is_probation = 1
          AND er.probation_end_date IS NOT NULL
          AND er.probation_end_date <= ?
          AND u.status = 'active'`,
      [today]
    );
    let flipped = 0;
    for (const r of rows) {
      await db.run(
        `UPDATE employment_records SET is_probation = 0 WHERE id = ?`,
        [r.id]
      );
      try {
        await writeAudit(db, 'system', {
          action: 'PROBATION_AUTO_COMPLETE',
          entityType: 'EMPLOYMENT_RECORD',
          entityId: r.id,
          oldValue: { is_probation: 1, probation_end_date: r.probation_end_date },
          newValue: { is_probation: 0 }
        });
      } catch (_) {}
      flipped++;
    }
    if (flipped > 0) console.log(`[CRON] Probation auto-flipped for ${flipped} employee(s)`);
  } catch (e) {
    console.error('[CRON] probation-flip failed:', e);
  }
}

async function runAutoSignOut(db) {
  try {
    const today = officeTime.getOfficeDate();
    const nowHHMM = officeTime.getOfficeHHMM();
    // Only run after 23:00 office time so we don't sign people out early.
    if (nowHHMM < '23:00') return;

    // Same weekend/holiday guard as auto-absent — no point auto-signing-out
    // people who weren't supposed to work today anyway.
    const check = await isNonWorkingDay(db, today);
    if (check.skip) {
      console.log(`[CRON] Skipping auto-sign-out for ${today} — ${check.reason}`);
      return;
    }

    const rows = await db.all(
      `SELECT a.id, a.user_id, a.sign_in_time,
              COALESCE(er.end_time, '18:00') AS expected_end
         FROM attendance a
         LEFT JOIN employment_records er ON er.user_id = a.user_id
        WHERE a.date = ?
          AND a.sign_in_time IS NOT NULL
          AND a.sign_out_time IS NULL`,
      [today]
    );
    let stamped = 0;
    for (const r of rows) {
      // Use the expected end_time so net hours don't count overtime the
      // employee didn't actually work past their schedule.
      const signOut = String(r.expected_end || '18:00');
      const [sih] = String(r.sign_in_time || '00:00').split(':').map(Number);
      const [soh] = signOut.split(':').map(Number);
      const hoursWorked = Math.max(0, soh - sih).toFixed(2);

      await db.run(
        `UPDATE attendance
            SET sign_out_time = ?, hours_worked = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [signOut, hoursWorked, r.id]
      );
      // Also mirror to time_logs end_time if the row exists.
      await db.run(
        `UPDATE time_logs
            SET end_time = COALESCE(end_time, ?), updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ? AND date = ?`,
        [signOut, r.user_id, today]
      );
      try {
        await writeAudit(db, 'system', {
          action: 'ATTENDANCE_AUTO_SIGN_OUT',
          entityType: 'ATTENDANCE',
          entityId: r.id,
          oldValue: { sign_out_time: null },
          newValue: { sign_out_time: signOut, reason: 'No manual sign-out by 23:00 office time' }
        });
      } catch (_) {}
      stamped++;
    }
    if (stamped > 0) console.log(`[CRON] Auto-signed-out ${stamped} employee(s) for ${today}`);
  } catch (e) {
    console.error('[CRON] auto-sign-out failed:', e);
  }
}

async function runAllNow(db) {
  await runAutoMarkAbsent(db);
  await runProbationFlip(db);
  await runAutoSignOut(db);
}

// Start an interval-based scheduler. Runs every hour (3,600,000 ms). Also
// fires once immediately on startup so a fresh deploy picks up any
// missed work since the last container went down.
function start(db) {
  if (!db) return null;
  console.log('[CRON] Starting scheduler — runs hourly');
  runAllNow(db).catch(e => console.error('[CRON] initial run failed:', e));
  return setInterval(() => {
    runAllNow(db).catch(e => console.error('[CRON] tick failed:', e));
  }, 60 * 60 * 1000);
}

module.exports = { start, runAllNow, runAutoMarkAbsent, runProbationFlip, runAutoSignOut };
