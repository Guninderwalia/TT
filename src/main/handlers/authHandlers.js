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

function register(ipcMain, db) {
  ipcMain.handle('auth:login', async (event, { email, password }) => {
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
      currentUser = safeUser;

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
      }
      currentUser = null;
      return { success: true };
    } catch (error) {
      console.error('Logout error:', error);
      return { success: false, message: 'Logout failed' };
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
