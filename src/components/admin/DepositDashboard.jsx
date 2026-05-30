import React, { useState, useEffect } from 'react';
import ConfirmModal from '../common/ConfirmModal';

function DepositDashboard({ user }) {
  const [deposits, setDeposits] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  // Replaces every former window.confirm — Electron returns null silently.
  const [confirmDialog, setConfirmDialog] = useState(null);

  const [formData, setFormData] = useState({
    userId: '',
    depositAmount: '',
    status: 'held',
    deductionStartMonth: 1,
    deductionEndMonth: 2
  });

  useEffect(() => {
    loadData();
  }, []);

  // Use ipcRenderer.invoke directly to bypass any preload-caching issues.
  // window.electron is created once per Electron window and won't pick up
  // newly added preload methods until the window is closed and re-opened.
  const invoke = (channel, args) => {

    if (window.ipcRenderer?.invoke) {
      // Only pass args if defined - avoid passing undefined as an argument
      if (args !== undefined) {
        return window.ipcRenderer.invoke(channel, args);
      } else {
        return window.ipcRenderer.invoke(channel);
      }
    }
    console.error('[INVOKE] ipcRenderer not available!');
    return Promise.reject(new Error('ipcRenderer not available'));
  };

  const loadData = async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      // Debug: Check if ipcRenderer is available

      let hasErrors = false;

      // Load deposits
      try {
        const depositResult = await invoke('deposit:getAll');

        if (depositResult.success) {
          setDeposits(depositResult.data || []);
        } else {
          console.error('[DEPOSITS] Failed to load deposits:', depositResult.message);
          hasErrors = true;
        }
      } catch (err) {
        console.error('[DEPOSITS] Exception loading deposits:', err);
        hasErrors = true;
      }

      // Load employees for dropdown
      try {
        const employeeResult = await invoke('employee:getAll');

        if (employeeResult.success) {
          setEmployees(employeeResult.data || []);
        } else {
          console.error('[DEPOSITS] Failed to load employees:', employeeResult.message);
          hasErrors = true;
        }
      } catch (err) {
        console.error('[DEPOSITS] Exception loading employees:', err);
        hasErrors = true;
      }

      if (hasErrors) {
        setErrorMessage('⚠️ Failed to load deposit or employee data. Check browser console for details. Make sure handlers are registered.');
      }
      setSuccessMessage('');
    } catch (error) {
      console.error('[DEPOSITS] Unexpected error:', error);
      setErrorMessage(error.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      userId: '',
      depositAmount: '',
      status: 'held',
      deductionStartMonth: 1,
      deductionEndMonth: 2
    });
    setEditingId(null);
  };

  const handleOpenEdit = (deposit) => {
    setFormData({
      userId: deposit.user_id,
      depositAmount: deposit.deposit_amount,
      status: deposit.status,
      deductionStartMonth: deposit.deduction_start_month || 1,
      deductionEndMonth: deposit.deduction_end_month || 2
    });
    setEditingId(deposit.id);
    setShowModal(true);
  };

  const handleOpenAdd = () => {
    resetForm();
    setShowModal(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (!formData.userId || !formData.depositAmount) {
      setErrorMessage('Please fill in all required fields');
      return;
    }

    try {
      let result;
      if (editingId) {
        result = await invoke('deposit:update', {
          id: editingId,
          depositAmount: parseFloat(formData.depositAmount),
          status: formData.status,
          deductionStartMonth: parseInt(formData.deductionStartMonth),
          deductionEndMonth: parseInt(formData.deductionEndMonth),
          currentUserId: user?.id
        });
      } else {
        result = await invoke('deposit:create', {
          userId: formData.userId,
          depositAmount: parseFloat(formData.depositAmount),
          deductionStartMonth: parseInt(formData.deductionStartMonth),
          deductionEndMonth: parseInt(formData.deductionEndMonth),
          currentUserId: user?.id
        });
      }

      if (result.success) {
        setSuccessMessage(editingId ? 'Deposit updated successfully!' : 'Deposit created successfully!');
        resetForm();
        setShowModal(false);
        await loadData();
      } else {
        setErrorMessage(result.message || 'Operation failed');
      }
    } catch (error) {
      console.error('Error saving deposit:', error);
      setErrorMessage(error.message || 'An error occurred');
    }
  };

  const handleDelete = (depositId, employeeName) => {
    setConfirmDialog({
      title: 'Delete deposit?',
      message: `The probation deposit for ${employeeName} will be removed. This action cannot be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
      onConfirm: () => doDelete(depositId)
    });
  };

  const doDelete = async (depositId) => {
    try {
      const result = await invoke('deposit:delete', { id: depositId, currentUserId: user?.id });
      if (result.success) {
        setSuccessMessage('Deposit deleted successfully!');
        await loadData();
      } else {
        setErrorMessage(result.message || 'Failed to delete deposit');
      }
    } catch (error) {
      console.error('Error deleting deposit:', error);
      setErrorMessage('Failed to delete deposit');
    }
  };

  const calculateEligibilityStatus = (eligibilityDate) => {
    if (!eligibilityDate) return { text: 'Unknown', color: '#6b7280' };
    const today = new Date();
    const eligible = new Date(eligibilityDate);
    if (today >= eligible) {
      return { text: 'Eligible Now', color: '#10b981' };
    }
    const daysLeft = Math.ceil((eligible - today) / (1000 * 60 * 60 * 24));
    return { text: `${daysLeft} days left`, color: '#f59e0b' };
  };

  const totalHeld = deposits.reduce((sum, d) => sum + d.deposit_amount, 0);

  if (loading) return <div className="loading">Loading deposit data...</div>;

  return (
    <div className="manager-container">
      <div className="manager-header">
        <h2>Security Deposit Management</h2>
        <p style={{ margin: 0, color: 'var(--text-2, #9ca3af)', fontSize: '14px' }}>
          Manage employee security deposits. Employees are eligible to receive deposits 2 years from their joining date.
        </p>
      </div>

      {errorMessage && (
        <div style={{ background: '#ef4444', color: 'white', padding: '12px 16px', borderRadius: '6px', marginBottom: '16px', fontSize: '13px' }}>
          ✗ {errorMessage}
        </div>
      )}

      {successMessage && (
        <div style={{ background: '#10b981', color: 'white', padding: '12px 16px', borderRadius: '6px', marginBottom: '16px', fontSize: '13px' }}>
          ✓ {successMessage}
        </div>
      )}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">💰</div>
          <div className="stat-content">
            <h3>Total Held Deposits</h3>
            <p className="stat-number">₹{totalHeld.toLocaleString('en-IN')}</p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">👥</div>
          <div className="stat-content">
            <h3>Active Deposits</h3>
            <p className="stat-number">{deposits.length}</p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">📅</div>
          <div className="stat-content">
            <h3>Eligible Now</h3>
            <p className="stat-number">
              {deposits.filter(d => {
                if (!d.eligibility_date) return false;
                return new Date() >= new Date(d.eligibility_date);
              }).length}
            </p>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <button
          onClick={handleOpenAdd}
          className="btn btn-primary"
          style={{ padding: '10px 16px', fontSize: '13px' }}
        >
          ➕ Add Deposit
        </button>
      </div>

      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th>Employee Name</th>
              <th>Joining Date</th>
              <th>Eligibility Date</th>
              <th>Status</th>
              <th>Deposit Amount</th>
              <th>Deduction Period</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {deposits.length === 0 ? (
              <tr>
                <td colSpan="7" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-2)' }}>
                  No deposits found. Click "Add Deposit" to create one.
                </td>
              </tr>
            ) : (
              deposits.map(deposit => {
                const statusInfo = calculateEligibilityStatus(deposit.eligibility_date);
                return (
                  <tr key={deposit.id}>
                    <td><strong>{deposit.user_name}</strong></td>
                    <td>{deposit.joining_date ? new Date(deposit.joining_date).toLocaleDateString() : '-'}</td>
                    <td>
                      {deposit.eligibility_date ? (
                        <div>
                          <div>{new Date(deposit.eligibility_date).toLocaleDateString()}</div>
                          <span style={{ fontSize: '11px', color: statusInfo.color }}>
                            {statusInfo.text}
                          </span>
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td>
                      <span className={`badge badge-${deposit.status === 'held' ? 'warning' : 'success'}`}>
                        {deposit.status}
                      </span>
                    </td>
                    <td><strong>₹{deposit.deposit_amount.toLocaleString('en-IN')}</strong></td>
                    <td style={{ fontSize: '12px' }}>
                      Month {deposit.deduction_start_month} - {deposit.deduction_end_month}
                    </td>
                    <td style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button
                        onClick={() => handleOpenEdit(deposit)}
                        className="btn btn-secondary"
                        style={{ padding: '6px 12px', fontSize: '12px' }}
                      >
                        ✏️ Edit
                      </button>
                      <button
                        onClick={() => handleDelete(deposit.id, deposit.user_name)}
                        className="btn btn-danger"
                        style={{ padding: '6px 12px', fontSize: '12px' }}
                      >
                        🗑️ Delete
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: 'var(--bg-1, #0f1419)',
            border: '1px solid var(--border, #374151)',
            borderRadius: '8px',
            padding: '24px',
            maxWidth: '500px',
            width: '90%',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)'
          }}>
            <h2 style={{ margin: '0 0 20px 0', fontSize: '18px', fontWeight: 600 }}>
              {editingId ? 'Edit Deposit' : 'Add New Deposit'}
            </h2>

            <form onSubmit={handleSave}>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '6px', fontWeight: 500 }}>
                  Employee *
                </label>
                <select
                  value={formData.userId}
                  onChange={e => setFormData({ ...formData, userId: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid var(--border, #374151)',
                    background: 'var(--bg-2, #111827)',
                    color: 'var(--text, #f3f4f6)',
                    fontSize: '13px',
                    boxSizing: 'border-box'
                  }}
                  disabled={!!editingId}
                >
                  <option value="">Select an employee</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.fullName} - {emp.email}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '6px', fontWeight: 500 }}>
                  Deposit Amount (₹) *
                </label>
                <input
                  type="number"
                  value={formData.depositAmount}
                  onChange={e => setFormData({ ...formData, depositAmount: e.target.value })}
                  placeholder="Enter deposit amount"
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid var(--border, #374151)',
                    background: 'var(--bg-2, #111827)',
                    color: 'var(--text, #f3f4f6)',
                    fontSize: '13px',
                    boxSizing: 'border-box'
                  }}
                  min="0"
                  step="100"
                />
              </div>

              <div style={{ marginBottom: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', marginBottom: '6px', fontWeight: 500 }}>
                    Start Month
                  </label>
                  <input
                    type="number"
                    value={formData.deductionStartMonth}
                    onChange={e => setFormData({ ...formData, deductionStartMonth: e.target.value })}
                    min="1"
                    max="12"
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--border, #374151)',
                      background: 'var(--bg-2, #111827)',
                      color: 'var(--text, #f3f4f6)',
                      fontSize: '13px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', marginBottom: '6px', fontWeight: 500 }}>
                    End Month
                  </label>
                  <input
                    type="number"
                    value={formData.deductionEndMonth}
                    onChange={e => setFormData({ ...formData, deductionEndMonth: e.target.value })}
                    min="1"
                    max="12"
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--border, #374151)',
                      background: 'var(--bg-2, #111827)',
                      color: 'var(--text, #f3f4f6)',
                      fontSize: '13px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '6px', fontWeight: 500 }}>
                  Status
                </label>
                <select
                  value={formData.status}
                  onChange={e => setFormData({ ...formData, status: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid var(--border, #374151)',
                    background: 'var(--bg-2, #111827)',
                    color: 'var(--text, #f3f4f6)',
                    fontSize: '13px',
                    boxSizing: 'border-box'
                  }}
                >
                  <option value="held">Held</option>
                  <option value="released">Released</option>
                  <option value="forfeited">Forfeited</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ flex: 1, padding: '8px' }}
                >
                  {editingId ? 'Update' : 'Create'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ flex: 1, padding: '8px' }}
                  onClick={() => {
                    setShowModal(false);
                    resetForm();
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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

export default DepositDashboard;
