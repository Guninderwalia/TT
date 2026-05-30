# Task Tango Authentication & Password Management System

## Overview

This document describes the production-ready authentication and password management system implemented for the Task Tango application.

## System Architecture

### Components

1. **Database Layer** (`src/db/init.js`, `src/db/schema.sql`, `src/db/migrations.js`)
   - SQLite database with user credentials and roles
   - Automatic migration system for schema updates
   - Support for user creation and password management

2. **Authentication Handlers** (`src/main/handlers/authHandlers.js`)
   - Login with username and hashed password validation
   - Password hashing using bcryptjs (10 salt rounds)
   - First-time login detection and forcing password change
   - Password validation with customizable rules
   - Audit logging for all authentication events

3. **Frontend Components** (`src/pages/LoginPage.jsx`, `src/components/modals/ChangePasswordModal.jsx`)
   - Secure login form
   - First-time password change modal
   - Password strength indicator
   - Real-time password validation

4. **IPC Bridge** (`src/main/preload.js`)
   - Secure expose of authentication functions to renderer process
   - Message-based communication between frontend and backend

## User Database Structure

### Users Table

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  email TEXT,
  full_name TEXT NOT NULL,
  role_id TEXT NOT NULL,
  department_id TEXT,
  is_department_lead BOOLEAN DEFAULT 0,
  is_first_login BOOLEAN DEFAULT 1,
  profile_picture_path TEXT,
  phone TEXT,
  status TEXT DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (role_id) REFERENCES roles(id),
  FOREIGN KEY (department_id) REFERENCES departments(id)
);
```

### Key Fields

- **is_first_login**: Boolean flag (default: 1). Set to 0 after user changes password for first time.
- **password_hash**: Bcrypted password hash (10 salt rounds). Never store plain passwords.
- **status**: User account status ('active' or 'inactive')

## Authentication Flow

### Initial Login

1. User enters username and password on LoginPage
2. System queries database for user by username
3. System validates password using bcrypt.compare()
4. System checks if user account is active
5. System checks isFirstLogin flag
6. If isFirstLogin = true:
   - Show ChangePasswordModal (blocking)
   - User MUST change password to continue
   - After password change, isFirstLogin set to 0
   - User logs in normally
7. If isFirstLogin = false:
   - User logs in and accesses dashboard

### Password Change Flow (First Login)

1. User sees modal: "Set Your Password"
2. User enters new password (no "current password" field)
3. System validates password strength in real-time
4. User confirms password
5. System hashes new password and updates database
6. System sets isFirstLogin = 0
7. System logs audit event "INITIAL_PASSWORD_SET"
8. User proceeds to dashboard

### Password Change Flow (Regular)

1. User initiates "Change Password" action from settings (future feature)
2. Modal shows three fields:
   - Current Password (validated against stored hash)
   - New Password (validated against rules)
   - Confirm Password
3. System validates all inputs
4. System updates password_hash
5. System logs audit event "PASSWORD_CHANGE"
6. User continues with new password

## Password Validation Rules

### Default Rules

- Minimum 8 characters
- Must contain at least one uppercase letter (A-Z)
- Must contain at least one lowercase letter (a-z)
- Must contain at least one number (0-9)
- Must contain at least one special character (!@#$%^&*()_+-=[]{}...etc)

### Customization

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

### Password Strength Scoring

Password strength is calculated on 0-5 scale:
- **1 point**: Meets minimum length
- **1 point**: Contains uppercase
- **1 point**: Contains lowercase
- **1 point**: Contains numbers
- **1 point**: Contains special characters

Labels:
- 0-1: Weak (red)
- 2: Fair (orange)
- 3: Good (yellow)
- 4: Strong (green)
- 5: Very Strong (dark green)

## IPC Handlers

### Login

```javascript
// Frontend
const result = await window.electron.login(username, password);
// Returns: { success, user, isFirstLogin }
```

### Change Password (First Login)

```javascript
// Frontend
const result = await window.electron.changePasswordFirstLogin(newPassword, confirmPassword);
// Returns: { success, message }
```

### Change Password (Regular)

```javascript
// Frontend
const result = await window.electron.changePassword(oldPassword, newPassword, confirmPassword);
// Returns: { success, message }
```

### Validate Password

```javascript
// Frontend
const result = await window.electron.validatePassword(password);
// Returns: {
//   isValid: boolean,
//   errors: string[],
//   strength: { score, maxScore, percentage, label }
// }
```

### Create User

```javascript
// Backend only
const result = await db.get('auth:createUser', {
  username: 'john.doe',
  fullName: 'John Doe',
  roleId: 'role-id',
  departmentId: 'dept-id',
  isLead: false
});
// Initial password: "password"
// isFirstLogin: true
```

### Reset User Password

```javascript
// Backend only
const result = await db.get('auth:resetUserPassword', { userId: 'user-id' });
// Resets password to "password"
// Sets isFirstLogin: true
```

### Get Password Rules

```javascript
// Frontend
const rules = await window.electron.getPasswordRules();
// Returns PASSWORD_RULES object
```

## Audit Logging

All authentication events are logged to `audit_logs` table:

### Events Logged

- **LOGIN**: User logs in
- **LOGOUT**: User logs out
- **PASSWORD_CHANGE**: User changes password (regular)
- **INITIAL_PASSWORD_SET**: User sets password on first login
- **CREATE_USER**: Admin creates new user
- **RESET_PASSWORD**: Admin resets user password

### Audit Log Schema

```sql
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  old_value TEXT,
  new_value TEXT,
  ip_address TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

