/**
 * Database migration utilities
 * Handles schema updates and data migrations
 */

async function runMigrations(db) {
  try {
    console.log('[MIGRATIONS] Starting database migrations...');

    // Check if is_first_login column exists
    await addFirstLoginColumnIfNeeded(db);

    // Add updated_at column to probation_deposits if needed
    await addUpdatedAtToDepositTableIfNeeded(db);

    // Add start_time and end_time columns to employment_records if needed
    await addWorkScheduleToEmploymentRecords(db);

    // Add manual_override column to leave_balances so admins can set a
    // specific remaining count without it being overwritten by the auto
    // proration on the next dashboard load.
    await addManualOverrideToLeaveBalances(db);

    // Track last login per user so admins can spot dormant accounts.
    await addLastLoginToUsers(db);

    // DOB column for the birthday widget.
    await addDateOfBirthToUsers(db);

    // Salary increments tracking for performance reviews
    await createSalaryIncrementsTableIfNeeded(db);

    // Employee document attachments (contracts, ID, offer letters, etc.)
    await createEmployeeDocumentsTableIfNeeded(db);

    // Direct-message chat between employees
    await createChatTablesIfNeeded(db);

    // Normalize legacy 'halfday' / 'Halfday' status strings to 'Half-day'.
    // Older JSON-store migrations + a couple of inconsistent code paths wrote
    // the no-hyphen form; the canonical value is 'Half-day' (mixed-case in DB,
    // lower-cased to 'half-day' by mapAttendanceOut on read).
    await normalizeHalfDayAttendanceStatus(db);

    // Leave-balance rollover policy — per-leave_type carry-forward / encashment
    // configuration + an audit log of year-end rollovers actually applied.
    await addLeaveRolloverPolicyColumns(db);
    await createLeaveBalanceRolloverLogTableIfNeeded(db);

    // Offboarding metadata on users — captures last working day, reason, and
    // optional notes so departures aren't just a silent status flip.
    await addOffboardingColumnsToUsers(db);

    // Chat attachments — file/image attachments riding alongside text messages.
    await addAttachmentColumnsToChatMessages(db);

    // Add other migrations here as needed
    // await updateExistingUsers(db);

    console.log('[MIGRATIONS] ✓ All migrations completed successfully');
  } catch (error) {
    console.error('[MIGRATIONS] Error running migrations:', error);
    throw error;
  }
}

async function addFirstLoginColumnIfNeeded(db) {
  try {
    // Check if column already exists
    const tableInfo = await db.all("PRAGMA table_info(users)");
    const hasColumn = tableInfo.some(col => col.name === 'is_first_login');

    if (!hasColumn) {
      console.log('[MIGRATIONS] Adding is_first_login column to users table...');
      await db.run(
        'ALTER TABLE users ADD COLUMN is_first_login BOOLEAN DEFAULT 1'
      );
      console.log('[MIGRATIONS] ✓ Added is_first_login column');

      // Set all existing users as requiring first login password change
      await db.run(
        'UPDATE users SET is_first_login = 1 WHERE is_first_login IS NULL'
      );
    } else {
      console.log('[MIGRATIONS] is_first_login column already exists');
    }
  } catch (error) {
    // Column might already exist, continue anyway
    console.log('[MIGRATIONS] Note:', error.message);
  }
}

async function addUpdatedAtToDepositTableIfNeeded(db) {
  try {
    // Check if probation_deposits table exists
    const tableExists = await db.get(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='probation_deposits'"
    );

    if (!tableExists) {
      console.log('[MIGRATIONS] probation_deposits table does not exist yet');
      return;
    }

    // Check if updated_at column already exists
    const tableInfo = await db.all("PRAGMA table_info(probation_deposits)");
    const hasColumn = tableInfo.some(col => col.name === 'updated_at');

    if (!hasColumn) {
      console.log('[MIGRATIONS] Adding updated_at column to probation_deposits table...');
      // SQLite doesn't allow adding columns with function defaults, so add without default first
      await db.run(
        'ALTER TABLE probation_deposits ADD COLUMN updated_at DATETIME'
      );

      // Then set the value for existing records
      await db.run(
        'UPDATE probation_deposits SET updated_at = datetime("now") WHERE updated_at IS NULL'
      );

      console.log('[MIGRATIONS] ✓ Added updated_at column to probation_deposits');
    } else {
      console.log('[MIGRATIONS] updated_at column already exists in probation_deposits');
    }
  } catch (error) {
    console.error('[MIGRATIONS] Error adding updated_at column:', error.message);
  }
}

