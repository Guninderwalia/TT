const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

let currentUser = null;

// Password validation rules
const PASSWORD_RULES = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true
};

function validatePassword(password) {
  const errors = [];

  if (password.length < PASSWORD_RULES.minLength) {
    errors.push(`Minimum ${PASSWORD_RULES.minLength} characters required`);
  }
  if (PASSWORD_RULES.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Must contain at least one uppercase letter');
  }
  if (PASSWORD_RULES.requireLowercase && !/[a-z]/.test(password)) {
    errors.push('Must contain at least one lowercase letter');
  }
  if (PASSWORD_RULES.requireNumbers && !/[0-9]/.test(password)) {
    errors.push('Must contain at least one number');
  }
  if (PASSWORD_RULES.requireSpecialChars && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Must contain at least one special character');
  }

  return { isValid: errors.length === 0, errors };
}

function getPasswordStrength(password) {
  let strength = 0;
  const maxStrength = 5;

  if (password.length >= PASSWORD_RULES.minLength) strength++;
  if (/[A-Z]/.test(password)) strength++;
  if (/[a-z]/.test(password)) strength++;
  if (/[0-9]/.test(password)) strength++;
  if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) strength++;

  return {
    score: strength,
    maxScore: maxStrength,
    percentage: (strength / maxStrength) * 100,
    label: strength <= 1 ? 'Weak' : strength <= 2 ? 'Fair' : strength <= 3 ? 'Good' : strength <= 4 ? 'Strong' : 'Very Strong'
  };
}

// Derive a human label from a User-Agent string. Falls back to "Unknown device".
function deviceLabelFromUA(ua) {
  if (!ua) return 'Desktop app';
  const s = String(ua);
  let os = 'Unknown OS';
  if (/Windows/i.test(s)) os = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(s)) os = 'macOS';
  else if (/Android/i.test(s)) os = 'Android';
  else if (/iPhone|iPad|iOS/i.test(s)) os = 'iOS';
  else if (/Linux/i.test(s)) os = 'Linux';
  let browser = 'browser';
  if (/Edg\//i.test(s)) browser = 'Edge';
  else if (/Chrome/i.test(s)) browser = 'Chrome';
  else if (/Firefox/i.test(s)) browser = 'Firefox';
  else if (/Safari/i.test(s) && !/Chrome/i.test(s)) browser = 'Safari';
  else if (/Electron/i.test(s)) return `Desktop app · ${os}`;
  return `${browser} · ${os}`;
}

