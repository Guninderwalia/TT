# Time Logging System Documentation

## Overview

The Time Logging System is a sophisticated component of the Task Tango application that allows employees to accurately track their work hours, break times, and calculate net working hours. The system provides real-time validation, automatic calculations, and a complete time log history management interface.

## Features

### 1. Time Logging Input
- **Start Time**: Record when work begins
- **Break Start Time**: Log when an employee goes on break (optional)
- **Break End Time**: Log when an employee returns from break (optional)
- **End/Finish Time**: Record when work ends

### 2. Real-Time Calculations
The system automatically calculates and displays:
- **Total Working Hours**: Duration from start to end time
- **Total Break Duration**: Duration of all breaks
- **Net Working Hours**: Working hours minus break time (the actual productive work hours)
- **Current Status**: Shows whether the employee is "Not Started", "Currently Working", "On Break", or "Finished for the day"

### 3. Validation
The system validates all time entries in real-time:
- Start time is required
- End time is required and must be after start time
- Break times must be provided together (both or neither)
- Break end time must be after break start time
- Breaks must fall within work hours (cannot start before work starts or end after work ends)
- Comprehensive error messages for user guidance

### 4. Time Log Management
- **View Logs**: See all logged time entries for the selected date
- **Edit Logs**: Update existing time entries with inline editing
- **Delete Logs**: Remove time entries with confirmation dialog
- **Date Navigation**: Select any past date or today to view/edit logs
- **History Display**: Shows all time logs with calculated durations

### 5. Automatic Updates
- When a user logs a time entry for a date that already has a log, it updates the existing entry instead of creating a duplicate
- Timestamps are maintained for all create and update operations

## Component Structure

### Frontend Component: `TimeLogging.jsx`

**Location**: `src/components/employee/TimeLogging.jsx`

**Props**:
```javascript
{
  user: {
    id: string,      // User's unique identifier
    fullName: string // User's full name
  }
}
```

**Key Functions**:
- `loadTimeLogs()`: Fetches time logs for the selected date
- `validateTimes()`: Validates all time input fields
- `calculateDurations()`: Computes working hours, break duration, and net hours
- `getCurrentStatus()`: Determines current status based on times
- `handleSubmit()`: Saves new or updates existing time log
- `handleEdit()`: Prepares a log for editing
- `handleSaveEdit()`: Saves edited time log
- `handleDelete()`: Removes a time log with confirmation

**State Management**:
- `selectedDate`: Currently selected date (YYYY-MM-DD format)
- `timeLog`: Current time input values
- `timeLogs`: All logs for the selected date
- `editingId`: ID of log being edited
- `editValues`: Temporary storage for edited values
- `validationErrors`: Map of field errors
- `successMessage`: User feedback messages
- `loading`: Loading state during API calls

### Styling: `timelogging.css`

**Location**: `src/styles/timelogging.css`

**Key Style Classes**:
- `.timelogging-container`: Main container with gradient background
- `.time-input-form`: Time entry form section
- `.calculations-section`: Display area for calculated durations
- `.calc-card`: Individual calculation cards with status-specific colors
- `.history-section`: Time log history display area
- `.log-item`: Individual log entry with edit/delete actions
- `.delete-confirm`: Confirmation dialog styling

**Color Scheme**:
- Status colors are dynamically applied based on current state:
  - "Not Started": Gray gradient
  - "Currently Working": Green gradient
  - "On Break": Orange/Yellow gradient
  - "Finished for the day": Cyan gradient

## Backend Integration

### IPC Handlers

All backend operations are handled through Electron IPC in `src/main/main.js`:

#### 1. createTimeLog
Creates or updates a time log for a user on a specific date.

```javascript
window.electron.createTimeLog(
  userId: string,
  date: string (YYYY-MM-DD),
  startTime: string (HH:MM),
  breakStartTime: string (HH:MM),
  breakEndTime: string (HH:MM),
  endTime: string (HH:MM)
)
```

**Returns**: 
```javascript
{
  success: boolean,
  data: {
    id: string,
    userId: string,
    date: string,
    startTime: string,
    breakStartTime: string,
    breakEndTime: string,
    endTime: string,
    createdAt: string (ISO),
    updatedAt: string (ISO)
  }
}
```

