# Time Logging System - Architecture & Design

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        TASK TANGO APPLICATION                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              REACT FRONTEND LAYER                        │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │                                                           │   │
│  │  ┌──────────────────────────────────────────────────┐    │   │
│  │  │     EmployeeDashboard (Main Container)          │    │   │
│  │  │     - Routes & Navigation                        │    │   │
│  │  │     - Dashboard Overview                         │    │   │
│  │  └──────────────────────────────────────────────────┘    │   │
│  │                      │                                    │   │
│  │                      ▼                                    │   │
│  │  ┌──────────────────────────────────────────────────┐    │   │
│  │  │      TimeLogging Component (20KB)               │    │   │
│  │  │  ┌────────────────────────────────────────────┐ │    │   │
│  │  │  │  Date Picker Section                       │ │    │   │
│  │  │  │  - Select date (any past date or today)   │ │    │   │
│  │  │  └────────────────────────────────────────────┘ │    │   │
│  │  │  ┌────────────────────────────────────────────┐ │    │   │
│  │  │  │  Time Input Form                           │ │    │   │
│  │  │  │  - Start Time (HH:MM)                      │ │    │   │
│  │  │  │  - Break Start Time (HH:MM) [optional]    │ │    │   │
│  │  │  │  - Break End Time (HH:MM) [optional]      │ │    │   │
│  │  │  │  - End/Finish Time (HH:MM)                │ │    │   │
│  │  │  │  - [Submit Button]                         │ │    │   │
│  │  │  └────────────────────────────────────────────┘ │    │   │
│  │  │  ┌────────────────────────────────────────────┐ │    │   │
│  │  │  │  Calculations Section                      │ │    │   │
│  │  │  │  - Total Working Hours                    │ │    │   │
│  │  │  │  - Total Break Duration                  │ │    │   │
│  │  │  │  - Net Working Hours (working - break)   │ │    │   │
│  │  │  │  - Current Status                         │ │    │   │
│  │  │  └────────────────────────────────────────────┘ │    │   │
│  │  │  ┌────────────────────────────────────────────┐ │    │   │
│  │  │  │  History Section                           │ │    │   │
│  │  │  │  - Log Display                             │ │    │   │
│  │  │  │  - Duration Stats                          │ │    │   │
│  │  │  │  - [Edit] [Delete] Buttons                │ │    │   │
│  │  │  │  - Edit Form (Inline)                     │ │    │   │
│  │  │  │  - Delete Confirmation Dialog             │ │    │   │
│  │  │  └────────────────────────────────────────────┘ │    │   │
│  │  │                                                   │    │   │
│  │  │  State Management:                               │    │   │
│  │  │  - selectedDate (YYYY-MM-DD)                     │    │   │
│  │  │  - timeLog (form inputs)                         │    │   │
│  │  │  - timeLogs (history array)                      │    │   │
│  │  │  - editingId (current edit)                      │    │   │
│  │  │  - validationErrors (error map)                  │    │   │
│  │  │  - loading (async state)                         │    │   │
│  │  └──────────────────────────────────────────────────┘    │   │
│  │                                                           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                      │                                          │
│                      ▼ IPC Communication                        │
├─────────────────────────────────────────────────────────────────┤
│                  ELECTRON IPC BRIDGE                             │
│  - Secure sandboxed communication                              │
│  - No direct Node.js access from frontend                      │
│  - Type-safe handler invocation                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │           ELECTRON MAIN PROCESS (Backend)               │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │                                                           │   │
│  │  ┌──────────────────────────────────────────────────┐    │   │
│  │  │  IPC Handlers (5 main functions)                │    │   │
│  │  │                                                  │    │   │
│  │  │  1. timelogging:createTimeLog                  │    │   │
│  │  │     - Create new or update existing log        │    │   │
│  │  │     - Validates on backend                     │    │   │
│  │  │     - Logs to audit trail                      │    │   │
│  │  │                                                  │    │   │
│  │  │  2. timelogging:getTimeLogs                    │    │   │
│  │  │     - Retrieve logs by date range              │    │   │
│  │  │     - Filters by user ID                       │    │   │
│  │  │     - Returns array of logs                    │    │   │
│  │  │                                                  │    │   │
│  │  │  3. timelogging:updateTimeLog                  │    │   │
│  │  │     - Update specific log by ID                │    │   │
│  │  │     - Backend validation                       │    │   │
│  │  │     - Audit logging                            │    │   │
│  │  │                                                  │    │   │
│  │  │  4. timelogging:deleteTimeLog                  │    │   │
│  │  │     - Remove log by ID                         │    │   │
│  │  │     - Soft or hard delete                      │    │   │
│  │  │     - Audit trail entry                        │    │   │
│  │  │                                                  │    │   │
│  │  │  5. timelogging:getUserTimeLogs                │    │   │
│  │  │     - Get logs for specific month/year         │    │   │
│  │  │     - For payroll processing                   │    │   │
│  │  └──────────────────────────────────────────────────┘    │   │
│  │                                                           │   │
│  │  ┌──────────────────────────────────────────────────┐    │   │
│  │  │  SimpleStore (Data Management)                  │    │   │
│  │  │  - JSON-based storage                           │    │   │
│  │  │  - File I/O operations                          │    │   │
│  │  │  - Data persistence                             │    │   │
│  │  └──────────────────────────────────────────────────┘    │   │
│  │          │                                                │   │
│  │          ▼                                                │   │
│  │  ┌──────────────────────────────────────────────────┐    │   │
│  │  │  Audit System                                   │    │   │
│  │  │  - Log all CREATE operations                    │    │   │
│  │  │  - Log all UPDATE operations                    │    │   │
│  │  │  - Log all DELETE operations                    │    │   │
│  │  │  - Timestamp every action                       │    │   │
│  │  └──────────────────────────────────────────────────┘    │   │
│  │                                                           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                      │                                          │
│                      ▼ File I/O                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │            PERSISTENT DATA STORAGE                      │   │
│  │  Location: <userData>/data/store.json                  │   │
│  │                                                           │   │
│  │  {                                                       │   │
│  │    "timeLogs": [                                        │   │
│  │      {                                                  │   │
│  │        "id": "1684927392019",                          │   │
│  │        "userId": "3",                                  │   │
│  │        "date": "2024-05-24",                           │   │
│  │        "startTime": "09:00",                           │   │
│  │        "breakStartTime": "12:00",                      │   │
│  │        "breakEndTime": "13:00",                        │   │
│  │        "endTime": "18:00",                             │   │
│  │        "createdAt": "2024-05-24T09:00:00.000Z",       │   │
│  │        "updatedAt": "2024-05-24T09:00:00.000Z"        │   │
│  │      },                                                 │   │
│  │      ...                                                │   │
│  │    ],                                                  │   │
│  │    "auditLogs": [...]                                  │   │
│  │  }                                                       │   │
│  │                                                           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Component Hierarchy

