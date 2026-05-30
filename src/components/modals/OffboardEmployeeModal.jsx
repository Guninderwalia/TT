import React, { useState } from 'react';
import { AlertCircle, UserMinus } from 'lucide-react';

const EXIT_REASONS = [
  { value: 'Resignation', label: 'Resignation' },
  { value: 'Termination', label: 'Termination' },
  { value: 'Contract End', label: 'Contract End' },
  { value: 'Retirement', label: 'Retirement' }
];

const CHECKLIST_ITEMS = [
  { key: 'finalSalary',      label: 'Final salary / payroll processed' },
  { key: 'depositRefunded',  label: 'Security deposit refunded' },
  { key: 'equipmentReturned', label: 'Company equipment returned' },
  { key: 'accessRevoked',    label: 'System access revoked' }
];

function todayIso() {
  const d = new Date();
  return d.toISOString().split('T')[0];
}

function OffboardEmployeeModal({ employee, currentUserId, onSuccess, onCancel }) {
  const [lastWorkingDay, setLastWorkingDay] = useState(todayIso());
  const [exitReason, setExitReason] = useState('');
  const [exitNotes, setExitNotes] = useState('');
  const [checklist, setChecklist] = useState(
    Object.fromEntries(CHECKLIST_ITEMS.map(i => [i.key, false]))
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isFormValid = () => Boolean(lastWorkingDay && exitReason);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isFormValid() || loading) return;
    setError('');
    setLoading(true);
    try {
      const res = await window.electron.offboardEmployee(
        employee.id,
        lastWorkingDay,
        exitReason,
        exitNotes,
        checklist,
        currentUserId
      );
      if (res?.success) {
        const cancelled = res?.data?.pendingLeavesCancelled || 0;
        const msg = cancelled > 0
          ? `${employee.fullName || employee.full_name} offboarded. ${cancelled} pending leave request${cancelled === 1 ? '' : 's'} auto-cancelled.`
          : `${employee.fullName || employee.full_name} offboarded.`;
        onSuccess?.(msg);
      } else {
        setError(res?.message || 'Failed to offboard employee');
      }
    } catch (err) {
      setError(err?.message || 'Failed to offboard employee');
    } finally {
      setLoading(false);
    }
  };

  const toggleChecklist = (key) => {
    setChecklist(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const employeeName = employee.fullName || employee.full_name || 'this employee';

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <UserMinus size={22} color="#f59e0b" />
          Offboard {employeeName}
        </h3>
        <p style={{ color: 'var(--text-2)', fontSize: 13, marginBottom: 20 }}>
          Marks the employee as inactive, captures the exit details, and auto-cancels any pending
          leave requests that start after the last working day. This is reversible from the Past
          Employees view.
        </p>

        {error && (
          <div className="error-message" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="lastWorkingDay">Last Working Day *</label>
            <input
              id="lastWorkingDay"
              type="date"
              value={lastWorkingDay}
              onChange={(e) => setLastWorkingDay(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="exitReason">Exit Reason *</label>
            <select
              id="exitReason"
              value={exitReason}
              onChange={(e) => setExitReason(e.target.value)}
              required
              disabled={loading}
            >
              <option value="">Select a reason…</option>
              {EXIT_REASONS.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="exitNotes">Notes (optional)</label>
            <textarea
              id="exitNotes"
              value={exitNotes}
              onChange={(e) => setExitNotes(e.target.value)}
              rows={3}
              placeholder="Anything HR should remember about this departure…"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label style={{ marginBottom: 10 }}>Exit Checklist</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {CHECKLIST_ITEMS.map(item => (
                <label
                  key={item.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 12px',
                    background: 'var(--bg-3)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    fontWeight: 400,
                    fontSize: 13
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checklist[item.key]}
                    onChange={() => toggleChecklist(item.key)}
                    disabled={loading}
                    style={{ width: 16, height: 16, cursor: loading ? 'not-allowed' : 'pointer' }}
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
            <p style={{ marginTop: 8, fontSize: 11, color: 'var(--text-3)' }}>
              Checklist state is recorded in the audit log for compliance — it doesn't block offboarding.
            </p>
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onCancel}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-danger"
              disabled={!isFormValid() || loading}
            >
              {loading ? 'Offboarding…' : 'Confirm Offboarding'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default OffboardEmployeeModal;
