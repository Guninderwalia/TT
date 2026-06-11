import React, { useState, useEffect } from 'react';
import ReasonPrompt from '../common/ReasonPrompt';
import { downloadLeaveAttachment } from '../../utils/leaveAttachment';

function AdminLeaveApprovals({ user }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  // Leave id we're rejecting — when set, the reason-prompt modal is shown.
  // Special value 'BULK' indicates a bulk reject is being collected.
  const [rejectFor, setRejectFor] = useState(null);
  // Multi-select: ids of requests currently checked for bulk action.
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    loadAssignedRequests();
  }, [user?.id]);

  const loadAssignedRequests = async () => {
    setLoading(true);
    try {
      const result = await window.electron.getAssignedLeaveRequests(user.id);
      if (result.success) {
        setRequests(result.data || []);
        setErrorMessage('');
        // Drop any selections that no longer exist in the refreshed list.
        setSelectedIds(prev => {
          const stillThere = new Set((result.data || []).map(r => r.id));
          const next = new Set();
          prev.forEach(id => { if (stillThere.has(id)) next.add(id); });
          return next;
        });
      } else {
        setErrorMessage(result.message || 'Failed to load leave requests');
      }
    } catch (error) {
      console.error('Failed to load assigned leave requests:', error);
      setErrorMessage('Failed to load leave requests');
    } finally {
      setLoading(false);
    }
  };

  // Coalesce common id field names so the call works regardless of which
  // auth flow produced the user object.
  const myId = user?.id || user?.user_id || user?.userId || user?.uid;

  const handleApprove = async (requestId) => {
    try {
      const result = await window.electron.approveLeaveRequest(requestId, 'Approved by administrator', myId);
      if (result.success) {
        window.toast.success(result.message || 'Leave approved.');
        loadAssignedRequests();
      } else {
        const msg = result.message || result.error || 'Failed to approve';
        setErrorMessage(msg);
        window.toast.error('Could not approve: ' + msg);
      }
    } catch (error) {
      console.error('Failed to approve leave:', error);
      setErrorMessage('Failed to approve leave: ' + error.message);
      window.toast.error('Failed to approve leave: ' + error.message);
    }
  };

  // Performs the rejection once the reason modal collects input. Reason may
  // be an empty string — the handler stores a default in that case.
  const doReject = async (requestId, reason) => {
    try {
      const result = await window.electron.rejectLeaveRequest(
        requestId,
        reason || 'Rejected by administrator',
        myId
      );
      if (result.success) {
        window.toast.success(result.message || 'Leave rejected.');
        loadAssignedRequests();
      } else {
        const msg = result.message || result.error || 'Failed to reject';
        setErrorMessage(msg);
        window.toast.error('Could not reject: ' + msg);
      }
    } catch (error) {
      console.error('Failed to reject leave:', error);
      setErrorMessage('Failed to reject leave: ' + error.message);
      window.toast.error('Failed to reject leave: ' + error.message);
    }
  };

  // -- Bulk helpers -----------------------------------------------------------
  const toggleOne = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds(prev => {
      if (prev.size === requests.length) return new Set();
      return new Set(requests.map(r => r.id));
    });
  };

  const handleBulkApprove = async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    setBulkBusy(true);
    try {
      const results = await Promise.all(
        ids.map(id =>
          window.electron.approveLeaveRequest(id, 'Approved by administrator (bulk)', myId)
            .then(r => ({ id, ok: !!r?.success, msg: r?.message || r?.error || '' }))
            .catch(err => ({ id, ok: false, msg: err?.message || 'Failed' }))
        )
      );
      const ok = results.filter(r => r.ok).length;
      const fail = results.length - ok;
      if (ok > 0) window.toast.success(`Approved ${ok} request${ok === 1 ? '' : 's'}.`);
      if (fail > 0) window.toast.error(`${fail} request${fail === 1 ? '' : 's'} failed to approve.`);
      setSelectedIds(new Set());
      loadAssignedRequests();
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
          window.electron.rejectLeaveRequest(id, reason || 'Rejected by administrator (bulk)', myId)
            .then(r => ({ id, ok: !!r?.success, msg: r?.message || r?.error || '' }))
            .catch(err => ({ id, ok: false, msg: err?.message || 'Failed' }))
        )
      );
      const ok = results.filter(r => r.ok).length;
      const fail = results.length - ok;
      if (ok > 0) window.toast.success(`Rejected ${ok} request${ok === 1 ? '' : 's'}.`);
      if (fail > 0) window.toast.error(`${fail} request${fail === 1 ? '' : 's'} failed to reject.`);
      setSelectedIds(new Set());
      loadAssignedRequests();
    } finally {
      setBulkBusy(false);
    }
  };

  if (loading) return <div className="loading">Loading leave requests...</div>;

  const renderStageBadge = (req) => {
    if (req.status === 'lead_approved') {
      return (
        <span
          className="badge"
          style={{ backgroundColor: '#10b981', color: 'white' }}
          title={req.lead_full_name ? `Approved by ${req.lead_full_name}` : 'Approved by team lead'}
        >
          ✓ Lead approved
        </span>
      );
    }
    return <span className="badge badge-warning">Pending</span>;
  };

  const allSelected = requests.length > 0 && selectedIds.size === requests.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < requests.length;

  return (
    <div className="manager-container">
      <div className="manager-header">
        <h2>Leave Approvals</h2>
        <p style={{ margin: 0, color: 'var(--text-2, #9ca3af)', fontSize: '14px' }}>
          Final approval queue — requests already approved by the team lead, plus requests from departments without a lead.
        </p>
      </div>

      {errorMessage && (
        <div className="error-message" style={{ margin: '12px 0' }}>
          <span>✗ {errorMessage}</span>
        </div>
      )}

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
                  disabled={requests.length === 0}
                  title="Select all"
                />
              </th>
              <th>Employee</th>
              <th>Department</th>
              <th>Leave Type</th>
              <th>From</th>
              <th>To</th>
              <th>Days</th>
              <th>Reason</th>
              <th>Document</th>
              <th>Stage</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {requests.length === 0 ? (
              <tr>
                <td colSpan="11" style={{ textAlign: 'center', padding: '30px' }}>
                  No pending leave requests assigned to you.
                </td>
              </tr>
            ) : (
              requests.map(req => (
                <tr key={req.id} style={selectedIds.has(req.id) ? { background: 'rgba(16,185,129,0.06)' } : null}>
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(req.id)}
                      onChange={() => toggleOne(req.id)}
                    />
                  </td>
                  <td>{req.full_name}</td>
                  <td>{req.department_name || '-'}</td>
                  <td>{req.leave_type_name}</td>
                  <td>{req.start_date}</td>
                  <td>{req.end_date}</td>
                  <td>{req.days_count}</td>
                  <td>{req.reason || '-'}</td>
                  <td>
                    {req.attachment_path ? (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => downloadLeaveAttachment(req)}
                        style={{ padding: '4px 10px', fontSize: '12px' }}
                        title={req.attachment_name || 'Download supporting document'}
                      >
                        📎 View
                      </button>
                    ) : (
                      <span style={{ opacity: 0.5 }}>-</span>
                    )}
                  </td>
                  <td>{renderStageBadge(req)}</td>
                  <td style={{ display: 'flex', gap: '8px' }}>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handleApprove(req.id)}
                      style={{ padding: '6px 12px', fontSize: '12px' }}
                    >
                      ✓ Approve
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => setRejectFor(req.id)}
                      style={{ padding: '6px 12px', fontSize: '12px' }}
                    >
                      ✗ Reject
                    </button>
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
          placeholder="e.g. Conflicts with project deadline"
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

export default AdminLeaveApprovals;
