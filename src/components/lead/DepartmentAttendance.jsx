import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getOfficeDate } from '../../utils/officeTime';

function DepartmentAttendance({ user }) {
  const [attendance, setAttendance] = useState([]);
  const [selectedDate, setSelectedDate] = useState(getOfficeDate());
  const location = useLocation();
  const navigate = useNavigate();

  // The user's department id can land on either snake_case or camelCase
  // depending on how the row was fetched — normalise here.
  const departmentId = user?.department_id || user?.departmentId || null;

  // The Lead Dashboard tiles deep-link here with ?filter=present / ?filter=leave
  // / ?filter=absent. Default 'all' shows everyone (the old behaviour). This
  // means clicking "Present Today" on the dashboard now actually narrows the
  // grid to only present employees instead of always showing all.
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const f = (params.get('filter') || 'all').toLowerCase();
    setStatusFilter(['present', 'absent', 'leave', 'all'].includes(f) ? f : 'all');
  }, [location.search]);

  useEffect(() => {
    loadAttendance();
  }, [selectedDate, departmentId]);

  const loadAttendance = async () => {
    try {
      const result = await window.electron.getAttendanceByDate(selectedDate, departmentId);
      if (result.success) {
        setAttendance(result.data);
      }
    } catch (error) {
      console.error('Failed to load attendance:', error);
    }
  };

  // Change the filter via the URL so the back/forward buttons and dashboard
  // deep-links stay in sync with the dropdown.
  const onFilterChange = (next) => {
    if (next === 'all') {
      navigate('/attendance', { replace: true });
    } else {
      navigate(`/attendance?filter=${next}`, { replace: true });
    }
  };

  const filtered = statusFilter === 'all'
    ? attendance
    : attendance.filter(a => (a.status || '').toLowerCase() === statusFilter);

  // Friendly heading bit when a filter is active
  const filterLabel = {
    all:     'All Employees',
    present: 'Present Only',
    absent:  'Absent Only',
    leave:   'On Leave Only'
  }[statusFilter];

  return (
    <div className="manager-container">
      <div className="manager-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <h2>Team Attendance <span style={{ fontSize: '0.6em', color: 'var(--text-2)', marginLeft: '8px' }}>· {filterLabel}</span></h2>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <select
            value={statusFilter}
            onChange={(e) => onFilterChange(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: '6px' }}
          >
            <option value="all">All Statuses</option>
            <option value="present">Present</option>
            <option value="absent">Absent</option>
            <option value="leave">On Leave</option>
          </select>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
        </div>
      </div>

      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Sign In</th>
              <th>Sign Out</th>
              <th>Hours Worked</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-2)' }}>
                  No employees match this filter for {selectedDate}.
                </td>
              </tr>
            ) : filtered.map(att => {
              // Suppress sign-in / sign-out / hours for any non-present status:
              // an employee who is On Leave or Absent didn't actually work, so
              // showing stale times next to a "Leave" badge is misleading.
              const s = (att.status || '').toLowerCase();
              const showTimes = s === 'present';
              const isHalfDay = (att.is_half_day === 1 || att.is_half_day === true || att.isHalfDay === true);
              // Both full and half-day leave use the same blue 'info' badge —
              // visually grouping them as "leave". The (½) suffix on the label
              // is what tells half-days apart. Previously half-day used 'warning'
              // (amber) which clashed with the "H = Half-Day Worked" amber on
              // the admin grid.
              const cls = s === 'present' ? 'success'
                        : s === 'absent'  ? 'danger'
                        : s === 'leave'   ? 'info'
                        : 'warning';
              const baseLabel = s ? s.charAt(0).toUpperCase() + s.slice(1) : '-';
              const label = (s === 'leave' && isHalfDay) ? `${baseLabel} (½)` : baseLabel;
              return (
                <tr key={att.id}>
                  <td>{att.full_name}</td>
                  <td>{showTimes ? (att.sign_in_time || '-') : '-'}</td>
                  <td>{showTimes ? (att.sign_out_time || '-') : '-'}</td>
                  <td>{showTimes ? (att.hours_worked || '-') : '-'}</td>
                  <td><span className={`badge badge-${cls}`}>{label}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default DepartmentAttendance;
