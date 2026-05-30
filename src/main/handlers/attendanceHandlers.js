const { v4: uuidv4 } = require('uuid');
const { format, differenceInHours, isPublicHoliday } = require('date-fns');
const { writeAudit } = require('./_auditHelper');
// v4.3: Always stamp times in the office timezone (default Europe/London)
// instead of the OS's local zone. Stops a laptop set to AEST from writing
// "19:00" for a 09:00 UK sign-in. Optional internet-time offset is applied
// transparently — see src/utils/officeTime.js for details.
const { getOfficeDate, getOfficeHHMMSS } = require('../../utils/officeTime');

// Shape an attendance row for the renderer: keep snake_case AND add camelCase
// aliases so the AttendanceLogger view (which reads record.signInTime) and
// the attendance grid (which reads sign_in_time) both work off the same row.
function mapAttendanceOut(row) {
  if (!row) return row;
  return {
    ...row,
    signInTime: row.sign_in_time || null,
    signOutTime: row.sign_out_time || null,
    hoursWorked: row.hours_worked || null,
    isLate: row.is_late === 1,
    isHalfDay: row.is_half_day === 1,
    isEarlyDeparture: row.is_early_departure === 1,
    status: (row.status || 'present').toLowerCase()
  };
}

function register(ipcMain, db) {
  ipcMain.handle('attendance:signIn', async (event, args = {}) => {
    try {
      // The frontend now passes userId explicitly via window.electron.signIn(user.id).
      // The old version used event.sender.id (a WebContents ID), which never
      // matched a users.id and so always returned "User not authenticated".
      const userId = args && args.userId;
      if (!userId) return { success: false, message: 'userId required', error: 'userId required' };

      const user = await db.get('SELECT id FROM users WHERE id = ?', [userId]);
      if (!user) return { success: false, message: 'User not found', error: 'User not found' };

      // Office-zone stamps so display stays consistent regardless of where
      // the employee's laptop is physically located.
      const today = getOfficeDate();
      const now = getOfficeHHMMSS();

      const existing = await db.get(
        'SELECT * FROM attendance WHERE user_id = ? AND date = ?',
        [userId, today]
      );

      if (existing && existing.sign_in_time) {
        // Already signed in — return the existing row so the UI re-syncs
        return { success: true, message: 'Already signed in today', data: mapAttendanceOut(existing) };
      }

      // Late if sign-in is after 09:00
      const [h, m] = now.split(':').map(Number);
      const isLate = h > 9 || (h === 9 && m > 0);
      const lateHours = isLate ? Math.max(0, h - 9 + (m > 0 ? 1 : 0)) : 0;

      let attendanceId;
      if (existing) {
        // Row exists (e.g. status was bulk-marked) — just fill in sign-in
        attendanceId = existing.id;
        await db.run(
          `UPDATE attendance
              SET sign_in_time = ?, is_late = ?, late_hours = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
          [now, isLate ? 1 : 0, lateHours, existing.id]
        );
      } else {
        attendanceId = uuidv4();
        await db.run(
          `INSERT INTO attendance (id, user_id, date, sign_in_time, status, is_late, late_hours)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [attendanceId, userId, today, now, 'Present', isLate ? 1 : 0, lateHours]
        );
      }

      // Mirror to time_logs so the Time Logging view (and the Consistency
      // metric in performance reviews) sees the same start time. Upsert by
      // (user_id, date).
      const existingLog = await db.get(
        'SELECT id, start_time FROM time_logs WHERE user_id = ? AND date = ?',
        [userId, today]
      );
      if (existingLog) {
        // Only overwrite start_time if it wasn't set manually
        if (!existingLog.start_time) {
          await db.run(
            `UPDATE time_logs SET start_time = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [now, existingLog.id]
          );
        }
      } else {
        await db.run(
          `INSERT INTO time_logs (id, user_id, date, start_time) VALUES (?, ?, ?, ?)`,
          [uuidv4(), userId, today, now]
        );
      }

      const row = await db.get('SELECT * FROM attendance WHERE id = ?', [attendanceId]);
      // Audit — sign-in is a personal mutation: userId is both actor and entity
      await writeAudit(db, userId, {
        action: 'ATTENDANCE_SIGN_IN',
        entityType: 'ATTENDANCE',
        entityId: attendanceId,
        oldValue: null,
        newValue: { date: today, signInTime: now, isLate, lateHours }
      });
      return {
        success: true,
        message: 'Signed in successfully',
        attendanceId,
        data: mapAttendanceOut(row)
      };
    } catch (error) {
      console.error('Sign-in error:', error);
      return { success: false, message: 'Sign-in failed: ' + error.message, error: error.message };
    }
  });

  ipcMain.handle('attendance:signOut', async (event, args = {}) => {
    try {
      const userId = args && args.userId;
      if (!userId) return { success: false, message: 'userId required', error: 'userId required' };

      // Office-zone stamps so display stays consistent regardless of where
      // the employee's laptop is physically located.
      const today = getOfficeDate();
      const now = getOfficeHHMMSS();

      const attendance = await db.get(
        'SELECT * FROM attendance WHERE user_id = ? AND date = ?',
        [userId, today]
      );
      if (!attendance) {
        return { success: false, message: 'No sign-in record found for today', error: 'No sign-in record' };
      }
      if (!attendance.sign_in_time) {
        return { success: false, message: 'Not signed in yet', error: 'Not signed in' };
      }

      const [signOutH, signOutM] = now.split(':').map(Number);
      const [signInH, signInMn] = attendance.sign_in_time.split(':').map(Number);
      const signInMinutes = signInH * 60 + signInMn;
      const signOutMinutes = signOutH * 60 + signOutM;
      const hoursWorked = Math.max(0, (signOutMinutes - signInMinutes) / 60).toFixed(2);

      const isEarlyDeparture = signOutH < 17 && !attendance.is_half_day;
      const earlyHours = isEarlyDeparture ? 17 - signOutH : 0;

      await db.run(
        `UPDATE attendance
            SET sign_out_time = ?, hours_worked = ?, is_early_departure = ?, early_departure_hours = ?,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [now, hoursWorked, isEarlyDeparture ? 1 : 0, earlyHours, attendance.id]
      );

      // Mirror to time_logs: set end_time and recompute totals if start_time exists
      const existingLog = await db.get(
        'SELECT * FROM time_logs WHERE user_id = ? AND date = ?',
        [userId, today]
      );
      const computeNet = (startStr, endStr, bsStr, beStr) => {
        const toMin = (s) => {
          if (!s) return null;
          const [hh, mm] = s.split(':').map(Number);
          return hh * 60 + mm;
        };
        const sm = toMin(startStr);
        const em = toMin(endStr);
        if (sm === null || em === null) return { totalHours: null, breakDuration: null, netHours: null };
        const bsm = toMin(bsStr);
        const bem = toMin(beStr);
        const breakMin = (bsm !== null && bem !== null) ? Math.max(0, bem - bsm) : 0;
        const totalMin = Math.max(0, em - sm);
        return {
          totalHours: +(totalMin / 60).toFixed(2),
          breakDuration: +(breakMin / 60).toFixed(2),
          netHours: +Math.max(0, (totalMin - breakMin) / 60).toFixed(2)
        };
      };

      if (existingLog) {
        const startForCalc = existingLog.start_time || attendance.sign_in_time;
        const { totalHours, breakDuration, netHours } = computeNet(
          startForCalc, now, existingLog.break_start_time, existingLog.break_end_time
        );
        await db.run(
          `UPDATE time_logs
              SET end_time = ?, total_hours = ?, break_duration = ?, net_hours = ?,
                  start_time = COALESCE(start_time, ?),
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
          [now, totalHours, breakDuration, netHours, attendance.sign_in_time, existingLog.id]
        );
      } else {
        // No log row yet — create one with both times
        const { totalHours, netHours } = computeNet(attendance.sign_in_time, now, null, null);
        await db.run(
          `INSERT INTO time_logs (id, user_id, date, start_time, end_time, total_hours, net_hours)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [uuidv4(), userId, today, attendance.sign_in_time, now, totalHours, netHours]
        );
      }

      const row = await db.get('SELECT * FROM attendance WHERE id = ?', [attendance.id]);
      // Audit — sign-out completes the day
      await writeAudit(db, userId, {
        action: 'ATTENDANCE_SIGN_OUT',
        entityType: 'ATTENDANCE',
        entityId: attendance.id,
        oldValue: { signOutTime: attendance.sign_out_time, hoursWorked: attendance.hours_worked },
        newValue: { signOutTime: now, hoursWorked, isEarlyDeparture }
      });
      return {
        success: true,
        message: 'Signed out successfully',
        data: mapAttendanceOut(row)
      };
    } catch (error) {
      console.error('Sign-out error:', error);
      return { success: false, message: 'Sign-out failed: ' + error.message, error: error.message };
    }
  });

  ipcMain.handle('attendance:getHistory', async (event, { userId, startDate, endDate }) => {
    try {
      const records = await db.all(
        `SELECT * FROM attendance
         WHERE user_id = ? AND date BETWEEN ? AND ?
         ORDER BY date DESC`,
        [userId, startDate, endDate]
      );
      return { success: true, data: records.map(mapAttendanceOut) };
    } catch (error) {
      console.error('Get attendance history error:', error);
      return { success: false, message: 'Failed to retrieve history' };
    }
  });

  // Now accepts an optional departmentId to scope the result to a single
  // department. The lead Team Attendance view passes user.department_id so
  // a lead only sees their own team — without it the lead used to see
  // everyone's attendance company-wide. Admin views still pass nothing and
  // get the full list.
  ipcMain.handle('attendance:getByDate', async (event, { date, departmentId } = {}) => {
    try {
      let sql = `SELECT a.*, u.full_name, u.department_id as user_department_id, d.name as department
                 FROM attendance a
                 JOIN users u ON a.user_id = u.id
                 LEFT JOIN departments d ON u.department_id = d.id
                 WHERE a.date = ?`;
      const params = [date];
      if (departmentId) {
        sql += ` AND u.department_id = ?`;
        params.push(departmentId);
      }
      sql += ` ORDER BY u.full_name`;

      const records = await db.all(sql, params);
      return { success: true, data: records.map(mapAttendanceOut) };
    } catch (error) {
      console.error('Get attendance by date error:', error);
      return { success: false, message: 'Failed to retrieve records' };
    }
  });

  // Parse a time value (ISO string, HH:MM, or HH:MM:SS) into HH:MM:SS for DB.
  const toDbTime = (v) => {
    if (!v) return null;
    if (typeof v !== 'string') return null;
    if (v.includes('T')) {
      const d = new Date(v);
      if (isNaN(d)) return null;
      const h = String(d.getUTCHours()).padStart(2, '0');
      const m = String(d.getUTCMinutes()).padStart(2, '0');
      const s = String(d.getUTCSeconds()).padStart(2, '0');
      return `${h}:${m}:${s}`;
    }
    const parts = v.split(':');
    if (parts.length === 2) return `${parts[0]}:${parts[1]}:00`;
    return v;
  };
  // SQLite stores 'Present'/'Absent'/'Leave' capitalized; the renderer
  // lowercases on read. Capitalize on write so both forms stay consistent.
  const toDbStatus = (s) => {
    if (!s || typeof s !== 'string') return 'Present';
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  };
  // Pull user_id + date out of an attendanceId formatted as
  // "<userId>-YYYY-MM-DD". UUIDs contain dashes too, so anchor the date at
  // the end of the string and treat everything before it as the userId.
  const parseAttendanceId = (id) => {
    if (!id || typeof id !== 'string') return null;
    const m = id.match(/^(.+)-(\d{4}-\d{2}-\d{2})$/);
    if (!m) return null;
    return { userId: m[1], date: m[2] };
  };

  ipcMain.handle('attendance:updateStatus', async (event, { attendanceId, status, notes, signInTime, signOutTime, currentUserId }) => {
    try {
      const parsed = parseAttendanceId(attendanceId);
      if (!parsed) {
        return { success: false, message: 'Invalid attendance ID', error: 'Invalid attendance ID format' };
      }
      // Capture the previous row (if any) for the audit diff before we overwrite it.
      // Look up by (user_id, date) rather than the synthetic id — when the row
      // was originally created by sign-in / bulk-mark / CSV import, its id is
      // a UUID, not the "{userId}-{date}" pattern the admin grid uses, so the
      // id lookup would miss it and the audit log would show a spurious
      // CREATE event for every edit.
      const before = await db.get(
        'SELECT * FROM attendance WHERE user_id = ? AND date = ?',
        [parsed.userId, parsed.date]
      );
      // Upsert keyed on the UNIQUE(user_id, date) constraint — NOT the primary
      // key. Reason: existing rows may have a different id (UUIDs from
      // attendance:signIn or attendance:create), so an INSERT with the synthetic
      // "{userId}-{date}" id used to trip "UNIQUE constraint failed:
      // attendance.user_id, attendance.date" instead of UPDATEing. Conflict-
      // targeting the user_id/date pair makes the UPSERT work regardless of
      // which id the existing row carries.
      await db.run(
        `INSERT INTO attendance (id, user_id, date, status, sign_in_time, sign_out_time, notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id, date) DO UPDATE SET
           status = excluded.status,
           sign_in_time = COALESCE(excluded.sign_in_time, attendance.sign_in_time),
           sign_out_time = COALESCE(excluded.sign_out_time, attendance.sign_out_time),
           notes = excluded.notes,
           updated_at = CURRENT_TIMESTAMP`,
        [attendanceId, parsed.userId, parsed.date, toDbStatus(status), toDbTime(signInTime), toDbTime(signOutTime), notes || null]
      );
      // Audit who edited which day for whom — answers "who marked X absent on Y?"
      await writeAudit(db, currentUserId || 'system', {
        action: before ? 'ATTENDANCE_EDIT' : 'ATTENDANCE_CREATE',
        entityType: 'ATTENDANCE',
        entityId: attendanceId,
        oldValue: before ? {
          userId: before.user_id, date: before.date, status: before.status,
          signInTime: before.sign_in_time, signOutTime: before.sign_out_time, notes: before.notes
        } : null,
        newValue: { userId: parsed.userId, date: parsed.date, status: toDbStatus(status), notes }
      });
      return { success: true, message: 'Attendance saved' };
    } catch (error) {
      console.error('Update attendance error:', error);
      return { success: false, message: 'Failed to update attendance: ' + error.message, error: error.message };
    }
  });

  // SQLite-backed attendance:create — overrides the JSON-store version in
  // main.js. Needed so the calendar's fallback "create" call lands in SQLite
  // rather than disappearing into an unread JSON blob.
  ipcMain.handle('attendance:create', async (event, { id, userId, date, signInTime, signOutTime, status, notes, currentUserId }) => {
    try {
      // Same conflict-target story as attendance:updateStatus — look up the
      // pre-existing row by (user_id, date) so a UUID row created via a
      // different code path is still recognised as the "before" state.
      const before = await db.get(
        'SELECT * FROM attendance WHERE user_id = ? AND date = ?',
        [userId, date]
      );
      await db.run(
        `INSERT INTO attendance (id, user_id, date, status, sign_in_time, sign_out_time, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, date) DO UPDATE SET
           status = excluded.status,
           sign_in_time = COALESCE(excluded.sign_in_time, attendance.sign_in_time),
           sign_out_time = COALESCE(excluded.sign_out_time, attendance.sign_out_time),
           notes = excluded.notes,
           updated_at = CURRENT_TIMESTAMP`,
        [id, userId, date, toDbStatus(status), toDbTime(signInTime), toDbTime(signOutTime), notes || null]
      );
      await writeAudit(db, currentUserId || userId, {
        action: before ? 'ATTENDANCE_EDIT' : 'ATTENDANCE_CREATE',
        entityType: 'ATTENDANCE',
        entityId: id,
        oldValue: before ? { status: before.status, signInTime: before.sign_in_time, signOutTime: before.sign_out_time } : null,
        newValue: { userId, date, status: toDbStatus(status), notes }
      });
      return { success: true, message: 'Attendance created', data: { id, userId, date, status: toDbStatus(status) } };
    } catch (error) {
      console.error('Create attendance error:', error);
      return { success: false, message: 'Failed to create attendance: ' + error.message, error: error.message };
    }
  });

  // Aggregated per-day attendance counts for the dashboard charts. Returns
  // one row per date in the range that has any attendance recorded; the
  // renderer is responsible for filling zero-rows on missing dates so the
  // chart x-axis is continuous.
  ipcMain.handle('attendance:getRangeSummary', async (event, { startDate, endDate, departmentId } = {}) => {
    try {
      if (!startDate || !endDate) {
        return { success: false, message: 'startDate and endDate are required' };
      }
      let sql = `SELECT
                   a.date,
                   SUM(CASE WHEN LOWER(a.status) = 'present' THEN 1 ELSE 0 END) AS present,
                   SUM(CASE WHEN LOWER(a.status) = 'absent'  THEN 1 ELSE 0 END) AS absent,
                   SUM(CASE WHEN LOWER(a.status) = 'leave'   THEN 1 ELSE 0 END) AS on_leave,
                   SUM(CASE WHEN a.is_half_day = 1 THEN 1 ELSE 0 END) AS half_day,
                   SUM(CASE WHEN a.is_late = 1 THEN 1 ELSE 0 END) AS late
                 FROM attendance a
                 JOIN users u ON a.user_id = u.id
                 WHERE a.date BETWEEN ? AND ?`;
      const params = [startDate, endDate];
      if (departmentId) {
        sql += ` AND u.department_id = ?`;
        params.push(departmentId);
      }
      sql += ` GROUP BY a.date ORDER BY a.date ASC`;

      const rows = await db.all(sql, params);
      return { success: true, data: rows };
    } catch (error) {
      console.error('Get attendance range summary error:', error);
      return { success: false, message: 'Failed to retrieve range summary' };
    }
  });

  ipcMain.handle('attendance:markHalfDay', async (event, { attendanceId, currentUserId }) => {
    try {
      const before = await db.get('SELECT * FROM attendance WHERE id = ?', [attendanceId]);
      await db.run(
        `UPDATE attendance SET is_half_day = 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [attendanceId]
      );
      await writeAudit(db, currentUserId || 'system', {
        action: 'ATTENDANCE_MARK_HALF_DAY',
        entityType: 'ATTENDANCE',
        entityId: attendanceId,
        oldValue: before ? { isHalfDay: before.is_half_day === 1 } : null,
        newValue: { isHalfDay: true }
      });
      return { success: true, message: 'Marked as half-day' };
    } catch (error) {
      console.error('Mark half-day error:', error);
      return { success: false, message: 'Failed to mark half-day' };
    }
  });
}

module.exports = { register };
