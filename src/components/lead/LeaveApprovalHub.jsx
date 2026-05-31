import React, { useState, useEffect } from 'react';
import ReasonPrompt from '../common/ReasonPrompt';

function LeaveApprovalHub({ user }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  // When set, renders the rejection-reason modal. Holds the leave id so we
  // know which request to reject once the user confirms. Special value 'BULK'
  // means a multi-row reject is being collected.
  const [rejectFor, setRejectFor] = useState(null);
  // Multi-select state for bulk approve/reject.
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    loadLeaveRequests();
  }, [user.department_id]);

  const loadLeaveRequests = async () => {
    try {
      // Pass the lead's own id so the backend filters their own requests out
      // of the queue. A lead must never see their own leave request as
      // something they can approve.
      const myId = user?.id || user?.user_id || user?.userId || user?.uid;
      const result = await window.electron.getDepartmentLeaveRequests(user.department_id, myId);
      if (result.success) {
        setRequests(result.data);
        // Drop selections that no longer exist after refresh.
        setSelectedIds(prev => {
          const still = new Set((result.data || []).filter(r => r.status === 'pending').map(r => r.id));
          const next = new Set();
          prev.forEach(id => { if (still.has(id)) next.add(id); });
          return next;
        });
      }
    } catch (error) {
      console.error('Failed to load leave requests:', error);
    } finally {
      setLoading(false);
    }
  };

  // Coalesce common id field names so the call works regardless of which
  // auth flow produced the user object (Electron vs web shim vs legacy).
  const myId = user?.id || user?.user_id || user?.userId || user?.uid;

  const handleApprove = async (requestId) => {
    try {
      const result = await window.electron.approveLeaveRequest(requestId, 'Approved by department lead', myId);
      if (result.success) {
        window.toast.success(result.message || 'Leave approved — forwarded to admin for final sign-off.');
        loadLeaveRequests();
      } else {
        window.toast.error('Could not approve: ' + (result.message || result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Failed to approve leave:', error);
      window.toast.error('Failed to approve leave: ' + error.message);
    }
  };

  // Confirms the rejection once the modal collects the reason. The reason
  // may be empty — the handler will store a sensible default.
  const doReject = async (requestId, reason) => {
    try {
      const result = await window.electron.rejectLeaveRequest(
        requestId,
        reason || 'Rejected by department lead',
        myId
      );
      if (result.success) {
        window.toast.success(result.message || 'Leave request rejected.');
        loadLeaveRequests();
      } else {
        window.toast.error('Could not reject: ' + (result.message || result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Failed to reject leave:', error);
      window.toast.error('Failed to reject leave: ' + error.message);
    }
  };

  // -- Bulk helpers -----------------------------------------------------------
  const pending = requests.filter(r => r.status === 'pending');

  const toggleOne = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds(prev => {
      if (prev.size === pending.length) return new Set();
      return new Set(pending.map(r => r.id));
    });
  };

  const handleBulkApprove = async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    setBulkBusy(true);
    try {
      const results = await Promise.all(
        ids.map(id =>
          window.electron.approveLeaveRequest(id, 'Approved by department lead (bulk)', myId)
            .then(r => ({ id, ok: !!r?.success }))
            .catch(() => ({ id, ok: false }))
        )
      );
      const ok = results.filter(r => r.ok).length;
      const fail = results.length - ok;
      if (ok > 0) window.toast.success(`Approved ${ok} request${ok === 1 ? '' : 's'}.`);
      if (fail > 0) window.toast.error(`${fail} request${fail === 1 ? '' : 's'} failed to approve.`);
      setSelectedIds(new Set());
      loadLeaveRequests();
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkReject = async (reason) => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    setBulkBusy(true);
    try {
      const results = await Promise.all(
        ids.map(id =>
          window.electron.rejectLeaveRequest(id, reason || 'Rejected by department lead (bulk)', myId)
            .then(r => ({ id, ok: !!r?.success }))
            .catch(() => ({ id, ok: false }))
        )
      );
      const ok = results.filter(r => r.ok).length;
      const fail = results.length - ok;
      if (ok > 0) window.toast.success(`Rejected ${ok} request${ok === 1 ? '' : 's'}.`);
      if (fail > 0) window.toast.error(`${fail} request${fail === 1 ? '' : 's'} failed to reject.`);
      setSelectedIds(new Set());
      loadLeaveRequests();
    } finally {
      setBulkBusy(false);
    }
  };

  if (loading) return <div className="loading">Loading leave requests...</div>;

  const allSelected = pending.length > 0 && selectedIds.size === pending.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < pending.length;

  return (
    <div className="manager-container">
      <div className="manager-header">
        <h2>Leave Approval Hub</h2>
      </div>

      {/* Bulk action bar — only shown when at least one row is selected. */}
      {selectedIds.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '12px',
          padding: '10px 14px', margin: '12px 0',
          background: 'rgba(16,185,129,0.08)',
          border: '1px solid rgba(16,185,129,0.3)',
          borderRadius: '8px'
        }}>
          <strong style={{ color: 'var(--text-1, #e5e7eb)' }}>
            {selectedIds.size} selected
          </strong>
          <button
            className="btn btn-primary btn-sm"
            disabled={bulkBusy}
            onClick={handleBulkApprove}
            style={{ padding: '6px 12px', fontSize: '12px' }}
          >
            ✓ Approve Selected
          </button>
          <button
            className="btn btn-danger btn-sm"
            disabled={bulkBusy}
            onClick={() => setRejectFor('BULK')}
            style={{ padding: '6px 12px', fontSize: '12px' }}
          >
            ✗ Reject Selected
          </button>
          <button
            className="btn btn-secondary btn-sm"
            disabled={bulkBusy}
            onClick={() => setSelectedIds(new Set())}
            style={{ padding: '6px 12px', fontSize: '12px', marginLeft: 'auto' }}
          >
            Clear
          </button>
        </div>
      )}

      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: '36px', textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={el => { if (el) el.indeterminate = someSelected; }}
                  onChange={toggleAll}
                  disabled={pending.length === 0}
                  title="Select all"
                />
              </th>
              <th>Employee</th>
              <th>Leave Type</th>
              <th>From Date</th>
              <th>To Date</th>
              <th>Days</th>
              <th>Reason</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pending.length === 0 ? (
              <tr>
                <td colSpan="9" style={{ textAlign: 'center', padding: '30px' }}>
                  No pending leave requests.
                </td>
              </tr>
            ) : (
              pending.map(req => (
                <tr key={req.id} style={selectedIds.has(req.id) ? { background: 'rgba(16,185,129,0.06)' } : null}>
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(req.id)}
                      onChange={() => toggleOne(req.id)}
                    />
                  </td>
                  <td>{req.full_name}</td>
                  <td>{req.leave_type_name}</td>
                  <td>{req.start_date}</td>
                  <td>{req.end_date}</td>
                  <td>{req.days_count}</td>
                  <td style={{ maxWidth: '260px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {req.reason || <span style={{ opacity: 0.5 }}>—</span>}
                  </td>
                  <td><span className="badge badge-warning">Pending</span></td>
                  <td>
                    <button className="btn btn-primary btn-sm" onClick={() => handleApprove(req.id)} style={{ marginRight: '6px' }}>Approve</button>
                    <button className="btn btn-danger btn-sm" onClick={() => setRejectFor(req.id)}>Reject</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {rejectFor && (
        <ReasonPrompt
          title={rejectFor === 'BULK' ? `Reject ${selectedIds.size} Leave Request${selectedIds.size === 1 ? '' : 's'}` : 'Reject Leave Request'}
          message={rejectFor === 'BULK'
            ? 'This reason will be sent to every selected employee — leave blank to use a default note.'
            : 'Add a reason for the employee — leave blank to use a default note.'}
          placeholder="e.g. Insufficient cover that week"
          submitLabel="Reject"
          cancelLabel="Cancel"
          onSubmit={(reason) => {
            if (rejectFor === 'BULK') {
              handleBulkReject(reason);
            } else {
              doReject(rejectFor, reason);
            }
          }}
          onClose={() => setRejectFor(null)}
        />
      )}
    </div>
  );
}

export default LeaveApprovalHub;