**Behavior**: 
- If a log exists for the user and date, it updates it
- If no log exists, creates a new one
- Automatically logs the action to the audit trail

#### 2. getTimeLogs
Retrieves time logs for a user within a date range.

```javascript
window.electron.getTimeLogs(
  userId: string,
  startDate: string (YYYY-MM-DD),
  endDate: string (YYYY-MM-DD)
)
```

**Returns**:
```javascript
{
  success: boolean,
  data: Array<TimeLog>
}
```

#### 3. updateTimeLog
Updates an existing time log by ID.

```javascript
window.electron.updateTimeLog(
  logId: string,
  {
    startTime: string (HH:MM),
    breakStartTime: string (HH:MM),
    breakEndTime: string (HH:MM),
    endTime: string (HH:MM)
  }
)
```

**Returns**: Updated TimeLog object

#### 4. deleteTimeLog
Deletes a time log by ID.

```javascript
window.electron.deleteTimeLog(logId: string)
```

**Returns**:
```javascript
{
  success: boolean,
  data: DeletedTimeLog
}
```

#### 5. getUserTimeLogs
Retrieves time logs for a user in a specific month/year.

```javascript
window.electron.getUserTimeLogs(
  userId: string,
  month: number (1-12),
  year: number
)
```

**Returns**:
```javascript
{
  success: boolean,
  data: Array<TimeLog>
}
```

### Data Storage

Time logs are stored in the Electron data store as JSON:

```
{
  timeLogs: [
    {
      id: "1684927392019",
      userId: "3",
      date: "2024-05-24",
      startTime: "09:00",
      breakStartTime: "12:00",
      breakEndTime: "13:00",
      endTime: "18:00",
      createdAt: "2024-05-24T09:00:00.000Z",
      updatedAt: "2024-05-24T09:00:00.000Z"
    }
  ]
}
```

## User Interface Layout

### Main Container (Grid Layout)
```
┌─────────────────────────────────────────────────┐
│  HEADER: Time Logging                           │
└─────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────┐
│  DATE PICKER SECTION                            │
│  [Date Input] [Today Button]                    │
└─────────────────────────────────────────────────┘
┌──────────────────────────┬──────────────────────┐
│  TIME INPUT FORM         │  CALCULATIONS        │
│  ├─ Start Time           │  ├─ Total Working    │
│  ├─ Break Start          │  ├─ Break Duration   │
│  ├─ Break End            │  ├─ Net Working      │
│  ├─ End Time             │  └─ Status           │
│  └─ [Submit Button]      │                      │
├──────────────────────────┴──────────────────────┤
│  HISTORY SECTION                                 │
│  ├─ Log Item 1                                  │
│  │  ├─ Time Display                             │
│  │  ├─ Duration Stats                           │
│  │  └─ [Edit] [Delete]                          │
│  └─ Log Item 2                                  │
└─────────────────────────────────────────────────┘
```

## Responsive Design

The system is fully responsive:
- **Desktop (> 1200px)**: Two-column layout with form on left, calculations on right
- **Tablet (768-1200px)**: Single column layout, calculations below form
- **Mobile (< 768px)**: Full-width single column layout, optimized for mobile input

## Navigation Integration

### Employee Dashboard Sidebar
The Time Logging feature is accessible via:
1. **Sidebar Navigation**: "Time Logging" menu item with clock icon
2. **Dashboard Quick Action Card**: "Log Your Time" card on the overview page that navigates to the Time Logging page

### Route
- **Path**: `/timelogging`
- **Component**: `TimeLogging`
- **Role**: User (Employees only)

## Example Usage

### In EmployeeDashboard
```jsx
<TimeLogging user={user} />
```

### From Navigation
```jsx
navigate('/timelogging');
```

### From Sidebar
Click "Time Logging" in the sidebar navigation

## Error Handling

The system provides comprehensive error handling:

1. **Validation Errors**: Field-specific error messages displayed below inputs
2. **API Errors**: General error message displayed at top of component
3. **Loading States**: Submit/Edit/Delete buttons show "Saving..." during API calls
4. **Delete Confirmation**: Prevents accidental deletion with confirmation dialog
5. **Success Feedback**: Green success message displayed after operations

