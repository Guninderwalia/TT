# Admin Time Logging - Quick Reference

## File Locations
```
Component:  src/components/admin/AdminTimeLogging.jsx
Styles:     src/styles/admin-timelogging.css
Dashboard:  src/pages/AdminDashboard.jsx (updated)
```

## Component Props
None - this is a standalone admin component

## Key State Variables
| Variable | Type | Purpose |
|----------|------|---------|
| selectedEmployee | string | Currently selected employee ID |
| selectedDepartment | string | Currently selected department ID |
| timeLogs | array | All loaded time logs |
| filteredLogs | array | Logs after search filtering |
| summary | object | Summary statistics |
| editingId | string | ID of log being edited |
| deleteConfirmId | string | ID awaiting deletion confirmation |

## Key Functions

### Data Loading
- `loadDepartments()` - Fetch all departments
- `loadEmployees(deptId)` - Fetch employees by department
- `loadTimeLogs()` - Fetch logs for selected date range

### Calculations
- `calculateSummary(logs)` - Compute total hours, breaks, days, average
- `calculateTotalHours(log)` - Total hours worked (start to end)
- `calculateNetHours(log)` - Hours minus break time
- `calculateBreakDuration(log)` - Break time in hours

### UI Operations
- `startEdit(log)` - Activate inline edit mode
- `saveEdit()` - Save edited log to DB
- `deleteLog()` - Delete log after confirmation
- `cancelEdit()` - Exit edit mode without saving
- `getStatus(log)` - Get current status string
- `getStatusClass(status)` - Get CSS class for status badge
- `getHourColor(hours)` - Get CSS class for hour color coding

## Navigation Integration

### Sidebar Configuration
Time Logging appears in admin sidebar:
- Label: "Time Logging"
- Icon: "clock"
- Path: "/timelogging"
- Position: After Attendance, before Payroll

### Route Configuration
Route added to AdminDashboard:
```javascript
<Route path="/timelogging/*" element={<AdminTimeLogging />} />
```

## Summary
Complete admin time logging management system with filtering, editing, deletion, and statistics.
