/**
 * Application settings — a tiny key/value store backed by SQLite.
 *
 * Used for:
 *   - default_annual_leave  (number, default 25)
 *   - probation_months      (number, default 3)
 *   - working_hours_start   (HH:MM string, default "09:00")
 *   - working_hours_end     (HH:MM string, default "18:00")
 *   - company_name          (string, default "TaskTango")
 *
 * Anyone can read; only admins should be allowed to write (enforced in the
 * renderer for now, since the IPC layer doesn't have a role check).
 */

const DEFAULTS = {
  default_annual_leave: '25',
  probation_months:     '3',
  working_hours_start:  '09:00',
  working_hours_end:    '18:00',
  company_name:         'TaskTango'
};

async function ensureTable(db) {
  // Table is created by migrations (settingsMigration). This is a safety
  // net for fresh installs in case the migration didn't run first.
  await db.run(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

const { writeAudit } = require('./_auditHelper');

function register(ipcMain, db) {
  ipcMain.handle('settings:list', async () => {
    try {
      await ensureTable(db);
      const rows = await db.all('SELECT key, value FROM app_settings');
      const obj = { ...DEFAULTS };
      rows.forEach(r => { if (r.value != null) obj[r.key] = r.value; });
      return { success: true, data: obj };
    } catch (error) {
      console.error('[SETTINGS] list error:', error);
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('settings:get', async (event, { key } = {}) => {
    try {
      await ensureTable(db);
      const row = await db.get('SELECT value FROM app_settings WHERE key = ?', [key]);
      const value = row && row.value != null ? row.value : DEFAULTS[key];
      return { success: true, value };
    } catch (error) {
      console.error('[SETTINGS] get error:', error);
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('settings:set', async (event, { key, value, currentUserId } = {}) => {
    try {
      if (!key) return { success: false, message: 'key required' };
      await ensureTable(db);
      const v = value == null ? '' : String(value);
      // Capture the previous value for the audit diff
      const before = await db.get('SELECT value FROM app_settings WHERE key = ?', [key]);
      // Upsert
      await db.run(
        `INSERT INTO app_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
        [key, v]
      );
      await writeAudit(db, currentUserId || 'system', {
        action: 'SETTING_UPDATE',
        entityType: 'APP_SETTING',
        entityId: key,
        oldValue: before ? { value: before.value } : null,
        newValue: { value: v }
      });
      return { success: true };
    } catch (error) {
      console.error('[SETTINGS] set error:', error);
      return { success: false, message: error.message };
    }
  });

  // Database backup: returns the SQLite file as a buffer the renderer can
  // download. Restoration is deliberately not exposed — too risky without
  // an app restart.
  ipcMain.handle('settings:downloadBackup', async (event, { currentUserId } = {}) => {
    try {
      const path = require('path');
      const fs   = require('fs');
      const DB_PATH = path.join(process.env.APPDATA || process.env.HOME, 'TaskTango', 'tasktango.db');
      if (!fs.existsSync(DB_PATH)) {
        return { success: false, message: 'Database file not found' };
      }
      const buf = fs.readFileSync(DB_PATH);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').split('Z')[0];
      const filename = `tasktango-backup-${stamp}.db`;
      await writeAudit(db, currentUserId || 'system', {
        action: 'BACKUP_DOWNLOAD',
        entityType: 'BACKUP',
        entityId: filename,
        oldValue: null,
        newValue: { filename, sizeBytes: buf.length }
      });
      // v4.4.2: base64 so the binary survives JSON-over-HTTP on the web
      // build. Electron mode also accepts the same format — renderer
      // base64-decodes into a Uint8Array before triggering the download.
      return { success: true, filename, data: buf.toString('base64'), sizeBytes: buf.length };
    } catch (error) {
      console.error('[SETTINGS] backup error:', error);
      return { success: false, message: error.message };
    }
  });
}

// v4.5 — Wipe Test Data
// Admin-only nuke for everything an employee can generate: attendance,
// time_logs, leave_requests, leave_balances, events, notifications, audit,
// chat, payroll, salary_increments, monthly_expenses, employee_documents,
// employee_skills, banking_details, probation_deposits, overtime,
// employment_records, AND every non-admin user. Keeps: roles, leave_types,
// app_settings, predefined_skills, manager_reviews template (cleared too),
// departments (cleared, can be recreated), and the original admin user(s).
function registerWipe(ipcMain, db) {
  ipcMain.handle('admin:wipeTestData', async (_event, args = {}) => {
    const { confirm } = args || {};
    if (confirm !== 'WIPE') {
      return { success: false, message: 'Confirmation token missing — pass {confirm:"WIPE"}.' };
    }
    try {
      // Wrap in a transaction so a partial wipe doesn't leave orphaned rows.
      await db.exec('BEGIN');
      const wiped = {};
      const wipe = async (table) => {
        try {
          const r = await db.run(`DELETE FROM ${table}`);
          wiped[table] = r?.changes ?? 0;
        } catch (e) {
          // Tables that don't exist in this install just get skipped — same
          // shape as the legacy migration safety-net.
          wiped[table] = 0;
        }
      };
      // Order matters for foreign-key parents — wipe children first.
      await wipe('chat_messages');
      await wipe('chat_participants');
      await wipe('chat_conversations');
      await wipe('audit_logs');
      await wipe('notifications');
      await wipe('events');
      await wipe('time_logs');
      await wipe('attendance');
      await wipe('leave_requests');
      await wipe('leave_balances');
      await wipe('leave_balance_rollover_log');
      await wipe('monthly_expenses');
      await wipe('payroll');
      await wipe('salary_increments');
      await wipe('overtime');
      await wipe('probation_deposits');
      await wipe('employee_documents');
      await wipe('employee_skills');
      await wipe('manager_reviews');
      await wipe('banking_details');
      await wipe('employment_records');

      // Delete non-admin users (keep Admin, MD, Managing Director roles).
      const adminRoleIds = await db.all(
        `SELECT id FROM roles WHERE LOWER(name) IN ('admin','administrator','md','managing director')`
      );
      const keepIds = adminRoleIds.map(r => `'${r.id}'`).join(',') || "''";
      const userDel = await db.run(`DELETE FROM users WHERE role_id NOT IN (${keepIds})`);
      wiped.users = userDel?.changes ?? 0;

      // Clear departments (admin recreates real ones after wipe).
      await wipe('departments');

      await db.exec('COMMIT');
      console.log('[ADMIN] Wipe complete:', wiped);
      return { success: true, message: 'Test data wiped.', wiped };
    } catch (error) {
      try { await db.exec('ROLLBACK'); } catch (_) {}
      console.error('[ADMIN] Wipe failed:', error);
      return { success: false, message: error.message };
    }
  });
}

// Both the original `register` (defined above) and the new wipe handler
// get wired up. The wrapper preserves the same public shape callers expect:
// require('./settingsHandlers').register(ipcMain, db).
module.exports = {
  register: (ipcMain, db) => {
    register(ipcMain, db);
    registerWipe(ipcMain, db);
  }
};
