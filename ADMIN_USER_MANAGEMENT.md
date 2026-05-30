# Admin User Management Guide

## Overview

This guide explains how administrators can manage users, handle passwords, and troubleshoot authentication issues in Task Tango.

## User Management Operations

### Creating New Users

New users are typically created when adding employees to the system.

#### Via Employee Manager

1. Navigate to Admin Dashboard → Employee Manager
2. Click "Add New Employee"
3. Fill in employee details:
   - Full Name
   - Email
   - Phone
   - Department
   - Role (Employee, Lead, Administrator, MD)
4. Click "Create"
5. System automatically creates user account with:
   - Username: Auto-generated or manually entered
   - Initial Password: "password"
   - isFirstLogin: true
   - Status: active

#### Directly via IPC (Backend Only)

```javascript
const result = await window.electron.createUser({
  username: 'john.smith',
  fullName: 'John Smith',
  roleId: 'role-id',
  departmentId: 'dept-id',
  isLead: false
});
```

### User Details

After creation, users will:
1. Receive their username (usually lastname or first.lastname)
2. Initial password is "password"
3. Must change password on first login
4. Cannot skip password change
5. Once changed, can login with new password

### Resetting User Passwords

If a user forgets their password or is locked out:

#### Via Admin Panel (Future Feature)

1. Go to Admin Dashboard → User Management
2. Find user in list
3. Click "Reset Password"
4. Confirm action
5. User password is reset to "password"
6. User must change on next login

#### Via Backend

```javascript
const result = await window.electron.resetUserPassword(userId);
// Returns: { success: true, message: 'Password reset successfully' }
```

**Important**: User will see password change modal on next login.

### Deactivating Users

To disable a user account:

1. Go to Admin Dashboard → User Management
2. Find user in list
3. Click "Deactivate" or "Change Status"
4. Select "Inactive"
5. Save changes

**Effect**: User cannot login; authentication fails with "User account is inactive"

### Viewing User Details

1. Admin Dashboard → User Management
2. Click on user name or info icon
3. View:
   - Username
   - Full Name
   - Email
   - Phone
   - Department
   - Role
   - Account Status
   - Created Date
   - Last Login Date
   - Password Last Changed

## Password Management

### Password Requirements

All users must meet these requirements:

