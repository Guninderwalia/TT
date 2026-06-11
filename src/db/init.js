const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(process.env.APPDATA || process.env.HOME, 'TaskTango', 'tasktango.db');

// Where SimpleStore wrote its JSON. We use this to migrate existing data on first SQLite startup.
// SimpleStore uses Electron's app.getPath('userData') which resolves to %APPDATA%/<app name>,
// where <app name> is the lowercase product name from package.json ("tasktango-crm").
// Fallback to a few known historical locations so older installs still get migrated.
function findStorePath() {
  const base = process.env.APPDATA || process.env.HOME;
  const candidates = [
    path.join(base, 'tasktango-crm', 'data', 'store.json'),
    path.join(base, 'TaskTango', 'data', 'store.json'),
    path.join(base, 'tasktango', 'data', 'store.json')
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0]; // return primary path even if missing (caller checks existence)
}
const STORE_PATH = findStorePath();

async function initializeDatabase() {
  // Ensure directory exists
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });

  try {
    await db.exec('PRAGMA foreign_keys = ON');

    // Read and execute schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await db.exec(schema);

    // Run migrations
    const { runMigrations } = require('./migrations');
    await runMigrations(db);

    // Seed initial data if empty. If a JSON store exists, we'll migrate from
    // it shortly, so we only seed the lookup tables (roles, leave types) and
    // skip creating demo users (to avoid conflicts with the migrated users).
    const adminRole = await db.get('SELECT * FROM roles WHERE name = ?', ['Admin']);
    const isFreshDatabase = !adminRole;
    const hasJsonStore = fs.existsSync(STORE_PATH);

    if (isFreshDatabase) {
      if (hasJsonStore) {
        console.log('[DB] Fresh database + JSON store found — seeding lookup tables only');
        await seedLookupTablesOnly(db);
      } else {
        console.log('[DB] Fresh database, no JSON store — seeding full demo data');
        await seedInitialData(db);
      }
    }

    // Migrate existing JSON store data into SQLite (one-time, idempotent).
    if (hasJsonStore) {
      try {
        const { migrateFromStore } = require('./migrateFromStore');
        await migrateFromStore(db, STORE_PATH);
      } catch (e) {
        console.error('[DB] JSON store migration failed:', e.message);
      }
    }

    // Always remove deprecated Sick Leave / Casual Leave types (runs on every
    // boot so existing databases are cleaned up as well as fresh ones).
    try {
      const legacyTypes = await db.all(
        "SELECT id, name FROM leave_types WHERE name IN ('Sick Leave', 'Casual Leave')"
      );
      for (const row of legacyTypes) {
        await db.run('DELETE FROM leave_balances WHERE leave_type_id = ?', [row.id]);
        await db.run('DELETE FROM leave_requests WHERE leave_type_id = ?', [row.id]);
        await db.run('DELETE FROM leave_types WHERE id = ?', [row.id]);
        console.log(`[DB] ✓ Removed deprecated leave type: ${row.name}`);
      }
    } catch (e) {
      console.warn('[DB] Could not clean up legacy leave types:', e.message);
    }

    // Pulse v2 — ensure the "Saturday Off" leave type exists and points its
    // deduction at Annual Leave. Runs on EVERY boot (not just fresh DBs)
    // because the seed functions above only run on a brand-new database, but
    // existing production DBs still need this type added. Idempotent.
    try {
      const annual = await db.get("SELECT id FROM leave_types WHERE name = 'Annual Leave'");
      if (annual) {
        const satOff = await db.get("SELECT id, deducts_from_type_id FROM leave_types WHERE name = 'Saturday Off'");
        if (!satOff) {
          await db.run(
            'INSERT INTO leave_types (id, name, annual_entitlement, description, deducts_from_type_id) VALUES (?, ?, ?, ?, ?)',
            [uuidv4(), 'Saturday Off', 0, 'Take a working Saturday off. Deducts from your Annual Leave balance.', annual.id]
          );
          console.log('[DB] ✓ Seeded "Saturday Off" leave type (deducts from Annual Leave)');
        } else if (!satOff.deducts_from_type_id) {
          // Repair an existing row that predates the deducts-from link.
          await db.run('UPDATE leave_types SET deducts_from_type_id = ? WHERE id = ?', [annual.id, satOff.id]);
          console.log('[DB] ✓ Linked "Saturday Off" → Annual Leave deduction');
        }
      }
    } catch (e) {
      console.warn('[DB] Could not ensure Saturday Off leave type:', e.message);
    }

    // v5.1 — Fail-safe "break-glass" admin account.
    //
    // Guarantees there is ALWAYS one working login with full admin access,
    // even if every other admin gets locked out / deleted / password-changed.
    // Runs on EVERY boot and is idempotent:
    //   - creates the account if missing (recreated even if someone deletes it)
    //   - force-resets its password, role, and active status every boot, so
    //     the known credentials always work.
    //
    // Credentials come from env vars (Fly secrets) so the password is NOT in
    // the source code:  FAILSAFE_EMAIL  and  FAILSAFE_PASSWORD.
    // If they aren't set, we skip silently (no insecure default).
    try {
      const fsEmail = (process.env.FAILSAFE_EMAIL || '').trim().toLowerCase();
      const fsPassword = process.env.FAILSAFE_PASSWORD || '';
      if (fsEmail && fsPassword) {
        // Highest-privilege role. Prefer Admin (the app's proven full-access
        // role); fall back to MD / Administrator if Admin isn't present.
        const role = await db.get(
          `SELECT id FROM roles WHERE name IN ('Admin','Administrator','MD')
            ORDER BY CASE name WHEN 'Admin' THEN 0 WHEN 'Administrator' THEN 1 ELSE 2 END LIMIT 1`
        );
        const dept = await db.get('SELECT id FROM departments LIMIT 1');
        const hash = await bcrypt.hash(fsPassword, 10);
        if (role) {
          const existing = await db.get('SELECT id FROM users WHERE LOWER(email) = ?', [fsEmail]);
          if (existing) {
            // Force it back to a known-good state every boot.
            await db.run(
              `UPDATE users SET password_hash = ?, role_id = ?, is_department_lead = 1,
                                is_first_login = 0, status = 'active', updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
              [hash, role.id, existing.id]
            );
            console.log(`[DB] ✓ Fail-safe admin ensured (${fsEmail})`);
          } else {
            await db.run(
              `INSERT INTO users (id, username, password_hash, email, full_name, role_id,
                                  department_id, is_department_lead, is_first_login, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 'active')`,
              [uuidv4(), 'failsafe', hash, fsEmail, 'Fail-safe Admin', role.id, dept ? dept.id : null]
            );
            console.log(`[DB] ✓ Fail-safe admin created (${fsEmail})`);
          }
        }
      }
    } catch (e) {
      console.warn('[DB] Could not ensure fail-safe admin:', e.message);
    }

    return db;
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
}

async function seedInitialData(db) {
  const adminId = uuidv4();
  const leadId = uuidv4();
  const userId = uuidv4();
  const deptId = uuidv4();
  const roleAdminId = uuidv4();
  const roleLeadId = uuidv4();
  const roleUserId = uuidv4();
  // Additional role IDs so all 7 roles exist on a fresh database.
  // Without these, MD/Manager/Employee/Administrator would never be created
  // and the role dropdown would only show Admin/Lead/User.
  const roleAdministratorId = uuidv4();
  const roleMDId = uuidv4();
  const roleManagerId = uuidv4();
  const roleEmployeeId = uuidv4();

  try {
    // Insert ALL 7 roles with explicit IDs (the three "default user" roles need
    // their IDs preserved because the demo users below reference them as FKs).
    await db.run('INSERT INTO roles (id, name, description) VALUES (?, ?, ?)',
      [roleAdminId, 'Admin', 'System administrator with full access']);
    await db.run('INSERT INTO roles (id, name, description) VALUES (?, ?, ?)',
      [roleAdministratorId, 'Administrator', 'System administrator with full access (legacy)']);
    await db.run('INSERT INTO roles (id, name, description) VALUES (?, ?, ?)',
      [roleMDId, 'MD', 'Managing Director']);
    await db.run('INSERT INTO roles (id, name, description) VALUES (?, ?, ?)',
      [roleManagerId, 'Manager', 'Department manager']);
    await db.run('INSERT INTO roles (id, name, description) VALUES (?, ?, ?)',
      [roleLeadId, 'Lead', 'Department lead with managerial access']);
    await db.run('INSERT INTO roles (id, name, description) VALUES (?, ?, ?)',
      [roleUserId, 'User', 'Standard employee with personal access only']);
    await db.run('INSERT INTO roles (id, name, description) VALUES (?, ?, ?)',
      [roleEmployeeId, 'Employee', 'Standard employee with personal access only']);

    // Insert leave types
    await db.run(
      'INSERT INTO leave_types (id, name, annual_entitlement, description) VALUES (?, ?, ?, ?)',
      [uuidv4(), 'Annual Leave', 25, 'Standard annual paid leave']
    );

    // Predefined skills (used by skill assessment in performance reviews)
    await seedPredefinedSkills(db);

    // Insert sample departments
    await db.run(
      'INSERT INTO departments (id, name, description) VALUES (?, ?, ?)',
      [deptId, 'Evergrow', 'Growth & Strategy Department']
    );
    const ncfsId = uuidv4();
    await db.run(
      'INSERT INTO departments (id, name, description) VALUES (?, ?, ?)',
      [ncfsId, 'NCFS', 'Client Financial Services']
    );
    const marketingId = uuidv4();
    await db.run(
      'INSERT INTO departments (id, name, description) VALUES (?, ?, ?)',
      [marketingId, 'Marketing', 'Marketing & Communications']
    );
    const accountingId = uuidv4();
    await db.run(
      'INSERT INTO departments (id, name, description) VALUES (?, ?, ?)',
      [accountingId, 'Accounting', 'Finance & Accounting']
    );

    // Hash initial password for all users (set to "password")
    const initialPassword = await bcrypt.hash('password', 10);

    // Insert sample users with is_first_login = 1
    await db.run(
      `INSERT INTO users (id, username, password_hash, email, full_name, role_id, department_id, is_department_lead, is_first_login, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [adminId, 'admin', initialPassword, 'admin@tasktango.co.uk', 'Administrator', roleAdminId, deptId, 1, 1, 'active']
    );

    await db.run(
      `INSERT INTO users (id, username, password_hash, email, full_name, role_id, department_id, is_department_lead, is_first_login, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [leadId, 'john_lead', initialPassword, 'john@tasktango.co.uk', 'John Mitchell', roleLeadId, deptId, 1, 1, 'active']
    );

    await db.run(
      `INSERT INTO users (id, username, password_hash, email, full_name, role_id, department_id, is_department_lead, is_first_login, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, 'sarah_emp', initialPassword, 'sarah@tasktango.co.uk', 'Sarah Johnson', roleUserId, ncfsId, 0, 1, 'active']
    );

    // Update department leads
    await db.run('UPDATE departments SET lead_id = ? WHERE id = ?', [leadId, deptId]);

    // Insert employment records
    const startDate = new Date(2024, 0, 15).toISOString().split('T')[0];
    const probationEnd = new Date(2024, 3, 15).toISOString().split('T')[0];

    await db.run(
      `INSERT INTO employment_records (id, user_id, start_date, employment_type, base_salary, is_probation, probation_end_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), adminId, startDate, 'Permanent', 80000, 0, null]
    );

    await db.run(
      `INSERT INTO employment_records (id, user_id, start_date, employment_type, base_salary, is_probation, probation_end_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), leadId, startDate, 'Permanent', 60000, 0, null]
    );

    await db.run(
      `INSERT INTO employment_records (id, user_id, start_date, employment_type, base_salary, is_probation, probation_end_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), userId, startDate, 'Permanent', 45000, 1, probationEnd]
    );

    // Insert probation deposits for new employees
    await db.run(
      `INSERT INTO probation_deposits (id, user_id, deposit_amount, deduction_start_month, deduction_end_month, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uuidv4(), userId, 9000, 1, 2, 'held']
    );

    // Insert sample public holidays (2024)
    const holidays = [
      { name: 'New Year', date: '2024-01-01' },
      { name: 'Republic Day', date: '2024-01-26' },
      { name: 'Independence Day', date: '2024-08-15' },
      { name: 'Gandhi Jayanti', date: '2024-10-02' },
      { name: 'Christmas', date: '2024-12-25' }
    ];

    for (const holiday of holidays) {
      await db.run(
        'INSERT INTO public_holidays (id, holiday_name, date) VALUES (?, ?, ?)',
        [uuidv4(), holiday.name, holiday.date]
      );
    }

    console.log('✓ Database initialized with seed data');
  } catch (error) {
    console.error('Error seeding database:', error);
    throw error;
  }
}

/**
 * Seeds only roles and leave types - no demo users or departments.
 * Used when a JSON store will be migrated immediately after init.
 */
async function seedLookupTablesOnly(db) {
  try {
    // Roles - both new SQL-style and legacy JSON-store role names so that
    // migrated users keep their original role identity (e.g. MD stays MD,
    // not collapsed into Admin).
    const roles = [
      ['Admin',         'System administrator with full access'],
      ['Administrator', 'System administrator with full access (legacy)'],
      ['MD',            'Managing Director'],
      ['Manager',       'Department manager'],
      ['Lead',          'Department lead with managerial access'],
      ['User',          'Standard employee with personal access only'],
      ['Employee',      'Standard employee with personal access only']
    ];
    for (const [name, desc] of roles) {
      await db.run('INSERT OR IGNORE INTO roles (id, name, description) VALUES (?, ?, ?)',
        [uuidv4(), name, desc]);
    }

    // Leave types
    await db.run('INSERT OR IGNORE INTO leave_types (id, name, annual_entitlement, description) VALUES (?, ?, ?, ?)',
      [uuidv4(), 'Annual Leave', 25, 'Standard annual paid leave']);

    // Predefined skills (used by skill assessment in performance reviews)
    await seedPredefinedSkills(db);

    // Remove any legacy Sick/Casual leave types and their dependent balances
    // (kept here so re-running seeding cleans up older databases too).
    const legacyTypes = await db.all(
      "SELECT id FROM leave_types WHERE name IN ('Sick Leave', 'Casual Leave')"
    );
    for (const row of legacyTypes) {
      await db.run('DELETE FROM leave_balances WHERE leave_type_id = ?', [row.id]);
      await db.run('DELETE FROM leave_requests WHERE leave_type_id = ?', [row.id]);
      await db.run('DELETE FROM leave_types WHERE id = ?', [row.id]);
    }
    if (legacyTypes.length > 0) {
      console.log(`[DB] ✓ Removed ${legacyTypes.length} legacy leave type(s)`);
    }

    console.log('[DB] ✓ Lookup tables seeded (roles + leave types + skills)');
  } catch (error) {
    console.error('[DB] Error seeding lookup tables:', error);
    throw error;
  }
}

/**
 * Seed the predefined_skills table with the same 8 skills the legacy JSON
 * store used. Idempotent (INSERT OR IGNORE by name).
 */
async function seedPredefinedSkills(db) {
  const skills = [
    ['communication',         'Communication',         'soft'],
    ['problem-solving',       'Problem Solving',       'soft'],
    ['teamwork',              'Teamwork',              'soft'],
    ['leadership',            'Leadership',            'soft'],
    ['time-management',       'Time Management',       'soft'],
    ['attention-to-detail',   'Attention to Detail',   'soft'],
    ['adaptability',          'Adaptability',          'soft'],
    ['technical-expertise',   'Technical Expertise',   'technical']
  ];
  for (const [id, name, category] of skills) {
    await db.run(
      'INSERT OR IGNORE INTO predefined_skills (id, name, category) VALUES (?, ?, ?)',
      [id, name, category]
    );
  }
}

module.exports = { initializeDatabase, DB_PATH };
