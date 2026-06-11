import React, { useState, useEffect, useMemo } from 'react';

// Pulse v2 — read-only "who's off" calendar/list.
//
// Item 12: employees can now see upcoming approved leaves for THEIR department
// (departmentId passed by the dashboard). Item 9: a "Type" filter lets anyone
// quickly narrow upcoming leaves to a single leave type (Annual Leave,
// Saturday Off, etc.). Reusable — pass departmentId=null for a company-wide
// view (admin) or a specific id to scope to one department.
function TeamLeavesPanel({ departmentId = null, title = 'Team Leaves — Upcoming' }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('all');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await window.electron.getUpcomingLeaves(departmentId || undefined);
        if (!cancelled && res?.success) setRows(Array.isArray(res.data) ? res.data : []);
      } catch (e) {
        console.error('Failed to load upcoming leaves:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [departmentId]);

  // Distinct leave-type names present in the data, for the Type filter.
  const types = useMemo(() => {
    const set = new Set();
    for (const r of rows) if (r.leave_type_name) set.add(r.leave_type_name);
    return Array.from(set).sort();
  }, [rows]);

  const visible = useMemo(() => {
    if (typeFilter === 'all') return rows;
    return rows.filter(r => r.leave_type_name === typeFilter);
  }, [rows, typeFilter]);

  const fmt = (d) => {
    if (!d) return '-';
    try {
      return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return d; }
  };

  return (
    <div className="manager-container">
      <div className="manager-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2>{title}</h2>
          <p style={{ margin: 0, color: 'var(--text-2, #9ca3af)', fontSize: 14 }}>
            Approved leaves coming up, so you can plan around who's away.
          </p>
        </div>
        {/* Item 9 — Type filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label htmlFor="leave-type-filter" style={{ fontSize: 13, color: 'var(--text-2, #9ca3af)' }}>Type</label>
          <select
            id="leave-type-filter"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            style={{ padding: '8px 12px' }}
          >
            <option value="all">All Types</option>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      <div className="table-wrapper">
        {loading ? (
          <p style={{ textAlign: 'center', padding: 20 }}>Loading…</p>
        ) : visible.length === 0 ? (
          <p style={{ textAlign: 'center', padding: 20, color: 'var(--text-2, #9ca3af)' }}>
            {rows.length === 0 ? 'No upcoming leaves.' : 'No upcoming leaves of this type.'}
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Department</th>
                <th>Type</th>
                <th>From</th>
                <th>To</th>
                <th>Days</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(r => (
                <tr key={r.id}>
                  <td><strong>{r.full_name}</strong></td>
                  <td>{r.department_name || '-'}</td>
                  <td><span className="badge">{r.leave_type_name}</span></td>
                  <td>{fmt(r.start_date)}</td>
                  <td>{fmt(r.end_date)}</td>
                  <td>{r.days_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default TeamLeavesPanel;
