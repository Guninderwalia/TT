/**
 * Migration: JSON Store → SQLite
 *
 * Runs once on first SQLite startup. Reads everything from store.json
 * (departments, employees, attendance, leaves, holidays, etc.) and
 * inserts it into the corresponding SQLite tables.
 *
 * Safe to re-run: uses INSERT OR IGNORE and tracks completion in a flag.
 */

const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

const MIGRATION_FLAG = 'json_store_migrated';

async function migrateFromStore(db, storeDataPath) {
  // Check if migration already ran
  try {
    await db.exec(`CREATE TABLE IF NOT EXISTS migration_flags (
      key TEXT PRIMARY KEY,
      value TEXT,
      completed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    const flag = await db.get('SELECT * FROM migration_flags WHERE key = ?', [MIGRATION_FLAG]);
    if (flag) {
      console.log('[MIGRATION] Already migrated from JSON store, skipping');
      return { migrated: false, reason: 'already_done' };
    }
  } catch (e) {
    console.warn('[MIGRATION] Could not check migration flag:', e.message);
  }

  // Load JSON store data
  if (!fs.existsSync(storeDataPath)) {
    console.log('[MIGRATION] No store.json found at', storeDataPath, '- nothing to migrate');
    return { migrated: false, reason: 'no_store' };
  }

  let storeData;
  try {
    storeData = JSON.parse(fs.readFileSync(storeDataPath, 'utf-8'));
  } catch (e) {
    console.error('[MIGRATION] Failed to parse store.json:', e.message);
    return { migrated: false, reason: 'parse_error' };
  }

  console.log('[MIGRATION] Starting JSON → SQLite migration...');

  const stats = {
    departments: 0,
    employees: 0,
    attendance: 0,
    leaves: 0,
    holidays: 0,
    timeLogs: 0,
    errors: []
  };

  // 1. Get role IDs (already seeded in DB)
  const roles = {};
  const roleRows = await db.all('SELECT id, name FROM roles');
  roleRows.forEach(r => { roles[r.name] = r.id; });

  // Preserve the original role name (Administrator, MD, Manager, Lead, User).
  // All of these now exist as separate rows in the roles table, so each user
  // keeps the exact role they had in the JSON store.
  const getRoleId = (roleName) => {
    if (!roleName) return roles['User'];
    // Try exact match first
    if (roles[roleName]) return roles[roleName];
    // Then capitalized match
    const cap = roleName.charAt(0).toUpperCase() + roleName.slice(1).toLowerCase();
    if (roles[cap]) return roles[cap];
    // Fallback: synonyms
    if (roleName.toLowerCase() === 'admin') return roles['Administrator'] || roles['Admin'];
    return roles['User'];
  };

  // ============================================================
  // 2. Migrate departments
  // ============================================================
  for (const dept of (storeData.departments || [])) {
    try {
      // Skip if department with this ID already exists
      const existing = await db.get('SELECT id FROM departments WHERE id = ? OR name = ?', [dept.id, dept.name]);
      if (existing) continue;

      await db.run(
        'INSERT INTO departments (id, name, description) VALUES (?, ?, ?)',
        [dept.id, dept.name, dept.description || '']
      );
      stats.departments++;
    } catch (e) {
      stats.errors.push(`Department "${dept.name}": ${e.message}`);
    }
  }

  // ============================================================
  // 3. Migrate employees
  // ============================================================
  const defaultPasswordHash = await bcrypt.hash('password', 10);

  for (const emp of (storeData.employees || [])) {
    try {
      // Skip if already exists
      const existing = await db.get('SELECT id FROM users WHERE id = ? OR email = ?', [emp.id, emp.email]);
      if (existing) continue;

      // Determine password hash
      const passwordChanges = storeData.passwordChanges || {};
      const customPassword = passwordChanges[emp.id];
      const passwordHash = customPassword
        ? await bcrypt.hash(customPassword, 10)
        : defaultPasswordHash;

      // Insert user
      await db.run(
        `INSERT INTO users (id, username, password_hash, email, full_name, role_id, department_id,
                            is_department_lead, is_first_login, phone, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          emp.id,
          emp.username || emp.email || `user_${emp.id}`,
          passwordHash,
          emp.email || null,
          emp.fullName || emp.full_name || 'Unknown',
          getRoleId(emp.role),
          emp.departmentId || null,
          emp.isLead ? 1 : 0,
          customPassword ? 0 : 1, // first login if no custom password set
          emp.phone || null,
          emp.status || 'active'
        ]
      );

      // Insert employment record
      const startDate = emp.joiningDate || emp.startDate || emp.createdAt || new Date().toISOString().split('T')[0];
      const startDateOnly = typeof startDate === 'string' ? startDate.split('T')[0] : startDate;

      await db.run(
        `INSERT OR IGNORE INTO employment_records (id, user_id, start_date, employment_type,
                                                    base_salary, is_probation, probation_end_date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          emp.id,
          startDateOnly,
          emp.employmentType || (emp.probationCompleted ? 'Permanent' : 'Probation'),
          emp.baseSalary || 0,
          emp.probationCompleted ? 0 : 1,
          emp.probationEndDate || null
        ]
      );

      // Insert banking details if available
      if (emp.bankAccountNumber || emp.bankName) {
        await db.run(
          `INSERT OR IGNORE INTO banking_details (id, user_id, bank_name, account_number,
                                                   account_holder, ifsc_code)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            uuidv4(),
            emp.id,
            emp.bankName || null,
            emp.bankAccountNumber || null,
            emp.accountName || emp.fullName || null,
            emp.ifscCode || null
          ]
        );
      }

      stats.employees++;
    } catch (e) {
      stats.errors.push(`Employee "${emp.fullName || emp.email}": ${e.message}`);
    }
  }

  // ============================================================
  // 4. Update department leads (after all users are inserted)
  // ============================================================
  for (const dept of (storeData.departments || [])) {
    if (dept.lead) {
      try {
        await db.run('UPDATE departments SET lead_id = ? WHERE id = ?', [dept.lead, dept.id]);
      } catch (e) {
        stats.errors.push(`Department lead "${dept.name}": ${e.message}`);
      }
    }
  }

  // ============================================================
  // 5. Migrate attendance records
  // ============================================================
  for (const att of (storeData.attendance || [])) {
    try {
      // Skip if userId is missing (orphaned record)
      if (!att.userId) continue;

      const id = att.id || uuidv4();
      const date = att.date || new Date().toISOString().split('T')[0];
      const status = att.status
        ? att.status.charAt(0).toUpperCase() + att.status.slice(1).toLowerCase()
        : 'Present';

      await db.run(
        `INSERT OR IGNORE INTO attendance (id, user_id, date, sign_in_time, sign_out_time,
                                            status, notes, is_half_day)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          att.userId,
          date,
          att.signInTime || null,
          att.signOutTime || null,
          status,
          att.notes || '',
          att.isHalfDay || att.status === 'half-day' ? 1 : 0
        ]
      );
      stats.attendance++;
    } catch (e) {
      // Silent - usually duplicates
    }
  }

  // ============================================================
  // 6. Migrate holidays
  // ============================================================
  for (const holiday of (storeData.holidays || [])) {
    try {
      await db.run(
        'INSERT OR IGNORE INTO public_holidays (id, holiday_name, date, description) VALUES (?, ?, ?, ?)',
        [holiday.id || uuidv4(), holiday.name, holiday.date, holiday.description || '']
      );
      stats.holidays++;
    } catch (e) {
      // Silent - usually duplicates
    }
  }

  // ============================================================
  // 7. Migrate time logs
  // ============================================================
  for (const log of (storeData.timeLogs || [])) {
    try {
      if (!log.userId) continue;
      await db.run(
        `INSERT OR IGNORE INTO time_logs (id, user_id, date, start_time, break_start_time,
                                           break_end_time, end_time)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          log.id || uuidv4(),
          log.userId,
          log.date,
          log.startTime || null,
          log.breakStartTime || null,
          log.breakEndTime || null,
          log.endTime || null
        ]
      );
      stats.timeLogs++;
    } catch (e) {
      // Silent
    }
  }

  // ============================================================
  // 8. Initialize leave balances for every migrated user
  // ============================================================
  const currentYear = new Date().getFullYear();
  const leaveTypes = await db.all('SELECT * FROM leave_types');
  const allUsers = await db.all('SELECT id FROM users WHERE status = ?', ['active']);
  let balancesCreated = 0;

  for (const user of allUsers) {
    for (const leaveType of leaveTypes) {
      try {
        const existing = await db.get(
          'SELECT id FROM leave_balances WHERE user_id = ? AND leave_type_id = ? AND year = ?',
          [user.id, leaveType.id, currentYear]
        );
        if (existing) continue;

        await db.run(
          `INSERT INTO leave_balances (id, user_id, leave_type_id, year, total_allocated, remaining)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [uuidv4(), user.id, leaveType.id, currentYear, leaveType.annual_entitlement, leaveType.annual_entitlement]
        );
        balancesCreated++;
      } catch (e) {
        // Silent - usually unique constraint conflicts
      }
    }
  }
  stats.leaveBalances = balancesCreated;

  // ============================================================
  // Mark migration as complete
  // ============================================================
  await db.run('INSERT INTO migration_flags (key, value) VALUES (?, ?)',
    [MIGRATION_FLAG, JSON.stringify(stats)]);

  console.log('[MIGRATION] ✓ Migration complete:');
  console.log(`  - Departments:     ${stats.departments}`);
  console.log(`  - Employees:       ${stats.employees}`);
  console.log(`  - Attendance:      ${stats.attendance}`);
  console.log(`  - Holidays:        ${stats.holidays}`);
  console.log(`  - Time logs:       ${stats.timeLogs}`);
  console.log(`  - Leave balances:  ${stats.leaveBalances || 0}`);
  if (stats.errors.length > 0) {
    console.log(`  - Errors:      ${stats.errors.length}`);
    stats.errors.slice(0, 5).forEach(e => console.log(`      • ${e}`));
  }

  return { migrated: true, stats };
}

module.exports = { migrateFromStore };
