const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const Papa = require('papaparse');

/**
 * Convert camelCase to snake_case
 */
function camelToSnake(str) {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

/**
 * Fields that belong to the users table and their mappings
 * Maps frontend field names to database column names
 */
const userTableFields = {
  fullName: 'full_name',
  email: 'email',
  phone: 'phone',
  username: 'username',
  departmentId: 'department_id',
  isLead: 'is_department_lead',
  status: 'status',
  profilePicturePath: 'profile_picture_path',
  dateOfBirth: 'date_of_birth'
};

/**
 * Fields that belong to employment_records table
 */
const employmentRecordFields = ['joiningDate', 'startTime', 'endTime', 'baseSalary', 'employmentType', 'probationCompleted', 'probationEndDate'];

/**
 * Fields routed to the salary_increments table. When the admin edits an
 * employee and supplies both lastIncrementDate + lastIncrementAmount, a new
 * row is upserted (one per employee+date pair).
 */
const salaryIncrementFields = ['lastIncrementDate', 'lastIncrementAmount'];

/**
 * Fields that belong to banking_details table
 */
const bankingDetailsFields = ['bankAccountNumber', 'bankName', 'accountName', 'ifscCode'];

/**
 * Fields to exclude from updates (read-only or handled separately)
 */
const excludedFields = ['id', 'currentUserId', 'role']; // 'role' is a display field, can't be updated

/**
 * Write a single audit log row. Safe to call without await — failures are
 * logged but never bubbled up to the caller, since auditing should never
 * break a user-facing operation.
 */
async function writeAudit(db, userId, { action, entityType, entityId, oldValue, newValue }) {
  try {
    await db.run(
      `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, old_value, new_value, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        uuidv4(),
        userId || 'system',
        action,
        entityType,
        entityId,
        oldValue == null ? null : (typeof oldValue === 'string' ? oldValue : JSON.stringify(oldValue)),
        newValue == null ? null : (typeof newValue === 'string' ? newValue : JSON.stringify(newValue))
      ]
    );
  } catch (e) {
    console.error('[AUDIT] Failed to write audit log:', e.message);
  }
}

// Add camelCase aliases for legacy frontend components that still read
// fullName / departmentId / baseSalary / bankAccountNumber / isLead / etc.
// instead of the snake_case names SQLite returns. Returns a new object with
// BOTH naming conventions so old and new components keep working.
function withCamelAliases(row) {
  if (!row) return row;
  return {
    ...row,
    // Identity / name
    fullName: row.full_name || row.fullName || null,
    name: row.full_name || row.fullName || null,
    // Department
    departmentId: row.department_id || row.departmentId || null,
    department_name: row.department_name || null,
    departmentName: row.department_name || row.departmentName || null,
    // Role / lead
    role: row.role_name || row.role || null,
    isLead: row.is_department_lead === 1 || row.isLead === true,
    // Employment
    baseSalary: row.base_salary != null ? row.base_salary : (row.baseSalary || 0),
    employmentType: row.employment_type || row.employmentType || null,
    isProbation: row.is_probation === 1 || row.isProbation === true,
    // Banking
    bankAccountNumber: row.bankAccountNumber || row.account_number || null,
    bankName: row.bankName || row.bank_name || null,
    accountName: row.accountName || row.account_holder || null,
    ifscCode: row.ifscCode || row.ifsc_code || null,
    // Joining date (multiple possible inputs from JOIN aliases)
    joiningDate: row.joiningDate || row.start_date || null,
    // Work schedule
    startTime: row.startTime || row.start_time || '09:00',
    endTime: row.endTime || row.end_time || '18:00',
    // First login flag
    isFirstLogin: row.is_first_login === 1
  };
}

function register(ipcMain, db) {
  ipcMain.handle('employee:getAll', async (event) => {
    try {
      const employees = await db.all(
        `SELECT u.*,
                r.name as role_name,
                d.name as department_name,
                er.start_date as joiningDate,
                er.base_salary,
                er.employment_type,
                er.is_probation,
                er.probation_end_date as probationEndDate,
                er.start_time as startTime,
                er.end_time as endTime,
                bd.account_number as bankAccountNumber,
                bd.bank_name as bankName,
                bd.account_holder as accountName,
                bd.ifsc_code as ifscCode
         FROM users u
         LEFT JOIN roles r ON u.role_id = r.id
         LEFT JOIN departments d ON u.department_id = d.id
         LEFT JOIN employment_records er ON u.id = er.user_id
         LEFT JOIN banking_details bd ON u.id = bd.user_id
         WHERE u.status = 'active'
         ORDER BY u.full_name`
      );
      return { success: true, data: employees.map(withCamelAliases) };
    } catch (error) {
      console.error('Get all employees error:', error);
      return { success: false, message: 'Failed to retrieve employees' };
    }
  });

  ipcMain.handle('employee:getById', async (event, { id }) => {
    try {
      let employee = await db.get(
        `SELECT u.*,
                r.name as role_name,
                d.name as department_name,
                er.id as employment_record_id,
                er.start_date as joiningDate,
                er.base_salary,
                er.employment_type,
                er.is_probation,
                er.probation_end_date as probationEndDate,
                er.start_time as startTime,
                er.end_time as endTime,
                bd.account_number as bankAccountNumber,
                bd.bank_name as bankName,
                bd.account_holder as accountName,
                bd.ifsc_code as ifscCode
         FROM users u
         LEFT JOIN roles r ON u.role_id = r.id
         LEFT JOIN departments d ON u.department_id = d.id
         LEFT JOIN employment_records er ON u.id = er.user_id
         LEFT JOIN banking_details bd ON u.id = bd.user_id
         WHERE u.id = ?`,
        [id]
      );

      // Also surface the latest salary increment so the edit form can pre-fill
      // "Last Increment Date" / "Last Increment Amount". A new row is created
      // when the admin saves a different combination.
      if (employee) {
        try {
          const incRow = await db.get(
            `SELECT increment_date, increment_amount
             FROM salary_increments
             WHERE user_id = ?
             ORDER BY increment_date DESC
             LIMIT 1`,
            [id]
          );
          if (incRow) {
            employee.lastIncrementDate = incRow.increment_date;
            employee.lastIncrementAmount = incRow.increment_amount;
          }
        } catch (e) {
          console.warn('[EMPLOYEE] Could not fetch last salary increment:', e.message);
        }
      }

      // If no employment records exist, create a default one
      if (employee && !employee.employment_record_id) {
        const empRecordId = uuidv4();
        const today = new Date().toISOString().split('T')[0];
        console.log('[EMPLOYEE] Creating default employment record for user:', id);
        await db.run(
          `INSERT INTO employment_records (id, user_id, start_date, employment_type, base_salary, is_probation)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [empRecordId, id, today, 'Permanent', 0, 0]
        );
        // Update employee object with the new employment record data
        employee.employment_record_id = empRecordId;
        employee.joiningDate = today;
        employee.base_salary = 0;
        employee.employment_type = 'Permanent';
        employee.is_probation = 0;
      }

      return { success: true, data: withCamelAliases(employee) };
    } catch (error) {
      console.error('Get employee by id error:', error);
      return { success: false, message: 'Failed to retrieve employee' };
    }
  });

  ipcMain.handle('employee:getByDepartment', async (event, { departmentId }) => {
    try {
      const employees = await db.all(
        `SELECT u.*,
                r.name as role_name,
                d.name as department_name,
                er.start_date as joiningDate,
                er.base_salary,
                er.employment_type,
                er.is_probation,
                bd.account_number as bankAccountNumber,
                bd.bank_name as bankName,
                bd.account_holder as accountName,
                bd.ifsc_code as ifscCode
         FROM users u
         LEFT JOIN roles r ON u.role_id = r.id
         LEFT JOIN departments d ON u.department_id = d.id
         LEFT JOIN employment_records er ON u.id = er.user_id
         LEFT JOIN banking_details bd ON u.id = bd.user_id
         WHERE u.department_id = ? AND u.status = 'active'
         ORDER BY u.full_name`,
        [departmentId]
      );
      return { success: true, data: employees.map(withCamelAliases) };
    } catch (error) {
      console.error('Get department employees error:', error);
      return { success: false, message: 'Failed to retrieve employees' };
    }
  });

  ipcMain.handle('employee:create', async (event, data) => {
    try {
      console.log('[EMPLOYEE] Creating employee:', { fullName: data.fullName, email: data.email, role: data.role, departmentId: data.departmentId });

      // ---- Required fields ----
      if (!data.fullName || !data.fullName.trim()) {
        return { success: false, message: 'Full name is required', error: 'Full name is required' };
      }
      if (!data.email || !data.email.trim()) {
        return { success: false, message: 'Email is required', error: 'Email is required' };
      }

      // ---- Email uniqueness check (gives a clear message instead of cryptic UNIQUE constraint error) ----
      const existing = await db.get('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', [data.email.trim()]);
      if (existing) {
        return { success: false, message: `An employee with email ${data.email} already exists`, error: 'Duplicate email' };
      }

      // ---- Resolve role: the form sends a role NAME ("Admin"/"Lead"/"User"/"MD"/"Manager"),
      // but users.role_id is a FK to roles.id (a UUID). Look up by name, fall
      // back to creating the role if the install hasn't seeded it yet. ----
      let roleId = data.roleId;
      if (!roleId && data.role) {
        const roleRow = await db.get('SELECT id FROM roles WHERE LOWER(name) = LOWER(?)', [data.role]);
        if (roleRow) {
          roleId = roleRow.id;
        } else {
          // Create the role on demand so admins can type any role name
          roleId = uuidv4();
          await db.run('INSERT INTO roles (id, name, description) VALUES (?, ?, ?)', [roleId, data.role, `Created from employee form`]);
          console.log('[EMPLOYEE] Created new role:', data.role, '->', roleId);
        }
      }
      if (!roleId) {
        // Default to "User" role
        const userRoleRow = await db.get(`SELECT id FROM roles WHERE LOWER(name) IN ('user', 'employee') LIMIT 1`);
        roleId = userRoleRow ? userRoleRow.id : null;
      }
      if (!roleId) {
        return { success: false, message: 'No role available — seed the roles table or pick a role.', error: 'Role missing' };
      }

      // ---- Resolve department: must exist in departments table or be left NULL ----
      let departmentId = data.departmentId || null;
      if (departmentId) {
        const dept = await db.get('SELECT id FROM departments WHERE id = ?', [departmentId]);
        if (!dept) {
          return { success: false, message: 'Selected department no longer exists.', error: 'Invalid departmentId' };
        }
      }

      const currentUserId = data.currentUserId || 'system';
      const userId = uuidv4();
      const passwordHash = await bcrypt.hash(data.password || 'password', 10);
      const username = (data.username && data.username.trim())
        || data.fullName.trim().toLowerCase().replace(/\s+/g, '_');
      const isLead = (data.isLead === true || data.isLead === 1 || data.isLead === 'true') ? 1 : 0;
      const status = data.status || 'active';

      // ---- Insert user row ----
      await db.run(
        `INSERT INTO users (id, username, password_hash, email, full_name, role_id, department_id, is_department_lead, is_first_login, phone, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, username, passwordHash, data.email.trim(), data.fullName.trim(), roleId, departmentId, isLead, 1, data.phone || null, status]
      );

      // ---- Employment record ----
      // Form sends `joiningDate`, not `startDate`. Default to today if missing.
      const startDate = data.joiningDate || data.startDate || new Date().toISOString().split('T')[0];
      const employmentType = data.employmentType || (data.probationCompleted ? 'Permanent' : 'Probation');
      const isProbation = data.probationCompleted ? 0 : 1;
      const baseSalary = data.baseSalary ? parseFloat(data.baseSalary) : 0;

      const empId = uuidv4();
      await db.run(
        `INSERT INTO employment_records (id, user_id, start_date, employment_type, base_salary, is_probation, probation_end_date, start_time, end_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [empId, userId, startDate, employmentType, baseSalary, isProbation, data.probationEndDate || null, data.startTime || '09:00', data.endTime || '18:00']
      );

      // ---- v4.7.5 — Auto probation deposit ----
      // New joiners give up their FIRST N months' salary as a refundable
      // security deposit. The deposit accrues over N months, then admin
      // releases it (typically at probation-end). Configurable via the
      // `probation_deposit_months` app_setting; defaults to 2.
      if (isProbation && baseSalary > 0) {
        try {
          const dmRow = await db.get(`SELECT value FROM app_settings WHERE key = 'probation_deposit_months'`);
          const depositMonths = Math.max(0, parseInt(dmRow?.value || '2', 10) || 2);
          if (depositMonths > 0) {
            const depositAmount = baseSalary * depositMonths;
            await db.run(
              `INSERT INTO probation_deposits (id, user_id, deposit_amount, deduction_start_month, deduction_end_month, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 'held', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
              [uuidv4(), userId, depositAmount, 1, depositMonths]
            );
            console.log(`[EMPLOYEE] Auto-created probation deposit for ${data.fullName}: ₹${depositAmount} over ${depositMonths} month(s)`);
          }
        } catch (depErr) {
          console.warn('[EMPLOYEE] probation deposit auto-create failed:', depErr.message);
          // Don't block employee creation — admin can add the deposit row manually.
        }
      }

      // ---- Banking details (if provided) ----
      if (data.bankAccountNumber || data.bankName || data.accountName || data.ifscCode) {
        try {
          await db.run(
            `INSERT INTO banking_details (id, user_id, account_number, bank_name, account_holder, ifsc_code)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [uuidv4(), userId, data.bankAccountNumber || null, data.bankName || null, data.accountName || data.fullName.trim(), data.ifscCode || null]
          );
        } catch (bankErr) {
          // Don't fail the whole create if banking insert errors — just log.
          console.warn('[EMPLOYEE] Banking details insert failed (continuing):', bankErr.message);
        }
      }

      // ---- Initial leave balances ----
      try {
        const currentYear = new Date().getFullYear();
        const leaveTypes = await db.all('SELECT * FROM leave_types');
        for (const leaveType of leaveTypes) {
          const balanceId = uuidv4();
          const proRataAllocation = (typeof calculateProRataLeave === 'function')
            ? calculateProRataLeave(startDate, leaveType.annual_entitlement)
            : leaveType.annual_entitlement;
          await db.run(
            `INSERT INTO leave_balances (id, user_id, leave_type_id, year, total_allocated, remaining)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [balanceId, userId, leaveType.id, currentYear, proRataAllocation, proRataAllocation]
          );
        }
      } catch (leaveErr) {
        console.warn('[EMPLOYEE] Leave balance init failed (continuing):', leaveErr.message);
      }

      await writeAudit(db, currentUserId, {
        action: 'EMPLOYEE_CREATE',
        entityType: 'User',
        entityId: userId,
        oldValue: null,
        newValue: {
          username, email: data.email, fullName: data.fullName,
          departmentId, roleId, baseSalary, employmentType
        }
      });

      // Return the freshly-created employee in the same shape getById uses,
      // so the React frontend can drop it into the list without a refetch.
      const created = await db.get(
        `SELECT u.*, r.name as role_name, d.name as department_name,
                er.start_date as joiningDate, er.base_salary, er.employment_type,
                er.is_probation, er.start_time as startTime, er.end_time as endTime,
                bd.account_number as bankAccountNumber, bd.bank_name as bankName,
                bd.account_holder as accountName, bd.ifsc_code as ifscCode
         FROM users u
         LEFT JOIN roles r ON u.role_id = r.id
         LEFT JOIN departments d ON u.department_id = d.id
         LEFT JOIN employment_records er ON u.id = er.user_id
         LEFT JOIN banking_details bd ON u.id = bd.user_id
         WHERE u.id = ?`,
        [userId]
      );

      return {
        success: true,
        message: 'Employee created',
        userId,
        data: created ? withCamelAliases(created) : { id: userId, fullName: data.fullName, email: data.email }
      };
    } catch (error) {
      console.error('[EMPLOYEE] Create employee error:', error.message);
      console.error('[EMPLOYEE] Full error:', error);
      const msg = 'Failed to create employee: ' + error.message;
      return { success: false, message: msg, error: msg };
    }
  });

  ipcMain.handle('employee:update', async (event, { id, currentUserId, ...data }) => {
    try {
      console.log('[EMPLOYEE] Updating employee:', { id, data });

      // Capture before-state for audit diff
      const before = await db.get('SELECT * FROM users WHERE id = ?', [id]);

      // ---- Resolve role NAME → role_id BEFORE the field loop ----
      // The frontend sends `role: 'MD'` (a name), but users.role_id is a FK
      // to roles.id. Without this lookup the role field is dropped by the
      // excludedFields filter and the role change silently fails.
      if (data.role) {
        let roleRow = await db.get('SELECT id FROM roles WHERE LOWER(name) = LOWER(?)', [data.role]);
        if (!roleRow) {
          // Synonym fallback: Employee↔User, Admin↔Administrator
          const synonyms = {
            'employee': 'User',
            'user': 'Employee',
            'admin': 'Administrator',
            'administrator': 'Admin'
          };
          const synonym = synonyms[data.role.toLowerCase()];
          if (synonym) {
            roleRow = await db.get('SELECT id FROM roles WHERE LOWER(name) = LOWER(?)', [synonym]);
          }
        }
        if (!roleRow) {
          // Create the role on demand so any role name works
          const newRoleId = uuidv4();
          await db.run('INSERT INTO roles (id, name, description) VALUES (?, ?, ?)',
            [newRoleId, data.role, 'Created from employee update form']);
          roleRow = { id: newRoleId };
          console.log('[EMPLOYEE] Created new role on demand:', data.role, '→', newRoleId);
        }
        // Stage the FK update; the loop will pick this up via camelToSnake → role_id
        data.roleId = roleRow.id;
        console.log('[EMPLOYEE] Mapped role', data.role, '→ roleId', roleRow.id);
        delete data.role; // drop the name so excludedFields skip is a no-op
      }

      const userUpdates = [];
      const userValues = [];
      let joiningDate = null;
      let startTime = null;
      let endTime = null;
      let baseSalary = null;
      let employmentType = null;
      let probationCompleted = null;
      // `undefined` = field not sent (preserve existing). String '' = clear.
      let probationEndDate = undefined;
      // Salary-increment fields — collected to insert a new salary_increments
      // row at the end of the update.
      let lastIncrementDate = undefined;
      let lastIncrementAmount = undefined;
      // Banking fields — collected during the loop, upserted into
      // banking_details after the user/employment_records updates run.
      // Sentinel `undefined` = field was not sent. Empty string = user
      // cleared the field, which we honour by writing null to the DB.
      let bankNameValue = undefined;
      let bankAccountNumberValue = undefined;
      let accountNameValue = undefined;
      let ifscCodeValue = undefined;

      for (const [key, value] of Object.entries(data)) {
        // Salary increment fields — handled at the end (separate table).
        if (salaryIncrementFields.includes(key)) {
          if (key === 'lastIncrementDate') lastIncrementDate = value;
          else if (key === 'lastIncrementAmount') lastIncrementAmount = value;
          continue;
        }
        // Check if this field belongs to employment_records
        if (employmentRecordFields.includes(key)) {
          if (key === 'joiningDate') {
            joiningDate = value;
            console.log('[EMPLOYEE] Found joiningDate:', joiningDate);
          } else if (key === 'startTime') {
            startTime = value;
            console.log('[EMPLOYEE] Found startTime:', startTime);
          } else if (key === 'endTime') {
            endTime = value;
            console.log('[EMPLOYEE] Found endTime:', endTime);
          } else if (key === 'baseSalary') {
            baseSalary = value;
            console.log('[EMPLOYEE] Found baseSalary:', baseSalary);
          } else if (key === 'employmentType') {
            employmentType = value;
            console.log('[EMPLOYEE] Found employmentType:', employmentType);
          } else if (key === 'probationCompleted') {
            probationCompleted = value;
            console.log('[EMPLOYEE] Found probationCompleted:', probationCompleted);
          } else if (key === 'probationEndDate') {
            probationEndDate = value;
            console.log('[EMPLOYEE] Found probationEndDate:', probationEndDate);
          }
        }
        // Collect banking_details fields — upserted below, no longer dropped
        else if (bankingDetailsFields.includes(key)) {
          if (key === 'bankName') bankNameValue = value;
          else if (key === 'bankAccountNumber') bankAccountNumberValue = value;
          else if (key === 'accountName') accountNameValue = value;
          else if (key === 'ifscCode') ifscCodeValue = value;
          console.log('[EMPLOYEE] Found banking field:', key, '=', value);
        }
        // Check if this is an excluded field
        else if (excludedFields.includes(key)) {
          // Skip excluded fields
          console.log('[EMPLOYEE] Skipping excluded field:', key);
        }
        // Check if this is a mapped users table field
        else if (userTableFields.hasOwnProperty(key)) {
          const dbColumnName = userTableFields[key];
          let normalized = value;
          // department_id is a FK to departments.id. An empty string would
          // trigger SQLITE_CONSTRAINT: FOREIGN KEY constraint failed because
          // "" isn't a valid department row. Validate before including:
          //   - empty / null  → drop the assignment so the existing value
          //     is preserved
          //   - non-empty     → verify it exists in departments; if not,
          //     drop it and log so we can see in the renderer console
          if (dbColumnName === 'department_id') {
            if (normalized === '' || normalized === null || normalized === undefined) {
              console.log('[EMPLOYEE] Skipping department_id (empty value)');
              continue;
            }
            const dept = await db.get('SELECT id FROM departments WHERE id = ?', [normalized]);
            if (!dept) {
              console.warn('[EMPLOYEE] Skipping department_id - no matching department:', normalized);
              continue;
            }
          }
          // is_department_lead is a BOOLEAN; coerce to 0/1 so the binding
          // never sends a string like "true" that SQLite stores as 0.
          if (dbColumnName === 'is_department_lead') {
            normalized = (value === true || value === 1 || value === '1' || value === 'true') ? 1 : 0;
          }
          userUpdates.push(`${dbColumnName} = ?`);
          userValues.push(normalized);
          console.log('[EMPLOYEE] Adding user field:', key, '→', dbColumnName, '=', normalized);
        }
        // Default: try camelToSnake conversion
        else {
          const snakeCaseKey = camelToSnake(key);
          userUpdates.push(`${snakeCaseKey} = ?`);
          userValues.push(value);
          console.log('[EMPLOYEE] Adding user field with camelToSnake:', key, '→', snakeCaseKey);
        }
      }

      // Update users table
      if (userUpdates.length > 0) {
        userValues.push(id);
        const userUpdateSQL = `UPDATE users SET ${userUpdates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
        console.log('[EMPLOYEE] Executing user update:', { sql: userUpdateSQL, values: userValues });
        await db.run(userUpdateSQL, userValues);
        console.log('[EMPLOYEE] Updated users table');
      } else {
        console.log('[EMPLOYEE] No user fields to update');
      }

      // Update or create employment_records for joining date, start time, end time, salary, etc.
      if (joiningDate || startTime || endTime || baseSalary || employmentType || probationCompleted || probationEndDate !== undefined) {
        // First check if employment record exists
        const existingRecord = await db.get(
          `SELECT id FROM employment_records WHERE user_id = ?`,
          [id]
        );

        if (existingRecord) {
          // Build update query dynamically based on what fields are provided
          const updates = [];
          const values = [];

          if (joiningDate) {
            updates.push('start_date = ?');
            values.push(joiningDate);
            console.log('[EMPLOYEE] Updating employment_records joining date:', joiningDate);
          }
          if (startTime) {
            updates.push('start_time = ?');
            values.push(startTime);
            console.log('[EMPLOYEE] Updating employment_records start time:', startTime);
          }
          if (endTime) {
            updates.push('end_time = ?');
            values.push(endTime);
            console.log('[EMPLOYEE] Updating employment_records end time:', endTime);
          }
          if (baseSalary) {
            updates.push('base_salary = ?');
            values.push(baseSalary);
            console.log('[EMPLOYEE] Updating employment_records base salary:', baseSalary);
          }
          if (employmentType) {
            updates.push('employment_type = ?');
            values.push(employmentType);
            console.log('[EMPLOYEE] Updating employment_records employment type:', employmentType);
          }
          if (probationCompleted !== null && probationCompleted !== undefined) {
            updates.push('is_probation = ?');
            values.push(probationCompleted ? 0 : 1);  // Invert: probationCompleted true → is_probation 0
            console.log('[EMPLOYEE] Updating employment_records probation status:', probationCompleted);
          }
          if (probationEndDate !== undefined) {
            updates.push('probation_end_date = ?');
            // Empty string from the form → write null so the column is cleared.
            values.push(probationEndDate ? probationEndDate : null);
            console.log('[EMPLOYEE] Updating employment_records probation end date:', probationEndDate);
          }

          if (updates.length > 0) {
            values.push(id);
            const empUpdateSQL = `UPDATE employment_records SET ${updates.join(', ')} WHERE user_id = ?`;
            console.log('[EMPLOYEE] Executing employment_records update:', { sql: empUpdateSQL, values: values });
            await db.run(empUpdateSQL, values);
          } else {
            console.log('[EMPLOYEE] No employment_records fields to update');
          }
        } else {
          // Create new employment record if it doesn't exist
          const empRecordId = uuidv4();
          await db.run(
            `INSERT INTO employment_records (id, user_id, start_date, employment_type, is_probation, start_time, end_time)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [empRecordId, id, joiningDate || new Date().toISOString().split('T')[0], 'Permanent', 0, startTime || '09:00', endTime || '18:00']
          );
          console.log('[EMPLOYEE] Created new employment_records');
        }
      }

      // Update or create banking_details for bank name, account name, account
      // number, IFSC code. Previously the field loop dropped these silently,
      // so the Edit form's banking inputs had no effect after the initial
      // employee creation. Now we upsert into banking_details on every edit.
      const bankingProvided =
        bankNameValue !== undefined ||
        bankAccountNumberValue !== undefined ||
        accountNameValue !== undefined ||
        ifscCodeValue !== undefined;

      if (bankingProvided) {
        // Normalise empty strings to null so cleared fields actually clear in the DB
        const normaliseBank = (v) =>
          v === undefined ? undefined : (v === '' || v === null ? null : v);

        const bankName = normaliseBank(bankNameValue);
        const bankAccountNumber = normaliseBank(bankAccountNumberValue);
        const accountName = normaliseBank(accountNameValue);
        const ifscCode = normaliseBank(ifscCodeValue);

        const existingBank = await db.get('SELECT id FROM banking_details WHERE user_id = ?', [id]);

        if (existingBank) {
          // Only touch the columns the form actually sent (undefined = leave alone)
          const bankUpdates = [];
          const bankValues = [];
          if (bankName !== undefined)          { bankUpdates.push('bank_name = ?');      bankValues.push(bankName); }
          if (bankAccountNumber !== undefined) { bankUpdates.push('account_number = ?'); bankValues.push(bankAccountNumber); }
          if (accountName !== undefined)       { bankUpdates.push('account_holder = ?'); bankValues.push(accountName); }
          if (ifscCode !== undefined)          { bankUpdates.push('ifsc_code = ?');      bankValues.push(ifscCode); }

          if (bankUpdates.length > 0) {
            bankUpdates.push('updated_at = CURRENT_TIMESTAMP');
            bankValues.push(id);
            const bankSQL = `UPDATE banking_details SET ${bankUpdates.join(', ')} WHERE user_id = ?`;
            console.log('[EMPLOYEE] Updating banking_details:', { sql: bankSQL, values: bankValues });
            await db.run(bankSQL, bankValues);
          }
        } else {
          // No banking_details row yet — INSERT one
          await db.run(
            `INSERT INTO banking_details (id, user_id, bank_name, account_number, account_holder, ifsc_code)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              uuidv4(),
              id,
              bankName === undefined ? null : bankName,
              bankAccountNumber === undefined ? null : bankAccountNumber,
              accountName === undefined ? null : accountName,
              ifscCode === undefined ? null : ifscCode
            ]
          );
          console.log('[EMPLOYEE] Created new banking_details row');
        }
      }

      // ---- Salary increment (if both fields provided) ----
      // If the admin filled BOTH lastIncrementDate and lastIncrementAmount
      // and either differs from the most-recent row, insert a new row.
      // We never overwrite history — every saved combination becomes a row.
      if (lastIncrementDate && lastIncrementAmount != null && lastIncrementAmount !== '') {
        try {
          const incrementAmt = parseFloat(lastIncrementAmount);
          if (!isNaN(incrementAmt)) {
            const latestRow = await db.get(
              `SELECT increment_date, increment_amount FROM salary_increments
               WHERE user_id = ? ORDER BY increment_date DESC LIMIT 1`,
              [id]
            );
            const same = latestRow &&
              String(latestRow.increment_date).slice(0, 10) === String(lastIncrementDate).slice(0, 10) &&
              Number(latestRow.increment_amount) === incrementAmt;
            if (!same) {
              // Look up the new base_salary so we can record the new/previous columns
              const er = await db.get(
                `SELECT base_salary FROM employment_records WHERE user_id = ?`, [id]
              );
              const newSalary = er ? (er.base_salary || 0) : 0;
              const previousSalary = Math.max(0, newSalary - incrementAmt);
              await db.run(
                `INSERT INTO salary_increments
                   (id, user_id, increment_date, previous_salary, new_salary,
                    increment_amount, reason, approved_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [uuidv4(), id, lastIncrementDate, previousSalary, newSalary,
                 incrementAmt, 'Recorded from employee edit form', currentUserId || null]
              );
              console.log('[EMPLOYEE] Recorded new salary increment:', lastIncrementDate, '+', incrementAmt);
            } else {
              console.log('[EMPLOYEE] Salary increment unchanged — skipping insert');
            }
          }
        } catch (incErr) {
          console.warn('[EMPLOYEE] Salary-increment insert failed (continuing):', incErr.message);
        }
      }

      // Capture after-state for audit
      const after = await db.get('SELECT * FROM users WHERE id = ?', [id]);
      if (before) delete before.password_hash;
      if (after) delete after.password_hash;
      await writeAudit(db, currentUserId || 'system', {
        action: 'EMPLOYEE_UPDATE',
        entityType: 'User',
        entityId: id,
        oldValue: before,
        newValue: after
      });

      // Fetch the updated employee with all details
      const updatedEmployee = await db.get(
        `SELECT u.*,
                r.name as role_name,
                d.name as department_name,
                er.start_date as joiningDate,
                er.base_salary,
                er.employment_type,
                er.is_probation,
                er.start_time as startTime,
                er.end_time as endTime,
                bd.account_number as bankAccountNumber,
                bd.bank_name as bankName,
                bd.account_holder as accountName,
                bd.ifsc_code as ifscCode
         FROM users u
         LEFT JOIN roles r ON u.role_id = r.id
         LEFT JOIN departments d ON u.department_id = d.id
         LEFT JOIN employment_records er ON u.id = er.user_id
         LEFT JOIN banking_details bd ON u.id = bd.user_id
         WHERE u.id = ?`,
        [id]
      );

      return { success: true, message: 'Employee updated', data: updatedEmployee ? withCamelAliases(updatedEmployee) : { id } };
    } catch (error) {
      console.error('[EMPLOYEE] Update employee error:', error.message);
      console.error('[EMPLOYEE] Full error:', error);
      const msg = 'Failed to update employee: ' + error.message;
      // Return both keys so callers reading either `message` or `error` get the
      // real reason instead of the generic "Unknown error" fallback in the UI.
      return { success: false, message: msg, error: msg };
    }
  });

  // Proper offboarding workflow: captures the exit metadata (last working day,
  // reason, notes, checklist), sets status='inactive', writes the employment
  // record's end_date, auto-cancels any pending leave requests that start after
  // the last working day, and writes a detailed audit log entry. Use this
  // instead of employee:delete when departing — employee:delete remains the
  // quick-toggle for soft deactivation without exit metadata.
  ipcMain.handle('employee:offboard', async (event, args = {}) => {
    const { id, lastWorkingDay, exitReason, exitNotes, checklist, currentUserId } = args;
    try {
      if (!id) return { success: false, message: 'Employee id is required' };
      if (!lastWorkingDay) return { success: false, message: 'Last working day is required' };
      if (!exitReason) return { success: false, message: 'Exit reason is required' };

      const before = await db.get(
        'SELECT id, full_name, email, status, last_working_day, exit_reason, exit_notes FROM users WHERE id = ?',
        [id]
      );
      if (!before) return { success: false, message: 'Employee not found' };

      // Bundle the HR checklist into the audit log so we have a record of what
      // was ticked off, even though the booleans aren't persisted on the user row.
      const checklistJson = checklist ? JSON.stringify(checklist) : null;

      await db.run(
        `UPDATE users
            SET status = 'inactive',
                last_working_day = ?,
                exit_reason = ?,
                exit_notes = ?,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [lastWorkingDay, exitReason, exitNotes || null, id]
      );

      // Mirror the end date on the employment record so payroll / tenure
      // calculations agree with the user-level offboarding date.
      await db.run(
        `UPDATE employment_records
            SET end_date = ?
          WHERE user_id = ?`,
        [lastWorkingDay, id]
      );

      // Auto-cancel any pending leave requests that begin after the last
      // working day — they can't be honoured anymore. Approved leaves up to
      // and including the last day are left alone (already taken / planned).
      const cancelledLeaves = await db.run(
        `UPDATE leave_requests
            SET status = 'cancelled',
                rejected_reason = COALESCE(rejected_reason, 'Cancelled due to offboarding')
          WHERE user_id = ?
            AND status = 'pending'
            AND start_date > ?`,
        [id, lastWorkingDay]
      );

      await writeAudit(db, currentUserId || 'system', {
        action: 'EMPLOYEE_OFFBOARD',
        entityType: 'User',
        entityId: id,
        oldValue: before,
        newValue: {
          status: 'inactive',
          last_working_day: lastWorkingDay,
          exit_reason: exitReason,
          exit_notes: exitNotes || null,
          checklist: checklistJson,
          pending_leaves_cancelled: cancelledLeaves?.changes || 0
        }
      });

      return {
        success: true,
        message: 'Employee offboarded',
        data: { pendingLeavesCancelled: cancelledLeaves?.changes || 0 }
      };
    } catch (error) {
      console.error('Offboard employee error:', error);
      return { success: false, message: 'Failed to offboard employee: ' + error.message };
    }
  });

  // Undo offboarding — flips status back to active and clears the exit fields.
  // Does NOT restore any leave requests that were auto-cancelled; HR can
  // re-submit those manually if the employee re-joins.
  ipcMain.handle('employee:reactivate', async (event, args = {}) => {
    const { id, currentUserId } = args;
    try {
      if (!id) return { success: false, message: 'Employee id is required' };
      const before = await db.get(
        'SELECT id, full_name, status, last_working_day, exit_reason, exit_notes FROM users WHERE id = ?',
        [id]
      );
      if (!before) return { success: false, message: 'Employee not found' };

      await db.run(
        `UPDATE users
            SET status = 'active',
                last_working_day = NULL,
                exit_reason = NULL,
                exit_notes = NULL,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [id]
      );
      await db.run(
        `UPDATE employment_records SET end_date = NULL WHERE user_id = ?`,
        [id]
      );
      await writeAudit(db, currentUserId || 'system', {
        action: 'EMPLOYEE_REACTIVATE',
        entityType: 'User',
        entityId: id,
        oldValue: before,
        newValue: { status: 'active' }
      });
      return { success: true, message: 'Employee reactivated' };
    } catch (error) {
      console.error('Reactivate employee error:', error);
      return { success: false, message: 'Failed to reactivate employee: ' + error.message };
    }
  });

  // List all offboarded employees for the "Past Employees" view. Returns the
  // exit metadata alongside the basic profile so HR can scan reasons at a glance.
  ipcMain.handle('employee:listOffboarded', async () => {
    try {
      const rows = await db.all(
        `SELECT u.id, u.full_name, u.email, u.phone, u.profile_picture_path,
                u.last_working_day, u.exit_reason, u.exit_notes,
                u.department_id, d.name AS department_name,
                r.name AS role_name,
                er.start_date AS joining_date, er.end_date
           FROM users u
           LEFT JOIN departments d ON u.department_id = d.id
           LEFT JOIN roles r ON u.role_id = r.id
           LEFT JOIN employment_records er ON er.user_id = u.id
          WHERE u.status = 'inactive'
          ORDER BY u.last_working_day DESC, u.full_name ASC`
      );
      return { success: true, data: rows };
    } catch (error) {
      console.error('List offboarded employees error:', error);
      return { success: false, message: 'Failed to list offboarded employees' };
    }
  });

  ipcMain.handle('employee:delete', async (event, { id, currentUserId }) => {
    try {
      const before = await db.get('SELECT id, full_name, email, status FROM users WHERE id = ?', [id]);
      await db.run('UPDATE users SET status = ? WHERE id = ?', ['inactive', id]);
      await writeAudit(db, currentUserId || 'system', {
        action: 'EMPLOYEE_DELETE',
        entityType: 'User',
        entityId: id,
        oldValue: before,
        newValue: { ...before, status: 'inactive' }
      });
      return { success: true, message: 'Employee deactivated' };
    } catch (error) {
      console.error('Delete employee error:', error);
      return { success: false, message: 'Failed to delete employee' };
    }
  });

  ipcMain.handle('employee:import', async (event, { csvData }) => {
    try {
      const results = Papa.parse(csvData, { header: true, dynamicTyping: true });
      let importedCount = 0;

      for (const row of results.data) {
        if (!row.username || !row.fullName) continue;

        const userId = uuidv4();
        const passwordHash = await bcrypt.hash('Welcome@123', 10);
        const roleId = row.roleId || (await db.get('SELECT id FROM roles WHERE name = ?', ['User'])).id;

        await db.run(
          `INSERT INTO users (id, username, password_hash, email, full_name, role_id, department_id, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [userId, row.username, passwordHash, row.email, row.fullName, roleId, row.departmentId, 'active']
        );

        // Employment record
        const empId = uuidv4();
        await db.run(
          `INSERT INTO employment_records (id, user_id, start_date, employment_type, base_salary, is_probation)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [empId, userId, row.startDate, row.employmentType || 'Permanent', row.baseSalary, 1]
        );

        importedCount++;
      }

      return { success: true, message: `Imported ${importedCount} employees` };
    } catch (error) {
      console.error('Import employees error:', error);
      return { success: false, message: 'Failed to import employees' };
    }
  });

  // Upcoming celebrations — birthdays + work anniversaries in the next
  // `windowDays` days (default 30). Used by the Birthday/Anniversary widget
  // on Admin and Lead dashboards. departmentId is optional: leads pass
  // theirs to see only their team, admins omit it for company-wide.
  ipcMain.handle('employee:getUpcomingCelebrations', async (event, { departmentId, windowDays = 30 } = {}) => {
    try {
      // Anchor "today" to UTC midnight so date-only inputs (YYYY-MM-DD) compare
      // consistently regardless of the server's local timezone. Without this,
      // a DOB of "2004-06-26" stored as UTC midnight reads back as "2004-06-25
      // 19:00" in EST and the widget shows the birthday 1 day early.
      const today = new Date();
      const todayUTC = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const windowEnd = new Date(todayUTC);
      windowEnd.setUTCDate(windowEnd.getUTCDate() + Math.max(1, parseInt(windowDays, 10) || 30));

      // Pull active users (with their joining date from employment_records)
      let sql = `SELECT u.id, u.full_name, u.date_of_birth, u.department_id,
                        u.profile_picture_path,
                        d.name as department_name,
                        er.start_date as joining_date
                 FROM users u
                 LEFT JOIN departments d ON u.department_id = d.id
                 LEFT JOIN employment_records er ON er.user_id = u.id
                 WHERE u.status = 'active'`;
      const params = [];
      if (departmentId) { sql += ' AND u.department_id = ?'; params.push(departmentId); }
      const rows = await db.all(sql, params);

      // For each user, compute this year's birthday + this year's anniversary
      // (using the joining month/day with the current year). If it's already
      // past, advance to next year. Then keep only those within the window.
      //
      // Everything in UTC to avoid date-shift bugs: storage rows are
      // "YYYY-MM-DD" strings (date-only); we parse the parts directly instead
      // of round-tripping through `new Date(string)` which lands at UTC
      // midnight and can become the previous day in any west-of-UTC timezone.
      const events = [];
      const isoToParts = (s) => {
        if (!s || typeof s !== 'string') return null;
        const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!m) return null;
        return { y: +m[1], m: +m[2] - 1, d: +m[3] };
      };
      const computeNextUTC = (parts) => {
        let next = new Date(Date.UTC(todayUTC.getUTCFullYear(), parts.m, parts.d));
        if (next < todayUTC) next = new Date(Date.UTC(todayUTC.getUTCFullYear() + 1, parts.m, parts.d));
        return next;
      };

      for (const u of rows) {
        // Birthday
        const dobParts = isoToParts(u.date_of_birth);
        if (dobParts) {
          const next = computeNextUTC(dobParts);
          if (next >= todayUTC && next <= windowEnd) {
            const daysAway = Math.round((next - todayUTC) / (1000 * 60 * 60 * 24));
            events.push({
              type: 'birthday',
              userId: u.id,
              name: u.full_name,
              department: u.department_name || null,
              department_id: u.department_id || null,
              profile_picture_path: u.profile_picture_path || null,
              date: `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`,
              daysAway,
              age: next.getUTCFullYear() - dobParts.y
            });
          }
        }
        // Work anniversary — only if they have a joining date AND it isn't
        // their *first* anniversary already counted from this calendar year.
        const jdParts = isoToParts(u.joining_date);
        if (jdParts) {
          const next = computeNextUTC(jdParts);
          const yearsCompleted = next.getUTCFullYear() - jdParts.y;
          if (yearsCompleted >= 1 && next >= todayUTC && next <= windowEnd) {
            const daysAway = Math.round((next - todayUTC) / (1000 * 60 * 60 * 24));
            events.push({
              type: 'anniversary',
              userId: u.id,
              name: u.full_name,
              department: u.department_name || null,
              department_id: u.department_id || null,
              profile_picture_path: u.profile_picture_path || null,
              date: `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`,
              daysAway,
              years: yearsCompleted
            });
          }
        }
      }

      // Sort by daysAway (closest first), then type
      events.sort((a, b) => a.daysAway - b.daysAway || a.type.localeCompare(b.type));
      return { success: true, data: events, today: todayStr };
    } catch (error) {
      console.error('[EMPLOYEE] Get upcoming celebrations error:', error);
      return { success: false, message: 'Failed to fetch celebrations: ' + error.message };
    }
  });

  ipcMain.handle('employee:updateBankingDetails', async (event, { userId, ...details }) => {
    try {
      const existing = await db.get('SELECT * FROM banking_details WHERE user_id = ?', [userId]);
      const id = existing?.id || uuidv4();

      if (existing) {
        await db.run(
          `UPDATE banking_details SET bank_name = ?, account_number = ?, account_holder = ?, ifsc_code = ?, routing_code = ? WHERE user_id = ?`,
          [details.bankName, details.accountNumber, details.accountHolder, details.ifscCode, details.routingCode, userId]
        );
      } else {
        await db.run(
          `INSERT INTO banking_details (id, user_id, bank_name, account_number, account_holder, ifsc_code, routing_code)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, userId, details.bankName, details.accountNumber, details.accountHolder, details.ifscCode, details.routingCode]
        );
      }

      return { success: true, message: 'Banking details updated' };
    } catch (error) {
      console.error('Update banking details error:', error);
      return { success: false, message: 'Failed to update banking details' };
    }
  });

  // ==========================================================================
  // SQLite-backed BULK CREATE (overrides the JSON-store version in main.js).
  // The old handler wrote to store.json which the dashboard never reads from,
  // so imports appeared "successful" but never showed up in the employee list.
  // ==========================================================================
  ipcMain.handle('employee:bulkCreate', async (event, { employees }) => {
    try {
      console.log('[EMPLOYEE] Bulk create:', employees.length, 'employees');

      // Pre-load departments and roles for fast name → id lookups
      const allDepartments = await db.all('SELECT id, name FROM departments');
      const deptByName = new Map(allDepartments.map(d => [d.name.toLowerCase(), d.id]));

      const allRoles = await db.all('SELECT id, name FROM roles');
      const roleByName = new Map(allRoles.map(r => [r.name.toLowerCase(), r.id]));

      const synonyms = {
        'employee': 'user',
        'user': 'employee',
        'admin': 'administrator',
        'administrator': 'admin'
      };

      const results = { success: [], failed: [] };
      const defaultPasswordHash = await bcrypt.hash('password', 10);

      for (const emp of employees) {
        try {
          if (!emp.fullName || !emp.email) {
            results.failed.push({ employee: emp, error: 'fullName and email are required' });
            continue;
          }

          // ---- Department lookup (by NAME, since Excel sends names) ----
          let departmentId = null;
          if (emp.department) {
            departmentId = deptByName.get(emp.department.toLowerCase()) || null;
            if (!departmentId) {
              results.failed.push({ employee: emp, error: `Department "${emp.department}" not found` });
              continue;
            }
          }

          // ---- Role lookup with synonym + on-demand creation ----
          const roleName = emp.role || 'Employee';
          let roleId = roleByName.get(roleName.toLowerCase());
          if (!roleId) {
            const syn = synonyms[roleName.toLowerCase()];
            if (syn) roleId = roleByName.get(syn);
          }
          if (!roleId) {
            // Create the role on demand
            roleId = uuidv4();
            await db.run('INSERT INTO roles (id, name, description) VALUES (?, ?, ?)',
              [roleId, roleName, 'Created from bulk import']);
            roleByName.set(roleName.toLowerCase(), roleId);
            console.log('[EMPLOYEE] Bulk: created role on demand:', roleName);
          }

          // ---- Skip if email already taken (prevents UNIQUE constraint error) ----
          const existing = await db.get('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', [emp.email]);
          if (existing) {
            results.failed.push({ employee: emp, error: `Email ${emp.email} already exists` });
            continue;
          }

          const userId = uuidv4();
          const username = (emp.username && String(emp.username).trim())
            || emp.fullName.trim().toLowerCase().replace(/\s+/g, '_');
          const isLead = emp.isTeamLead === true ? 1 : 0;

          // ---- Insert user (now including dateOfBirth) ----
          await db.run(
            `INSERT INTO users (id, username, password_hash, email, full_name, role_id, department_id, is_department_lead, is_first_login, phone, status, date_of_birth)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, username, defaultPasswordHash, emp.email.trim(), emp.fullName.trim(),
             roleId, departmentId, isLead, 1, emp.phone || null, 'active',
             emp.dateOfBirth || null]
          );

          // ---- Employment record (use Excel data, not hardcoded defaults) ----
          // Today is a sensible fallback for joining date when the Excel has none,
          // but if the importer supplies one (the common case), use that.
          const today = new Date();
          const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
          await db.run(
            `INSERT INTO employment_records (id, user_id, start_date, employment_type, base_salary, is_probation, probation_end_date, start_time, end_time)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [uuidv4(), userId,
             emp.joiningDate || todayISO,
             emp.employmentType || 'Permanent',
             emp.baseSalary || 0,
             emp.isProbation ? 1 : 0,
             emp.probationEndDate || null,
             emp.startTime || '09:00',
             emp.endTime || '18:00']
          );

          // ---- Banking details (if any provided) ----
          if (emp.bankAccountNumber || emp.bankName || emp.accountName || emp.ifscCode) {
            try {
              await db.run(
                `INSERT INTO banking_details (id, user_id, account_number, bank_name, account_holder, ifsc_code)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [uuidv4(), userId, emp.bankAccountNumber || null, emp.bankName || null,
                 emp.accountName || emp.fullName.trim(), emp.ifscCode || null]
              );
            } catch (bankErr) {
              console.warn('[EMPLOYEE] Bulk: banking insert failed for', emp.email, '-', bankErr.message);
            }
          }

          // ---- Salary increment history (if provided) ----
          if (emp.lastIncrementDate && emp.lastIncrementAmount) {
            try {
              await db.run(
                `INSERT INTO salary_increments
                   (id, user_id, increment_date, previous_salary, new_salary, increment_amount, reason, approved_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [uuidv4(), userId, emp.lastIncrementDate,
                 (emp.baseSalary || 0) - (emp.lastIncrementAmount || 0),
                 emp.baseSalary || 0,
                 emp.lastIncrementAmount || 0,
                 'Imported from Excel', null]
              );
            } catch (incErr) {
              console.warn('[EMPLOYEE] Bulk: increment insert failed for', emp.email, '-', incErr.message);
            }
          }

          // ---- If marked team lead, set department.lead_id ----
          if (isLead && departmentId) {
            try {
              await db.run('UPDATE departments SET lead_id = ? WHERE id = ?', [userId, departmentId]);
            } catch (leadErr) {
              console.warn('[EMPLOYEE] Bulk: lead assignment failed:', leadErr.message);
            }
          }

          results.success.push({ employee: { id: userId, ...emp }, message: 'Created successfully' });
        } catch (error) {
          console.error('[EMPLOYEE] Bulk: error creating', emp.email, '-', error.message);
          results.failed.push({ employee: emp, error: error.message });
        }
      }

      console.log(`[EMPLOYEE] Bulk create complete: ${results.success.length} created, ${results.failed.length} failed`);

      return {
        success: results.failed.length === 0,
        data: results,
        summary: {
          created: results.success.length,
          failed: results.failed.length,
          total: employees.length
        }
      };
    } catch (error) {
      console.error('[EMPLOYEE] Bulk create error:', error);
      return { success: false, error: error.message };
    }
  });

  // ==========================================================================
  // SQLite-backed EXPORT (overrides the JSON-store version in main.js).
  // The old handler read from store.json which was stale; this one reads the
  // same SQLite tables the dashboard uses, so export matches what you see.
  // ==========================================================================
  ipcMain.handle('excel:exportEmployees', async () => {
    try {
      console.log('[EXCEL] Exporting employees from SQLite...');

      // Fetch all employee data with employment records and banking details
      const employees = await db.all(
        `SELECT u.*,
                r.name as role_name,
                d.name as department_name,
                er.base_salary,
                er.employment_type,
                er.start_date as joiningDate,
                er.start_time as startTime,
                er.end_time as endTime,
                er.is_probation as isProbation,
                er.probation_end_date as probationEndDate,
                bd.account_number as bankAccountNumber,
                bd.bank_name as bankName,
                bd.account_holder as accountName,
                bd.ifsc_code as ifscCode
         FROM users u
         LEFT JOIN roles r ON u.role_id = r.id
         LEFT JOIN departments d ON u.department_id = d.id
         LEFT JOIN employment_records er ON u.id = er.user_id
         LEFT JOIN banking_details bd ON u.id = bd.user_id
         WHERE u.status = 'active'
         ORDER BY u.full_name`
      );

      // For each employee, fetch their last salary increment
      const salaryIncrements = new Map();
      for (const emp of employees) {
        try {
          const increment = await db.get(
            `SELECT increment_date, increment_amount FROM salary_increments
             WHERE user_id = ? ORDER BY increment_date DESC LIMIT 1`,
            [emp.id]
          );
          if (increment) {
            salaryIncrements.set(emp.id, increment);
          }
        } catch (err) {
          console.warn(`[EXCEL] Could not fetch salary increment for ${emp.id}:`, err.message);
        }
      }

      // Shape rows so excelUtils.exportEmployeeData sees the expected fields.
      const employeesForExport = employees.map(e => {
        const increment = salaryIncrements.get(e.id);
        return {
          fullName: e.full_name,
          email: e.email,
          phone: e.phone || '',
          username: e.username,
          departmentId: e.department_id,
          role: e.role_name || 'Employee',
          dateOfBirth: e.date_of_birth,
          joiningDate: e.joiningDate,
          employmentType: e.employment_type || 'Permanent',
          baseSalary: e.base_salary || 0,
          startTime: e.startTime,
          endTime: e.endTime,
          isProbation: e.isProbation === 1 || e.isProbation === true,
          probationEndDate: e.probationEndDate,
          lastIncrementDate: increment?.increment_date || null,
          lastIncrementAmount: increment?.increment_amount || null,
          bankName: e.bankName || '',
          accountName: e.accountName || '',
          bankAccountNumber: e.bankAccountNumber || '',
          ifscCode: e.ifscCode || '',
          isLead: e.is_department_lead === 1
        };
      });

      const departments = await db.all('SELECT id, name FROM departments');
      const excelUtils = require('../../utils/excelUtils');
      const exportBuffer = excelUtils.exportEmployeeData(employeesForExport, departments);

      // Base64-encode so the binary survives JSON-over-HTTP (web mode) AND
      // Electron IPC structured cloning. The renderer decodes back to bytes
      // before constructing the download Blob. Without this the buffer
      // round-trips as `{type:"Buffer",data:[...]}` and the resulting .xlsx
      // is unreadable.
      const base64 = Buffer.isBuffer(exportBuffer)
        ? exportBuffer.toString('base64')
        : Buffer.from(exportBuffer).toString('base64');

      console.log(`[EXCEL] ✓ Exported ${employeesForExport.length} employees from SQLite (${base64.length} b64 chars)`);
      return { success: true, data: base64 };
    } catch (error) {
      console.error('[EXCEL] Export employees error:', error);
      return { success: false, error: error.message };
    }
  });

  // Get the last salary increment for an employee (for performance review)
  ipcMain.handle('employee:getLastSalaryIncrement', async (event, { userId }) => {
    try {
      if (!userId) {
        return { success: false, message: 'userId is required' };
      }

      const increment = await db.get(
        `SELECT id, increment_date, previous_salary, new_salary, increment_amount,
                increment_percentage, reason, approved_by
         FROM salary_increments
         WHERE user_id = ?
         ORDER BY increment_date DESC
         LIMIT 1`,
        [userId]
      );

      if (!increment) {
        return { success: true, data: null };
      }

      return {
        success: true,
        data: {
          incrementDate: increment.increment_date,
          previousSalary: increment.previous_salary,
          newSalary: increment.new_salary,
          incrementAmount: increment.increment_amount,
          incrementPercentage: increment.increment_percentage,
          reason: increment.reason,
          approvedBy: increment.approved_by
        }
      };
    } catch (error) {
      console.error('Get last salary increment error:', error);
      return { success: false, message: 'Failed to retrieve salary increment' };
    }
  });
}

function calculateProRataLeave(startDate, annualEntitlement) {
  const start = new Date(startDate);
  const yearEnd = new Date(start.getFullYear(), 11, 31);
  const daysInYear = 365;
  const daysRemaining = Math.ceil((yearEnd - start) / (1000 * 60 * 60 * 24));
  return Math.ceil((daysRemaining / daysInYear) * annualEntitlement);
}

module.exports = { register };