## Security Best Practices

### Implemented

1. **Password Hashing**: Using bcryptjs with 10 salt rounds
2. **Never Store Plain Passwords**: All passwords hashed before storage
3. **Secure Comparison**: Using bcrypt.compare() for validation
4. **Password Requirements**: Strong password rules enforced
5. **Audit Trail**: All auth events logged
6. **Account Status**: Users can be marked inactive
7. **First Login Enforcement**: Passwords must be changed on first login
8. **Real-Time Validation**: Password strength shown while typing

### Additional Security Measures (Recommended)

1. **Rate Limiting**: Add login attempt throttling
2. **Account Lockout**: Lock after N failed attempts
3. **Password History**: Prevent password reuse
4. **Password Expiration**: Expire passwords periodically
5. **Two-Factor Authentication**: Add TOTP/SMS 2FA
6. **Session Management**: Implement token-based sessions
7. **HTTPS Only**: Use TLS in production
8. **CORS**: Restrict cross-origin requests

## Demo Credentials

Initial demo users are seeded during database initialization:

| Username | Full Name | Role | Initial Password | First Login |
|----------|-----------|------|------------------|-------------|
| admin | Administrator | Admin | password | Yes |
| john_lead | John Mitchell | Lead | password | Yes |
| sarah_emp | Sarah Johnson | User | password | Yes |

All demo users must change their password on first login.

## Database Initialization

### First Time Setup

When the application starts:

1. Database file is created at: `%APPDATA%/TaskTango/tasktango.db` (Windows)
2. Schema is created from `schema.sql`
3. Migrations are run to ensure latest schema
4. Demo users are seeded if roles table is empty
5. All demo users have `isFirstLogin = 1`

### Migration System

Located in `src/db/migrations.js`. Automatically:

1. Adds `is_first_login` column if missing
2. Sets all existing users' `isFirstLogin = 1` (requires password change)
3. Can be extended with additional migrations

## Frontend Components

### LoginPage

- Simple login form with username and password
- Shows error messages from backend
- Shows demo credentials for convenience
- Handles first-time login by showing ChangePasswordModal
- Blocks dashboard access until password is changed

### ChangePasswordModal

- Beautiful modal interface with gradient background
- Shows different text for first login vs. regular password change
- Real-time password strength indicator
- Password validation errors shown as user types
- Toggle password visibility
- Match confirmation indicator
- Disabled submit button until all requirements met
- Responsive design for mobile

## Testing

### Test Cases

1. **First Login Flow**
   - Login as "admin" with password "password"
   - Modal should appear
   - Enter weak password → validation errors shown
   - Enter valid password → strength indicator updates
   - Confirm password must match
   - On submit, password changed and user logged in

2. **Regular Login**
   - After first login, login again with new password
   - Should proceed directly to dashboard
   - No modal appears

3. **Password Validation**
   - Test minimum length requirement
   - Test uppercase/lowercase requirements
   - Test number requirement
   - Test special character requirement
   - Test password strength scoring

4. **Admin User Creation**
   - Create new user via EmployeeManager
   - User should have isFirstLogin = 1
   - User should be able to login with password "password"
   - User should see password change modal on first login

## File Structure

```
src/
├── db/
│   ├── init.js                    # Database initialization
│   ├── schema.sql                 # Database schema
│   └── migrations.js              # Migration system
├── main/
│   ├── handlers/
│   │   └── authHandlers.js       # Authentication logic
│   ├── main.js                    # Main process entry
│   └── preload.js                 # IPC bridge
├── pages/
│   └── LoginPage.jsx              # Login page
├── components/
│   └── modals/
│       └── ChangePasswordModal.jsx # Password change modal
└── styles/
    ├── changePasswordModal.css     # Modal styles
    └── login.css                   # Login page styles
```

## Troubleshooting

### Issue: "Invalid credentials" on first login

**Solution**: Ensure demo users were seeded. Check database contains users table with admin/john_lead/sarah_emp.

### Issue: Modal not appearing after login

**Solution**: Check that isFirstLogin flag is set to 1 in database. Verify ChangePasswordModal is imported in LoginPage.

### Issue: "Passwords do not match" error

**Solution**: Ensure both password fields contain exactly the same characters. Check for hidden spaces.

### Issue: Password strength indicator shows "Weak"

**Solution**: Add more character variety - uppercase, lowercase, numbers, and special characters.

### Issue: Database file not found

**Solution**: Application will create at %APPDATA%/TaskTango/tasktango.db. Ensure write permissions to AppData folder.

## Future Enhancements

1. **Password Reset Email**: Add email-based password reset
2. **Security Questions**: Add secondary authentication
3. **Login History**: Track all login attempts
4. **IP Whitelisting**: Restrict login to specific IPs
5. **Device Management**: Track and manage trusted devices
6. **Session Timeout**: Automatically logout after inactivity
7. **Multi-Factor Authentication**: TOTP/SMS/Email codes
8. **Biometric Login**: Windows Hello/Fingerprint support

## References

- [bcryptjs Documentation](https://github.com/dcodeIO/bcrypt.js)
- [OWASP Password Guidelines](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [SQLite Documentation](https://www.sqlite.org/docs.html)
- [Electron IPC Documentation](https://www.electronjs.org/docs/latest/api/ipc-main)

## Support

For issues or questions regarding authentication:

1. Check console logs for detailed error messages
2. Verify database is initialized: Check for tasktango.db file
3. Review audit_logs table for authentication events
4. Check IPC handler registration in main.js startup logs
