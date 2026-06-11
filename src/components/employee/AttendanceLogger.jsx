import React, { useState, useEffect } from 'react';
// v4.4.3: "today" must match the office timezone (set in Settings, default
// Asia/Kolkata) — the backend stamps attendance rows under getOfficeDate(),
// so the renderer needs to query for the same calendar day or sign-in
// silently "reverts" because the freshly-written row doesn't match the
// UTC date the renderer is asking for.
import { getOfficeDate } from '../../utils/officeTime';

function AttendanceLogger({ user }) {
  const [attendance, setAttendance] = useState([]);
  const [loading, setLoading] = useState(false);
  const [todayRecord, setTodayRecord] = useState(null);
  const [signedIn, setSignedIn] = useState(false);
  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    loadAttendance();
  }, []);

  const loadAttendance = async () => {
    setLoading(true);
    try {
      const today = getOfficeDate();
      const startDate = new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0];
      const endDate = today;

      // Get this user's history (last 30 days). Use the history result for
      // BOTH the "Today's Check-In/Out" panel and the table below — that way
      // we only ever look at this user's own rows. The previous version used
      // attendance:getByDate which returns every employee's row for the date,
      // so Manisha would see (e.g.) the Administrator's bulk-marked row.
      const historyResult = await window.electron.getAttendanceHistory(user.id, startDate, endDate);
      const history = (historyResult && historyResult.success && Array.isArray(historyResult.data))
        ? historyResult.data
        : [];

      setAttendance(history);

      const todayRow = history.find(r => r.date === today);
      if (todayRow) {
        setTodayRecord(todayRow);
        setSignedIn(!!todayRow.signInTime);
        setSignedOut(!!todayRow.signOutTime);
      } else {
        setTodayRecord(null);
        setSignedIn(false);
        setSignedOut(false);
      }
    } catch (error) {
      console.error('Failed to load attendance:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async () => {
    try {
      const result = await window.electron.signIn(user?.id);
      if (result.success) {
        setTodayRecord(result.data);
        setSignedIn(true);
        window.toast.success('Sign In recorded!');
        await loadAttendance();
      } else {
        window.toast.error('Error: ' + (result.message || result.error || 'Failed to sign in'));
      }
    } catch (error) {
      console.error('Failed to sign in:', error);
      window.toast.error('Error: ' + error.message);
    }
  };

  const handleSignOut = async () => {
    // Confirmation guard to prevent accidental Sign Out clicks.
    // Sign Out closes the day's attendance record, so we want the user
    // to explicitly confirm before we hit the backend.
    const confirmed = window.confirm(
      '⚠️ Are you sure you want to Sign Out for the day?\n\n' +
      'This will record your end-of-day time and close today\'s attendance. ' +
      'You will not be able to undo this from your dashboard.\n\n' +
      'Click OK to confirm Sign Out, or Cancel to stay signed in.'
    );
    if (!confirmed) return;
    try {
      const result = await window.electron.signOut(user?.id);
      if (result.success) {
        setTodayRecord(result.data);
        setSignedOut(true);
        window.toast.success('Sign Out recorded!');
        await loadAttendance();
      } else {
        window.toast.error('Error: ' + (result.message || result.error || 'Failed to sign out'));
      }
    } catch (error) {
      console.error('Failed to sign out:', error);
      window.toast.error('Error: ' + error.message);
    }
  };

  // The backend now stores sign-in/out as "HH:MM:SS" (TIME column), not as
  // ISO timestamps. Detect that case and format directly; fall back to Date
  // parsing for any legacy ISO strings still in the data.
  const formatTime = (value) => {
    if (!value) return '-';
    if (typeof value === 'string' && /^\d{1,2}:\d{2}(:\d{2})?$/.test(value)) {
      const [h, m] = value.split(':').map(Number);
      const period = h >= 12 ? 'PM' : 'AM';
      const hour12 = ((h + 11) % 12) + 1;
      return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
    }
    const date = new Date(value);
    if (isNaN(date.getTime())) return value;
    return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString + 'T00:00:00');
    return date.toLocaleDateString('en-IN', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  };

  // Works for either HH:MM:SS strings or ISO timestamps.
  const timeToMinutes = (value) => {
    if (!value) return null;
    if (typeof value === 'string' && /^\d{1,2}:\d{2}(:\d{2})?$/.test(value)) {
      const [h, m] = value.split(':').map(Number);
      return h * 60 + m;
    }
    const date = new Date(value);
    if (isNaN(date.getTime())) return null;
    return date.getHours() * 60 + date.getMinutes();
  };

  const getHoursWorked = (signIn, signOut) => {
    const sm = timeToMinutes(signIn);
    const em = timeToMinutes(signOut);
    if (sm === null || em === null) return '-';
    const hours = Math.max(0, (em - sm) / 60);
    return hours.toFixed(2) + ' hrs';
  };

  return (
    <div className="manager-container">
      <div className="manager-header">
        <h2>My Attendance</h2>
      </div>

      {/* Today's Check-In/Out */}
      <div className="form-section">
        <h3>Today's Check-In/Out</h3>
        <div className="attendance-today">
          <div className="today-info" style={{ color: '#f3f4f6' }}>
            <p style={{ color: '#f3f4f6' }}><strong style={{ color: '#ffffff' }}>Date:</strong> {formatDate(getOfficeDate())}</p>
            {todayRecord && (
              <>
                <p style={{ color: '#f3f4f6' }}><strong style={{ color: '#ffffff' }}>Sign In Time:</strong> {formatTime(todayRecord.signInTime)}</p>
                <p style={{ color: '#f3f4f6' }}><strong style={{ color: '#ffffff' }}>Sign Out Time:</strong> {formatTime(todayRecord.signOutTime)}</p>
                <p style={{ color: '#f3f4f6' }}><strong style={{ color: '#ffffff' }}>Hours Worked:</strong> {getHoursWorked(todayRecord.signInTime, todayRecord.signOutTime)}</p>
                <p style={{ color: '#f3f4f6' }}>
                  <strong style={{ color: '#ffffff' }}>Status:</strong>
                  <span className={`badge badge-${todayRecord.status === 'present' ? 'success' : 'warning'}`} style={{marginLeft: '8px'}}>
                    {todayRecord.status}
                  </span>
                </p>
              </>
            )}
            {!todayRecord && (
              <p style={{ color: '#f3f4f6' }}><strong style={{ color: '#ffffff' }}>Status:</strong> <span style={{ marginLeft: '8px', opacity: 0.7 }}>Not signed in yet</span></p>
            )}
          </div>
          <div className="today-actions">
            <button
              className="btn btn-primary"
              onClick={handleSignIn}
              disabled={signedIn || loading}
            >
              {signedIn ? '✓ Signed In' : '📍 Sign In'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={handleSignOut}
              disabled={!signedIn || signedOut || loading}
            >
              {signedOut ? '✓ Signed Out' : '📍 Sign Out'}
            </button>
          </div>
        </div>
      </div>

      {/* Attendance History */}
      <div className="table-wrapper">
        <h3>Attendance History (Last 30 Days)</h3>
        {loading ? (
          <p style={{textAlign: 'center', padding: '20px'}}>Loading...</p>
        ) : attendance.length === 0 ? (
          <p style={{textAlign: 'center', padding: '20px', color: 'var(--text-2)'}}>No attendance records found</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Sign In</th>
                <th>Sign Out</th>
                <th>Hours Worked</th>
                <th>Status</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {attendance.map(att => {
                // For absent / full-leave rows, suppress sign-in/out/hours so
                // the user doesn't see stale times next to an Absent badge.
                // Half-day rows DO show times because the employee actually
                // came in for half the day — that was the bug the user was
                // hitting: a half-day attendance row would hide its sign-in
                // even when one was explicitly recorded.
                const s = (att.status || '').toLowerCase();
                const isHalfDay = (att.is_half_day === 1 || att.is_half_day === true || att.isHalfDay === true);
                // Show times for any row where the employee was actually present,
                // including half-day worked. Full-leave / absent rows still hide.
                // (Legacy 'halfday' rows are normalized to 'half-day' by a DB migration.)
                const showTimes = s === 'present' || s === 'half-day'
                                  || (s === 'leave' && isHalfDay && (att.signInTime || att.sign_in_time));
                // Both full and half-day leave use the blue 'info' badge so
                // they read as the same family ("leave"). The "(½)" suffix on
                // the label distinguishes half-days.
                const cls = s === 'present'  ? 'success'
                          : s === 'absent'   ? 'danger'
                          : s === 'leave'    ? 'info'
                          : s === 'half-day' ? 'warning'
                          : 'warning';
                const statusLabel = (s === 'leave' && isHalfDay)
                  ? 'Leave (½)'
                  : s === 'half-day' ? 'Half-Day' : att.status;
                // Coerce snake_case (from DB join) and camelCase shapes —
                // historically the same handler has returned both, and the
                // half-day row was missing times because the row carried
                // snake_case fields only.
                const signIn  = att.signInTime  || att.sign_in_time;
                const signOut = att.signOutTime || att.sign_out_time;
                return (
                  <tr key={att.id}>
                    <td>{formatDate(att.date)}</td>
                    <td>{showTimes ? formatTime(signIn) : '-'}</td>
                    <td>{showTimes ? formatTime(signOut) : '-'}</td>
                    <td>{showTimes ? getHoursWorked(signIn, signOut) : '-'}</td>
                    <td>
                      <span className={`badge badge-${cls}`}>{statusLabel}</span>
                    </td>
                    <td>{att.notes || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default AttendanceLogger;
