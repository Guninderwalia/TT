-- TaskTango Database Schema
-- Production-grade HR & CRM System with RBAC and Full Audit Trail

-- ========== ROLES & USERS ==========
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
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

-- ========== DEPARTMENTS & TEAMS ==========
CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  lead_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES users(id)
);

-- ========== EMPLOYMENT ==========
CREATE TABLE IF NOT EXISTS employment_records (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  employment_type TEXT NOT NULL DEFAULT 'Permanent',
  base_salary DECIMAL(12,2) NOT NULL,
  currency TEXT DEFAULT 'INR',
  is_probation BOOLEAN DEFAULT 1,
  probation_end_date DATE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ========== BANKING & FINANCIAL ==========
CREATE TABLE IF NOT EXISTS banking_details (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL,
  bank_name TEXT,
  account_number TEXT,
  account_holder TEXT,
  ifsc_code TEXT,
  routing_code TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ========== ATTENDANCE ==========
CREATE TABLE IF NOT EXISTS attendance (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date DATE NOT NULL,
  sign_in_time TIME,
  sign_out_time TIME,
  status TEXT NOT NULL DEFAULT 'Present',
  hours_worked DECIMAL(5,2),
  is_late BOOLEAN DEFAULT 0,
  late_hours DECIMAL(5,2) DEFAULT 0,
  is_early_departure BOOLEAN DEFAULT 0,
  early_departure_hours DECIMAL(5,2) DEFAULT 0,
  is_half_day BOOLEAN DEFAULT 0,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, date),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ========== OVERTIME ==========
CREATE TABLE IF NOT EXISTS overtime (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date DATE NOT NULL,
  hours DECIMAL(5,2) NOT NULL,
  rate_multiplier DECIMAL(3,1) DEFAULT 1.5,
  amount DECIMAL(12,2),
  status TEXT DEFAULT 'pending',
  approved_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (approved_by) REFERENCES users(id)
);

-- ========== HOLIDAYS & PUBLIC HOLIDAYS ==========
CREATE TABLE IF NOT EXISTS public_holidays (
  id TEXT PRIMARY KEY,
  holiday_name TEXT NOT NULL,
  date DATE UNIQUE NOT NULL,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ========== LEAVE MANAGEMENT ==========
CREATE TABLE IF NOT EXISTS leave_types (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  annual_entitlement INTEGER NOT NULL DEFAULT 25,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS leave_balances (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  leave_type_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  total_allocated INTEGER NOT NULL,
  used INTEGER DEFAULT 0,
  carried_forward INTEGER DEFAULT 0,
  remaining INTEGER NOT NULL,
  manual_override BOOLEAN DEFAULT 0,  -- 1 = admin has set this manually; getBalance skips the auto recompute
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, leave_type_id, year),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (leave_type_id) REFERENCES leave_types(id)
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  leave_type_id TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days_count INTEGER NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'pending',
  requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  approved_by TEXT,
  approved_at DATETIME,
  rejected_reason TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (leave_type_id) REFERENCES leave_types(id),
  FOREIGN KEY (approved_by) REFERENCES users(id)
);

-- ========== PROBATION & SECURITY DEPOSIT ==========
CREATE TABLE IF NOT EXISTS probation_deposits (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL,
  deposit_amount DECIMAL(12,2) NOT NULL,
  deduction_start_month INTEGER NOT NULL,
  deduction_end_month INTEGER NOT NULL,
  status TEXT DEFAULT 'held',
  released_date DATE,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ========== PAYROLL & EXPENSES ==========
CREATE TABLE IF NOT EXISTS payroll (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  payroll_month TEXT NOT NULL,
  payroll_year INTEGER NOT NULL,
  base_salary DECIMAL(12,2) NOT NULL,
  overtime_amount DECIMAL(12,2) DEFAULT 0,
  bonus_amount DECIMAL(12,2) DEFAULT 0,
  reimbursement_amount DECIMAL(12,2) DEFAULT 0,
  attendance_deduction DECIMAL(12,2) DEFAULT 0,
  probation_deposit_deduction DECIMAL(12,2) DEFAULT 0,
  other_deductions DECIMAL(12,2) DEFAULT 0,
  gross_amount DECIMAL(12,2) NOT NULL,
  net_amount DECIMAL(12,2) NOT NULL,
  status TEXT DEFAULT 'Pending',
  processed_date DATETIME,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, payroll_month, payroll_year),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS monthly_expenses (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  payroll_id TEXT,
  category TEXT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (payroll_id) REFERENCES payroll(id)
);

-- ========== TIME LOGGING & EVENTS ==========
CREATE TABLE IF NOT EXISTS time_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date DATE NOT NULL,
  start_time TIME,
  break_start_time TIME,
  break_end_time TIME,
  end_time TIME,
  total_hours DECIMAL(5,2),
  break_duration DECIMAL(5,2),
  net_hours DECIMAL(5,2),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, date),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date DATE NOT NULL,
  time TIME NOT NULL,
  activity_type TEXT NOT NULL,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ========== APPROVALS & WORKFLOWS ==========
CREATE TABLE IF NOT EXISTS approval_requests (
  id TEXT PRIMARY KEY,
  request_type TEXT NOT NULL,
  request_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  assigned_to TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME,
  notes TEXT,
  FOREIGN KEY (requested_by) REFERENCES users(id),
  FOREIGN KEY (assigned_to) REFERENCES users(id)
);

-- ========== MANAGER REVIEWS & SKILLS ==========
CREATE TABLE IF NOT EXISTS manager_reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  manager_id TEXT,
  rating INTEGER NOT NULL,
  comments TEXT,
  review_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (manager_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS predefined_skills (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  category TEXT DEFAULT 'soft',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS employee_skills (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  rating INTEGER NOT NULL,
  assessed_by TEXT,
  assessment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, skill_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (skill_id) REFERENCES predefined_skills(id),
  FOREIGN KEY (assessed_by) REFERENCES users(id)
);

-- ========== AUDIT LOG ==========
CREATE TABLE IF NOT EXISTS audit_logs (
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

-- ========== SYSTEM NOTIFICATIONS ==========
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  type TEXT NOT NULL,
  related_id TEXT,
  is_read BOOLEAN DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ========== INDEXES FOR PERFORMANCE ==========
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_department_id ON users(department_id);
CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance(user_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance(status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_user ON leave_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_payroll_user_month ON payroll(user_id, payroll_month, payroll_year);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_time_logs_user_date ON time_logs(user_id, date);
CREATE INDEX IF NOT EXISTS idx_events_user_date ON events(user_id, date);
CREATE INDEX IF NOT EXISTS idx_events_activity ON events(activity_type);
