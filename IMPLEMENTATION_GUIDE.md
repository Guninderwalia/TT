# TaskTango Implementation Guide

## Complete Build & Deployment Instructions

### Step 1: Environment Setup

**Install Node.js**
1. Download Node.js 16+ from https://nodejs.org/
2. Run installer and complete setup
3. Verify installation:
   ```bash
   node --version
   npm --version
   ```

### Step 2: Install Dependencies

Open PowerShell and navigate to the TaskTango directory:

```powershell
cd C:\Users\GOD\Documents\TaskTango
npm install
```

This installs:
- **react** & **react-dom**: UI framework
- **electron**: Desktop application framework
- **sqlite3**: Local database
- **bcryptjs**: Password encryption
- **date-fns**: Date utilities

### Step 3: Development Build (Testing)

**Option A: Hot-Reload Development**
```bash
npm run electron-dev
```

This starts:
- React dev server on http://localhost:3000
- Electron application window
- Live code reloading
- DevTools console access

**Option B: Production Build (Local Testing)**
```bash
npm run react-build
npm run electron-build
```

### Step 4: Production Build (.exe Installer)

**Build Windows Installer**
```bash
npm run build-exe
```

This process:
1. Builds optimized React bundle
2. Compiles Electron application
3. Creates NSIS installer
4. Outputs to `dist/` directory

**Output Files**
- `dist/TaskTango Setup 1.0.0.exe` - Main installer
- `dist/TaskTango 1.0.0.exe` - Portable executable
- `dist/latest.yml` - Update manifest

### Step 5: Distribution

**Installation via Installer**
1. Double-click `TaskTango Setup 1.0.0.exe`
2. Accept license
3. Choose installation location
4. Create Start menu shortcuts
5. Create desktop shortcut
6. Complete installation

**First Launch**
- Application creates database in `%APPDATA%\TaskTango\`
- Seeds initial demo data
- Displays login screen

---

## Project Architecture Deep Dive

### Electron Lifecycle

```
[User Starts App]
         ↓
[main.js] → [initializeDatabase()]
         ↓
[Create BrowserWindow]
         ↓