```
App
├── LoginPage
├── AdminDashboard
├── LeadDashboard
└── EmployeeDashboard ✓ (Active for employees)
    ├── Sidebar
    │   ├── Dashboard (route: /)
    │   ├── Time Logging (route: /timelogging) ← NEW!
    │   ├── Attendance (route: /attendance)
    │   ├── Leave Requests (route: /leave)
    │   └── Payslips (route: /payslip)
    │
    └── Dashboard Content
        ├── EmployeeOverview
        │   ├── Profile Card
        │   └── Stats Grid
        │       ├── [Log Your Time] Card ← QUICK ACCESS
        │       ├── Leave Balance Cards
        │       ├── Punctuality Card
        │       └── Performance Card
        │
        └── Routes
            ├── EmployeeOverview (/)
            ├── TimeLogging (/timelogging) ← NEW!
            │   ├── Date Picker
            │   ├── Time Input Form
            │   ├── Calculations Display
            │   └── History List
            ├── AttendanceLogger (/attendance)
            ├── LeaveRequestForm (/leave)
            └── PayslipViewer (/payslip)
```

## Data Flow Diagram

```
User Action (Input Time)
        │
        ▼
┌───────────────────────┐
│ Validate on Client    │
│ - Check required      │
│ - Check ordering      │
│ - Check constraints   │
└───────────────────────┘
        │
    ┌───┴──────┐
    │           │
  ✓ Valid    ✗ Invalid
    │           │
    │           ▼
    │      ┌─────────────────────┐
    │      │ Show Error Messages │
    │      │ Disable Submit      │
    │      └─────────────────────┘
    │
    ▼
┌───────────────────────────────────┐
│ Call IPC Handler                  │
│ window.electron.createTimeLog()   │
└───────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────┐
│ Electron Main Process             │
│ - Check for existing log          │
│ - Create or update                │
│ - Save to store.json              │
│ - Log to audit trail              │
└───────────────────────────────────┘
        │
    ┌───┴──────┐
    │           │
  ✓ Success  ✗ Error
    │           │
    │           ▼
    │      ┌─────────────────────┐
    │      │ Return Error Message│
    │      │ Show in UI          │
    │      └─────────────────────┘
    │
    ▼
┌───────────────────────────────────┐
│ Update Component State            │
│ - Clear form                      │
│ - Load updated logs               │
│ - Show success message            │
│ - Refresh calculations            │
└───────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────┐
│ Re-render Component               │
│ - Show updated history            │
│ - Display new calculations        │
│ - Clear validations               │
└───────────────────────────────────┘
```

