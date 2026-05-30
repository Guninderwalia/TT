import React, { useState, useEffect } from 'react';
import ReasonPrompt from '../common/ReasonPrompt';

function AdminLeaveApprovals({ user }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  // Leave id we're rejecting — when set, the reason-prompt modal is shown.
  const [rejectFor, setRejectFor] = useState(null);

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

      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Department</th>
              <th>Leave Type</th>
              <th>From</th>
              <th>To</th>
              <th>Days</th>
              <th>Reason</th>
              <th>Stage</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {requests.length === 0 ? (
              <tr>
                <td colSpan="10" style={{ textAlign: 'center', padding: '30px' }}>
                  No pending leave requests assigned to you.
                </td>
              </tr>
            ) : (
              requests.map(req => (
                <tr key={req.id}>
                  <td>{req.full_name}</td>
                  <td>{req.department_name || '-'}</td>
                  <td>{req.leave_type_name}</td>
                  <td>{req.start_date}</td>
                  <td>{req.end_date}</td>
                  <td>{req.days_count}</td>
                  <td>{req.reason || '-'}</td>
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
          title="Reject Leave Request"
          message="Add a reason for the employee — leave blank to use a default note."
          placeholder="e.g. Conflicts with project deadline"
          submitLabel="Reject"
          cancelLabel="Cancel"
          onSubmit={(reason) => doReject(rejectFor, reason)}
          onClose={() => setRejectFor(null)}
        />
      )}
    </div>
  );
}

export default AdminLeaveApprovals;
