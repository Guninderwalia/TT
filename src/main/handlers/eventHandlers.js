const { v4: uuidv4 } = require('uuid');
const { writeAudit } = require('./_auditHelper');

function register(ipcMain, db) {
  // Get all events for a user on a specific date
  ipcMain.handle('event:getByDate', async (event, { userId, date }) => {
    try {
      const events = await db.all(
        `SELECT * FROM events
         WHERE user_id = ? AND date = ?
         ORDER BY time ASC`,
        [userId, date]
      );
      return { success: true, data: events || [] };
    } catch (error) {
      console.error('Get events by date error:', error);
      return { success: false, message: 'Failed to retrieve events' };
    }
  });

  // Create a new event
  ipcMain.handle('event:create', async (event, { userId, date, time, activityType, notes, currentUserId }) => {
    try {
      const eventId = uuidv4();
      const createdAt = new Date().toISOString();

      await db.run(
        `INSERT INTO events (id, user_id, date, time, activity_type, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [eventId, userId, date, time, activityType, notes || '', createdAt]
      );

      await writeAudit(db, currentUserId || userId, {
        action: 'EVENT_CREATE',
        entityType: 'EVENT',
        entityId: eventId,
        oldValue: null,
        newValue: { userId, date, time, activityType, notes }
      });
      return {
        success: true,
        message: 'Event created successfully',
        eventId
      };
    } catch (error) {
      console.error('Create event error:', error);
      return { success: false, message: 'Failed to create event' };
    }
  });

  // Update an event
  // v5.6 — Only ADMINS / MD may edit events (matches event:delete). This both
  // gives admins full edit rights over anyone's activity log AND closes the
  // previous IDOR (the handler had no auth check, so any caller could edit any
  // event by id). Trustworthy caller id = x-user-id header (mirrored to
  // event.sender.id by webServer.js); falls back to currentUserId on desktop.
  ipcMain.handle('event:update', async (event, { eventId, time, activityType, notes, currentUserId }) => {
    try {
      const actorId = (event?.sender?.id) || currentUserId || null;
      if (!actorId) {
        return { success: false, message: 'Not authenticated' };
      }
      const caller = await db.get(
        `SELECT r.name AS role_name
           FROM users u LEFT JOIN roles r ON u.role_id = r.id
          WHERE u.id = ?`,
        [actorId]
      );
      const role = ((caller && caller.role_name) || '').toLowerCase();
      const isPrivileged = ['admin', 'administrator', 'md', 'managing director'].includes(role);
      if (!isPrivileged) {
        return { success: false, message: 'Only an admin can edit events' };
      }

      const before = await db.get('SELECT * FROM events WHERE id = ?', [eventId]);
      const updatedAt = new Date().toISOString();

      await db.run(
        `UPDATE events
         SET time = ?, activity_type = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
        [time, activityType, notes || '', updatedAt, eventId]
      );

      await writeAudit(db, actorId, {
        action: 'EVENT_UPDATE',
        entityType: 'EVENT',
        entityId: eventId,
        oldValue: before ? { time: before.time, activityType: before.activity_type, notes: before.notes } : null,
        newValue: { time, activityType, notes }
      });
      return { success: true, message: 'Event updated successfully' };
    } catch (error) {
      console.error('Update event error:', error);
      return { success: false, message: 'Failed to update event' };
    }
  });

  // Delete an event.
  // v5.1 — Only ADMINS / MD may delete events. Team leads, managers and plain
  // employees can add activity-log entries but not remove them, so a day's
  // record can't be quietly rewritten by anyone below admin. The trustworthy
  // caller id is the x-user-id header (mirrored to event.sender.id by
  // webServer.js); fall back to the passed currentUserId for Electron desktop.
  ipcMain.handle('event:delete', async (event, { eventId, currentUserId }) => {
    try {
      const actorId = (event?.sender?.id) || currentUserId || null;
      if (!actorId) {
        return { success: false, message: 'Not authenticated' };
      }
      const caller = await db.get(
        `SELECT r.name AS role_name
           FROM users u LEFT JOIN roles r ON u.role_id = r.id
          WHERE u.id = ?`,
        [actorId]
      );
      const role = ((caller && caller.role_name) || '').toLowerCase();
      const isPrivileged = ['admin', 'administrator', 'md', 'managing director'].includes(role);
      if (!isPrivileged) {
        return { success: false, message: 'Only an admin can delete events' };
      }

      const before = await db.get('SELECT * FROM events WHERE id = ?', [eventId]);
      await db.run('DELETE FROM events WHERE id = ?', [eventId]);
      await writeAudit(db, currentUserId || (before && before.user_id), {
        action: 'EVENT_DELETE',
        entityType: 'EVENT',
        entityId: eventId,
        oldValue: before ? { userId: before.user_id, date: before.date, time: before.time, activityType: before.activity_type, notes: before.notes } : null,
        newValue: null
      });
      return { success: true, message: 'Event deleted successfully' };
    } catch (error) {
      console.error('Delete event error:', error);
      return { success: false, message: 'Failed to delete event' };
    }
  });

  // Get all events for a user within a date range
  ipcMain.handle('event:getByRange', async (event, { userId, startDate, endDate }) => {
    try {
      const events = await db.all(
        `SELECT * FROM events
         WHERE user_id = ? AND date >= ? AND date <= ?
         ORDER BY date DESC, time ASC`,
        [userId, startDate, endDate]
      );
      return { success: true, data: events || [] };
    } catch (error) {
      console.error('Get events by range error:', error);
      return { success: false, message: 'Failed to retrieve events' };
    }
  });
}

module.exports = { register };
