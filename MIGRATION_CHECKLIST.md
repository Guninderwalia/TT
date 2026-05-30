# Migration Checklist: From Hardcoded to Database Authentication

This checklist guides the transition from the old hardcoded demo credentials system to the new database-backed authentication system.

## Migration Status: ✅ COMPLETE (No Migration Needed)

**Important Note**: Since this is a greenfield implementation (the old system was just hardcoded demo users), there is NO data migration needed. The new system can run standalone with complete backward compatibility.

## Pre-Migration Checklist (Before Starting)

- [ ] Read AUTHENTICATION_SYSTEM.md to understand new system
- [ ] Read ADMIN_USER_MANAGEMENT.md for admin procedures
- [ ] Backup any existing data
- [ ] Notify team about planned changes
- [ ] Plan testing window
- [ ] Have rollback plan ready

## System Verification (Before Migration)

- [ ] Current system is working
- [ ] All users can login with old credentials
- [ ] No critical tasks during migration window
- [ ] Database tools/access ready
- [ ] SQLite installed and working

## Migration Process

### Step 1: Backup Current Data (5 minutes)

```bash
# Backup current store.json (if using JSON store)
cp "C:\Users\%USERNAME%\AppData\Local\electron/Task Tango/store.json" store.json.backup

# Backup database if already exists
cp "%APPDATA%\TaskTango\tasktango.db" tasktango.db.backup
```

### Step 2: Deploy New Application (5 minutes)

```bash
# Option A: If running from source
git pull origin main  # or however you manage code
npm install
npm run electron-build

# Option B: If using compiled version
# Replace application files with new version
```

### Step 3: First Run (Database Initialization)

When the new application starts for the first time:

1. Application detects no database exists
2. Creates database at `%APPDATA%\TaskTango\tasktango.db`
3. Loads schema from `src/db/schema.sql`
4. Runs migrations from `src/db/migrations.js`
5. Seeds initial demo users
6. Prints logs: `[DB] ✓ Database initialized successfully`

**Time**: ~5 seconds  
**What Happens**: Automatic, no user action required

### Step 4: Verify New System

```bash
npm run electron-dev
```

Test login with demo credentials:

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Enter username: `admin` | Input accepted |
| 2 | Enter password: `password` | Input accepted |
| 3 | Click "Sign In" | ChangePasswordModal appears |
| 4 | Try weak password | Validation errors shown |
| 5 | Enter strong password: `NewAdminPass123!` | Password strength shows "Strong" or "Very Strong" |
| 6 | Confirm password (same) | Match indicator shows green |
| 7 | Click "Set Password & Continue" | Modal closes, logged into dashboard |
| 8 | Click Logout | Returns to login page |
| 9 | Login with new password | Goes directly to dashboard (no modal) |

✅ If all steps work, migration successful!

### Step 5: Verify Database Files

Check that new files were created:

```bash
# Windows
dir "%APPDATA%\TaskTango"

# Should show:
# tasktango.db (created automatically)
```

Check database schema:

```sql
-- View tables
SELECT name FROM sqlite_master WHERE type='table';

-- Should show:
-- users, roles, departments, audit_logs, etc.

-- Check demo users
SELECT * FROM users;

-- Should show admin, john_lead, sarah_emp with is_first_login = 1
```

## Admin Training & Onboarding

### For Administrators (30 minutes)

1. **Read Documentation**
   - [ ] ADMIN_USER_MANAGEMENT.md (20 min)
   - [ ] QUICK_AUTH_REFERENCE.md (5 min)

2. **Understand User Management**
   - [ ] How to create new users
   - [ ] How to reset user passwords
   - [ ] How to deactivate accounts
   - [ ] How to view audit logs

3. **Practice Procedures**
   - [ ] Create a test user account
   - [ ] Reset the test user's password
   - [ ] Verify password change modal appears
   - [ ] Review audit log entries
   - [ ] Deactivate and reactivate test user

4. **Bookmark Resources**
   - [ ] QUICK_AUTH_REFERENCE.md
   - [ ] ADMIN_USER_MANAGEMENT.md → Troubleshooting

### For Help Desk/Support (20 minutes)

1. **Read Documentation**
   - [ ] ADMIN_USER_MANAGEMENT.md → Troubleshooting

2. **Common Issues to Handle**
   - [ ] User forgot password → Admin reset
   - [ ] User stuck on password modal → Check password requirements
   - [ ] User cannot login → Check account status
   - [ ] User locked out → Contact admin for reset

3. **Create Support Documentation**
   - [ ] Prepare password requirement poster
   - [ ] Write onboarding email for new users
   - [ ] Create FAQ for common questions

## Rollback Plan (If Needed)

If critical issues occur and you need to revert:

### Rollback to Previous Version

```bash
# Revert code
git checkout <previous-version>

# OR replace application files with previous version

# Restart application
```

### Restore from Backup

```bash
# If you backed up data
cp store.json.backup "C:\Users\%USERNAME%\AppData\Local\electron/Task Tango/store.json"
cp tasktango.db.backup "%APPDATA%\TaskTango\tasktango.db"
```

**Note**: The new system doesn't depend on the old JSON store, so there's minimal risk.

## Parallel Testing (Optional)

If you want to test without affecting production:

```bash
# 1. Start new application on different port
PORT=3002 npm run electron-dev

# 2. Test all features
# 3. Verify database works correctly
# 4. Check audit logs are created
# 5. Once confirmed, deploy to production
```

## Post-Migration Checklist

### Immediate (Within 1 hour)

