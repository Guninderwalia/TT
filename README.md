# TaskTango - Enterprise HR & Employee Management System

A production-grade Windows desktop CRM and employee management application built with Electron, React, and SQLite.

## 🎯 Overview

TaskTango is a comprehensive offline-first HR management system featuring:

- **Three-Tier Role-Based Access Control (RBAC)**
  - Admin: Full system control
  - Department Lead: Managerial oversight of their department
  - Employee: Personal dashboard with limited access

- **Core Features**
  - Attendance tracking with automatic late/early calculations
  - Intelligent leave management with approval workflows
  - Comprehensive payroll with deductions and probation deposits
  - Performance KPIs and analytics
  - Immutable audit logging for compliance
  - Secure offline SQLite database

## 📋 Quick Start

### Prerequisites
- Node.js 16+ ([Download](https://nodejs.org/))
- Windows 10/11 (64-bit)
- 4GB RAM minimum

### Demo Credentials
```
Admin:     admin / admin123
Lead:      john_lead / lead123
Employee:  sarah_emp / user123
```

### Installation & Development

1. **Clone/Extract the project**
   ```bash
   cd C:\Users\GOD\Documents\TaskTango
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start development mode**
   ```bash
   npm run electron-dev
   ```
   This will open the application in development mode with access to DevTools.

### Building for Production

**Build standalone Windows installer (.exe):**

```bash
npm run build-exe
```

This will:
1. Build the React frontend
2. Package everything with Electron
3. Create a Windows installer in `dist/` folder

The installer creates:
- Start menu shortcuts
- Desktop shortcut
- Uninstaller
- Local SQLite database in `%APPDATA%\TaskTango\`

## 🏗️ Project Structure

```
TaskTango/
├── src/
│   ├── main/
│   │   ├── main.js                 # Electron main process
│   │   ├── preload.js              # Secure IPC bridge
│   │   └── handlers/               # IPC handlers
│   │       ├── authHandlers.js
│   │       ├── attendanceHandlers.js
│   │       ├── payrollHandlers.js
│   │       ├── leaveHandlers.js
│   │       ├── employeeHandlers.js
│   │       ├── departmentHandlers.js
│   │       └── auditHandlers.js
│   │
│   ├── db/
│   │   ├── init.js                 # Database initialization
│   │   └── schema.sql              # Database schema
│   │
│   └── renderer/
│       ├── App.jsx                 # Main React component
│       ├── index.js                # React entry point
│       ├── pages/
│       │   ├── LoginPage.jsx
│       │   ├── AdminDashboard.jsx
│       │   ├── LeadDashboard.jsx
│       │   └── EmployeeDashboard.jsx
│       ├── components/
│       │   ├── Sidebar.jsx
│       │   ├── admin/              # Admin-specific components
│       │   ├── lead/               # Lead-specific components
│       │   └── employee/           # Employee-specific components
│       └── styles/                 # CSS stylesheets
│
├── public/
│   └── index.html                  # HTML template
│
├── package.json                    # Dependencies & scripts
└── README.md                       # This file
```

## 🔐 Security Features

### Authentication & Authorization
- **Bcrypt Password Hashing**: Industry-standard password encryption
- **Role-Based Access Control**: Three distinct permission levels
- **Session Management**: Secure user session tracking
- **IPC Security**: Context isolation prevents main process access

### Data Protection
- **Immutable Audit Logs**: All critical actions logged with timestamp, user, and changes
- **SQLite Encryption**: Local database stored securely
- **Offline-First**: No data transmitted externally
- **PRAGMA foreign_keys = ON**: Referential integrity enforcement

### Compliance
- **GDPR Ready**: No external data sharing
- **SOX Compliance**: Complete audit trail for financial operations
- **Data Integrity**: Transaction-based operations with rollback support

## 💼 Business Logic Implementation

### Attendance Engine
```
- 6-day work week (Mon-Sat), Sunday off
- Late threshold: 9:00 AM
- Early departure: Before 5:00 PM
- Automatic deduction calculations
- Public holiday recognition
```

### Payroll Calculations
```
Monthly Deductions:
- Absent Days: Full day's salary
- Half Days: 50% of day's salary
- Late/Early Hours: Hourly rate deduction
- Probation Deposit (First 2 months): Automatic hold

Additions:
- Overtime hours (configurable multiplier)
- Manual bonuses & reimbursements
- Department-specific adjustments
```

### Leave Management
```
- Pro-rata allocation for mid-year starts
- Multiple leave types (Annual, Sick, Casual)
- Department Lead approval workflow
- Year-end carry-forward policy
- Automatic balance updates on approval
```

### Probation Security Deposits
```
- Calculated as percentage of salary during probation
- Held in separate balance until probation end
- Automatically released on confirmation
- Visible only to Admin users
```

## 📊 Database Schema

### Core Tables
- **users**: Employee accounts with role assignments
- **roles**: Admin, Lead, User role definitions
- **departments**: Organizational units with lead assignments
- **employment_records**: Job details (start date, salary, probation status)

### Operations
- **attendance**: Daily sign-in/out records with calculations
- **overtime**: Overtime hours with approval status
- **payroll**: Monthly salary calculations
- **leave_requests**: Leave applications with approval workflow
- **leave_balances**: Year-wise leave entitlements

### Compliance
- **audit_logs**: Immutable record of all critical operations
- **banking_details**: Secure employee banking information
- **probation_deposits**: Security deposit tracking
- **notifications**: System alerts for pending actions

## 🚀 Key Features

### Admin Dashboard
- Full employee CRUD operations
- Bulk CSV import for employees
- Department & team management
- Monthly payroll processing
- Security deposit management
- System-wide audit logs
- Holiday definitions

### Department Lead Portal
- Team attendance overview
- Leave request approval hub
- Team performance analytics
- KPI tracking
- Attendance history review

### Employee Self-Service
- Daily sign-in/sign-out logging
- Leave request submission
- Leave balance visibility
- Personal payslip access
- Attendance history
- Performance KPI dashboard

## 📈 Advanced Features

### KPI Tracking
- Automatic punctuality scoring based on attendance
- Task completion rates
- Tenure calculations from hire date
- Team performance benchmarking

### Notifications
- Leave approval/rejection alerts
- Probation end reminders
- System maintenance notifications
- Department announcements

### Export & Reporting
- CSV export of employee data
- Payroll reports by month/department
- Attendance summaries
- Audit trail exports

## 🔧 Configuration

### Environment Variables
Create `.env` file in project root:
```env
NODE_ENV=production
ELECTRON_ENABLE_REMOTE_MODULE=false
```

### Database Location
- **Windows**: `%APPDATA%\TaskTango\tasktango.db`
- **Backup**: Manually copy the database file

## 🛠️ Development Tips

### Adding a New Component
1. Create file in appropriate `components/` folder
2. Import required hooks (useState, useEffect)
3. Use `window.electron.*` APIs for backend communication
4. Test in development mode before building

### Extending Database
1. Modify `src/db/schema.sql` with new tables
2. Update IPC handlers for new operations
3. Add database queries in handler functions
4. Restart application to apply changes

### Styling
- CSS custom properties defined in `app.css`
- Dark theme with gold accents
- Responsive design (768px breakpoint)
- Hover states for all interactive elements

## 🧪 Testing the Application

### Initial Setup
1. Login with demo credentials
2. Admin: Create new employees & departments
3. Lead: Review team attendance & approve leaves
4. Employee: Submit leave requests & view payslip

### Critical Workflows
1. **Attendance**: Sign in/out daily to test calculations
2. **Leave**: Request leave → Lead approves → Balance updates
3. **Payroll**: Process monthly → View deductions
4. **Audit**: All actions logged in Admin > Audit Logs

## 📦 Distribution

### Installer Details
- Single .exe file (~150MB with all dependencies)
- No external dependencies required
- Self-contained with embedded Node runtime
- Auto-updates can be configured

### System Requirements
- Windows 10/11 (x64)
- .NET Framework 4.5+
- 500MB disk space minimum
- No internet connection required

## ⚠️ Important Notes

### Data Integrity
- **Never** modify the database directly
- Always use the application UI for changes
- Database backups stored in AppData folder
- Use audit logs for compliance verification

### Offline Operation
- Application works 100% offline
- No cloud sync (by design)
- All data stays on local machine
- Manual backups recommended

### Performance
- Optimized for 500+ employees
- Indexes on frequently queried fields
- Connection pooling for database
- Lazy loading of heavy components

## 🐛 Troubleshooting

### Database Connection Error
```bash
# Delete corrupted database and reinitialize
rm %APPDATA%\TaskTango\tasktango.db
# Restart application
```

### Port Conflict (Development)
```bash
# Kill process using port 3000
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

### Build Fails
```bash
# Clean and reinstall
rm -r node_modules package-lock.json
npm install
npm run build-exe
```

## 📞 Support

For issues or feature requests:
1. Check the audit logs for error details
2. Review database integrity
3. Verify user permissions match expected role

## 📄 License

This application is proprietary software. All rights reserved.

---

**Build Version**: 1.0.0  
**Last Updated**: 2026-05-17  
**Status**: Production Ready ✅