async function addWorkScheduleToEmploymentRecords(db) {
  try {
    // Check if employment_records table exists
    const tableExists = await db.get(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='employment_records'"
    );

    if (!tableExists) {
      console.log('[MIGRATIONS] employment_records table does not exist yet');
      return;
    }

    // Check if start_time and end_time columns already exist
    const tableInfo = await db.all("PRAGMA table_info(employment_records)");
    const hasStartTime = tableInfo.some(col => col.name === 'start_time');
    const hasEndTime = tableInfo.some(col => col.name === 'end_time');

    if (!hasStartTime) {
      console.log('[MIGRATIONS] Adding start_time column to employment_records table...');
      await db.run(
        'ALTER TABLE employment_records ADD COLUMN start_time TEXT DEFAULT "09:00"'
      );
      console.log('[MIGRATIONS] ✓ Added start_time column');
    } else {
      console.log('[MIGRATIONS] start_time column already exists');
    }

    if (!hasEndTime) {
      console.log('[MIGRATIONS] Adding end_time column to employment_records table...');
      await db.run(
        'ALTER TABLE employment_records ADD COLUMN end_time TEXT DEFAULT "18:00"'
      );
      console.log('[MIGRATIONS] ✓ Added end_time column');
    } else {
      console.log('[MIGRATIONS] end_time column already exists');
    }
  } catch (error) {
    console.error('[MIGRATIONS] Error adding work schedule columns:', error.message);
  }
}

async function addManualOverrideToLeaveBalances(db) {
  try {
    const tableExists = await db.get(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='leave_balances'"
    );
    if (!tableExists) {
      console.log('[MIGRATIONS] leave_balances table does not exist yet');
      return;
    }

    const tableInfo = await db.all("PRAGMA table_info(leave_balances)");
    const hasColumn = tableInfo.some(col => col.name === 'manual_override');

    if (!hasColumn) {
      console.log('[MIGRATIONS] Adding manual_override column to leave_balances...');
      await db.run(
        'ALTER TABLE leave_balances ADD COLUMN manual_override BOOLEAN DEFAULT 0'
      );
      console.log('[MIGRATIONS] ✓ Added manual_override column');
    } else {
      console.log('[MIGRATIONS] manual_override column already exists on leave_balances');
    }
  } catch (error) {
    console.error('[MIGRATIONS] Error adding manual_override column:', error.message);
  }
}

async function addLastLoginToUsers(db) {
  try {
    const info = await db.all("PRAGMA table_info(users)");
    if (!info.some(c => c.name === 'last_login_at')) {
      console.log('[MIGRATIONS] Adding last_login_at column to users...');
      await db.run('ALTER TABLE users ADD COLUMN last_login_at DATETIME');
      console.log('[MIGRATIONS] ✓ Added last_login_at');
    }
  } catch (e) {
    console.error('[MIGRATIONS] Error adding last_login_at:', e.message);
  }
}

async function addDateOfBirthToUsers(db) {
  try {
    const info = await db.all("PRAGMA table_info(users)");
    if (!info.some(c => c.name === 'date_of_birth')) {
      console.log('[MIGRATIONS] Adding date_of_birth column to users...');
      await db.run('ALTER TABLE users ADD COLUMN date_of_birth DATE');
      console.log('[MIGRATIONS] ✓ Added date_of_birth');
    }
  } catch (e) {
    console.error('[MIGRATIONS] Error adding date_of_birth:', e.message);
  }
}

// Adds carry-forward / encashment columns to leave_types so each leave type
// can have its own rollover policy. Idempotent — checks each column first.
async function addLeaveRolloverPolicyColumns(db) {
  try {
    const tableExists = await db.get(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='leave_types'"
    );
    if (!tableExists) {
      console.log('[MIGRATIONS] leave_types missing — skipping rollover columns');
      return;
    }
    const cols = await db.all("PRAGMA table_info(leave_types)");
    const has = (n) => cols.some(c => c.name === n);

    const additions = [
      // 1 = unused balance rolls over to next year (capped by max_carry_forward_days)
      ['carry_forward_enabled',       'INTEGER DEFAULT 0'],
      // Hard cap on the carry-forward — anything above this is either encashed or forfeited
      ['max_carry_forward_days',      'INTEGER DEFAULT 0'],
      // Months from 1 Jan when carried-forward days expire (0 = no expiry, just stay on the balance)
      ['expiry_months_after_year_end','INTEGER DEFAULT 0'],
      // 1 = days that didn't carry forward get encashed; 0 = forfeited silently
      ['encashment_enabled',          'INTEGER DEFAULT 0']
    ];
    for (const [col, def] of additions) {
      if (!has(col)) {
        await db.run(`ALTER TABLE leave_types ADD COLUMN ${col} ${def}`);
        console.log(`[MIGRATIONS] ✓ Added leave_types.${col}`);
      }
    }
  } catch (error) {
    console.error('[MIGRATIONS] Error adding leave-rollover columns:', error.message);
  }
}

