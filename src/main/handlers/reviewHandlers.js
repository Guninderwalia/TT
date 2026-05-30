const { v4: uuidv4 } = require('uuid');
const { writeAudit } = require('./_auditHelper');

/**
 * SQLite-backed manager review handlers. Overrides the legacy JSON-store
 * versions in main.js (which wrote to store.get('managerReviews', [])).
 *
 * Schema (manager_reviews):
 *   id, user_id, manager_id, rating (1-5), comments, review_date,
 *   created_at, updated_at — UNIQUE(user_id) so each employee has at most
 *   one current review row (review:create upserts).
 *
 * Frontend shape: { id, employeeId, managerId, rating, comments, reviewDate }
 * — keep camelCase keys with `employeeId` to match the legacy callers.
 */

function mapRowOut(row) {
  if (!row) return row;
  return {
    id: row.id,
    employeeId: row.user_id,
    managerId: row.manager_id,
    rating: row.rating,
    comments: row.comments || '',
    reviewDate: row.review_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function register(ipcMain, db) {
  // Upsert by user_id — legacy handler had the same "create or update" shape.
  ipcMain.handle('review:create', async (event, { employeeId, rating, comments, currentUserId }) => {
    try {
      if (!employeeId) return { success: false, error: 'employeeId required' };
      if (rating == null || rating < 1 || rating > 5) {
        return { success: false, error: 'rating must be between 1 and 5' };
      }

      const existing = await db.get(
        'SELECT * FROM manager_reviews WHERE user_id = ?',
        [employeeId]
      );

      if (existing) {
        await db.run(
          `UPDATE manager_reviews
              SET rating = ?, comments = ?, review_date = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
          [rating, comments || '', existing.id]
        );
        const row = await db.get('SELECT * FROM manager_reviews WHERE id = ?', [existing.id]);
        await writeAudit(db, currentUserId || 'system', {
          action: 'REVIEW_UPDATE',
          entityType: 'MANAGER_REVIEW',
          entityId: existing.id,
          oldValue: { rating: existing.rating, comments: existing.comments, employeeId },
          newValue: { rating, comments, employeeId }
        });
        console.log('[REVIEW] Updated for employee', employeeId);
        return { success: true, data: mapRowOut(row) };
      }

      const id = uuidv4();
      await db.run(
        `INSERT INTO manager_reviews (id, user_id, manager_id, rating, comments)
         VALUES (?, ?, ?, ?, ?)`,
        [id, employeeId, currentUserId || null, rating, comments || '']
      );
      const row = await db.get('SELECT * FROM manager_reviews WHERE id = ?', [id]);
      await writeAudit(db, currentUserId || 'system', {
        action: 'REVIEW_CREATE',
        entityType: 'MANAGER_REVIEW',
        entityId: id,
        oldValue: null,
        newValue: { rating, comments, employeeId }
      });
      console.log('[REVIEW] Created for employee', employeeId);
      return { success: true, data: mapRowOut(row) };
    } catch (error) {
      console.error('[REVIEW] Create/update error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('review:update', async (event, { reviewId, rating, comments, currentUserId }) => {
    try {
      if (!reviewId) return { success: false, error: 'reviewId required' };
      if (rating == null || rating < 1 || rating > 5) {
        return { success: false, error: 'rating must be between 1 and 5' };
      }
      const existing = await db.get('SELECT * FROM manager_reviews WHERE id = ?', [reviewId]);
      if (!existing) return { success: false, error: 'Review not found' };

      await db.run(
        `UPDATE manager_reviews
            SET rating = ?, comments = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [rating, comments || '', reviewId]
      );
      const row = await db.get('SELECT * FROM manager_reviews WHERE id = ?', [reviewId]);
      await writeAudit(db, currentUserId || 'system', {
        action: 'REVIEW_UPDATE',
        entityType: 'MANAGER_REVIEW',
        entityId: reviewId,
        oldValue: { rating: existing.rating, comments: existing.comments },
        newValue: { rating, comments }
      });
      return { success: true, data: mapRowOut(row) };
    } catch (error) {
      console.error('[REVIEW] Update error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('review:getLatestByEmployee', async (event, { employeeId }) => {
    try {
      const row = await db.get(
        'SELECT * FROM manager_reviews WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1',
        [employeeId]
      );
      return { success: true, data: row ? mapRowOut(row) : null };
    } catch (error) {
      console.error('[REVIEW] Get latest error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('review:getAll', async (event, _args) => {
    try {
      const rows = await db.all('SELECT * FROM manager_reviews ORDER BY updated_at DESC');
      return { success: true, data: rows.map(mapRowOut) };
    } catch (error) {
      console.error('[REVIEW] Get all error:', error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
