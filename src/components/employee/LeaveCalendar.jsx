import React, { useState, useEffect } from 'react';
import { calculateLeaveAllocation, getLeaveAllocationDisplay } from '../../utils/leaveAllocationUtils';
import ReasonPrompt from '../common/ReasonPrompt';
import '../styles/leaveCalendar.css';

function LeaveCalendar({ user }) {
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [leaveBalance, setLeaveBalance] = useState([]);
  const [selectedStartDate, setSelectedStartDate] = useState(null);
  const [selectedEndDate, setSelectedEndDate] = useState(null);
  const [leaveType, setLeaveType] = useState('casual');
  const [reason, setReason] = useState('');
  const [showRequestForm, setShowRequestForm] = useState(false);
  // Half-day leave: when on, the request is for a single date that only
  // counts as 0.5 days and is auto-marked as a half-day in attendance.
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [halfDaySession, setHalfDaySession] = useState('morning');
  const [submitting, setSubmitting] = useState(false);
  const [employeeInfo, setEmployeeInfo] = useState(null);
  const [leaveAllocation, setLeaveAllocation] = useState(null);
  const [leaveTypes, setLeaveTypes] = useState([]);
  // When set, holds { requestId } for the leave the employee chose to
  // cancel — drives the reason-prompt modal.
  const [cancelFor, setCancelFor] = useState(null);

  useEffect(() => {
    loadData();
    loadEmployeeInfo();
    loadLeaveTypes();
  }, [user.id]);

  const loadLeaveTypes = async () => {
    try {
      // Load leave types from balance data to get IDs
      const result = await window.electron.getLeaveBalance(user.id);
      if (result.success && Array.isArray(result.data)) {
        setLeaveTypes(result.data);
        // Set default to first available leave type
        if (result.data.length > 0) {
          setLeaveType(result.data[0].leave_type_id);
        }
      }
    } catch (error) {
      console.error('Failed to load leave types:', error);
    }
  };

  useEffect(() => {
    loadHolidaysForMonth();

    // Refresh holidays periodically (every 10 seconds) to catch updates from Holiday Management
    const holidayRefreshInterval = setInterval(() => {
      loadHolidaysForMonth();
    }, 10000);

    return () => clearInterval(holidayRefreshInterval);
  }, [currentYear, currentMonth]);

  const loadEmployeeInfo = async () => {
    try {
      const result = await window.electron.getEmployeeById(user.id);
      if (result.success && result.data) {
        setEmployeeInfo(result.data);

        // Calculate leave allocation based on joining date + probation status.
        // Probationers get 0 allocated (leave during probation is unpaid).
        if (result.data.joiningDate) {
          const probInfo = {
            isProbation: result.data.is_probation === 1 || result.data.isProbation === true,
            probationEndDate: result.data.probation_end_date || result.data.probationEndDate || null
          };
          const allocation = calculateLeaveAllocation(result.data.joiningDate, new Date().getFullYear(), probInfo);
          const allocationInfo = getLeaveAllocationDisplay(result.data.joiningDate, new Date().getFullYear(), probInfo);
          setLeaveAllocation({
            allocated: allocation,
            ...allocationInfo
          });
        }
      }
    } catch (error) {
      console.error('Failed to load employee info:', error);
    }
  };

  const loadData = async () => {
    try {
      const [requestsResult, balanceResult, holidaysResult] = await Promise.all([
        window.electron.getLeaveRequests(user.id),
        window.electron.getLeaveBalance(user.id),
        window.electron.getHolidaysList()
      ]);

      if (requestsResult.success) {
        setLeaveRequests(Array.isArray(requestsResult.data) ? requestsResult.data : []);
      }
      if (balanceResult.success) {
        setLeaveBalance(Array.isArray(balanceResult.data) ? balanceResult.data : []);
      }
      if (holidaysResult.success) {
        setHolidays(Array.isArray(holidaysResult.data) ? holidaysResult.data : []);
      }
    } catch (error) {
      console.error('Failed to load leave data:', error);
    }
  };

  const loadHolidaysForMonth = async () => {
    try {
      const result = await window.electron.getHolidaysByMonth(currentYear, currentMonth + 1);
      if (result.success) {
        setHolidays(result.data || []);
      }
    } catch (error) {
      console.error('Failed to load holidays:', error);
    }
  };

  const isDateInPast = (dateStr) => {
    const today = new Date().toISOString().split('T')[0];
    return dateStr < today;
  };

  const handleDateClick = (day) => {
    const selected = new Date(currentYear, currentMonth, day);
    const dateStr = selected.toISOString().split('T')[0];

    // Prevent selection of past dates
    if (isDateInPast(dateStr)) {
      return;
    }

    if (!selectedStartDate || (selectedStartDate && selectedEndDate)) {
      // Start new selection
      setSelectedStartDate(dateStr);
      setSelectedEndDate(null);
    } else if (dateStr > selectedStartDate) {
      // Set end date
      setSelectedEndDate(dateStr);
    } else {
      // If clicked before start date, reset
      setSelectedStartDate(dateStr);
      setSelectedEndDate(null);
    }
  };

  const handleRequestLeave = async () => {
    if (!selectedStartDate || !selectedEndDate) {
      window.toast.warning('Please select both start and end dates');
      return;
    }
    if (!reason.trim()) {
      window.toast.warning('Please provide a reason for your leave');
      return;
    }

    // Validate that dates are in the future
    const today = new Date().toISOString().split('T')[0];
    if (selectedStartDate < today) {
      window.toast.warning('Leave requests can only be made for future dates');
      return;
    }

    // The user object can land here from several auth flows — Electron's
    // auth:getCurrentUser, the web shim, and the legacy JSON-store login —
    // each of which uses slightly different field names. Coalesce so we
    // always have an id to send.
    const myId = user?.id || user?.user_id || user?.userId || user?.uid;
    if (!myId) {
      window.toast.error('Could not identify the logged-in user. Please sign out and sign in again.');
      return;
    }

    // For half-day requests we always send start == end so the backend
    // doesn't have to second-guess.
    const effectiveEnd = isHalfDay ? selectedStartDate : selectedEndDate;

    setSubmitting(true);
    try {
      const result = await window.electron.requestLeave(
        leaveType, selectedStartDate, effectiveEnd, reason, myId,
        { isHalfDay, halfDaySession }
      );
      if (result.success) {
        window.toast.success('Leave request submitted successfully!');
        setSelectedStartDate(null);
        setSelectedEndDate(null);
        setReason('');
        setIsHalfDay(false);
        setHalfDaySession('morning');
        setShowRequestForm(false);
        await loadData();
      } else {
        window.toast.error('Error submitting leave request: ' + (result.message || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error submitting leave request:', error);
      window.toast.error('Error submitting leave request: ' + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const getLeaveStatusColor = (date) => {
    // Check if it's a holiday
    const holiday = holidays.find(h => h.date === date);
    if (holiday) return '#9ca3af'; // Gray for holidays

    // Check if it's a weekend (Sunday only) using UTC to avoid timezone offset issues
    const [year, month, day] = date.split('-').map(Number);
    const dateObj = new Date(Date.UTC(year, month - 1, day));
    const dayOfWeek = dateObj.getUTCDay();
    if (dayOfWeek === 0) return '#374151'; // Dark gray for Sundays (weekend)

    // Check leave status
    const request = leaveRequests.find(r => {
      const start = r.start_date;
      const end = r.end_date;
      return date >= start && date <= end;
    });

    if (request) {
      if (request.status === 'approved') return '#4ade80'; // Green
      if (request.status === 'pending') return '#fbbf24'; // Yellow
      if (request.status === 'rejected') return '#ef4444'; // Red
    }

    return null;
  };

  const isDateInSelection = (date) => {
    if (!selectedStartDate) return false;
    if (!selectedEndDate) return selectedStartDate === date;
    return date >= selectedStartDate && date <= selectedEndDate;
  };

  const getDaysInMonth = (year, month) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (year, month) => {
    // Use UTC to avoid timezone offset issues
    return new Date(Date.UTC(year, month, 1)).getUTCDay();
  };

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDay = getFirstDayOfMonth(currentYear, currentMonth);
  const monthName = new Date(currentYear, currentMonth).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const calendarDays = [];
  for (let i = 0; i < firstDay; i++) {
    calendarDays.push(null);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    calendarDays.push(day);
  }

  return (
    <div className="leave-calendar-container">
      <div className="leave-calendar-main">
        <div className="calendar-section">
          <div className="calendar-header">
            <button onClick={() => {
              if (currentMonth === 0) {
                setCurrentMonth(11);
                setCurrentYear(currentYear - 1);
              } else {
                setCurrentMonth(currentMonth - 1);
              }
            }}>← Previous</button>
            <h2>{monthName}</h2>
            <button onClick={() => {
              if (currentMonth === 11) {
                setCurrentMonth(0);
                setCurrentYear(currentYear + 1);
              } else {
                setCurrentMonth(currentMonth + 1);
              }
            }}>Next →</button>
          </div>

          <div className="calendar-grid">
            <div className="weekdays">
              <div>Sun</div>
              <div>Mon</div>
              <div>Tue</div>
              <div>Wed</div>
              <div>Thu</div>
              <div>Fri</div>
              <div>Sat</div>
            </div>
            <div className="days">
              {calendarDays.map((day, index) => {
                if (day === null) return <div key={`empty-${index}`} className="empty-day"></div>;

                const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const isPast = isDateInPast(dateStr);
                const statusColor = getLeaveStatusColor(dateStr);
                const isSelected = isDateInSelection(dateStr);
                const isStartDate = selectedStartDate === dateStr;
                const isEndDate = selectedEndDate === dateStr;

                return (
                  <div
                    key={`day-${day}`}
                    className={`calendar-day ${isSelected ? 'selected' : ''} ${isStartDate ? 'start-date' : ''} ${isEndDate ? 'end-date' : ''} ${isPast ? 'past-date' : ''}`}
                    style={{
                      backgroundColor: isPast ? '#e5e7eb' : (isSelected ? '#dbeafe' : (statusColor ? statusColor : 'transparent')),
                      color: isPast ? '#9ca3af' : 'inherit',
                      cursor: isPast ? 'not-allowed' : 'pointer',
                      borderRadius: isStartDate ? '8px 0 0 8px' : isEndDate ? '0 8px 8px 0' : '0',
                      opacity: isPast ? 0.5 : 1
                    }}
                    onClick={() => handleDateClick(day)}
                  >
                    {day}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="calendar-legend">
            <div className="legend-item"><span className="legend-color" style={{backgroundColor: '#4ade80'}}></span> Approved Leave</div>
            <div className="legend-item"><span className="legend-color" style={{backgroundColor: '#fbbf24'}}></span> Pending</div>
            <div className="legend-item"><span className="legend-color" style={{backgroundColor: '#ef4444'}}></span> Rejected</div>
            <div className="legend-item"><span className="legend-color" style={{backgroundColor: '#9ca3af'}}></span> Holiday</div>
            <div className="legend-item"><span className="legend-color" style={{backgroundColor: '#374151'}}></span> Sunday (Non-Working)</div>
            <div className="legend-item"><span className="legend-color" style={{backgroundColor: '#dbeafe'}}></span> Selected</div>
            <div className="legend-item"><span className="legend-color" style={{backgroundColor: '#e5e7eb'}}></span> Past Dates (Disabled)</div>
          </div>
        </div>

        <div className="request-section">
          {leaveAllocation && employeeInfo && (
            <div style={{
              backgroundColor: leaveAllocation.color,
              color: 'white',
              padding: '12px 16px',
              borderRadius: '6px',
              marginBottom: '16px',
              fontSize: '13px'
            }}>
              <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                🗓️ Leave Entitlement for {new Date().getFullYear()}
              </div>
              <div style={{ fontSize: '12px', opacity: 0.9, marginBottom: '4px' }}>
                Joined: {new Date(employeeInfo.joiningDate).toLocaleDateString('en-GB', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric'
                })}
              </div>
              <div style={{ fontSize: '14px', fontWeight: 600 }}>
                {leaveAllocation.allocated} days allocated {leaveAllocation.allocated < 25 ? '(prorated)' : ''}
              </div>
              <div style={{ fontSize: '11px', opacity: 0.85, marginTop: '4px' }}>
                {leaveAllocation.message}
              </div>
            </div>
          )}

          <h3>Leave Balance</h3>
          <div className="balance-cards">
            {!Array.isArray(leaveBalance) || leaveBalance.length === 0 ? (
              <p>Loading leave balance...</p>
            ) : (
              leaveBalance.map(balance => (
                <div key={balance.id} className="balance-card">
                  <h4>{balance.leave_type_name}</h4>
                  <div className="balance-details">
                    <div>
                      <span className="label">Total:</span>
                      <span className="value">{balance.total || 0}</span>
                    </div>
                    <div>
                      <span className="label">Used:</span>
                      <span className="value">{balance.used || 0}</span>
                    </div>
                    {balance.pending > 0 && (
                      <div>
                        <span className="label">Pending:</span>
                        <span className="value" style={{ color: '#fbbf24' }}>
                          {balance.pending}
                        </span>
                      </div>
                    )}
                    <div>
                      <span className="label">Remaining:</span>
                      <span className="value" style={{color: balance.remaining > 0 ? '#10b981' : '#ef4444'}}>
                        {balance.remaining || 0}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Leave Requests list with status — shows employee what they've submitted */}
          {Array.isArray(leaveRequests) && leaveRequests.length > 0 && (
            <div style={{ marginTop: '24px' }}>
              <h3>My Leave Requests</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
                {leaveRequests
                  .slice()
                  .sort((a, b) => (b.requested_at || '').localeCompare(a.requested_at || ''))
                  .slice(0, 10)
                  .map((req) => {
                    const statusInfo = {
                      pending:       { bg: '#fbbf24', label: '⏳ Pending Approval' },
                      lead_approved: { bg: '#60a5fa', label: '⏳ Pending Final Approval' },
                      approved:      { bg: '#10b981', label: '✓ Approved' },
                      rejected:      { bg: '#ef4444', label: '✗ Rejected' },
                      cancelled:     { bg: '#6b7280', label: '⊘ Cancelled' }
                    }[req.status] || { bg: '#6b7280', label: req.status };

                    // Employees can cancel anything that hasn't already been
                    // rejected or cancelled. Approved leave can still be
                    // cancelled (e.g. exam dates changed) — the handler will
                    // restore the balance and un-mark the attendance days.
                    const canCancel = ['pending', 'lead_approved', 'approved'].includes(req.status);
                    // Cancel flow: a single modal collects both the confirm
                    // intent *and* the optional reason. The previous
                    // window.confirm + window.prompt pair was broken in the
                    // Electron build because Chromium disables window.prompt
                    // by default — it returned null silently so no reason
                    // could ever be captured.
                    const handleCancelClick = () => {
                      setCancelFor({
                        id: req.id,
                        approved: req.status === 'approved',
                        days: req.days_count
                      });
                    };

                    return (
                      <div
                        key={req.id}
                        style={{
                          background: '#1e293b',
                          color: '#ffffff',
                          padding: '12px 14px',
                          borderRadius: '8px',
                          borderLeft: `4px solid ${statusInfo.bg}`,
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '12px',
                          flexWrap: 'wrap'
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '14px' }}>
                            {req.start_date} → {req.end_date}
                          </div>
                          <div style={{ fontSize: '12px', color: '#cbd5e1', marginTop: '2px' }}>
                            {req.days_count} day{req.days_count !== 1 ? 's' : ''}
                            {req.leave_type_name ? ` · ${req.leave_type_name}` : ''}
                          </div>
                          {req.reason && (
                            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px', fontStyle: 'italic' }}>
                              "{req.reason}"
                            </div>
                          )}
                          {(req.status === 'rejected' || req.status === 'cancelled') && req.rejected_reason && (
                            <div style={{ fontSize: '12px', color: '#fca5a5', marginTop: '4px' }}>
                              Reason: {req.rejected_reason}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{
                            background: statusInfo.bg,
                            color: '#0f172a',
                            padding: '4px 12px',
                            borderRadius: '12px',
                            fontSize: '12px',
                            fontWeight: 700,
                            whiteSpace: 'nowrap'
                          }}>
                            {statusInfo.label}
                          </span>
                          {canCancel && (
                            <button
                              onClick={handleCancelClick}
                              style={{
                                background: 'transparent',
                                color: '#fca5a5',
                                border: '1px solid #fca5a5',
                                padding: '3px 10px',
                                borderRadius: '12px',
                                fontSize: '12px',
                                fontWeight: 600,
                                cursor: 'pointer'
                              }}
                              title={req.status === 'approved'
                                ? 'Cancel this approved leave and restore your balance'
                                : 'Withdraw this leave request'}
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {!showRequestForm ? (
            <button
              className="btn btn-primary"
              onClick={() => setShowRequestForm(true)}
              style={{ width: '100%', marginTop: '20px' }}
            >
              + Request Leave
            </button>
          ) : (
            <div className="request-form">
              <h4>Request Leave</h4>
              <div className="form-group" title="First day of your leave. Must be today or a future date.">
                <label>Start Date</label>
                <input
                  type="date"
                  value={selectedStartDate || ''}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={e => {
                    const v = e.target.value;
                    setSelectedStartDate(v || null);
                    // If the new start is after the current end, clear the end
                    // so the user picks a fresh one (avoids a negative range).
                    if (v && selectedEndDate && v > selectedEndDate) {
                      setSelectedEndDate(null);
                    }
                  }}
                  disabled={submitting}
                />
              </div>
              {!isHalfDay && (
                <div className="form-group" title="Last day of your leave (inclusive). Must be on or after the Start Date.">
                  <label>End Date</label>
                  <input
                    type="date"
                    value={selectedEndDate || ''}
                    min={selectedStartDate || new Date().toISOString().split('T')[0]}
                    onChange={e => setSelectedEndDate(e.target.value || null)}
                    disabled={submitting || !selectedStartDate}
                  />
                </div>
              )}
              {/* Half-day toggle. When on, only one date is needed and it
                  counts as 0.5 days. Pick which half: Morning / Afternoon. */}
              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  id="halfDayCheckbox"
                  checked={isHalfDay}
                  onChange={e => {
                    const on = e.target.checked;
                    setIsHalfDay(on);
                    if (on && selectedStartDate) setSelectedEndDate(selectedStartDate);
                  }}
                  disabled={submitting}
                  style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                  title="Take half a day off (counts as 0.5 days)"
                />
                <label htmlFor="halfDayCheckbox" style={{ margin: 0, cursor: 'pointer' }}>
                  Half-day (0.5 days)
                </label>
                {isHalfDay && (
                  <select
                    value={halfDaySession}
                    onChange={e => setHalfDaySession(e.target.value)}
                    disabled={submitting}
                    style={{ marginLeft: '8px', padding: '4px 8px', borderRadius: '4px' }}
                    title="Which half of the day?"
                  >
                    <option value="morning">Morning</option>
                    <option value="afternoon">Afternoon</option>
                  </select>
                )}
              </div>
              <div className="form-group" title="Which leave bucket this should be deducted from (Casual, Sick, Earned, etc.).">
                <label>Leave Type</label>
                <select value={leaveType} onChange={e => setLeaveType(e.target.value)} disabled={submitting}>
                  {leaveTypes.length === 0 ? (
                    <option value="">No leave types available</option>
                  ) : (
                    leaveTypes.map(type => (
                      <option key={type.leave_type_id} value={type.leave_type_id}>
                        {type.leave_type_name}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div className="form-group" title="Brief explanation for your manager. Be specific — vague reasons can delay approval.">
                <label>Reason</label>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Enter reason for leave"
                  rows="4"
                  disabled={submitting}
                />
              </div>
              <div className="form-actions">
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setShowRequestForm(false);
                    setReason('');
                  }}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleRequestLeave}
                  disabled={submitting || !selectedStartDate || !selectedEndDate}
                >
                  {submitting ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {cancelFor && (
        <ReasonPrompt
          title={cancelFor.approved ? 'Cancel approved leave?' : 'Cancel leave request?'}
          message={cancelFor.approved
            ? `${cancelFor.days} day(s) will be returned to your balance and the attendance marks will be removed.`
            : 'This will withdraw the request.'}
          placeholder="Reason for cancelling (optional)"
          submitLabel="Cancel Leave"
          cancelLabel="Keep It"
          onSubmit={async (why) => {
            try {
              const result = await window.electron.cancelLeaveRequest(cancelFor.id, user?.id, why || '');
              if (result.success) {
                window.toast.success(result.message || 'Leave cancelled.');
                await loadData();
              } else {
                window.toast.error('Could not cancel: ' + (result.message || result.error || 'Unknown error'));
              }
            } catch (e) {
              window.toast.error('Failed to cancel: ' + e.message);
            }
          }}
          onClose={() => setCancelFor(null)}
        />
      )}
    </div>
  );
}

export default LeaveCalendar;