// Per-(user, leave_type, year) audit row recording the rollover that was
// applied. Existence of a row is also the guard that prevents the same
// rollover from being run twice.
async function createLeaveBalanceRolloverLogTableIfNeeded(db) {
  try {
    const exists = await db.get(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='leave_balance_rollover_log'"
    );
    if (exists) {
      console.log('[MIGRATIONS] leave_balance_rollover_log already exists');
      return;
    }
    console.log('[MIGRATIONS] Creating leave_balance_rollover_log...');
    await db.run(`
      CREATE TABLE leave_balance_rollover_log (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        leave_type_id TEXT NOT NULL,
        from_year INTEGER NOT NULL,
        to_year INTEGER NOT NULL,
        prev_remaining DECIMAL(6,2) NOT NULL,
        carried_forward DECIMAL(6,2) NOT NULL,
        encashed DECIMAL(6,2) DEFAULT 0,
        forfeited DECIMAL(6,2) DEFAULT 0,
        policy_snapshot TEXT,       -- JSON: the policy fields that were in effect when applied
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, leave_type_id, to_year),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (leave_type_id) REFERENCES leave_types(id)
      )
    `);
    await db.run('CREATE INDEX idx_rollover_log_user ON leave_balance_rollover_log(user_id, to_year)');
    console.log('[MIGRATIONS] ✓ Created leave_balance_rollover_log + index');
  } catch (error) {
    console.error('[MIGRATIONS] Error creating leave_balance_rollover_log:', error.message);
  }
}

async function normalizeHalfDayAttendanceStatus(db) {
  try {
    // Only run if the table actually exists (fresh installs may not yet).
    const exists = await db.get(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='attendance'"
    );
    if (!exists) {
      console.log('[MIGRATIONS] attendance table not present — skipping half-day normalize');
      return;
    }
    // Match any case-variant of 'halfday' / 'half day' / 'Half-Day' that isn't
    // already the canonical 'Half-day'.
    const result = await db.run(
      `UPDATE attendance
         SET status = 'Half-day', updated_at = CURRENT_TIMESTAMP
       WHERE LOWER(REPLACE(REPLACE(status, ' ', ''), '-', '')) = 'halfday'
         AND status != 'Half-day'`
    );
    const changed = result && result.changes ? result.changes : 0;
    if (changed > 0) {
      console.log(`[MIGRATIONS] ✓ Normalized ${changed} attendance row(s) to 'Half-day'`);
    } else {
      console.log('[MIGRATIONS] Half-day status already normalized');
    }
  } catch (error) {
    console.error('[MIGRATIONS] Error normalizing half-day status:', error.message);
  }
}

async function createChatTablesIfNeeded(db) {
  try {
    // Conversations are the parent — a "chat" between N participants. Today
    // we only create 1:1 direct conversations; the `type` column is here so
    // group chats can be added later without another migration.
    const convExists = await db.get(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='chat_conversations'"
    );
    if (!convExists) {
      console.log('[MIGRATIONS] Creating chat_conversations table...');
      await db.run(`
        CREATE TABLE chat_conversations (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL DEFAULT 'direct',
          name TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_message_at DATETIME
        )
      `);
      console.log('[MIGRATIONS] ✓ Created chat_conversations');
    }

    // Participants — a row per (conversation, user). last_read_at drives the
    // unread badge: messages with sent_at > last_read_at count as unread for
    // that participant.
    const partExists = await db.get(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='chat_participants'"
    );
    if (!partExists) {
      console.log('[MIGRATIONS] Creating chat_participants table...');
      await db.run(`
        CREATE TABLE chat_participants (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_read_at DATETIME,
          FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id),
          FOREIGN KEY (user_id) REFERENCES users(id),
          UNIQUE (conversation_id, user_id)
        )
      `);
      await db.run('CREATE INDEX idx_chat_participants_user ON chat_participants(user_id)');
      console.log('[MIGRATIONS] ✓ Created chat_participants + index');
    }

    // Messages — append-only. content is plain text for now.
    const msgExists = await db.get(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='chat_messages'"
    );
    if (!msgExists) {
      console.log('[MIGRATIONS] Creating chat_messages table...');
      await db.run(`
        CREATE TABLE chat_messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          sender_id TEXT NOT NULL,
          content TEXT NOT NULL,
          sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id),
          FOREIGN KEY (sender_id) REFERENCES users(id)
        )
      `);
      await db.run('CREATE INDEX idx_chat_messages_conv ON chat_messages(conversation_id, sent_at)');
      console.log('[MIGRATIONS] ✓ Created chat_messages + index');
    }
  } catch (error) {
    console.error('[MIGRATIONS] Error creating chat tables:', error.message);
  }
}

