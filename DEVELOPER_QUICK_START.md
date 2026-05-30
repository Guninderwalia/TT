# Developer Quick Start Guide

Get up to speed with the authentication system in 10 minutes.

## TL;DR

1. Database-backed authentication with bcrypt hashing
2. First-login forces password change
3. Demo mode as fallback
4. Fully documented and tested

## Quick Start (5 min)

### Run the Application

```bash
npm run electron-dev
```

### Test Authentication

```
Username: admin
Password: password
→ Password modal appears
→ Set new password: "TestPass123!"
→ Click "Set Password & Continue"
→ Logged into dashboard
```

### Test Login Again

```
Username: admin
Password: TestPass123!
→ Directly to dashboard (no modal)
```

## File Quick Reference

| File | Purpose | When to Edit |
|------|---------|--------------|
| `src/main/handlers/authHandlers.js` | Auth logic | Add new handlers, change rules |
| `src/pages/LoginPage.jsx` | Login UI | Modify login form |
| `src/components/modals/ChangePasswordModal.jsx` | Password modal | Modify password modal |
| `src/db/schema.sql` | Database schema | Add new tables/columns |
| `src/db/init.js` | Database init | Change demo data |
| `src/main/preload.js` | IPC bridge | Expose new methods |
| `src/main/main.js` | Main process | Add event handlers |

## Key Concepts

### Password Rules
```javascript
// src/main/handlers/authHandlers.js, line ~15
const PASSWORD_RULES = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true
};
```

### IPC Methods
```javascript
// Frontend code
await window.electron.login(username, password)
// Returns: { success, user, isFirstLogin }

await window.electron.changePasswordFirstLogin(newPassword, confirmPassword)
// Returns: { success, message }

await window.electron.validatePassword(password)
// Returns: { isValid, errors[], strength }
```

### Database
```
Location: %APPDATA%\TaskTango\tasktango.db (Windows)
Database: SQLite 3
Schema: src/db/schema.sql
Init: src/db/init.js
```

## Common Tasks

### Add a New Password Rule

```javascript
// Edit PASSWORD_RULES in src/main/handlers/authHandlers.js
const PASSWORD_RULES = {
  minLength: 10,  // Changed from 8
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
  // Add new rules here
  requireConsecutiveChars: false
};

// Update validatePassword() function to check new rule
```

### Add a New Auth Handler

```javascript
// 1. Add to src/main/handlers/authHandlers.js
ipcMain.handle('auth:myNewHandler', async (event, data) => {
  try {
    // Your logic here
    return { success: true, data: result };
  } catch (error) {
    console.error('Error:', error);
    return { success: false, message: error.message };
  }
});

// 2. Expose in src/main/preload.js
myNewHandler: (data) => ipcRenderer.invoke('auth:myNewHandler', data),

// 3. Use in frontend
const result = await window.electron.myNewHandler(data);
```

### Customize Demo Users

```javascript
// Edit src/db/init.js, seedInitialData() function
// Change username, email, or full_name as needed

await db.run(
  `INSERT INTO users (id, username, password_hash, email, full_name, ...)
   VALUES (?, ?, ?, ?, ?, ...)`,
  [userId, 'newusername', passwordHash, 'newemail@example.com', 'New User', ...]
);
```

### Add New User Column

```sql
-- 1. Edit src/db/schema.sql, add to CREATE TABLE users
CREATE TABLE IF NOT EXISTS users (
  -- ... existing columns ...
  new_column TEXT,  -- Add this
  -- ... more columns ...
);

-- 2. Create migration in src/db/migrations.js
async function addNewColumnIfNeeded(db) {
  try {
    const tableInfo = await db.all("PRAGMA table_info(users)");
    const hasColumn = tableInfo.some(col => col.name === 'new_column');
    if (!hasColumn) {
      await db.run('ALTER TABLE users ADD COLUMN new_column TEXT');
    }
  } catch (error) {
    console.log('[MIGRATIONS] Note:', error.message);
  }
}

-- 3. Call in runMigrations()
await addNewColumnIfNeeded(db);
```

## Testing

### Run Tests

```bash
# Unit tests (if set up)
npm test

# Manual testing
npm run electron-dev
# Then test login flow manually
```

### Key Test Cases

```javascript
// Test password validation
const result = await window.electron.validatePassword('weak');
// Should return errors

const result = await window.electron.validatePassword('Strong123!');
// Should return valid with strength

// Test login
const result = await window.electron.login('admin', 'password');
// Should return { success: true, isFirstLogin: true }

// Test password change
const result = await window.electron.changePasswordFirstLogin('NewPass123!', 'NewPass123!');
// Should return { success: true }
```

## Debugging

### Enable Debug Logging

```javascript
// Add to any component
console.log('[AUTH]', 'Your message here');

// Check main process logs
// They appear in the console when running npm run electron-dev
```