- [ ] Database created successfully
- [ ] Demo users can login
- [ ] Password modal appears on first login
- [ ] Password change works
- [ ] Login works with new password
- [ ] Audit logs record events
- [ ] No errors in console

### First Day

- [ ] Test with all demo users
- [ ] Admin can create new user
- [ ] Admin can reset user password
- [ ] Audit logs viewable
- [ ] No issues reported

### First Week

- [ ] Monitor authentication logs
- [ ] Verify no failed login attempts
- [ ] Check database file size (should be small)
- [ ] Gather user feedback
- [ ] Document any issues

### First Month

- [ ] Review audit logs for patterns
- [ ] Verify all users changed initial password
- [ ] Check for any security issues
- [ ] Plan Phase 2 enhancements

## Monitoring

### During Migration

```bash
# Watch application logs in real-time
# When running: npm run electron-dev
# Watch for [DB] and [AUTH] messages

# Expected logs:
[DB] Database initialization started
[MIGRATIONS] Starting database migrations
[MIGRATIONS] ✓ All migrations completed
[DB] ✓ Database initialized successfully
[AUTH] ✓ Database authentication initialized
```

### After Migration

- Check for [AUTH] errors in logs
- Monitor failed login attempts in audit logs
- Verify password changes are logged
- Check database file size growth
- Monitor application performance

## Troubleshooting

### Database Not Created

**Symptoms**: `[DB] Failed to initialize database`

**Cause**: AppData directory not writable or SQLite issue

**Solution**:
1. Check `%APPDATA%` folder exists and is writable
2. Restart application
3. Check for SQLite driver errors
4. See ADMIN_USER_MANAGEMENT.md → Database Issues

### Demo Mode Active Instead of Database

**Symptoms**: Application uses demo auth instead of database

**Cause**: Database failed to initialize

**Solution**:
1. Check console for `[DB]` error messages
2. Verify `%APPDATA%\TaskTango` directory exists
3. Check SQLite driver installed
4. Check disk space available
5. See ADMIN_USER_MANAGEMENT.md → Troubleshooting

### Login Fails After Migration

**Symptoms**: Cannot login with username/password

**Cause**: Database not properly initialized

**Solution**:
1. Check console for [DB] and [AUTH] messages
2. Verify demo users created: `SELECT * FROM users`
3. Check if tables exist: `SELECT * FROM sqlite_master`
4. Restore from backup and try again
5. See ADMIN_USER_MANAGEMENT.md → Invalid Credentials

### Password Modal Not Appearing

**Symptoms**: Login works but modal doesn't appear

**Cause**: is_first_login flag not set correctly

**Solution**:
1. Check database: `SELECT * FROM users WHERE is_first_login = 1`
2. Reset user: `UPDATE users SET is_first_login = 1 WHERE username = 'admin'`
3. Clear app cache and restart
4. See ADMIN_USER_MANAGEMENT.md

## Success Criteria

Migration is considered successful when:

- ✅ Application starts without errors
- ✅ Database file created at correct location
- ✅ Demo users present in database
- ✅ Login with "admin" / "password" works
- ✅ Password change modal appears
- ✅ Password strength validation works
- ✅ Audit logs record events
- ✅ All users can change password on first login
- ✅ Subsequent logins work without modal
- ✅ No security warnings or errors
- ✅ Performance acceptable

## Data Validation

### Verify Users Created

```sql
SELECT username, full_name, status, is_first_login FROM users;

-- Expected output:
-- admin, Administrator, active, 1
-- john_lead, John Mitchell, active, 1
-- sarah_emp, Sarah Johnson, active, 1
```

### Verify Roles Created

```sql
SELECT * FROM roles;

-- Expected: Admin, Lead, User roles
```

### Verify Departments Created

```sql
SELECT name FROM departments;

-- Expected: Evergrow, NCFS, Marketing, Accounting
```

### Verify Audit Log Working

```sql
SELECT COUNT(*) as event_count FROM audit_logs;

-- Should have some entries from seeding
```

## Documentation for Team

### Create Handoff Document

Include:
1. New system overview
2. How to login (demo credentials)
3. Password requirements
4. Admin procedures
5. Support contact info
6. Escalation process

### Share Documentation

- [ ] AUTHENTICATION_README.md → Everyone
- [ ] ADMIN_USER_MANAGEMENT.md → Admins
- [ ] QUICK_AUTH_REFERENCE.md → Everyone
- [ ] DEVELOPER_QUICK_START.md → Developers

## Phase 2 Readiness

Once migration complete and stable (1 week), consider:

- [ ] Add rate limiting
- [ ] Add account lockout
- [ ] Add password expiration
- [ ] Add 2FA support
- [ ] Add SSO integration

See AUTH_IMPLEMENTATION_SUMMARY.md → Future Enhancements

## Final Checklist

- [ ] Code deployed to production
- [ ] Database initialized successfully
- [ ] Demo users verified
- [ ] Login works correctly
- [ ] Password change works correctly
- [ ] Audit logs created
- [ ] Admin trained on procedures
- [ ] Help desk trained on troubleshooting
- [ ] Users notified of new password requirements
- [ ] Documentation shared with team
- [ ] No critical issues reported
- [ ] Rollback plan confirmed working
- [ ] Database backups established
- [ ] Monitoring setup complete

## Sign-Off

- [ ] Migration completed successfully
- [ ] All tests passed
- [ ] Admin approval obtained
- [ ] Users notified
- [ ] Support team ready
- [ ] Monitoring active

---

**Migration Date**: May 17, 2026  
**Status**: Ready for execution  
**Estimated Duration**: 30-60 minutes total  
**Risk Level**: Low (new system, no data migration needed)  
**Approval**: ✅ Ready
