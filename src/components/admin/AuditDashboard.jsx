import React, { useEffect, useMemo, useState } from 'react';
import ConfirmModal from '../common/ConfirmModal';

const ACTION_BADGE_COLORS = {
  LOGIN: '#10b981',
  LOGOUT: '#6b7280',
  INITIAL_PASSWORD_SET: '#8b5cf6',
  CHANGE_PASSWORD: '#8b5cf6',
  EMPLOYEE_CREATE: '#3b82f6',
  EMPLOYEE_UPDATE: '#f59e0b',
  EMPLOYEE_DELETE: '#ef4444',
  LEAVE_APPROVE: '#10b981',
  LEAVE_LEAD_APPROVE: '#22c55e',
  LEAVE_REJECT: '#ef4444',
  UPDATE: '#f59e0b',
  DELETE: '#ef4444',
  CREATE: '#3b82f6'
};

function actionColor(action) {
  return ACTION_BADGE_COLORS[action] || '#6b7280';
}

function safeParse(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function diffObjects(oldObj, newObj) {
  if (oldObj == null && newObj == null) return [];
  if (oldObj == null) return Object.entries(newObj || {}).map(([k, v]) => ({ key: k, before: undefined, after: v, kind: 'added' }));
  if (newObj == null) return Object.entries(oldObj || {}).map(([k, v]) => ({ key: k, before: v, after: undefined, kind: 'removed' }));
  if (typeof oldObj !== 'object' || typeof newObj !== 'object') {
    return [{ key: '(value)', before: oldObj, after: newObj, kind: 'changed' }];
  }
  const keys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
  return Array.from(keys)
    .map(k => ({ key: k, before: oldObj[k], after: newObj[k] }))
    .filter(d => JSON.stringify(d.before) !== JSON.stringify(d.after))
    .map(d => ({
      ...d,
      kind: d.before === undefined ? 'added' : d.after === undefined ? 'removed' : 'changed'
    }));
}

function formatVal(v) {
  if (v === undefined) return <span style={{ color: '#6b7280' }}>—</span>;
  if (v === null) return <span style={{ color: '#6b7280' }}>null</span>;
  if (typeof v === 'object') return <code style={{ fontSize: '11px' }}>{JSON.stringify(v)}</code>;
  return String(v);
}

function AuditDashboard() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  // Filters
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [entityFilter, setEntityFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  // Replaces window.confirm — Electron returns null with no dialog.
  const [confirmDialog, setConfirmDialog] = useState(null);

  useEffect(() => {
    loadAuditLogs();
  }, []);

  const loadAuditLogs = async () => {
    setLoading(true);
    try {
      const result = await window.electron.getAuditLogs({});
      if (result.success) {
        setLogs(result.data || []);
        setErrorMessage('');
      } else {
        setErrorMessage(result.message || 'Failed to load audit logs');
      }
    } catch (error) {
      console.error('Failed to load audit logs:', error);
      setErrorMessage('Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  };

  const distinctActions = useMemo(() => Array.from(new Set(logs.map(l => l.action))).sort(), [logs]);
  const distinctEntities = useMemo(() => Array.from(new Set(logs.map(l => l.entity_type))).sort(), [logs]);
  const distinctUsers = useMemo(() => {
    const map = new Map();
    logs.forEach(l => { if (l.user_id) map.set(l.user_id, l.user_name || l.user_id); });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    const startTs = startDate ? new Date(startDate + 'T00:00:00').getTime() : null;
    const endTs = endDate ? new Date(endDate + 'T23:59:59').getTime() : null;

    return logs.filter(log => {
      if (actionFilter !== 'all' && log.action !== actionFilter) return false;
      if (entityFilter !== 'all' && log.entity_type !== entityFilter) return false;
      if (userFilter !== 'all' && log.user_id !== userFilter) return false;
      if (startTs || endTs) {
        const ts = new Date(log.timestamp).getTime();
        if (startTs && ts < startTs) return false;
        if (endTs && ts > endTs) return false;
      }
      if (q) {
        const hay = [
          log.user_name, log.action, log.entity_type, log.entity_id,
          log.old_value, log.new_value, log.ip_address
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [logs, search, actionFilter, entityFilter, userFilter, startDate, endDate]);

  const stats = useMemo(() => {
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const last24h = logs.filter(l => new Date(l.timestamp).getTime() >= dayAgo).length;
    const topAction = distinctActions
      .map(a => ({ a, c: logs.filter(l => l.action === a).length }))
      .sort((x, y) => y.c - x.c)[0];
    return {
      total: logs.length,
      last24h,
      topAction: topAction ? `${topAction.a} (${topAction.c})` : '—',
      filtered: filteredLogs.length
    };
  }, [logs, filteredLogs, distinctActions]);

  const resetFilters = () => {
    setSearch('');
    setActionFilter('all');
    setEntityFilter('all');
    setUserFilter('all');
    setStartDate('');
    setEndDate('');
  };

  const clearLogs = (filtered = false) => {
    const title = filtered ? `Purge ${filteredLogs.length} filtered log(s)?` : 'Purge ALL audit logs?';
    const message = filtered
      ? 'Only the rows that match your current filters will be deleted. This cannot be undone.'
      : 'EVERY audit log row will be permanently deleted. This is irreversible — make sure you have a backup first.';
    setConfirmDialog({
      title,
      message,
      confirmLabel: filtered ? 'Purge filtered' : 'Purge ALL',
      tone: 'danger',
      onConfirm: () => doClearLogs(filtered)
    });
  };

  const doClearLogs = async (filtered = false) => {
    try {
      const filters = {};
      if (filtered) {
        if (actionFilter !== 'all') filters.action = actionFilter;
        if (entityFilter !== 'all') filters.entityType = entityFilter;
        if (userFilter !== 'all') filters.userId = userFilter;
        if (startDate) filters.startDate = new Date(startDate + 'T00:00:00').toISOString();
        if (endDate) filters.endDate = new Date(endDate + 'T23:59:59').toISOString();
      }

      const result = await window.electron.clearAuditLogs({ filtered, filters });
      if (result.success) {
        setErrorMessage('');
        await loadAuditLogs();
      } else {
        setErrorMessage(result.message || 'Failed to clear logs');
      }
    } catch (error) {
      console.error('Failed to clear audit logs:', error);
      setErrorMessage('Failed to clear logs');
    }
  };

  const exportCsv = () => {
    const headers = ['Timestamp', 'User', 'Action', 'Entity Type', 'Entity ID', 'IP', 'Old Value', 'New Value'];
    const rows = filteredLogs.map(l => [
      l.timestamp,
      l.user_name || l.user_id || '',
      l.action || '',
      l.entity_type || '',
      l.entity_id || '',
      l.ip_address || '',
      l.old_value || '',
      l.new_value || ''
    ]);
    const csv = [headers, ...rows]
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-logs-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="loading">Loading audit logs...</div>;

  return (
    <div className="manager-container">
      <div className="manager-header">
        <h2>Audit Log &amp; System Security</h2>
        <p style={{ margin: 0, color: 'var(--text-2, #9ca3af)', fontSize: '14px' }}>
          Tracks logins, password changes, employee CRUD, and leave approvals — click any row to see the before/after diff.
        </p>
      </div>

      {errorMessage && (
        <div className="error-message" style={{ margin: '12px 0' }}>
          <span>✗ {errorMessage}</span>
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', margin: '16px 0' }}>
        {[
          { label: 'Total Logs', value: stats.total },
          { label: 'Filtered', value: stats.filtered },
          { label: 'Last 24h', value: stats.last24h },
          { label: 'Top Action', value: stats.topAction }
        ].map((s) => (
          <div key={s.label} style={{
            background: 'var(--bg-3, #1f2937)',
            border: '1px solid var(--border, #374151)',
            borderRadius: '8px',
            padding: '14px 16px'
          }}>
            <div style={{ fontSize: '12px', color: 'var(--text-2, #9ca3af)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {s.label}
            </div>
            <div style={{ fontSize: '22px', fontWeight: 700, marginTop: '4px' }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: '10px',
        marginBottom: '16px',
        background: 'var(--bg-3, #1f2937)',
        border: '1px solid var(--border, #374151)',
        borderRadius: '8px',
        padding: '12px'
      }}>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Search user, action, ID, value..."
          style={{ gridColumn: 'span 2', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)' }}
        />
        <select value={actionFilter} onChange={e => setActionFilter(e.target.value)} style={selectStyle}>
          <option value="all">All actions</option>
          {distinctActions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={entityFilter} onChange={e => setEntityFilter(e.target.value)} style={selectStyle}>
          <option value="all">All entities</option>
          {distinctEntities.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        <select value={userFilter} onChange={e => setUserFilter(e.target.value)} style={selectStyle}>
          <option value="all">All users</option>
          {distinctUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={selectStyle} />
        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={selectStyle} />
        <button onClick={resetFilters} className="btn btn-secondary" style={{ padding: '8px 12px' }}>Reset</button>
        <button onClick={loadAuditLogs} className="btn btn-secondary" style={{ padding: '8px 12px' }}>↻ Refresh</button>
        <button onClick={exportCsv} className="btn btn-primary" style={{ padding: '8px 12px' }} disabled={filteredLogs.length === 0}>
          ⬇ Export CSV
        </button>
        <button
          onClick={() => clearLogs(true)}
          style={{ padding: '8px 12px', background: '#dc2626', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}
          disabled={filteredLogs.length === 0}
          title="Delete all filtered logs"
        >
          🗑 Clear Filtered
        </button>
        <button
          onClick={() => clearLogs(false)}
          style={{ padding: '8px 12px', background: '#991b1b', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}
          title="Delete ALL logs (permanent)"
        >
          ⚠ Clear All
        </button>
      </div>

      {/* Table */}
      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: '40px' }}></th>
              <th>Timestamp</th>
              <th>User</th>
              <th>Action</th>
              <th>Entity</th>
              <th>ID</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.length === 0 ? (
              <tr>
                <td colSpan="7" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-2)' }}>
                  {logs.length === 0 ? 'No audit logs yet.' : 'No logs match your filters.'}
                </td>
              </tr>
            ) : filteredLogs.map(log => {
              const isExpanded = expandedId === log.id;
              const oldParsed = safeParse(log.old_value);
              const newParsed = safeParse(log.new_value);
              const diffs = diffObjects(oldParsed, newParsed);
              const hasDetail = log.old_value || log.new_value;
              return (
                <React.Fragment key={log.id}>
                  <tr
                    onClick={() => hasDetail && setExpandedId(isExpanded ? null : log.id)}
                    style={{ cursor: hasDetail ? 'pointer' : 'default' }}
                    title={hasDetail ? 'Click to view diff' : 'No before/after values for this action'}
                  >
                    <td style={{ textAlign: 'center', color: 'var(--text-2)' }}>
                      {hasDetail ? (isExpanded ? '▼' : '▶') : ''}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{new Date(log.timestamp).toLocaleString()}</td>
                    <td>{log.user_name || <span style={{ color: 'var(--text-2)' }}>{log.user_id || 'system'}</span>}</td>
                    <td>
                      <span className="badge" style={{ backgroundColor: actionColor(log.action), color: 'white', fontSize: '11px' }}>
                        {log.action}
                      </span>
                    </td>
                    <td>{log.entity_type || '-'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--text-2)' }}>
                      {log.entity_id ? log.entity_id.substring(0, 16) + (log.entity_id.length > 16 ? '…' : '') : '-'}
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: '11px' }}>{log.ip_address || '-'}</td>
                  </tr>
                  {isExpanded && hasDetail && (
                    <tr>
                      <td colSpan="7" style={{ background: 'var(--bg-2, #111827)', padding: '16px' }}>
                        {diffs.length > 0 ? (
                          <div>
                            <div style={{ marginBottom: '8px', fontSize: '12px', color: 'var(--text-2)' }}>
                              {diffs.length} field{diffs.length === 1 ? '' : 's'} changed:
                            </div>
                            <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                              <thead>
                                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                  <th style={diffHeaderStyle}>Field</th>
                                  <th style={diffHeaderStyle}>Before</th>
                                  <th style={diffHeaderStyle}>After</th>
                                </tr>
                              </thead>
                              <tbody>
                                {diffs.map(d => (
                                  <tr key={d.key} style={{ borderBottom: '1px solid var(--border)' }}>
                                    <td style={diffCellStyle}><strong>{d.key}</strong></td>
                                    <td style={{ ...diffCellStyle, color: d.kind === 'added' ? 'var(--text-2)' : '#f87171' }}>
                                      {formatVal(d.before)}
                                    </td>
                                    <td style={{ ...diffCellStyle, color: d.kind === 'removed' ? 'var(--text-2)' : '#34d399' }}>
                                      {formatVal(d.after)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                            <div>
                              <div style={{ fontSize: '12px', color: 'var(--text-2)', marginBottom: '4px' }}>Old value</div>
                              <pre style={prePreviewStyle}>{log.old_value || '—'}</pre>
                            </div>
                            <div>
                              <div style={{ fontSize: '12px', color: 'var(--text-2)', marginBottom: '4px' }}>New value</div>
                              <pre style={prePreviewStyle}>{log.new_value || '—'}</pre>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {confirmDialog && (
        <ConfirmModal
          isOpen={true}
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          tone={confirmDialog.tone}
          onConfirm={confirmDialog.onConfirm}
          onClose={() => setConfirmDialog(null)}
        />
      )}
    </div>
  );
}

const selectStyle = {
  padding: '8px 10px',
  borderRadius: '6px',
  border: '1px solid var(--border, #374151)',
  background: 'var(--bg-2, #111827)',
  color: 'var(--text, #f3f4f6)',
  fontSize: '13px'
};

const diffHeaderStyle = {
  textAlign: 'left',
  padding: '6px 8px',
  fontSize: '12px',
  color: 'var(--text-2)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px'
};

const diffCellStyle = {
  padding: '6px 8px',
  verticalAlign: 'top',
  fontFamily: 'ui-monospace, monospace',
  fontSize: '12px',
  wordBreak: 'break-word'
};

const prePreviewStyle = {
  margin: 0,
  padding: '8px',
  background: 'var(--bg-3, #1f2937)',
  borderRadius: '4px',
  fontSize: '11px',
  overflow: 'auto',
  maxHeight: '200px'
};

export default AuditDashboard;
