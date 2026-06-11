const { v4: uuidv4 } = require('uuid');
const { writeAudit } = require('./_auditHelper');
const { canAccessUser, denied } = require('./_authz');
// Pulse v2 — use the office timezone for "today" so the live status snapshot
// matches the date that breaks / sign-ins are stamped under. Using raw UTC
// here made the dashboard read the PREVIOUS office day during the early-
// morning IST window (UTC is 5.5h behind), so a started break showed as
// "Working" instead of "On Break".
const { getOfficeDate } = require('../../utils/officeTime');

/**
 * SQLite-backed time logging handlers. Overrides the legacy JSON-store
 * versions in main.js so time logs land in the same database the
 * performance review reads from.
 *
 * Schema (time_logs):
 *   id, user_id, date, start_time, break_start_time, break_end_time,
 *   end_time, total_hours, break_duration, net_hours,
 *   created_at, updated_at — UNIQUE(user_id, date)
 *
 * Frontend shape (legacy): startTime, breakStartTime, breakEndTime, endTime
 * — fields are camelCase on the way out for compatibility with existing
 * callers (AdminPerformanceReview reads log.startTime/log.endTime etc.).
 */

function mapRowOut(row) {
  if (!row) return row;
  return {
    id: row.id,
    userId: row.user_id,
    date: row.date,
    startTime: row.start_time || null,
    breakStartTime: row.break_start_time || null,
    breakEndTime: row.break_end_time || null,
    endTime: row.end_time || null,
    totalHours: row.total_hours,
    breakDuration: row.break_duration,
    netHours: row.net_hours,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// Convert "HH:MM" or "HH:MM:SS" to minutes since midnight; null on bad input.
function timeToMinutes(t) {
  if (!t || typeof t !== 'string') return null;
  const parts = t.split(':');
  if (parts.length < 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

// Return net hours worked given the four time fields (any may be null).
function computeNetHours(startTime, breakStartTime, breakEndTime, endTime) {
  const startMin = timeToMinutes(startTime);
  const endMin   = timeToMinutes(endTime);
  if (startMin === null || endMin === null) return { totalHours: null, breakDuration: null, netHours: null };
  const breakStartMin = timeToMinutes(breakStartTime);
  const breakEndMin   = timeToMinutes(breakEndTime);
  const breakMin = (breakStartMin !== null && breakEndMin !== null)
    ? Math.max(0, breakEndMin - breakStartMin)
    : 0;
  const totalMin = Math.max(0, endMin - startMin);
  const netMin   = Math.max(0, totalMin - breakMin);
  return {
    totalHours: +(totalMin / 60).toFixed(2),
    breakDuration: +(breakMin / 60).toFixed(2),
    netHours: +(netMin / 60).toFixed(2)
  };
}

function register(ipcMain, db) {
  // Create or update a time log for a (userId, date) pair. The legacy
  // handler did upsert too — we keep the same behaviour.
  ipcMain.handle('timelogging:createTimeLog', async (event, { userId, date, startTime, breakStartTime, breakEndTime, endTime }) => {
    try {
      if (!userId || !date) {
        return { success: false, error: 'userId and date are required' };
      }

      const { totalHours, breakDuration, netHours } = computeNetHours(startTime, breakStartTime, breakEndTime, endTime);

      const existing = await db.get(
        'SELECT id FROM time_logs WHERE user_id = ? AND date = ?',
        [userId, date]
      );

      if (existing) {
        await db.run(
          `UPDATE time_logs
              SET start_time = ?, break_start_time = ?, break_end_time = ?, end_time = ?,
                  total_hours = ?, break_duration = ?, net_hours = ?,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
          [startTime || null, breakStartTime || null, breakEndTime || null, endTime || null,
           totalHours, breakDuration, netHours, existing.id]
        );
        const row = await db.get('SELECT * FROM time_logs WHERE id = ?', [existing.id]);
        console.log('[TIMELOG] Updated', userId, date);
        return { success: true, data: mapRowOut(row) };
      }

      const id = uuidv4();
      await db.run(
        `INSERT INTO time_logs (id, user_id, date, start_time, break_start_time, break_end_time, end_time, total_hours, break_duration, net_hours)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, userId, date, startTime || null, breakStartTime || null, breakEndTime || null, endTime || null,
         totalHours, breakDuration, netHours]
      );
      const row = await db.get('SELECT * FROM time_logs WHERE id = ?', [id]);
      await writeAudit(db, userId, {
        action: 'TIMELOG_CREATE',
        entityType: 'TIME_LOG',
        entityId: id,
        oldValue: null,
        newValue: { userId, date, startTime, breakStartTime, breakEndTime, endTime, totalHours, netHours }
      });
      console.log('[TIMELOG] Created', userId, date);
      return { success: true, data: mapRowOut(row) };
    } catch (error) {
      console.error('[TIMELOG] Create/update error:', error);
      return { success: false, error: error.message };
    }
  });

  // Live team snapshot — one row per active employee in `departmentId`, plus
  // their time-log row for today if one exists. Powers the lead dashboard's
  // "Live Team Status" widget. The renderer derives the status pill (Working
  // / On Break / Signed Off / Not Started) from the four timestamps without
  // making a second round trip.
  ipcMain.handle('timelogging:getTeamToday', async (_event, { departmentId } = {}) => {
    try {
      // departmentId is OPTIONAL — leads pass theirs to scope to their team,
      // admins omit it for a company-wide snapshot used by the admin dashboard.
      // Office-zone "today" so this matches the date breaks/sign-ins are
      // stamped under (see import note above).
      const today = getOfficeDate();
      const params = [today, today];
      let sql = `SELECT u.id          AS user_id,
                        u.full_name   AS full_name,
                        u.profile_picture_path AS profile_picture_path,
                        u.department_id AS department_id,
                        d.name        AS department_name,
                        t.start_time,
                        t.break_start_time,
                        t.break_end_time,
                        t.end_time,
                        a.status      AS attendance_status
                   FROM users u
                   LEFT JOIN time_logs  t ON t.user_id = u.id AND t.date = ?
                   LEFT JOIN attendance a ON a.user_id = u.id AND a.date = ?
                   LEFT JOIN departments d ON d.id = u.department_id
                  WHERE u.status = 'active'`;
      if (departmentId) {
        sql += ` AND u.department_id = ?`;
        params.push(departmentId);
      }
      sql += ` ORDER BY u.full_name ASC`;
      const rows = await db.all(sql, params);
      return {
        success: true,
        data: rows.map(r => ({
          userId: r.user_id,
          fullName: r.full_name,
          profilePicturePath: r.profile_picture_path,
          departmentId: r.department_id,
          departmentName: r.department_name,
          startTime: r.start_time,
          breakStartTime: r.break_start_time,
          breakEndTime: r.break_end_time,
          endTime: r.end_time,
          attendanceStatus: (r.attendance_status || '').toLowerCase() || null
        }))
      };
    } catch (error) {
      console.error('[TIMELOG] getTeamToday error:', error);
      return { success: false, error: error.message };
    }
  });

  // Range query — used by AdminPerformanceReview for consistency/lateness.
  ipcMain.handle('timelogging:getTimeLogs', async (event, { userId, startDate, endDate }) => {
    try {
      if (!(await canAccessUser(db, event, userId))) return denied();
      const rows = await db.all(
        `SELECT * FROM time_logs
          WHERE user_id = ? AND date BETWEEN ? AND ?
          ORDER BY date ASC`,
        [userId, startDate, endDate]
      );
      return { success: true, data: rows.map(mapRowOut) };
    } catch (error) {
      console.error('[TIMELOG] Get range error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('timelogging:updateTimeLog', async (event, { logId, startTime, breakStartTime, breakEndTime, endTime, currentUserId }) => {
    try {
      if (!logId) return { success: false, error: 'logId required' };
      const existing = await db.get('SELECT * FROM time_logs WHERE id = ?', [logId]);
      if (!existing) return { success: false, error: 'Time log not found' };

      // Only overwrite a field if the caller actually sent it
      const newStart       = startTime       !== undefined ? startTime       : existing.start_time;
      const newBreakStart  = breakStartTime  !== undefined ? breakStartTime  : existing.break_start_time;
      const newBreakEnd    = breakEndTime    !== undefined ? breakEndTime    : existing.break_end_time;
      const newEnd         = endTime         !== undefined ? endTime         : existing.end_time;

      const { totalHours, breakDuration, netHours } =
        computeNetHours(newStart, newBreakStart, newBreakEnd, newEnd);

      await db.run(
        `UPDATE time_logs
            SET start_time = ?, break_start_time = ?, break_end_time = ?, end_time = ?,
                total_hours = ?, break_duration = ?, net_hours = ?,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [newStart, newBreakStart, newBreakEnd, newEnd, totalHours, breakDuration, netHours, logId]
      );

      const row = await db.get('SELECT * FROM time_logs WHERE id = ?', [logId]);
      await writeAudit(db, currentUserId || existing.user_id, {
        action: 'TIMELOG_UPDATE',
        entityType: 'TIME_LOG',
        entityId: logId,
        oldValue: { startTime: existing.start_time, breakStartTime: existing.break_start_time, breakEndTime: existing.break_end_time, endTime: existing.end_time },
        newValue: { startTime: newStart, breakStartTime: newBreakStart, breakEndTime: newBreakEnd, endTime: newEnd }
      });
      return { success: true, data: mapRowOut(row) };
    } catch (error) {
      console.error('[TIMELOG] Update error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('timelogging:deleteTimeLog', async (event, { logId, currentUserId }) => {
    try {
      const existing = await db.get('SELECT user_id, date FROM time_logs WHERE id = ?', [logId]);
      await db.run('DELETE FROM time_logs WHERE id = ?', [logId]);
      await writeAudit(db, currentUserId || (existing && existing.user_id), {
        action: 'TIMELOG_DELETE',
        entityType: 'TIME_LOG',
        entityId: logId,
        oldValue: existing ? { userId: existing.user_id, date: existing.date } : null,
        newValue: null
      });
      return { success: true };
    } catch (error) {
      console.error('[TIMELOG] Delete error:', error);
      return { success: false, error: error.message };
    }
  });

  // Month query — used by personal time logging view.
  ipcMain.handle('timelogging:getUserTimeLogs', async (event, { userId, month, year }) => {
    try {
      if (!(await canAccessUser(db, event, userId))) return denied();
      // month is 1-12 from the renderer
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const endDate   = `${year}-${String(month).padStart(2, '0')}-31`;
      const rows = await db.all(
        `SELECT * FROM time_logs
          WHERE user_id = ? AND date BETWEEN ? AND ?
          ORDER BY date ASC`,
        [userId, startDate, endDate]
      );
      return { success: true, data: rows.map(mapRowOut) };
    } catch (error) {
      console.error('[TIMELOG] Get user month error:', error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
