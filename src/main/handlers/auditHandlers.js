const { v4: uuidv4 } = require('uuid');

function register(ipcMain, db) {
  ipcMain.handle('audit:getLogs', async (event, filters) => {
    try {
      const f = filters || {};
      let query = `SELECT al.*, u.full_name as user_name FROM audit_logs al
                   LEFT JOIN users u ON al.user_id = u.id
                   WHERE 1=1`;
      const params = [];

      if (f.entityType) { query += ` AND al.entity_type = ?`; params.push(f.entityType); }
      if (f.action)     { query += ` AND al.action = ?`;      params.push(f.action); }
      if (f.userId)     { query += ` AND al.user_id = ?`;     params.push(f.userId); }
      if (f.startDate)  { query += ` AND al.timestamp >= ?`;  params.push(f.startDate); }
      if (f.endDate)    { query += ` AND al.timestamp <= ?`;  params.push(f.endDate); }

      const limit = Math.min(parseInt(f.limit, 10) || 1000, 5000);
      query += ` ORDER BY al.timestamp DESC LIMIT ${limit}`;

      const logs = await db.all(query, params);
      return { success: true, data: logs };
    } catch (error) {
      console.error('Get audit logs error:', error);
      return { success: false, message: 'Failed to retrieve audit logs' };
    }
  });

  ipcMain.handle('audit:logAction', async (event, { action, entityType, entityId, oldValue, newValue, userId }) => {
    try {
      const actualUserId = userId || event.sender.id || 'system';
      const logId = uuidv4();

      await db.run(
        `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, old_value, new_value, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [logId, actualUserId, action, entityType, entityId, oldValue, newValue]
      );

      return { success: true };
    } catch (error) {
      console.error('Log action error:', error);
      return { success: false };
    }
  });

  ipcMain.handle('audit:clearLogs', async (event, { filtered, filters }) => {
    try {
      let query = 'DELETE FROM audit_logs WHERE 1=1';
      const params = [];

      if (filtered && filters) {
        if (filters.action) { query += ` AND action = ?`; params.push(filters.action); }
        if (filters.entityType) { query += ` AND entity_type = ?`; params.push(filters.entityType); }
        if (filters.userId) { query += ` AND user_id = ?`; params.push(filters.userId); }
        if (filters.startDate) { query += ` AND timestamp >= ?`; params.push(filters.startDate); }
        if (filters.endDate) { query += ` AND timestamp <= ?`; params.push(filters.endDate); }
      }

      await db.run(query, params);
      return { success: true, message: 'Audit logs cleared' };
    } catch (error) {
      console.error('Clear logs error:', error);
      return { success: false, message: 'Failed to clear logs' };
    }
  });
}

module.exports = { register };