async function createEmployeeDocumentsTableIfNeeded(db) {
  try {
    const tableExists = await db.get(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='employee_documents'"
    );

    if (!tableExists) {
      console.log('[MIGRATIONS] Creating employee_documents table...');
      await db.run(`
        CREATE TABLE employee_documents (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          document_type TEXT NOT NULL,
          original_filename TEXT NOT NULL,
          stored_filename TEXT NOT NULL,
          file_size INTEGER,
          mime_type TEXT,
          description TEXT,
          is_confidential INTEGER DEFAULT 0,
          uploaded_by TEXT,
          uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id),
          FOREIGN KEY (uploaded_by) REFERENCES users(id)
        )
      `);
      // Index for fast lookups by employee
      await db.run('CREATE INDEX idx_employee_documents_user ON employee_documents(user_id)');
      console.log('[MIGRATIONS] ✓ Created employee_documents table + index');
    } else {
      console.log('[MIGRATIONS] employee_documents table already exists');
    }
  } catch (error) {
    console.error('[MIGRATIONS] Error creating employee_documents table:', error.message);
  }
}

async function createSalaryIncrementsTableIfNeeded(db) {
  try {
    // Check if salary_increments table already exists
    const tableExists = await db.get(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='salary_increments'"
    );

    if (!tableExists) {
      console.log('[MIGRATIONS] Creating salary_increments table...');
      await db.run(`
        CREATE TABLE salary_increments (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          increment_date DATE NOT NULL,
          previous_salary DECIMAL(12,2) NOT NULL,
          new_salary DECIMAL(12,2) NOT NULL,
          increment_amount DECIMAL(12,2) NOT NULL,
          increment_percentage DECIMAL(5,2),
          reason TEXT,
          approved_by TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `);
      console.log('[MIGRATIONS] ✓ Created salary_increments table');
    } else {
      console.log('[MIGRATIONS] salary_increments table already exists');
    }
  } catch (error) {
    console.error('[MIGRATIONS] Error creating salary_increments table:', error.message);
  }
}

// Adds offboarding metadata columns to users so departures are auditable:
// last_working_day (DATE), exit_reason (TEXT), exit_notes (TEXT). All nullable
// so existing rows are untouched and the status='active'/'inactive' flag keeps
// working as the source of truth.
async function addOffboardingColumnsToUsers(db) {
  try {
    const cols = await db.all("PRAGMA table_info(users)");
    const has = (n) => cols.some(c => c.name === n);

    const additions = [
      ['last_working_day', 'DATE'],
      ['exit_reason',      'TEXT'],
      ['exit_notes',       'TEXT']
    ];
    for (const [col, def] of additions) {
      if (!has(col)) {
        await db.run(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
        console.log(`[MIGRATIONS] ✓ Added users.${col}`);
      }
    }
  } catch (error) {
    console.error('[MIGRATIONS] Error adding offboarding columns:', error.message);
  }
}

// Adds file-attachment columns to chat_messages so DMs can carry images and
// documents. All nullable — text-only messages still work unchanged.
async function addAttachmentColumnsToChatMessages(db) {
  try {
    const tableExists = await db.get(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='chat_messages'"
    );
    if (!tableExists) {
      console.log('[MIGRATIONS] chat_messages missing — skipping attachment columns');
      return;
    }
    const cols = await db.all("PRAGMA table_info(chat_messages)");
    const has = (n) => cols.some(c => c.name === n);

    const additions = [
      ['attachment_path', 'TEXT'],
      ['attachment_name', 'TEXT'],
      ['attachment_size', 'INTEGER'],
      ['attachment_mime', 'TEXT']
    ];
    for (const [col, def] of additions) {
      if (!has(col)) {
        await db.run(`ALTER TABLE chat_messages ADD COLUMN ${col} ${def}`);
        console.log(`[MIGRATIONS] ✓ Added chat_messages.${col}`);
      }
    }
  } catch (error) {
    console.error('[MIGRATIONS] Error adding chat-attachment columns:', error.message);
  }
}

module.exports = { runMigrations };
