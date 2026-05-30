/**
 * Shared audit-log helper for every handler that mutates state.
 *
 * Why one place: each handler used to either have its own writeAudit (e.g.
 * employeeHandlers) or no audit at all. The latter created a serious HR
 * compliance gap — 12 out of 17 handlers logged nothing. This module is the
 * single point of truth so every mutation lands in `audit_logs` with the same
 * shape and conventions.
 *
 * Usage:
 *   const { writeAudit } = require('./_auditHelper');
 *   await writeAudit(db, callerId, {
 *     action:     'HOLIDAY_CREATE',           // verb + entity
 *     entityType: 'HOLIDAY',                   // noun, capitalised
 *     entityId:   newHolidayId,
 *     oldValue:   null,                        // null on create
 *     newValue:   { name, date, description }  // object — JSON-stringified
 *   });
 *
 * Conventions:
 *   - `action` is `${ENTITY}_${VERB}` (e.g. ATTENDANCE_EDIT, CHAT_SEND).
 *   - `entityType` is the upper-cased entity name (HOLIDAY, REVIEW, …).
 *   - `entityId` is whatever uniquely identifies the row (uuid, attendanceId).
 *   - `oldValue` is null on creates, the previous row on updates/deletes.
 *   - `newValue` is the new state on creates/updates, null on deletes.
 *
 * Audit writes are intentionally fire-and-forget — if the audit insert fails
 * (DB lock, disk full, etc.) we log it and move on. Auditing must NEVER
 * break a user-facing operation.
 */

const { v4: uuidv4 } = require('uuid');

async function writeAudit(db, userId, { action, entityType, entityId, oldValue, newValue, ipAddress } = {}) {
  try {
    if (!action || !entityType) {
      console.warn('[AUDIT] writeAudit called without action/entityType — skipping');
      return;
    }
    await db.run(
      `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, old_value, new_value, ip_address, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        uuidv4(),
        userId || 'system',
        action,
        entityType,
        entityId == null ? null : String(entityId),
        oldValue == null ? null : (typeof oldValue === 'string' ? oldValue : JSON.stringify(oldValue)),
        newValue == null ? null : (typeof newValue === 'string' ? newValue : JSON.stringify(newValue)),
        ipAddress || null
      ]
    );
  } catch (e) {
    // Never throw — audit-log writes must not break a user-facing flow.
    console.error('[AUDIT] Failed to write audit log:', e.message, '|', action, entityType);
  }
}

module.exports = { writeAudit };
