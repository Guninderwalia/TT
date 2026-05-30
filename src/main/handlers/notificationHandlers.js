const { v4: uuidv4 } = require('uuid');

/**
 * Notification handlers — exposes the existing `notifications` table to the
 * renderer. Other handlers (leave approve / reject / cancel, etc.) already
 * write rows; this just lets the UI read + mark them as read.
 */
function register(ipcMain, db) {
  // List notifications for a given user. Returns the most recent first.
  // limit defaults to 50; unreadOnly filters to is_read = 0.
  ipcMain.handle('notification:list', async (event, { userId, limit = 50, unreadOnly = false } = {}) => {
    try {
      if (!userId) return { success: false, message: 'userId required' };
      let sql = `SELECT id, user_id, title, message, type, related_id, is_read, created_at
                 FROM notifications
                 WHERE user_id = ?`;
      const params = [userId];
      if (unreadOnly) sql += ` AND is_read = 0`;
      sql += ` ORDER BY created_at DESC LIMIT ?`;
      params.push(Math.max(1, Math.min(200, parseInt(limit, 10) || 50)));
      const rows = await db.all(sql, params);
      return { success: true, data: rows };
    } catch (error) {
      console.error('[NOTIF] list error:', error);
      return { success: false, message: error.message };
    }
  });

  // Just the unread count — used to drive the bell-icon badge without
  // loading the entire list every poll.
  ipcMain.handle('notification:unreadCount', async (event, { userId } = {}) => {
    try {
      if (!userId) return { success: false, message: 'userId required' };
      const row = await db.get(
        `SELECT COUNT(*) as n FROM notifications WHERE user_id = ? AND is_read = 0`,
        [userId]
      );
      return { success: true, count: (row && row.n) || 0 };
    } catch (error) {
      console.error('[NOTIF] unreadCount error:', error);
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('notification:markRead', async (event, { id, userId } = {}) => {
    try {
      if (!id || !userId) return { success: false, message: 'id and userId required' };
      // Only the owner can mark their own notifications read.
      const row = await db.get('SELECT user_id FROM notifications WHERE id = ?', [id]);
      if (!row) return { success: false, message: 'Notification not found' };
      if (row.user_id !== userId) return { success: false, message: 'Not your notification' };
      await db.run('UPDATE notifications SET is_read = 1 WHERE id = ?', [id]);
      return { success: true };
    } catch (error) {
      console.error('[NOTIF] markRead error:', error);
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('notification:markAllRead', async (event, { userId } = {}) => {
    try {
      if (!userId) return { success: false, message: 'userId required' };
      await db.run('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [userId]);
      return { success: true };
    } catch (error) {
      console.error('[NOTIF] markAllRead error:', error);
      return { success: false, message: error.message };
    }
  });

  // Optional convenience: let any handler create a notification through here
  // instead of writing raw SQL. (Currently other handlers inline the INSERT —
  // they still work, this is just for future use.)
  ipcMain.handle('notification:create', async (event, { userId, title, message, type = 'info', relatedId = null } = {}) => {
    try {
      if (!userId || !title) return { success: false, message: 'userId and title required' };
      const id = uuidv4();
      await db.run(
        `INSERT INTO notifications (id, user_id, title, message, type, related_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, userId, title, message || '', type, relatedId]
      );
      return { success: true, id };
    } catch (error) {
      console.error('[NOTIF] create error:', error);
      return { success: false, message: error.message };
    }
  });
}

module.exports = { register };
