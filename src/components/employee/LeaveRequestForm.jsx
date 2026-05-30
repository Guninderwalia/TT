import React, { useState, useEffect } from 'react';

function LeaveRequestForm({ user }) {
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [balances, setBalances] = useState([]);
  const [requests, setRequests] = useState([]);
  const [formData, setFormData] = useState({
    leaveType: '',
    startDate: '',
    endDate: '',
    reason: ''
  });

  useEffect(() => {
    loadData();
  }, [user.id]);

  const loadData = async () => {
    try {
      const balanceResult = await window.electron.getLeaveBalance(user.id);
      const requestsResult = await window.electron.getLeaveRequests(user.id);

      if (balanceResult.success) {
        setBalances(balanceResult.data);
        if (balanceResult.data.length > 0) {
          setLeaveTypes(balanceResult.data);
        }
      }
      if (requestsResult.success) {
        setRequests(requestsResult.data);
      }
    } catch (error) {
      console.error('Failed to load leave data:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.leaveType || !formData.startDate || !formData.endDate) {
      window.toast.warning('Please fill all required fields');
      return;
    }

    // Same fallback used in LeaveCalendar — the user object can come from
    // multiple auth flows that name the id field differently.
    const myId = user?.id || user?.user_id || user?.userId || user?.uid;
    if (!myId) {
      window.toast.error('Could not identify the logged-in user. Please sign out and sign in again.');
      return;
    }

    try {
      const result = await window.electron.requestLeave(
        formData.leaveType,
        formData.startDate,
        formData.endDate,
        formData.reason,
        myId
      );
      if (result.success) {
        setFormData({ leaveType: '', startDate: '', endDate: '', reason: '' });
        loadData();
      }
    } catch (error) {
      console.error('Failed to request leave:', error);
    }
  };

  return (
    <div className="manager-container">
      <div className="manager-header">
        <h2>Leave Management</h2>
      </div>

      <div className="form-section">
        <h3>Leave Balance</h3>
        <div className="stats-grid">
          {Array.isArray(balances) ? (
            balances.map(balance => (
              <div key={balance.id} className="stat-card">
                <div className="stat-icon">📅</div>
                <div className="stat-content">
                  <h3>{balance.leave_type_name}</h3>
                  <p className="stat-number">{balance.remaining} / {balance.total_allocated}</p>
                </div>
              </div>
            ))
          ) : (
            <p style={{ color: 'var(--text-3)' }}>No leave data available</p>
          )}
        </div>
      </div>

      <div className="form-section">
        <h3>Request Leave</h3>
        <form className="form-grid" onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Leave Type *</label>
            <select
              value={formData.leaveType}
              onChange={(e) => setFormData({ ...formData, leaveType: e.target.value })}
            >
              <option value="">Select Leave Type</option>
              {Array.isArray(balances) && balances.map(balance => (
                <option key={balance.id} value={balance.leave_type_id}>
                  {balance.leave_type_name} ({balance.remaining} available)
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>From Date *</label>
            <input
              type="date"
              value={formData.startDate}
              onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>To Date *</label>
            <input
              type="date"
              value={formData.endDate}
              onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
            />
          </div>
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label>Reason</label>
            <textarea
              value={formData.reason}
              onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
              placeholder="Please provide a reason for your leave..."
            />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">Submit Request</button>
          </div>
        </form>
      </div>

      <div className="form-section">
        <h3>Your Leave Requests</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Leave Type</th>
              <th>From</th>
              <th>To</th>
              <th>Days</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {Array.isArray(requests) ? (
              requests.map(req => (
                <tr key={req.id}>
                  <td>{req.leave_type_name}</td>
                  <td>{req.start_date}</td>
                  <td>{req.end_date}</td>
                  <td>{req.days_count}</td>
                  <td>
                    <span className={`badge badge-${req.status === 'approved' ? 'success' : req.status === 'pending' ? 'warning' : 'danger'}`}>
                      {req.status}
                    </span>
                </td>
              </tr>
              ))
            ) : (
              <tr>
                <td colSpan="5" style={{ textAlign: 'center', padding: '20px', color: 'var(--text-3)' }}>
                  No leave requests found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default LeaveRequestForm;