## State Management Flow

```
Component State
├── selectedDate (string: YYYY-MM-DD)
│   └── User selects date via date picker
│   └── Triggers loadTimeLogs()
│
├── timeLog (object: form values)
│   ├── startTime (string: HH:MM)
│   ├── breakStartTime (string: HH:MM)
│   ├── breakEndTime (string: HH:MM)
│   └── endTime (string: HH:MM)
│   └── User changes values
│   └── Triggers validation
│
├── timeLogs (array: history)
│   └── Loaded from API
│   └── Updated after submit/delete
│
├── editingId (string: log ID or null)
│   └── User clicks Edit
│   └── Sets ID and editValues
│
├── editValues (object: temp edit data)
│   └── Used during inline editing
│   └── Cleared on save/cancel
│
├── validationErrors (object: error map)
│   ├── startTime: "message"
│   ├── endTime: "message"
│   └── Updates on every input change
│
├── successMessage (string: message or empty)
│   └── Shown after successful operation
│   └── Auto-clears after 3 seconds
│
├── showDeleteConfirm (string: log ID or null)
│   └── Used for delete confirmation dialog
│
└── loading (boolean)
    └── true during API calls
    └── Disables buttons during loading
```

## Validation Rules Engine

```
validateTimes(timeObject) {
    errors = {}
    
    // Required fields
    if (!startTime) errors.startTime = "Required"
    if (!endTime) errors.endTime = "Required"
    
    // Time ordering
    if (startTime >= endTime) 
        errors.endTime = "Must be after start"
    
    // Break validation
    if (breakStartTime && !breakEndTime)
        errors.breakEndTime = "Required if start time set"
    if (breakEndTime && !breakStartTime)
        errors.breakStartTime = "Required if end time set"
    
    // Break ordering
    if (breakStartTime && breakEndTime) {
        if (breakStartTime >= breakEndTime)
            errors.breakEndTime = "Must be after break start"
        
        // Break within work hours
        if (breakStartTime < startTime)
            errors.breakStartTime = "Cannot start before work"
        if (breakEndTime > endTime)
            errors.breakEndTime = "Cannot end after work"
    }
    
    return errors
}
```

## Calculation Engine

```
calculateDurations(times) {
    // Convert to minutes for accuracy
    startDate = new Date(`2000-01-01T${times.startTime}`)
    endDate = new Date(`2000-01-01T${times.endTime}`)
    
    // Calculate working minutes
    workingMinutes = (endDate - startDate) / (1000 * 60)
    workingHours = workingMinutes / 60
    
    // Calculate break
    let breakMinutes = 0
    if (times.breakStartTime && times.breakEndTime) {
        breakStart = new Date(`2000-01-01T${times.breakStartTime}`)
        breakEnd = new Date(`2000-01-01T${times.breakEndTime}`)
        breakMinutes = (breakEnd - breakStart) / (1000 * 60)
    }
    
    // Calculate net working
    netWorkingHours = (workingMinutes - breakMinutes) / 60
    
    return {
        workingHours: round(workingHours, 2),
        breakDuration: round(breakMinutes / 60, 2),
        netWorkingHours: round(netWorkingHours, 2)
    }
}
```

## IPC Communication Pattern

```
Frontend (React)                   Bridge                  Backend (Electron)
────────────────                   ──────                  ──────────────────

User clicks Save
│
▼
window.electron.createTimeLog(
  userId,
  date,
  startTime,
  breakStartTime,
  breakEndTime,
  endTime
)
│
├─────────────────────────────────────────────────────────►
│                     ipcRenderer.invoke
│
│                                        ┌─────────────────────────────┐
│                                        │ ipcMain.handle              │
│                                        │ 'timelogging:createTimeLog' │
│                                        │                             │
│                                        │ - Validate input            │
│                                        │ - Find/create log           │
│                                        │ - Save to store             │
│                                        │ - Log audit                 │
│                                        │ - Return response           │
│                                        └─────────────────────────────┘
│                                        │
│◄─────────────────────────────────────────
│         Promise.resolve(response)
│
▼
.then(result => {
  if (result.success) {
    setSuccessMessage()
    loadTimeLogs()
  } else {
    setError(result.error)
  }
})
```

