// Pulse v5.2 — shared authorization helpers for the multi-user web server.
//
// In the Fly web build, ONE Node process serves every browser and identity
// arrives per-request (token-validated id on event.sender.id — see
// webServer.js). These helpers stop a plain employee from reading another
// user's data just by changing a `userId` parameter (an IDOR).
//
// In Electron desktop mode there is a single trusted local user, so the
// helpers are permissive there (global.__webMode is only set in server.js).

// Roles allowed to access ANY user's records (admin screens, team views).
const PRIVILEGED_ROLES = ['admin', 'administrator', 'md', 'managing director', 'manager', 'lead'];

// The caller's user id, as resolved by the HTTP layer (validated session token
// → authoritative id; falls back to the x-user-id header for legacy clients).
function callerId(event) {
  return (event && event.sender && event.sender.id) || null;
}

// Is the caller allowed to act on / read data belonging to `targetUserId`?
//   - desktop / non-web mode → yes (single trusted user)
//   - self → yes
//   - privileged role or department lead → yes
//   - plain employee asking for someone else → no
async function canAccessUser(db, event, targetUserId) {
  if (!global.__webMode) return true;
  const cid = callerId(event);
  if (!cid) return false;
  if (!targetUserId || String(cid) === String(targetUserId)) return true;
  try {
    const caller = await db.get(
      `SELECT u.is_department_lead, r.name AS role_name
         FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.id = ?`,
      [cid]
    );
    if (!caller) return false;
    const role = (caller.role_name || '').toLowerCase();
    return PRIVILEGED_ROLES.includes(role) || caller.is_department_lead === 1;
  } catch (_) {
    return false;
  }
}

// Convenience: standard "denied" response shape used by handlers.
function denied(message = 'You are not allowed to access this data') {
  return { success: false, message, error: 'forbidden' };
}

module.exports = { callerId, canAccessUser, denied, PRIVILEGED_ROLES };
