import React, { useState, useEffect } from 'react';
import { getOfficeDate } from '../../utils/officeTime';

function AttendanceTracker() {
  const [selectedDate, setSelectedDate] = useState(getOfficeDate());
  const [attendance, setAttendance] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showMarkForm, setShowMarkForm] = useState(false);
  const [markingEmp, setMarkingEmp] = useState(null);
  const [viewMode, setViewMode] = useState('calendar'); // 'calendar' or 'table'
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [selectedEmployee, setSelectedEmployee] = useState('all');
  const [monthAttendance, setMonthAttendance] = useState({});
  const [editingCell, setEditingCell] = useState(null); // {date, employeeId}
  const [editFormData, setEditFormData] = useState({
    status: 'present',
    signInTime: '09:00',
    signOutTime: '18:00',
    notes: ''
  });
  const [markFormData, setMarkFormData] = useState({
    employeeId: '',
    status: 'present',
    signInTime: '09:00',
    signOutTime: '18:00',
    notes: ''
  });
  const [selectedCells, setSelectedCells] = useState(new Set()); // Set of 'date-employeeId'
  const [bulkStatus, setBulkStatus] = useState('present');
  const [bulkApplying, setBulkApplying] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [holidays, setHolidays] = useState([]);
  const [bulkModalData, setBulkModalData] = useState({
    startDate: getOfficeDate(),
    endDate: getOfficeDate(),
    status: 'present',
    applyTo: 'all', // 'all' or specific employeeId
    selectedEmployeeId: ''
  });

  useEffect(() => {
    loadEmployees();
    if (viewMode === 'calendar') {
      loadMonthAttendance();
    } else {
      loadAttendanceForDate();
    }
  }, [selectedDate, selectedMonth, viewMode]);

  // Load holidays whenever month changes or component comes into focus
  useEffect(() => {
    loadHolidays();

    // Also refresh holidays periodically (every 10 seconds) to catch updates from Holiday Management
    const holidayRefreshInterval = setInterval(() => {
      loadHolidays();
    }, 10000);

    return () => clearInterval(holidayRefreshInterval);
  }, [selectedMonth]);

  // SQLite returns attendance rows with snake_case keys (user_id, sign_in_time,
  // sign_out_time, full_name). The rest of this component reads camelCase
  // (userId, signInTime, signOutTime, fullName). Add the camelCase aliases so
  // the existing filters and renderers keep working.
  const normalizeAttendanceRow = (row) => row && ({
    ...row,
    userId: row.userId || row.user_id || null,
    signInTime: row.signInTime || row.sign_in_time || null,
    signOutTime: row.signOutTime || row.sign_out_time || null,
    fullName: row.fullName || row.full_name || null,
    // SQLite stores status capitalized ('Present', 'Leave'); existing
    // comparisons and color lookups in this component use lowercase
    // ('present', 'leave'). Lowercase here so both pipelines agree.
    status: row.status ? String(row.status).toLowerCase() : row.status
  });

  // The DB stores times as HH:MM:SS (e.g. "09:00:00"), older rows may be ISO
  // datetimes ("2026-05-27T09:00:00Z"). Convert whichever shape we got to a
  // plain "HH:MM" string suitable for an <input type="time">. Returns the
  // fallback if input is missing or unparseable — previously the modal used
  // `new Date("09:00:00")` which gives Invalid Date, so the existing time
  // was lost and admins had to retype it on every open.
  const toHHMM = (val, fallback = '09:00') => {
    if (!val) return fallback;
    if (typeof val !== 'string') return fallback;
    const m = val.match(/^(\d{1,2}):(\d{2})/);
    if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
    if (val.includes('T')) {
      const d = new Date(val);
      if (!isNaN(d.getTime())) return d.toTimeString().slice(0, 5);
    }
    return fallback;
  };

  // Helpers to compute hours worked from whatever time format the row has.
  const timeToMinutes = (val) => {
    if (!val || typeof val !== 'string') return null;
    const m = val.match(/^(\d{1,2}):(\d{2})/);
    if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    if (val.includes('T')) {
      const d = new Date(val);
      if (!isNaN(d.getTime())) return d.getHours() * 60 + d.getMinutes();
    }
    return null;
  };
  const formatHoursWorked = (signIn, signOut) => {
    const a = timeToMinutes(signIn);
    const b = timeToMinutes(signOut);
    if (a === null || b === null) return '-';
    const h = Math.max(0, (b - a) / 60);
    return h.toFixed(2);
  };

  const loadMonthAttendance = async () => {
    setLoading(true);
    try {
      const year = parseInt(selectedMonth.split('-')[0]);
      const month = parseInt(selectedMonth.split('-')[1]);
      const daysInMonth = new Date(year, month, 0).getDate();

      // Load attendance for the entire month using UTC to avoid timezone offset issues
      const attendance = {};
      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const result = await window.electron.getAttendanceByDate(dateStr);
        if (result.success && result.data) {
          attendance[dateStr] = result.data.map(normalizeAttendanceRow);
        } else {
          attendance[dateStr] = [];
        }
      }
      setMonthAttendance(attendance);
    } catch (error) {
      console.error('Failed to load month attendance:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadAttendanceForDate = async () => {
    setLoading(true);
    try {
      const result = await window.electron.getAttendanceByDate(selectedDate);
      if (result.success) {
        setAttendance((result.data || []).map(normalizeAttendanceRow));
      }
    } catch (error) {
      console.error('Failed to load attendance:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadEmployees = async () => {
    try {
      const result = await window.electron.getEmployees();
      if (result.success) {
        setEmployees(result.data || []);
      }
    } catch (error) {
      console.error('Failed to load employees:', error);
    }
  };

  const loadHolidays = async () => {
    try {
      const result = await window.electron.getHolidaysList();
      if (result.success) {
        setHolidays(result.data || []);
      }
    } catch (error) {
      console.error('Failed to load holidays:', error);
    }
  };

  const handleMarkAttendance = async (e) => {
    e.preventDefault();

    if (!markFormData.employeeId) {
      window.toast.warning('Please select an employee');
      return;
    }

    try {
      // Create or update attendance record
      const date = selectedDate;
      const signInTime = new Date(`${date}T${markFormData.signInTime}:00`).toISOString();
      const signOutTime = new Date(`${date}T${markFormData.signOutTime}:00`).toISOString();

      const result = await window.electron.updateAttendanceStatus(
        `${markFormData.employeeId}-${selectedDate}`,
        markFormData.status,
        markFormData.notes
      );

      if (result.success || markFormData.status) {
        window.toast.success('Attendance marked successfully!');
        setShowMarkForm(false);
        setMarkFormData({
          employeeId: '',
          status: 'present',
          signInTime: '09:00',
          signOutTime: '18:00',
          notes: ''
        });
        // Reload based on current view
        if (viewMode === 'calendar') {
          await loadMonthAttendance();
        } else {
          await loadAttendanceForDate();
        }
      }
    } catch (error) {
      console.error('Error marking attendance:', error);
      window.toast.error('Error: ' + error.message);
    }
  };

  const getEmployeeName = (empId) => {
    const emp = employees.find(e => e.id === empId);
    return emp ? emp.fullName : 'Unknown';
  };

  const formatTime = (isoString) => {
    if (!isoString) return '-';
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString + 'T00:00:00');
    return date.toLocaleDateString('en-IN', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  };

  const getHoursWorked = (signIn, signOut) => {
    // Use the format-aware helper so this works whether the row holds
    // "HH:MM:SS" (new SQLite format) or an ISO datetime (legacy). The old
    // version used new Date("09:00:00") which produces Invalid Date and
    // therefore NaN hours — that's the source of the bogus "9.30 hrs" /
    // mismatched totals on the attendance history.
    const h = formatHoursWorked(signIn, signOut);
    if (h === '-') return '-';
    return `${h} hrs`;
  };

  const getMissingEmployees = () => {
    const attendedIds = attendance.map(a => a.userId);
    return employees.filter(e => !attendedIds.includes(e.id));
  };

  const getStatusColor = (status) => {
    // SQLite stores statuses capitalized ('Present', 'Absent', 'Leave', etc.)
    // but legacy code/store uses lowercase. Normalize so either matches.
    switch((status || '').toLowerCase()) {
      case 'present': return '#34D399';      // green
      case 'absent': return '#F87171';       // red
      case 'half-day': return '#FBBF24';     // yellow — canonical (legacy 'halfday' is normalized by a DB migration)
      case 'leave': return '#60A5FA';        // blue
      case 'late': return '#FB923C';         // orange
      case 'holiday': return '#A78BFA';      // purple
      default: return '#3D5170';
    }
  };

  const getStatusLabel = (status) => {
    if (!status) return '-';
    return status.charAt(0).toUpperCase() + status.slice(1).replace('-', ' ');
  };

  const getAttendanceForDay = (date, empId) => {
    const dayRecords = monthAttendance[date] || [];
    if (empId === 'all') {
      return dayRecords;
    }
    return dayRecords.filter(a => a.userId === empId);
  };

  const handleCellClick = (date, employeeId, event) => {
    // If Ctrl/Cmd is pressed, do multi-select instead of single edit
    if (event && (event.ctrlKey || event.metaKey)) {
      handleCellCtrlClick(date, employeeId, event);
      return;
    }

    // Normal single-click edit
    const records = getAttendanceForDay(date, employeeId);
    const record = records.length > 0 ? records[0] : null;

    setEditingCell({ date, employeeId });
    setEditFormData({
      status: record?.status || 'present',
      signInTime:  toHHMM(record?.signInTime,  '09:00'),
      signOutTime: toHHMM(record?.signOutTime, '18:00'),
      notes: record?.notes || ''
    });
  };

  const handleSaveCell = async () => {
    if (!editingCell) return;

    try {
      const { date, employeeId } = editingCell;
      const attendanceId = `${employeeId}-${date}`;

      // Create or update attendance record
      const signInTime = new Date(`${editingCell.date}T${editFormData.signInTime}:00`).toISOString();
      const signOutTime = new Date(`${editingCell.date}T${editFormData.signOutTime}:00`).toISOString();

      // First try to update existing record
      let result = await window.electron.updateAttendanceStatus(
        attendanceId,
        editFormData.status,
        editFormData.notes,
        signInTime,
        signOutTime
      );

      // If record doesn't exist, create a new one
      if (!result.success && result.error && result.error.includes('not found')) {
        // Create the attendance record in the database
        const createResult = await window.electron.createAttendance(
          attendanceId,
          employeeId,
          date,
          signInTime,
          signOutTime,
          editFormData.status,
          editFormData.notes
        );

        if (createResult.success) {
          // Reload the month attendance to get the newly created record from database
          await loadMonthAttendance();
          setEditingCell(null);
          window.toast.success('Attendance recorded successfully!');
        } else {
          window.toast.error('Error creating attendance: ' + (createResult.error || 'Unknown error'));
        }
        return;
      }

      if (result.success) {
        // Reload the month attendance to ensure we have the latest from the database
        await loadMonthAttendance();

        setEditingCell(null);
        window.toast.success('Attendance updated successfully!');
      } else {
        window.toast.error('Error: ' + (result.error || 'Failed to update'));
      }
    } catch (error) {
      console.error('Error saving attendance:', error);
      window.toast.error('Error: ' + error.message);
    }
  };

  const handleCellCtrlClick = (date, employeeId, event) => {
    event.stopPropagation();
    if (event.ctrlKey || event.metaKey) {
      const cellKey = `${date}-${employeeId}`;
      const newSelected = new Set(selectedCells);
      if (newSelected.has(cellKey)) {
        newSelected.delete(cellKey);
      } else {
        newSelected.add(cellKey);
      }
      setSelectedCells(newSelected);
    }
  };

  const handleBulkApply = async () => {
    if (selectedCells.size === 0) {
      window.toast.warning('Please select at least one day to update');
      return;
    }

    setBulkApplying(true);
    try {
      // cellKey is "<YYYY-MM-DD>-<employeeId>" — but employeeId may contain
      // dashes (UUIDs do), so don't split('-'). The date is always the first
      // 10 characters; everything after the 11th is the employeeId.
      const updates = Array.from(selectedCells).map(cellKey => {
        const date = cellKey.substring(0, 10);
        const employeeId = cellKey.substring(11);
        return { date, employeeId, status: bulkStatus };
      });

      let successCount = 0;
      for (const update of updates) {
        try {
          const attendanceId = `${update.employeeId}-${update.date}`;
          const signInTime = new Date(`${update.date}T09:00:00`).toISOString();
          const signOutTime = new Date(`${update.date}T18:00:00`).toISOString();

          // First try to update existing record
          let result = await window.electron.updateAttendanceStatus(
            attendanceId,
            update.status,
            `Bulk updated to ${update.status}`,
            signInTime,
            signOutTime
          );

          // If record doesn't exist, create a new one
          if (!result.success && result.error && result.error.includes('not found')) {
            const createResult = await window.electron.createAttendance(
              attendanceId,
              update.employeeId,
              update.date,
              signInTime,
              signOutTime,
              update.status,
              `Bulk updated to ${update.status}`
            );

            if (createResult.success) {
              successCount++;
            } else {
              console.error(`Failed to create attendance for ${update.employeeId} on ${update.date}:`, createResult.error);
            }
          } else if (result.success) {
            successCount++;
          } else {
            console.error(`Failed to update attendance for ${update.employeeId} on ${update.date}:`, result.error);
          }
        } catch (error) {
          console.error(`Failed to process ${update.employeeId} on ${update.date}:`, error);
        }
      }

      window.toast.success(`Updated ${successCount} of ${selectedCells.size} records successfully!`);
      setSelectedCells(new Set());
      await loadMonthAttendance();
    } catch (error) {
      console.error('Error in bulk apply:', error);
      window.toast.error('Error: ' + error.message);
    } finally {
      setBulkApplying(false);
    }
  };

  const handleClearSelection = () => {
    setSelectedCells(new Set());
  };

  const handleModalBulkApply = async () => {
    if (!bulkModalData.startDate || !bulkModalData.endDate) {
      window.toast.warning('Please select both start and end dates');
      return;
    }

    // Parse dates using UTC to avoid timezone offset issues
    const [startYear, startMonth, startDay] = bulkModalData.startDate.split('-').map(Number);
    const [endYear, endMonth, endDay] = bulkModalData.endDate.split('-').map(Number);
    const startDate = new Date(Date.UTC(startYear, startMonth - 1, startDay));
    const endDate = new Date(Date.UTC(endYear, endMonth - 1, endDay));

    if (startDate > endDate) {
      window.toast.warning('Start date must be before or equal to end date');
      return;
    }

    if (bulkModalData.applyTo === 'specific' && !bulkModalData.selectedEmployeeId) {
      window.toast.warning('Please select an employee');
      return;
    }

    setBulkApplying(true);
    try {
      // Get list of employees to update
      const targetEmployees = bulkModalData.applyTo === 'all'
        ? employees
        : employees.filter(e => e.id === bulkModalData.selectedEmployeeId);

      let successCount = 0;
      const updates = [];

      // Build list of updates (date + employee combinations, skipping Sundays and holidays)
      for (let currentDate = new Date(startDate); currentDate <= endDate; currentDate.setUTCDate(currentDate.getUTCDate() + 1)) {
        const dayOfWeek = currentDate.getUTCDay();
        const dateStr = currentDate.toISOString().split('T')[0];

        // Skip Sundays only (0 = Sunday; Saturday is a working day)
        if (dayOfWeek === 0) {
          continue;
        }

        // Skip holidays
        if (holidays.some(h => h.date === dateStr)) {
          continue;
        }

        for (const emp of targetEmployees) {
          updates.push({
            date: dateStr,
            employeeId: emp.id,
            status: bulkModalData.status
          });
        }
      }

      // Apply all updates
      for (const update of updates) {
        try {
          const attendanceId = `${update.employeeId}-${update.date}`;
          const signInTime = new Date(`${update.date}T09:00:00`).toISOString();
          const signOutTime = new Date(`${update.date}T18:00:00`).toISOString();

          // First try to update existing record
          let result = await window.electron.updateAttendanceStatus(
            attendanceId,
            update.status,
            `Bulk marked as ${update.status}`,
            signInTime,
            signOutTime
          );

          // If record doesn't exist, create a new one
          if (!result.success && result.error && result.error.includes('not found')) {
            const createResult = await window.electron.createAttendance(
              attendanceId,
              update.employeeId,
              update.date,
              signInTime,
              signOutTime,
              update.status,
              `Bulk marked as ${update.status}`
            );

            if (createResult.success) {
              successCount++;
            } else {
              console.error(`Failed to create attendance for ${update.employeeId} on ${update.date}:`, createResult.error);
            }
          } else if (result.success) {
            successCount++;
          } else {
            console.error(`Failed to update attendance for ${update.employeeId} on ${update.date}:`, result.error);
          }
        } catch (error) {
          console.error(`Failed to process ${update.employeeId} on ${update.date}:`, error);
        }
      }

      window.toast.success(`Successfully updated ${successCount} of ${updates.length} records!`);
      setShowBulkModal(false);
      setBulkModalData({
        startDate: getOfficeDate(),
        endDate: getOfficeDate(),
        status: 'present',
        applyTo: 'all',
        selectedEmployeeId: ''
      });
      await loadMonthAttendance();
    } catch (error) {
      console.error('Error in bulk modal apply:', error);
      window.toast.error('Error: ' + error.message);
    } finally {
      setBulkApplying(false);
    }
  };

  const isWeekend = (dateString) => {
    // Parse date using UTC to avoid timezone offset issues
    // Only Sunday (0) is weekend - Saturday is a working day
    const [year, month, day] = dateString.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCDay() === 0;
  };

  const isHolidayDate = (dateString) => {
    return holidays.some(h => h.date === dateString);
  };

  const renderCalendarView = () => {
    const year = parseInt(selectedMonth.split('-')[0]);
    const month = parseInt(selectedMonth.split('-')[1]);
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days = [];
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(i);
    }

    const displayEmployees = selectedEmployee === 'all' ? employees : employees.filter(e => e.id === selectedEmployee);

    return (
      <div style={{overflowX: 'auto'}}>
        {displayEmployees.length === 0 ? (
          <p style={{textAlign: 'center', padding: '20px', color: 'var(--text-2)'}}>No employees found</p>
        ) : (
          <table className="table" style={{minWidth: '900px'}}>
            <thead>
              <tr>
                <th style={{minWidth: '150px'}}>Employee</th>
                {Array.from({length: daysInMonth}, (_, i) => (
                  <th key={i+1} style={{width: '40px', textAlign: 'center', padding: '8px 4px', fontSize: '12px'}}>
                    {i+1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayEmployees.map(emp => (
                <tr key={emp.id}>
                  <td style={{minWidth: '150px'}}><strong>{emp.fullName}</strong></td>
                  {Array.from({length: daysInMonth}, (_, i) => {
                    // Create date string directly to avoid timezone offset issues
                    const date = `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
                    const isSunday = isWeekend(date);
                    const holiday = holidays.find(h => h.date === date);
                    const isNonWorking = isSunday || holiday;
                    const records = getAttendanceForDay(date, emp.id);
                    const record = records.length > 0 ? records[0] : null;
                    const status = record ? record.status : null;
                    // Half-day flag may come as is_half_day (snake) or isHalfDay (camel)
                    const isHalfLeave = record && status === 'leave'
                      && (record.is_half_day === 1 || record.is_half_day === true || record.isHalfDay === true);

                    // Determine color and label
                    let color = '#3D5170';
                    let label = '-';
                    let tooltipText = `Click to edit (Ctrl+Click to select) - ${getStatusLabel(status)}`;

                    if (holiday) {
                      color = '#A78BFA'; // Purple for holidays
                      label = 'X';
                      tooltipText = `Holiday: ${holiday.name}`;
                    } else if (isSunday) {
                      color = '#6B7280'; // Gray for Sunday
                      label = '-';
                      tooltipText = 'Sunday (Non-Working)';
                    } else if (isHalfLeave) {
                      // Half-day LEAVE: light blue (relates to full-leave #60A5FA
                      // dark blue) with ½ glyph. Kept distinct from the amber
                      // "H = Half-Day Worked" status — that one is about a
                      // partial *workday*, not partial leave, and the previous
                      // shared amber colour made them hard to tell apart.
                      color = '#93C5FD';
                      label = '½';
                      tooltipText = 'Half-Day Leave';
                    } else if (status) {
                      color = getStatusColor(status);
                      label = status.charAt(0).toUpperCase();
                    }

                    const cellKey = `${date}-${emp.id}`;
                    const isSelected = selectedCells.has(cellKey);

                    return (
                      <td
                        key={i+1}
                        onClick={(e) => !isNonWorking && handleCellClick(date, emp.id, e)}
                        style={{
                          width: '40px',
                          padding: '8px 4px',
                          textAlign: 'center',
                          backgroundColor: color,
                          color: 'white',
                          borderRadius: '4px',
                          cursor: isNonWorking ? 'not-allowed' : 'pointer',
                          fontSize: '12px',
                          fontWeight: 'bold',
                          transition: 'all 0.2s ease',
                          border: isSelected ? '3px solid #3b82f6' : '2px solid transparent',
                          opacity: isNonWorking ? 0.6 : 1,
                          boxShadow: isSelected ? '0 0 8px rgba(59, 130, 246, 0.5)' : 'none'
                        }}
                        onMouseEnter={(e) => {
                          if (!isNonWorking) {
                            e.currentTarget.style.border = isSelected ? '3px solid #3b82f6' : '2px solid white';
                            e.currentTarget.style.transform = 'scale(1.1)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.border = isSelected ? '3px solid #3b82f6' : '2px solid transparent';
                          e.currentTarget.style.transform = 'scale(1)';
                        }}
                        title={tooltipText}
                      >
                        {label}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{marginTop: '16px', fontSize: '12px', color: 'var(--text-2)'}}>
          <p><strong>Legend:</strong></p>
          <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px'}}>
            <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
              <div style={{width: '20px', height: '20px', backgroundColor: '#34D399', borderRadius: '4px'}}></div>
              <span>P = Present</span>
            </div>
            <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
              <div style={{width: '20px', height: '20px', backgroundColor: '#F87171', borderRadius: '4px'}}></div>
              <span>A = Absent</span>
            </div>
            <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
              <div style={{width: '20px', height: '20px', backgroundColor: '#FBBF24', borderRadius: '4px'}}></div>
              <span>H = Half-Day Worked</span>
            </div>
            <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
              <div style={{width: '20px', height: '20px', backgroundColor: '#60A5FA', borderRadius: '4px'}}></div>
              <span>L = Leave (full day)</span>
            </div>
            <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
              <div style={{width: '20px', height: '20px', backgroundColor: '#93C5FD', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1f2937', fontWeight: 700, fontSize: '12px'}}>½</div>
              <span>½ = Half-Day Leave</span>
            </div>
            <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
              <div style={{width: '20px', height: '20px', backgroundColor: '#A78BFA', borderRadius: '4px', opacity: 0.6}}></div>
              <span>X = Holiday</span>
            </div>
            <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
              <div style={{width: '20px', height: '20px', backgroundColor: '#6B7280', borderRadius: '4px', opacity: 0.6}}></div>
              <span>- = Sunday (Non-Working)</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="manager-container">
      <div className="manager-header">
        <h2>Attendance Management</h2>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{display: 'flex', gap: '8px', backgroundColor: 'var(--bg-3)', padding: '4px', borderRadius: '6px'}}>
            <button
              className={`btn ${viewMode === 'calendar' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setViewMode('calendar')}
              style={{padding: '6px 12px', fontSize: '12px'}}
            >
              📅 Calendar
            </button>
            <button
              className={`btn ${viewMode === 'table' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setViewMode('table')}
              style={{padding: '6px 12px', fontSize: '12px'}}
            >
              📋 Table
            </button>
          </div>

          {viewMode === 'calendar' ? (
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              style={{padding: '8px 12px'}}
            />
          ) : (
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              style={{padding: '8px 12px'}}
            />
          )}

          {viewMode === 'calendar' && (
            <select
              value={selectedEmployee}
              onChange={(e) => setSelectedEmployee(e.target.value)}
              style={{padding: '8px 12px'}}
            >
              <option value="all">All Employees</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>{emp.fullName}</option>
              ))}
            </select>
          )}

          <button className="btn btn-primary" onClick={() => setShowMarkForm(true)}>
            + Mark Attendance
          </button>

          {viewMode === 'calendar' && (
            <button className="btn btn-primary" onClick={() => setShowBulkModal(true)}>
              📋 Bulk Mark
            </button>
          )}

          <button
            className="btn btn-secondary"
            onClick={loadHolidays}
            title="Refresh holidays from Holiday Management"
            style={{marginLeft: '8px'}}
          >
            🔄 Refresh Holidays
          </button>
        </div>
      </div>

      {/* Edit Cell Modal */}
      {editingCell && (
        <div className="modal-overlay" onClick={() => setEditingCell(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>Edit Attendance for {getEmployeeName(editingCell.employeeId)}</h3>
            <p style={{color: 'var(--text-2)', marginBottom: '20px'}}>Date: {formatDate(editingCell.date)}</p>
            <form onSubmit={e => { e.preventDefault(); handleSaveCell(); }}>
              <div className="form-group">
                <label>Status *</label>
                <select
                  value={editFormData.status}
                  onChange={e => setEditFormData({...editFormData, status: e.target.value})}
                  required
                >
                  <option value="present">Present</option>
                  <option value="absent">Absent</option>
                  <option value="half-day">Half Day</option>
                  <option value="leave">On Leave</option>
                </select>
              </div>

              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px'}}>
                <div className="form-group">
                  <label>Sign In Time</label>
                  <input
                    type="time"
                    value={editFormData.signInTime}
                    onChange={e => setEditFormData({...editFormData, signInTime: e.target.value})}
                  />
                </div>
                <div className="form-group">
                  <label>Sign Out Time</label>
                  <input
                    type="time"
                    value={editFormData.signOutTime}
                    onChange={e => setEditFormData({...editFormData, signOutTime: e.target.value})}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Notes</label>
                <textarea
                  value={editFormData.notes}
                  onChange={e => setEditFormData({...editFormData, notes: e.target.value})}
                  placeholder="Add any notes (optional)"
                  rows="3"
                />
              </div>

              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setEditingCell(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Mark Modal */}
      {showBulkModal && (
        <div className="modal-overlay" onClick={() => !bulkApplying && setShowBulkModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>Bulk Mark Attendance</h3>
            <form onSubmit={e => { e.preventDefault(); handleModalBulkApply(); }}>
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px'}}>
                <div className="form-group">
                  <label>Start Date *</label>
                  <input
                    type="date"
                    value={bulkModalData.startDate}
                    onChange={e => setBulkModalData({...bulkModalData, startDate: e.target.value})}
                    disabled={bulkApplying}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>End Date *</label>
                  <input
                    type="date"
                    value={bulkModalData.endDate}
                    onChange={e => setBulkModalData({...bulkModalData, endDate: e.target.value})}
                    disabled={bulkApplying}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Status *</label>
                <select
                  value={bulkModalData.status}
                  onChange={e => setBulkModalData({...bulkModalData, status: e.target.value})}
                  disabled={bulkApplying}
                  required
                >
                  <option value="present">Present</option>
                  <option value="absent">Absent</option>
                  <option value="half-day">Half Day</option>
                  <option value="leave">On Leave</option>
                </select>
              </div>

              <div className="form-group">
                <label>Apply To *</label>
                <select
                  value={bulkModalData.applyTo}
                  onChange={e => setBulkModalData({...bulkModalData, applyTo: e.target.value})}
                  disabled={bulkApplying}
                  required
                >
                  <option value="all">All Employees</option>
                  <option value="specific">Specific Employee</option>
                </select>
              </div>

              {bulkModalData.applyTo === 'specific' && (
                <div className="form-group">
                  <label>Select Employee *</label>
                  <select
                    value={bulkModalData.selectedEmployeeId}
                    onChange={e => setBulkModalData({...bulkModalData, selectedEmployeeId: e.target.value})}
                    disabled={bulkApplying}
                    required
                  >
                    <option value="">-- Choose Employee --</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>
                        {emp.fullName}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div style={{backgroundColor: 'var(--bg-2)', padding: '12px', borderRadius: '6px', marginBottom: '16px', fontSize: '13px', color: 'var(--text-2)'}}>
                <strong>Note:</strong> This will mark attendance for all weekdays (Monday-Friday) in the selected date range for the {bulkModalData.applyTo === 'all' ? 'selected employees' : 'selected employee'}. Weekends will be skipped automatically.
              </div>

              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowBulkModal(false)} disabled={bulkApplying}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={bulkApplying}>
                  {bulkApplying ? 'Applying...' : 'Apply Bulk Mark'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Calendar View */}
      {viewMode === 'calendar' && (
        <div className="form-section">
          <h3>Attendance Calendar - {new Date(selectedMonth + '-01').toLocaleDateString('en-IN', {year: 'numeric', month: 'long'})}</h3>
          {loading ? (
            <p style={{textAlign: 'center', padding: '20px'}}>Loading...</p>
          ) : (
            renderCalendarView()
          )}
        </div>
      )}

      {/* Bulk Action Toolbar */}
      {viewMode === 'calendar' && selectedCells.size > 0 && (
        <div style={{
          backgroundColor: '#1e3a8a',
          color: 'white',
          padding: '16px 20px',
          borderRadius: '8px',
          display: 'flex',
          gap: '16px',
          alignItems: 'center',
          marginTop: '16px',
          flexWrap: 'wrap'
        }}>
          <div style={{ fontWeight: 600 }}>
            {selectedCells.size} day{selectedCells.size !== 1 ? 's' : ''} selected
          </div>
          <select
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value)}
            disabled={bulkApplying}
            style={{
              padding: '8px 12px',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: 'white',
              color: '#1f2937',
              cursor: bulkApplying ? 'not-allowed' : 'pointer',
              opacity: bulkApplying ? 0.6 : 1
            }}
          >
            <option value="present">Present</option>
            <option value="absent">Absent</option>
            <option value="half-day">Half Day</option>
            <option value="leave">On Leave</option>
          </select>
          <button
            onClick={handleBulkApply}
            disabled={bulkApplying}
            style={{
              padding: '8px 16px',
              backgroundColor: '#10b981',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: bulkApplying ? 'not-allowed' : 'pointer',
              fontWeight: 600,
              opacity: bulkApplying ? 0.6 : 1
            }}
          >
            {bulkApplying ? 'Applying...' : 'Apply to Selected'}
          </button>
          <button
            onClick={handleClearSelection}
            disabled={bulkApplying}
            style={{
              padding: '8px 16px',
              backgroundColor: '#6b7280',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: bulkApplying ? 'not-allowed' : 'pointer',
              fontWeight: 600,
              opacity: bulkApplying ? 0.6 : 1
            }}
          >
            Clear Selection
          </button>
        </div>
      )}

      {/* Mark Attendance Form */}
      {showMarkForm && (
        <div className="modal-overlay" onClick={() => setShowMarkForm(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>Mark Attendance for {formatDate(selectedDate)}</h3>
            <form onSubmit={handleMarkAttendance}>
              <div className="form-group">
                <label>Employee *</label>
                <select
                  value={markFormData.employeeId}
                  onChange={e => setMarkFormData({...markFormData, employeeId: e.target.value})}
                  required
                >
                  <option value="">Select Employee</option>
                  {getMissingEmployees().map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.fullName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Status *</label>
                <select
                  value={markFormData.status}
                  onChange={e => setMarkFormData({...markFormData, status: e.target.value})}
                  required
                >
                  <option value="present">Present</option>
                  <option value="absent">Absent</option>
                  <option value="half-day">Half Day</option>
                  <option value="leave">On Leave</option>
                </select>
              </div>

              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px'}}>
                <div className="form-group">
                  <label>Sign In Time</label>
                  <input
                    type="time"
                    value={markFormData.signInTime}
                    onChange={e => setMarkFormData({...markFormData, signInTime: e.target.value})}
                  />
                </div>
                <div className="form-group">
                  <label>Sign Out Time</label>
                  <input
                    type="time"
                    value={markFormData.signOutTime}
                    onChange={e => setMarkFormData({...markFormData, signOutTime: e.target.value})}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Notes</label>
                <textarea
                  value={markFormData.notes}
                  onChange={e => setMarkFormData({...markFormData, notes: e.target.value})}
                  placeholder="Add any notes (optional)"
                  rows="3"
                />
              </div>

              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowMarkForm(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Mark Attendance
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Table View Content */}
      {viewMode === 'table' && (
        <>
      {/* Attendance Summary */}
      <div className="form-section">
        <h3>Attendance Summary for {formatDate(selectedDate)}</h3>
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', margin: '16px 0'}}>
          <div style={{
            background: 'var(--bg-3)',
            padding: '16px',
            borderRadius: '8px',
            borderLeft: '4px solid var(--green)'
          }}>
            <p style={{color: 'var(--text-2)', fontSize: '12px', margin: '0 0 4px 0'}}>Present</p>
            <p style={{color: 'var(--green)', fontSize: '20px', fontWeight: 'bold', margin: 0}}>
              {attendance.filter(a => a.status === 'present').length}
            </p>
          </div>
          <div style={{
            background: 'var(--bg-3)',
            padding: '16px',
            borderRadius: '8px',
            borderLeft: '4px solid var(--red)'
          }}>
            <p style={{color: 'var(--text-2)', fontSize: '12px', margin: '0 0 4px 0'}}>Absent</p>
            <p style={{color: 'var(--red)', fontSize: '20px', fontWeight: 'bold', margin: 0}}>
              {attendance.filter(a => a.status === 'absent').length}
            </p>
          </div>
          <div style={{
            background: 'var(--bg-3)',
            padding: '16px',
            borderRadius: '8px',
            borderLeft: '4px solid var(--amber)'
          }}>
            <p style={{color: 'var(--text-2)', fontSize: '12px', margin: '0 0 4px 0'}}>Half Day</p>
            <p style={{color: 'var(--amber)', fontSize: '20px', fontWeight: 'bold', margin: 0}}>
              {attendance.filter(a => a.status === 'half-day').length}
            </p>
          </div>
          <div style={{
            background: 'var(--bg-3)',
            padding: '16px',
            borderRadius: '8px',
            borderLeft: '4px solid var(--blue)'
          }}>
            <p style={{color: 'var(--text-2)', fontSize: '12px', margin: '0 0 4px 0'}}>Not Marked</p>
            <p style={{color: 'var(--blue)', fontSize: '20px', fontWeight: 'bold', margin: 0}}>
              {getMissingEmployees().length}
            </p>
          </div>
        </div>
      </div>

      {/* Attendance Table */}
      <div className="table-wrapper">
        <h3>Attendance Records</h3>
        {loading ? (
          <p style={{textAlign: 'center', padding: '20px'}}>Loading...</p>
        ) : attendance.length === 0 ? (
          <p style={{textAlign: 'center', padding: '20px', color: 'var(--text-2)'}}>
            No attendance records for {formatDate(selectedDate)}. Click "+ Mark Attendance" to add records.
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Employee Name</th>
                <th>Sign In</th>
                <th>Sign Out</th>
                <th>Hours Worked</th>
                <th>Status</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {attendance.map(att => {
                // Sign-in/out/hours only make sense for "Present". Suppress
                // them when status is Leave / Absent / etc. — otherwise the
                // grid showed stale times next to a Leave badge.
                const s = (att.status || '').toLowerCase();
                const showTimes = s === 'present';
                const cls = s === 'present' ? 'success'
                          : s === 'absent'  ? 'danger'
                          : s === 'leave'   ? 'info'
                          : 'warning';
                return (
                  <tr key={att.id}>
                    <td><strong>{getEmployeeName(att.userId)}</strong></td>
                    <td>{showTimes ? formatTime(att.signInTime) : '-'}</td>
                    <td>{showTimes ? formatTime(att.signOutTime) : '-'}</td>
                    <td>{showTimes ? getHoursWorked(att.signInTime, att.signOutTime) : '-'}</td>
                    <td>
                      <span className={`badge badge-${cls}`}>
                        {att.status}
                      </span>
                    </td>
                    <td>{att.notes || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Missing Employees */}
      {getMissingEmployees().length > 0 && (
        <div className="form-section">
          <h3>Employees Yet to Mark Attendance ({getMissingEmployees().length})</h3>
          <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px'}}>
            {getMissingEmployees().map(emp => (
              <div key={emp.id} style={{
                background: 'var(--bg-3)',
                padding: '12px',
                borderRadius: '8px',
                borderLeft: '3px solid var(--amber)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span>{emp.fullName}</span>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setMarkFormData({...markFormData, employeeId: emp.id});
                    setShowMarkForm(true);
                  }}
                >
                  Mark
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}

export default AttendanceTracker;