- **Minimum 8 characters**
- **At least one uppercase letter** (A-Z)
- **At least one lowercase letter** (a-z)
- **At least one number** (0-9)
- **At least one special character** (!@#$%^&*()_+-=[]{}...etc)

Example strong passwords:
- `SecurePass123!`
- `MyPassword@2024`
- `Admin#Secure99`

Example weak passwords:
- `password` (no uppercase, numbers, special chars)
- `Password123` (no special character)
- `Pass@` (too short)

### Password Strength Indicator

When users change their password, they see:

- **Weak** (Red): 0-1 criteria met
- **Fair** (Orange): 2 criteria met
- **Good** (Yellow): 3 criteria met
- **Strong** (Green): 4 criteria met
- **Very Strong** (Dark Green): All 5 criteria met

### Forcing Password Change

#### First Login

- All new users must change password on first login
- Modal appears after successful authentication
- Cannot skip; no "Cancel" button on first login
- User must set password before accessing dashboard

#### Password Reset

- When admin resets user password, user's isFirstLogin flag is set to 1
- On next login, user sees password change modal
- User must set new password before accessing dashboard

### Password Expiration (Future Feature)

Planned feature to force password changes periodically:
- Configurable expiration period (30, 60, 90 days)
- Warning emails before expiration
- Force change on next login if expired
- Audit trail of all password changes

## Audit & Monitoring

### Viewing Audit Logs

1. Admin Dashboard → Audit Dashboard
2. Filter by:
   - User
   - Action Type
   - Date Range
   - Entity Type

### Authentication Events

The system logs all authentication events:

| Action | Trigger | Logged When |
|--------|---------|------------|
| LOGIN | User logs in | Always |
| LOGOUT | User logs out | Always |
| PASSWORD_CHANGE | User changes password | Regular password change |
| INITIAL_PASSWORD_SET | User sets password | First login password change |
| CREATE_USER | Admin creates user | New user created |
| RESET_PASSWORD | Admin resets password | Password reset initiated |

### Sample Audit Log Query

```sql
SELECT * FROM audit_logs
WHERE action IN ('LOGIN', 'PASSWORD_CHANGE', 'INITIAL_PASSWORD_SET')
ORDER BY timestamp DESC
LIMIT 100;
```

## Troubleshooting

### "Invalid credentials" Error

**Symptoms**: User cannot login with username and password

**Causes**:
1. Wrong username or password
2. Account is inactive
3. Database connection issue

**Solutions**:
1. Verify username is correct (case-sensitive)
2. Check account status (should be "active")
3. Restart application to reconnect database
4. Check database is properly initialized

### User Stuck on Password Change Modal

**Symptoms**: User cannot proceed past password change screen

**Causes**:
1. Password doesn't meet requirements
2. Passwords don't match
3. Form has validation errors

**Solutions**:
1. Read error messages carefully
2. Ensure password meets all requirements
3. Verify confirm password matches exactly
4. Check for leading/trailing spaces

### Cannot Create New User

**Symptoms**: User creation fails with error message

**Causes**:
1. Username already exists (must be unique)
2. Missing required fields
3. Database error
4. Permission issue

**Solutions**:
1. Use different username
2. Fill all required fields
3. Check error log for details
4. Verify admin permissions

### Password Change Not Working

**Symptoms**: Password change fails after clicking submit

**Causes**:
1. Current password incorrect (regular change)
2. New password doesn't meet requirements
3. Passwords don't match
4. Database connection error

**Solutions**:
1. Verify current password is correct
2. Check password meets all requirements
3. Ensure passwords match exactly
4. Restart application and try again

### User Cannot Reset Password

**Symptoms**: "Reset Password" button not working or error appears

**Causes**:
1. User is already admin or system user
2. Permission denied (only Admin can reset)
3. Database error

**Solutions**:
1. Verify user is not protected system user
2. Ensure logged in user is Admin role
3. Check database logs for errors
4. Try again after restarting application

## Best Practices

### Security

1. **Initial Passwords**: Always set initial password to "password"
2. **First Login Change**: Enforce password change on first login
3. **Reset on Departure**: Reset password when user leaves
4. **Audit Review**: Regularly review audit logs
5. **Account Deactivation**: Deactivate instead of deleting
6. **Strong Passwords**: Educate users on strong passwords
7. **Password Sharing**: Warn users never to share passwords
8. **Session Management**: Remind users to logout when finished

### User Experience

1. **Welcome Email**: Send username to new users
2. **Clear Instructions**: Provide first login instructions
3. **Password Help**: Have mechanism for password reset
4. **Support Contact**: Provide admin contact for locked accounts
5. **Documentation**: Share password requirements with users

### Account Maintenance

1. **Regular Audits**: Review user list quarterly
2. **Deactivate Unused**: Deactivate inactive accounts
3. **Role Review**: Periodically verify role assignments
4. **Department Changes**: Update department on transfers
5. **Status Monitoring**: Check for suspicious login patterns

## Demo Users

Initial demo users provided:

| Username | Password | Role | Status |
|----------|----------|------|--------|
| admin | password | Admin | Active |
| john_lead | password | Lead | Active |
| sarah_emp | password | User | Active |

**For Testing**: Use demo users to test authentication flow

**For Production**: Delete or deactivate demo users before deploying

## Database Direct Access

### Viewing Users

```sql
SELECT u.id, u.username, u.full_name, r.name as role, u.status, u.is_first_login
FROM users u
JOIN roles r ON u.role_id = r.id
ORDER BY u.created_at DESC;
```

### Updating User Status

```sql
UPDATE users SET status = 'inactive' WHERE username = 'john_lead';
```

### Viewing Audit Logs

```sql
SELECT u.username, a.action, a.entity_type, a.timestamp
FROM audit_logs a
LEFT JOIN users u ON a.user_id = u.id
ORDER BY a.timestamp DESC
LIMIT 50;
```

### Checking First Login Status

```sql
SELECT u.username, u.full_name, u.is_first_login, u.updated_at
FROM users u
WHERE u.is_first_login = 1
ORDER BY u.created_at;
```

## Common Procedures

### Onboarding New User

1. Create employee in Employee Manager
   - System auto-creates user account
   - Initial password: "password"
2. Send user their username
3. User logs in for first time
   - ChangePasswordModal appears
   - User sets their password
4. User can access dashboard

### Offboarding Departing User

1. Go to User Management
2. Find user account
3. Click "Deactivate"
4. Confirm deactivation
5. User cannot login
6. (Optional) Reset password if account might be reused

### Forgotten Password Recovery

1. User contacts admin
2. Admin resets password
   - Go to User Management
   - Select user
   - Click "Reset Password"
3. Inform user password is reset to "password"
4. User logs in with "password"
5. ChangePasswordModal appears
6. User sets new password

### Promoting User to Admin

1. Go to User Management
2. Find user
3. Click "Edit Role"
4. Change role to "Administrator"
5. Save changes
6. User now has admin permissions

## Support & Escalation

### Common Questions

**Q: Can admin see user passwords?**
A: No. Passwords are hashed. Not even admins can see original passwords.

**Q: What if admin forgets their password?**
A: Database must be reset or admin account recreated by developer.

**Q: Can password requirements be changed?**
A: Yes, by editing PASSWORD_RULES in authHandlers.js and restarting app.

**Q: How often should users change passwords?**
A: Best practice is every 90 days. Set reminder emails if using scheduled tasks.

**Q: Is there two-factor authentication?**
A: Not currently. Future enhancement planned.

### Getting Help

1. Check AUTHENTICATION_SYSTEM.md for technical details
2. Review audit logs for error patterns
3. Check application console for error messages
4. Contact development team with error details

## Changelog

### Version 1.0 (Current)

- Initial authentication system with bcrypt hashing
- First-time login password change enforcement
- Password strength validation
- Audit logging of all auth events
- Demo user seeding
- Real-time password validation
- Beautiful password change modal
- Responsive design

### Planned Features

- Email-based password reset
- Security questions for account recovery
- IP-based login restrictions
- Device management for trusted devices
- Automatic session timeout
- Two-factor authentication (TOTP/SMS)
- Password expiration and rotation
- Biometric login (Windows Hello)
- Login history and analytics
- Impossible travel detection
