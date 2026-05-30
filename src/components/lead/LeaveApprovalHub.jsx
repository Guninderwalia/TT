import React, { useState, useEffect } from 'react';
import ReasonPrompt from '../common/ReasonPrompt';

function LeaveApprovalHub({ user }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  // When set, renders the rejection-reason modal. Holds the leave id so we
  // know which request to reject once the user confirms.
  const [rejectFor, setRejectFor] = useState(null);

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

  if (loading) return <div className="loading">Loading leave requests...</div>;

  return (
    <div className="manager-container">
      <div className="manager-header">
        <h2>Leave Approval Hub</h2>
      </div>

      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
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
            {requests.filter(r => r.status === 'pending').map(req => (
              <tr key={req.id}>
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
            ))}
          </tbody>
        </table>
      </div>

      {rejectFor && (
        <ReasonPrompt
          title="Reject Leave Request"
          message="Add a reason for the employee — leave blank to use a default note."
          placeholder="e.g. Insufficient cover that week"
          submitLabel="Reject"
          cancelLabel="Cancel"
          onSubmit={(reason) => doReject(rejectFor, reason)}
          onClose={() => setRejectFor(null)}
        />
      )}
    </div>
  );
}

export default LeaveApprovalHub;
