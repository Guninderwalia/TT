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
      return { success: true, filename, data: buf };
    } catch (error) {
      console.error('[SETTINGS] backup error:', error);
      return { success: false, message: error.message };
    }
  });
}

module.exports = { register };