function register(ipcMain, db) {
  ipcMain.handle('auth:login', async (event, { email, password, clientInfo }) => {
    try {
      const user = await db.get(
        `SELECT u.*, r.name as role_name FROM users u
         JOIN roles r ON u.role_id = r.id
         WHERE u.email = ?`,
        [email]
      );

      if (!user) {
        return { success: false, message: 'Invalid credentials' };
      }

      const passwordMatch = await bcrypt.compare(password, user.password_hash);
      if (!passwordMatch) {
        return { success: false, message: 'Invalid credentials' };
      }

      if (user.status !== 'active') {
        return { success: false, message: 'User account is inactive' };
      }

      // Remove sensitive data and add camelCase aliases for frontend compatibility.
      // (SQL returns snake_case columns, but legacy frontend components expect
      // fullName, departmentId, etc.)
      const { password_hash, ...safeUser } = user;
      safeUser.fullName = safeUser.full_name || safeUser.fullName;
      safeUser.departmentId = safeUser.department_id || safeUser.departmentId;
      safeUser.isFirstLogin = safeUser.is_first_login === 1;
      safeUser.onboardingCompleted = (safeUser.onboarding_completed === 1 || safeUser.onboarding_completed === true);
      currentUser = safeUser;

      // v4.6 — record a session row so the user can see (and end) other
      // active logins later. Best-effort: don't fail login if the table is
      // missing on a very old DB.
      try {
        const sessionId = uuidv4();
        const sessionToken = uuidv4() + '.' + uuidv4();
        const ip = clientInfo?.ip || null;
        const ua = clientInfo?.userAgent || null;
        const label = clientInfo?.deviceLabel || deviceLabelFromUA(ua);
        await db.run(
          `INSERT INTO user_sessions (id, user_id, token, ip_address, user_agent, device_label, created_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [sessionId, user.id, sessionToken, ip, ua, label]
        );
        safeUser.sessionId = sessionId;
        safeUser.sessionToken = sessionToken;
        currentUser.sessionId = sessionId;
        currentUser.sessionToken = sessionToken;
        // v4.6.3 — explicit device-detection log line so admins reviewing
        // the server logs can see exactly what was recognised on each login.
        console.log(`[AUTH] LOGIN  user=${user.email}  device="${label}"  ip=${ip || 'local'}  ua="${(ua || '').slice(0, 80)}"`);
        // Also write an enriched audit row that includes the device label
        // so the audit log UI shows useful context, not just "LOGIN".
        try {
          await db.run(
            `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, new_value, timestamp)
             VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [uuidv4(), user.id, 'LOGIN_DEVICE', 'UserSession', sessionId,
             JSON.stringify({ device: label, ip, sessionId })]
          );
        } catch (_) { /* audit is best-effort */ }
      } catch (e) { console.warn('[AUTH] session record failed:', e.message); }

      // Stamp last_login so admins can spot dormant accounts. Best-effort —
      // a tiny ALTER TABLE failure here shouldn't block the login.
      try {
        await db.run(
          'UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?',
          [user.id]
        );
      } catch (_) { /* column may not exist on very old DBs */ }

      // Log audit
      await db.run(
        `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, timestamp)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [uuidv4(), user.id, 'LOGIN', 'User', user.id]
      );

      // Return with isFirstLogin flag
      return {
        success: true,
        user: safeUser,
        isFirstLogin: user.is_first_login === 1
      };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, message: 'Authentication failed' };
    }
  });

  ipcMain.handle('auth:changePassword', async (event, { oldPassword, newPassword, confirmPassword }) => {
    try {
      if (!currentUser) {
        return { success: false, message: 'No user logged in' };
      }

      if (newPassword !== confirmPassword) {
        return { success: false, message: 'Passwords do not match' };
      }

      // Validate new password
      const validation = validatePassword(newPassword);
      if (!validation.isValid) {
        return { success: false, message: 'Invalid password', errors: validation.errors };
      }

      // Verify old password
      const user = await db.get(
        'SELECT password_hash FROM users WHERE id = ?',
        [currentUser.id]
      );

      const oldPasswordMatch = await bcrypt.compare(oldPassword, user.password_hash);
      if (!oldPasswordMatch) {
        return { success: false, message: 'Current password is incorrect' };
      }

      // Hash new password
      const newPasswordHash = await bcrypt.hash(newPassword, 10);

      // Update password and clear first login flag
      await db.run(
        `UPDATE users
         SET password_hash = ?, is_first_login = 0, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [newPasswordHash, currentUser.id]
      );

      // Log audit
      await db.run(
        `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, timestamp)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [uuidv4(), currentUser.id, 'PASSWORD_CHANGE', 'User', currentUser.id]
      );

      // Update current user
      currentUser.is_first_login = 0;

      return { success: true, message: 'Password changed successfully' };
    } catch (error) {
      console.error('Change password error:', error);
      return { success: false, message: 'Failed to change password' };
    }
  });

  ipcMain.handle('auth:changePasswordFirstLogin', async (event, { newPassword, confirmPassword }) => {
    try {
      if (!currentUser) {
        return { success: false, message: 'No user logged in' };
      }

      if (newPassword !== confirmPassword) {
        return { success: false, message: 'Passwords do not match' };
      }

      // Validate new password
      const validation = validatePassword(newPassword);
      if (!validation.isValid) {
        return { success: false, message: 'Invalid password', errors: validation.errors };
      }

      // Hash new password
      const newPasswordHash = await bcrypt.hash(newPassword, 10);

      // Update password and clear first login flag
      await db.run(
        `UPDATE users
         SET password_hash = ?, is_first_login = 0, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [newPasswordHash, currentUser.id]
      );

      // Log audit
      await db.run(
        `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, timestamp)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [uuidv4(), currentUser.id, 'INITIAL_PASSWORD_SET', 'User', currentUser.id]
      );

      // Update current user
      currentUser.is_first_login = 0;

      return { success: true, message: 'Password set successfully' };
    } catch (error) {
      console.error('First login password set error:', error);
      return { success: false, message: 'Failed to set password' };
    }
  });

  ipcMain.handle('auth:validatePassword', async (event, { password }) => {
    const validation = validatePassword(password);
    const strength = getPasswordStrength(password);

    return {
      isValid: validation.isValid,
      errors: validation.errors,
      strength
    };
  });

  ipcMain.handle('auth:logout', async (event) => {
    try {
      if (currentUser) {
        await db.run(
          `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, timestamp)
           VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [uuidv4(), currentUser.id, 'LOGOUT', 'User', currentUser.id]
        );
        // v4.6 — revoke this session row so it disappears from the active list.
        if (currentUser.sessionId) {
          try {
            await db.run(
              `UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?`,
              [currentUser.sessionId]
            );
          } catch (_) {}
        }
      }
      currentUser = null;
      return { success: true };
    } catch (error) {
      console.error('Logout error:', error);
      return { success: false, message: 'Logout failed' };
    }
  });

  // v4.6.2 — Identity helper. In web mode the Node process is shared across
  // many users, and after a deploy/restart the module-scoped `currentUser`
  // is null even though browser tabs still have their identity. The web
  // shim sends the user id in the x-user-id header, which webServer.js
  // mirrors onto event.sender.id. Use that as a fallback.
  function callerId(event) {
    if (currentUser?.id) return currentUser.id;
    return event?.sender?.id || null;
  }

  // v4.6 — Active session listing for the current user. Excludes revoked rows
  // and rows that haven't been seen in 30 days (stale).
  //
  // v4.6.3 — Lazy backfill: if the caller is identified (via x-user-id) but
  // has zero session rows — usually because they logged in BEFORE the
  // user_sessions table existed — synthesise a session row for the
  // current device on the fly. Next refresh they'll see themselves.
  ipcMain.handle('auth:listMySessions', async (event) => {
    try {
      const userId = callerId(event);
      if (!userId) return { success: false, message: 'Not logged in', data: [] };

      let rows = await db.all(
        `SELECT id, ip_address, user_agent, device_label, created_at, last_seen_at
           FROM user_sessions
          WHERE user_id = ?
            AND revoked_at IS NULL
            AND last_seen_at >= datetime('now', '-30 days')
          ORDER BY last_seen_at DESC`,
        [userId]
      );

      // Backfill — no rows but the caller is clearly logged in. Make one
      // using whatever request metadata the web server attached.
      if (rows.length === 0) {
        const ri = event?.requestInfo || {};
        const ua = ri.userAgent || null;
        const ip = ri.ip || null;
        const label = deviceLabelFromUA(ua);
        const sessionId = uuidv4();
        const sessionToken = uuidv4() + '.' + uuidv4();
        try {
          await db.run(
            `INSERT INTO user_sessions (id, user_id, token, ip_address, user_agent, device_label, created_at, last_seen_at)
             VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [sessionId, userId, sessionToken, ip, ua, label]
          );
          if (currentUser && currentUser.id === userId) {
            currentUser.sessionId = sessionId;
            currentUser.sessionToken = sessionToken;
          }
          console.log(`[AUTH] BACKFILL session  user=${userId}  device="${label}"  ip=${ip || 'local'}`);
          rows = await db.all(
            `SELECT id, ip_address, user_agent, device_label, created_at, last_seen_at
               FROM user_sessions
              WHERE user_id = ?
                AND revoked_at IS NULL
              ORDER BY last_seen_at DESC`,
            [userId]
          );
        } catch (e) {
          console.warn('[AUTH] session backfill failed:', e.message);
        }
      } else {
        // Bump last_seen_at on the row that matches the caller's UA so the
        // "Last seen" timestamp stays meaningful as they navigate.
        const ri = event?.requestInfo || {};
        const ua = ri.userAgent;
        if (ua) {
          try {
            await db.run(
              `UPDATE user_sessions
                  SET last_seen_at = CURRENT_TIMESTAMP
                WHERE user_id = ? AND user_agent = ? AND revoked_at IS NULL`,
              [userId, ua]
            );
          } catch (_) {}
        }
      }

      const data = rows.map(r => ({
        ...r,
        isCurrent: r.id === currentUser?.sessionId
      }));
      return { success: true, data };
    } catch (error) {
      console.error('listMySessions error:', error);
      return { success: false, message: error.message, data: [] };
    }
  });

  // v4.6 — Revoke one specific other session. Will refuse to revoke the caller's
  // own session (use auth:logout for that).
  ipcMain.handle('auth:revokeSession', async (event, { sessionId }) => {
    try {
      const userId = callerId(event);
      if (!userId) return { success: false, message: 'Not logged in' };
      if (!sessionId) return { success: false, message: 'sessionId required' };
      if (currentUser?.sessionId && sessionId === currentUser.sessionId) {
        return { success: false, message: 'Use logout to end the current session' };
      }
      const result = await db.run(
        `UPDATE user_sessions
            SET revoked_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND user_id = ?
            AND revoked_at IS NULL`,
        [sessionId, userId]
      );
      return { success: true, changes: result?.changes || 0 };
    } catch (error) {
      console.error('revokeSession error:', error);
      return { success: false, message: error.message };
    }
  });

  // v4.6 — "Sign out everywhere else" — revoke every other active session.
  ipcMain.handle('auth:revokeAllOtherSessions', async (event) => {
    try {
      const userId = callerId(event);
      if (!userId) return { success: false, message: 'Not logged in' };
      const result = await db.run(
        `UPDATE user_sessions
            SET revoked_at = CURRENT_TIMESTAMP
          WHERE user_id = ?
            AND revoked_at IS NULL
            AND id != COALESCE(?, '')`,
        [userId, currentUser?.sessionId || '']
      );
      return { success: true, revoked: result?.changes || 0 };
    } catch (error) {
      console.error('revokeAllOtherSessions error:', error);
      return { success: false, message: error.message };
    }
  });

  // v4.6 — Mark onboarding wizard completed for the current user. Called by
  // the wizard's Done step so we don't show it again.
  ipcMain.handle('auth:completeOnboarding', async (event) => {
    try {
      const userId = callerId(event);
      if (!userId) return { success: false, message: 'Not logged in' };
      await db.run(
        `UPDATE users SET onboarding_completed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [userId]
      );
      if (currentUser) currentUser.onboardingCompleted = true;
      return { success: true };
    } catch (error) {
      console.error('completeOnboarding error:', error);
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('auth:getCurrentUser', async (event) => {
    return currentUser || null;
  });

  ipcMain.handle('auth:createUser', async (event, { username, fullName, roleId, departmentId, isLead = false }) => {
    try {
      const userId = uuidv4();
      // Initial password is "password"
      const initialPasswordHash = await bcrypt.hash('password', 10);

      await db.run(
        `INSERT INTO users (id, username, password_hash, full_name, role_id, department_id, is_department_lead, is_first_login, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, username, initialPasswordHash, fullName, roleId, departmentId, isLead ? 1 : 0, 1, 'active']
      );

      // Log audit
      await db.run(
        `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, timestamp)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [uuidv4(), currentUser?.id || 'system', 'CREATE_USER', 'User', userId]
      );

      return { success: true, message: 'User created successfully', userId };
    } catch (error) {
      console.error('Create user error:', error);
      return { success: false, message: 'Failed to create user', error: error.message };
    }
  });

  ipcMain.handle('auth:resetUserPassword', async (event, { userId }) => {
    try {
      // Reset password to "password"
      const initialPasswordHash = await bcrypt.hash('password', 10);

      await db.run(
        `UPDATE users
         SET password_hash = ?, is_first_login = 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [initialPasswordHash, userId]
      );

      // Log audit
      await db.run(
        `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, timestamp)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [uuidv4(), currentUser?.id || 'system', 'RESET_PASSWORD', 'User', userId]
      );

      return { success: true, message: 'Password reset successfully' };
    } catch (error) {
      console.error('Reset password error:', error);
      return { success: false, message: 'Failed to reset password' };
    }
  });

  ipcMain.handle('auth:getPasswordRules', async (event) => {
    return PASSWORD_RULES;
  });
}

module.exports = { register, validatePassword, getPasswordStrength, PASSWORD_RULES };