## Best Practices

### For Employees
1. Log your time at the end of each workday
2. Always include break times if taken
3. Review calculated net working hours for accuracy
4. Edit logs if needed to correct times
5. Keep time entries within reasonable work hours

### For Administrators
1. Monitor time logs for unusual patterns
2. Use audit logs to track time log modifications
3. Consider setting business hours constraints
4. Review employee net working hours for payroll accuracy

## Audit Trail

All time logging operations are automatically logged to the audit system:
- **CREATE**: New time log created
- **UPDATE**: Existing time log updated
- **DELETE**: Time log deleted

Each audit entry includes:
- Action type (CREATE/UPDATE/DELETE)
- Entity type (TIME_LOG)
- Entity ID (the log ID)
- Old and new values
- Timestamp of the operation
- User ID (when available)

## Calculation Examples

### Example 1: Full Day with Break
- Start: 09:00
- Break Start: 12:00
- Break End: 13:00
- End: 18:00

**Calculations**:
- Total Working Hours: 9 hours (09:00 to 18:00)
- Break Duration: 1 hour (12:00 to 13:00)
- Net Working Hours: 8 hours (9 - 1)

### Example 2: Full Day No Break
- Start: 09:00
- Break Start: (empty)
- Break End: (empty)
- End: 18:00

**Calculations**:
- Total Working Hours: 9 hours
- Break Duration: 0 hours
- Net Working Hours: 9 hours

### Example 3: Half Day
- Start: 09:00
- Break Start: (empty)
- Break End: (empty)
- End: 13:00

**Calculations**:
- Total Working Hours: 4 hours
- Break Duration: 0 hours
- Net Working Hours: 4 hours

## Future Enhancements

Potential improvements for future versions:
1. **Templates**: Save common time schedules as templates
2. **Bulk Import**: Import time logs from CSV files
3. **Time Lock**: Prevent editing of logs older than X days
4. **Notifications**: Remind employees to log time at end of day
5. **Reports**: Generate time log reports and analytics
6. **Integration**: Sync with external time tracking systems
7. **Overtime Tracking**: Calculate and track overtime hours
8. **Team View**: Allow managers to view team time logs (with permissions)
9. **Dashboard Widget**: Add time log summary to dashboard
10. **Mobile App**: Standalone mobile app for time logging

## Troubleshooting

### Issue: Time log not saving
- **Solution**: Check internet connection, validate all required fields are filled

### Issue: Calculations not showing correctly
- **Solution**: Verify time format (HH:MM), ensure times are in logical order

### Issue: Cannot edit old logs
- **Solution**: This is by design; you can delete and recreate if needed

### Issue: Break validation errors
- **Solution**: Ensure break times fall between start and end times, both break start and end must be provided together

## Technical Stack

- **Frontend**: React 18, React Router
- **Backend**: Electron, Node.js
- **IPC Communication**: Electron ipcMain/ipcRenderer
- **Data Storage**: JSON file-based store
- **Styling**: CSS3 with gradients and animations
- **State Management**: React Hooks (useState, useEffect)

## Files Modified/Created

### Created Files
- `src/components/employee/TimeLogging.jsx` - Main component
- `src/styles/timelogging.css` - Component styling
- `TIME_LOGGING_DOCUMENTATION.md` - This documentation

### Modified Files
- `src/main/main.js` - Added IPC handlers for time logging
- `src/main/preload.js` - Exposed time logging APIs
- `src/pages/EmployeeDashboard.jsx` - Added route and navigation
- `src/styles/dashboard.css` - Added action card styling

## API Reference Summary

| Function | Purpose |
|----------|---------|
| `createTimeLog(userId, date, times)` | Create/update time log |
| `getTimeLogs(userId, startDate, endDate)` | Get logs by date range |
| `updateTimeLog(logId, times)` | Update specific log |
| `deleteTimeLog(logId)` | Delete specific log |
| `getUserTimeLogs(userId, month, year)` | Get logs for month/year |

## Conclusion

The Time Logging System provides a comprehensive solution for employee time tracking within the Task Tango application. With its intuitive interface, real-time validation, and robust backend integration, it enables employees to accurately track their work hours while providing administrators with reliable data for payroll and compliance purposes.
