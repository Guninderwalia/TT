# Quick Authentication Reference

## Demo Users (First Login)

```
Username: admin | Password: password
Username: john_lead | Password: password
Username: sarah_emp | Password: password
```

All require password change on first login.

## Password Requirements

- Minimum **8 characters**
- At least one **UPPERCASE** letter
- At least one **lowercase** letter
- At least one **NUMBER**
- At least one **SPECIAL CHARACTER** (!@#$%^&*()_+-=[]{}...etc)

## File Locations

| File | Purpose |
|------|---------|
| `src/db/schema.sql` | Database schema definition |
| `src/db/init.js` | Database initialization |
| `src/db/migrations.js` | Schema migrations |
| `src/main/handlers/authHandlers.js` | Authentication logic |
| `src/main/preload.js` | IPC bridge |
| `src/pages/LoginPage.jsx` | Login page UI |
| `src/components/modals/ChangePasswordModal.jsx` | Password change modal |
| `src/styles/changePasswordModal.css` | Modal styling |
| `src/styles/login.css` | Login page styling |

## Database Location

**Windows**: `%APPDATA%\TaskTango\tasktango.db`

## Key Features

✅ Bcrypt password hashing (10 salt rounds)  
✅ First-login password change enforcement  
✅ Real-time password strength indicator  
✅ Password validation with custom rules  
✅ Audit logging of all auth events  
✅ Inactive account support  
✅ Beautiful responsive UI  
✅ Demo mode fallback  

## IPC Methods

### Login
```javascript
const result = await window.electron.login(username, password);
// { success, user, isFirstLogin }
```

### Password Change (First Login)
```javascript
const result = await window.electron.changePasswordFirstLogin(newPassword, confirmPassword);
// { success, message }
```

### Password Change (Regular)
```javascript
const result = await window.electron.changePassword(oldPassword, newPassword, confirmPassword);
// { success, message }
```

### Validate Password
```javascript
const result = await window.electron.validatePassword(password);
// { isValid, errors[], strength }
```

### Logout
```javascript
const result = await window.electron.logout();
// { success }
```

## Tables

| Table | Purpose |
|-------|---------|
| `users` | User accounts and credentials |
| `roles` | User roles (Admin, Lead, User, MD) |
| `departments` | Organization departments |
| `audit_logs` | Authentication event history |

## Audit Events

- **LOGIN**: User authenticates
- **LOGOUT**: User logs out
- **PASSWORD_CHANGE**: User changes password
- **INITIAL_PASSWORD_SET**: User sets password on first login
- **CREATE_USER**: Admin creates new user
- **RESET_PASSWORD**: Admin resets user password

## Configuration

Edit `PASSWORD_RULES` in `src/main/handlers/authHandlers.js`:

```javascript
const PASSWORD_RULES = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true
};
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Login fails | Verify username (case-sensitive) and password |
| Modal won't close | Password must meet all requirements |
| Password weak | Add uppercase, lowercase, numbers, special chars |
| Database not found | Application creates at %APPDATA%\TaskTango\tasktango.db |
| Demo mode active | Real database not available; only demo users work |

## Security Notes

- Never store plain passwords
- Always use bcrypt for hashing
- Use at least 10 salt rounds
- Enforce strong password on first login
- Log all authentication events
- Deactivate users when they leave
- Review audit logs regularly

## Testing Checklist

- [ ] Login with demo credentials
- [ ] Password modal appears on first login
- [ ] Can set new password
- [ ] Login fails with wrong password
- [ ] New password required on next login
- [ ] Audit logs show login events
- [ ] Password strength indicator works
- [ ] Can validate passwords
- [ ] Responsive on mobile

## Documentation

- **AUTHENTICATION_SYSTEM.md**: Complete technical documentation
- **ADMIN_USER_MANAGEMENT.md**: Admin procedures and troubleshooting
- **QUICK_AUTH_REFERENCE.md**: This quick reference guide

## Key Code Snippets

### Hash Password
```javascript
const hash = await bcrypt.hash(password, 10);
```

### Verify Password
```javascript
const match = await bcrypt.compare(password, hash);
```

### Check First Login
```javascript
if (result.isFirstLogin) {
  showPasswordModal();
}
```

### Validate Password
```javascript
const validation = validatePassword(password);
if (!validation.isValid) {
  showErrors(validation.errors);
}
```

## Performance

- Database queries optimized with indexes
- Audit table indexed on user_id and entity_type
- Login query uses indexed username field
- Password validation runs client-side for responsiveness

## Migration Guide

If migrating from old system:

1. Create users table with new schema
2. Hash existing passwords: `UPDATE users SET password_hash = bcrypt(password)`
3. Add is_first_login column
4. Run migrations: `await runMigrations(db)`
5. Test login flow with migrated users

## Next Steps

1. Test authentication thoroughly
2. Train admins on user management
3. Establish password policy
4. Set up regular audit log reviews
5. Plan for password reset process
6. Consider 2FA implementation
7. Monitor login patterns
8. Update employee handbook