### Common Issues

| Issue | Solution |
|-------|----------|
| Login not working | Check database exists, check console for errors |
| Modal not appearing | Verify isFirstLogin flag is being returned |
| Password not validating | Check PASSWORD_RULES, check error messages |
| Database not found | Database auto-created on first run |
| Demo mode active | Check console, might mean database failed to init |

## Architecture Diagram

```
Frontend (React)
├── LoginPage.jsx
│   └── Calls: window.electron.login()
├── ChangePasswordModal.jsx
│   └── Calls: window.electron.changePasswordFirstLogin()
└── Dashboard
    └── User is logged in

Preload Bridge (src/main/preload.js)
└── Exposes IPC methods to frontend

Main Process (src/main/main.js)
├── Creates window
├── Initializes database
└── Registers IPC handlers

Auth Handlers (src/main/handlers/authHandlers.js)
├── auth:login
├── auth:changePassword
├── auth:changePasswordFirstLogin
├── auth:validatePassword
├── auth:logout
└── ... more handlers

Database (SQLite)
├── users table
├── roles table
├── audit_logs table
└── ... more tables
```

## Important Files to Know

```
src/
├── main/
│   ├── main.js ............................ Main process entry
│   ├── handlers/
│   │   └── authHandlers.js ............... All auth logic
│   └── preload.js ......................... IPC bridge
├── db/
│   ├── init.js ........................... Database initialization
│   ├── schema.sql ........................ Database schema
│   └── migrations.js .................... Schema migrations
├── pages/
│   └── LoginPage.jsx ..................... Login page
├── components/
│   └── modals/
│       └── ChangePasswordModal.jsx ...... Password change modal
└── styles/
    ├── login.css ......................... Login styling
    └── changePasswordModal.css .......... Modal styling
```

## Useful Commands

```bash
# Start development
npm run electron-dev

# Build for production
npm run electron-build

# Build Windows installer
npm run build-exe

# Clear cache/build
rm -rf build/ dist/ node_modules/
npm install

# Run specific test
npm test -- --testNamePattern="password"
```

## Important Constants

```javascript
// Password requirement: 8+ characters
PASSWORD_RULES.minLength = 8

// Bcrypt salt rounds (higher = slower but more secure)
bcrypt.hash(password, 10)

// Demo initial password
'password'

// First login flag column
users.is_first_login

// Audit action types
'LOGIN', 'LOGOUT', 'PASSWORD_CHANGE', 'INITIAL_PASSWORD_SET'
```

## Database Quick Access

```sql
-- View users
SELECT * FROM users;

-- View audit logs
SELECT * FROM audit_logs ORDER BY timestamp DESC;

-- Reset user to first login
UPDATE users SET is_first_login = 1 WHERE username = 'admin';

-- Check password hash
SELECT username, password_hash FROM users;
```

## Best Practices

1. **Always hash passwords**
   ```javascript
   const hash = await bcrypt.hash(password, 10);
   ```

2. **Never log passwords**
   ```javascript
   // BAD:
   console.log('Password:', password);
   
   // GOOD:
   console.log('Password validated for user:', username);
   ```

3. **Use parameterized queries**
   ```javascript
   // BAD:
   db.run(`SELECT * FROM users WHERE username = '${username}'`);
   
   // GOOD:
   db.run('SELECT * FROM users WHERE username = ?', [username]);
   ```

4. **Always validate input**
   ```javascript
   const validation = validatePassword(password);
   if (!validation.isValid) {
     return { success: false, errors: validation.errors };
   }
   ```

5. **Log important events**
   ```javascript
   await db.run(
     'INSERT INTO audit_logs (id, user_id, action, ...) VALUES (...)',
     [uuidv4(), userId, 'ACTION_NAME', ...]
   );
   ```

## Next Steps

1. ✅ Understand the flow (you're doing this now)
2. Run the app and test authentication
3. Read AUTHENTICATION_SYSTEM.md for detailed info
4. Run through IMPLEMENTATION_CHECKLIST.md for testing
5. Implement any custom features needed
6. Deploy to production

## Getting Help

- **Technical Details**: AUTHENTICATION_SYSTEM.md
- **Admin Procedures**: ADMIN_USER_MANAGEMENT.md
- **Quick Reference**: QUICK_AUTH_REFERENCE.md
- **Testing**: IMPLEMENTATION_CHECKLIST.md
- **Code Comments**: Read the source code comments

## Key Takeaways

1. **Authentication is database-backed** with bcrypt hashing
2. **First login enforces password change** with a modal
3. **Demo mode provides fallback** if database fails
4. **Audit logging tracks all events** for compliance
5. **Everything is documented** for future developers

---

**Ready to code?** Start with:
```bash
npm run electron-dev
```

Then login with credentials on the login page!