[Load http://localhost:3000 or build/index.html]
         ↓
[preload.js] → [Context Isolation Bridge]
         ↓
[React App Loads] → [window.electron API Available]
         ↓
[User Interacts] → [IPC Call to Handlers]
         ↓
[Handlers Query/Modify Database]
         ↓
[Return Results to React Component]
```

### IPC Message Flow

```
React Component
    ↓
window.electron.method()
    ↓
ipcRenderer.invoke()
    ↓
preload.js → contextBridge.exposeInMainWorld()
    ↓
ipcMain.handle() → Handler Function
    ↓
Database Operations
    ↓
Return Result
    ↓
React State Update
    ↓
UI Re-render
```

### Database Access Pattern

```
Handler receives IPC message
    ↓
Validate user permissions (RBAC)
    ↓
Construct SQL query
    ↓
Execute on SQLite connection
    ↓
Handle errors/edge cases
    ↓
Log action to audit_logs
    ↓
Return result to client
```

---

## Customization Guide

### Adding a New Field to Employee Profile

1. **Database Schema** (`src/db/schema.sql`)
```sql
ALTER TABLE users ADD COLUMN middle_name TEXT;
```

2. **IPC Handler** (`src/main/handlers/employeeHandlers.js`)
```javascript
await db.run(
  `UPDATE users SET middle_name = ? WHERE id = ?`,
  [middleName, userId]
);
```

3. **React Component** (`src/renderer/components/admin/EmployeeManager.jsx`)
```jsx
<div className="form-group">
  <label>Middle Name</label>
  <input type="text" value={middleName} onChange={...} />
</div>
```

### Adding a New Leave Type

1. **Database Seed** (`src/db/init.js`)
```javascript
await db.run(
  'INSERT INTO leave_types (id, name, annual_entitlement) VALUES (?, ?, ?)',
  [uuidv4(), 'Maternity Leave', 180]
);
```

2. **Automatic in Leave Request Form** - Component fetches from database dynamically

### Changing Business Logic

**Example: Adjust Late Threshold from 9:00 AM to 9:30 AM**

File: `src/main/handlers/attendanceHandlers.js`
```javascript
// Change this line:
const isLate = hours > 9 || (hours === 9 && minutes > 0);

// To this:
const isLate = hours > 9 || (hours === 9 && minutes > 30);
```

---

## Security Checklist

### For Production Deployment

- [ ] Change demo credentials
  ```javascript
  // In src/db/init.js, modify seed data
  const adminPassword = await bcrypt.hash('YourSecurePassword', 10);
  ```

- [ ] Enable HTTPS (if syncing externally)
  - Configure SSL certificates
  - Update API endpoints

- [ ] Database Encryption
  - SQLite3 can use encryption
  - Consider adding encryption layer

- [ ] Update Package Checksums
  ```bash
  npm audit
  npm update
  ```

- [ ] Code Signing for Installer
  - Obtain code signing certificate
  - Update electron-builder config

### Access Control Review

**Admin Access** ✓
- All employees, payroll, departments, audit logs

**Department Lead Access** ✓
- Own department employees only
- Leave approvals for own department
- Team attendance for own department

**Employee Access** ✓
- Own profile data only
- Own attendance history
- Own leave requests
- Own payslips

---

## Performance Optimization

### Database Optimization

Already implemented:
- Indexes on `user_id`, `date`, `department_id`
- Foreign key constraints
- Connection pooling

For additional optimization:
```javascript
// Add indexes for custom queries
CREATE INDEX idx_custom ON table_name(column_name);
```

### React Optimization

- Component memoization for large lists
- Lazy loading of dashboard components
- Virtual scrolling for big tables

### Electron Optimization

- Preload scripts for faster startup
- Native modules compiled for Windows
- Code splitting for initial bundle

---

## Testing Workflows

### Admin Testing

1. **Create Department**
   - Admin → Departments → Create Department
   - Assign department lead
   - Verify in database

2. **Bulk Import Employees**
   - Prepare CSV: username, fullName, email, departmentId, baseSalary
   - Admin → Employees → Import CSV
   - Verify audit log

3. **Process Payroll**
   - Admin → Payroll → Select Month/Year
   - Click "Process Payroll"
   - Verify calculations for each employee

### Lead Testing

1. **Approve Leave Request**
   - Login as department lead
   - Employee submits leave request
   - Lead reviews in "Leave Approvals" tab
   - Approve → Check employee balance updated

2. **Review Team Attendance**
   - Lead → Team Attendance
   - Select date
   - View all employees' sign-in/out times

### Employee Testing

1. **Daily Attendance**
   - Employee → Attendance → Sign In
   - Work during day
   - Employee → Attendance → Sign Out
   - Verify hours calculated

2. **Request Leave**
   - Employee → Leave Requests
   - Select leave type & dates
   - Submit with reason
   - Wait for lead approval
   - Check balance updated

---

## Troubleshooting Common Issues

### Issue: Database Locked
**Cause**: Multiple processes accessing database
**Solution**:
```powershell
# Restart the application
# Or delete and recreate database:
Remove-Item $env:APPDATA\TaskTango\tasktango.db
```

### Issue: Port 3000 Already In Use (Development)
**Solution**:
```powershell
Get-NetTCPConnection -LocalPort 3000 | Stop-Process -Force
```

### Issue: Electron Won't Start
**Solution**:
```bash
# Clear electron cache and rebuild
rm -r node_modules
npm install
npm run electron-dev
```

### Issue: Password Hash Errors
**Solution**: Ensure bcryptjs installed correctly
```bash
npm install bcryptjs --save
```

---

## Advanced Features to Implement

### 1. Data Export (Excel/PDF)
```javascript
// Using xlsx library for Excel export
import XLSX from 'xlsx';

const exportToExcel = (data, filename) => {
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
  XLSX.writeFile(workbook, filename);
};
```

### 2. Email Notifications
```javascript
// Using nodemailer
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user, pass }
});

await transporter.sendMail({
  to: employee.email,
  subject: 'Leave Approved',
  html: '<p>Your leave request has been approved</p>'
});
```

### 3. Biometric Integration
```javascript
// Using Windows Hello API
const authenticator = require('windows-hello-authenticator');

const authenticated = await authenticator.authenticate();
```

### 4. Multi-site Support
```javascript
// Modify schema to include site_id
ALTER TABLE departments ADD COLUMN site_id TEXT;
ALTER TABLE users ADD COLUMN site_id TEXT;

// Add RBAC for Site Admin role
```

---

## Migration Guide (Old System to TaskTango)

### Data Migration Steps

1. **Export from Old System**
   - Employee list (name, email, department, salary)
   - Attendance records (date, hours)
   - Payroll history (month, amount)

2. **Create CSV Format**
   ```csv
   username,fullName,email,departmentId,baseSalary
   john.doe,John Doe,john@company.com,dept1,50000
   jane.smith,Jane Smith,jane@company.com,dept2,55000
   ```

3. **Import via Admin Panel**
   - Admin → Employees → Import CSV
   - System creates accounts with default password
   - Notify employees to change password on first login

4. **Verify Data**
   - Check audit logs for import records
   - Validate all employees present
   - Verify department assignments

---

## Version Upgrade Guide

### Updating to New Versions

1. **Backup Current Database**
   ```powershell
   Copy-Item "$env:APPDATA\TaskTango\tasktango.db" "$env:APPDATA\TaskTango\backup.db"
   ```

2. **Download New .exe Installer**

3. **Run Installer**
   - Old database preserved
   - New code deployed
   - Schema migrations applied automatically

4. **Verify After Update**
   - Login successful
   - Data intact
   - All features working

---

## Support & Documentation

- **Code Comments**: All handlers documented
- **Function Signatures**: Clear parameter types
- **Error Messages**: User-friendly feedback
- **Audit Trail**: Complete action history

---

**Last Updated**: 2026-05-17  
**Version**: 1.0.0  
**Status**: Production Ready ✅