## Navigation Flow

```
App (Router)
└── LoginPage
    └── Login successful
        └── EmployeeDashboard
            ├── Sidebar (Navigation)
            │   ├── [Dashboard] ────► EmployeeOverview
            │   │   ├── [Log Your Time] Card
            │   │   │   └──► Navigate to /timelogging
            │   │   │
            │   │   └── Stats Grid
            │   │       └── Quick action
            │   │
            │   ├── [Time Logging] ──► TimeLogging Component
            │   │   ├── Date Picker
            │   │   ├── Time Input
            │   │   ├── Calculations
            │   │   └── History
            │   │
            │   ├── [Attendance] ────► AttendanceLogger
            │   ├── [Leave Requests] ► LeaveRequestForm
            │   └── [Payslips] ──────► PayslipViewer
            │
            └── Routes (/employee/*)
                ├── / (Dashboard)
                ├── /timelogging (TimeLogging) ← NEW
                ├── /attendance
                ├── /leave
                └── /payslip
```

## Error Handling Flow

```
Error Occurrence
│
├─► Input Validation Error
│   └─► Display field error
│   └─► Highlight input red
│   └─► Disable submit button
│   └─► User can retry
│
├─► API/Backend Error
│   └─► Display error message
│   └─► Log to console
│   └─► Show error toast
│   └─► User can retry
│
└─► Deletion Error
    └─► Confirm dialog stays open
    └─► Show error message
    └─► User can retry or cancel
```

## Performance Optimization

```
Frontend Optimizations:
├── Client-side validation (instant feedback)
├── Calculations done locally (no server round-trip)
├── Debounced API calls (prevent duplicates)
├── Loading states (prevent double-submit)
├── Memoized components (avoid re-renders)
└── Lazy loading (code splitting)

Backend Optimizations:
├── Indexed data queries (date + userId)
├── Batch operations (bulk create/delete)
├── Async file I/O (non-blocking)
├── Efficient JSON parsing (minimal overhead)
└── Audit logging (append-only, no locks)
```

## Security Architecture

```
Security Layers
├── Frontend
│   ├── Input validation
│   ├── Error handling
│   └── No sensitive data exposure
│
├── IPC Bridge
│   ├── Sandboxed context
│   ├── No direct Node.js access
│   └── Type-safe invocation
│
├── Backend
│   ├── File system permissions
│   ├── Data encryption (optional)
│   └── Audit trail logging
│
└── Data Storage
    ├── User-specific data directory
    ├── File-level permissions
    └── No database credentials
```

## Scalability Considerations

```
Current Architecture:
├── JSON file storage (suitable for < 100k logs)
├── In-memory filtering (fast for typical use)
├── No database overhead (simple deployment)
└── Easy to backup (single file)

Future Scalability:
├── Optional database migration path
├── Pagination for large result sets
├── Caching layer for frequent queries
├── API optimization for bulk operations
└── Archive old logs for performance
```

## Integration Points

```
Time Logging System ←→ Other Systems

Payroll System
└─ getUserTimeLogs(userId, month, year)
   └─ Returns net working hours
   └─ Used for salary calculation

Attendance System
└─ Cross-reference time logs
└─ Validate attendance records

Audit System
└─ All operations logged
└─ Tracks changes
└─ Compliance reporting

Dashboard
└─ Quick action link
└─ Stats cards
└─ User feedback
```

## Testing Strategy

```
Unit Tests:
├── validateTimes() → Various input combinations
├── calculateDurations() → Expected outputs
├── getCurrentStatus() → Status logic
└── Error handling → Edge cases

Integration Tests:
├── Create time log
├── Retrieve logs
├── Update log
├── Delete log
└── API communication

UI Tests:
├── Form input
├── Validation display
├── Calculations accuracy
├── History display
├── Edit/delete functionality

E2E Tests:
├── Complete user workflow
├── Navigation
├── State persistence
└── Error recovery
```

---

## System Requirements

- **Frontend**: React 18+
- **Backend**: Node.js with Electron
- **Storage**: File system access
- **Browser**: Modern ES6+ support
- **Display**: Responsive CSS3

## Deployment Architecture

```
Development:
├── React Dev Server (port 3001)
├── Electron in debug mode
└── Live reload enabled

Production:
├── Built React files
├── Packaged Electron app
├── Code signing optional
└── Auto-updates supported
```

---

This architecture ensures:
- ✅ Security through isolation
- ✅ Performance through client-side operations
- ✅ Reliability through validation
- ✅ Scalability through modular design
- ✅ Maintainability through clear structure
