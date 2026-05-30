import React, { useState, useEffect } from 'react';
import ConfirmModal from '../common/ConfirmModal';

function HolidayManagement() {
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [formData, setFormData] = useState({ date: '', name: '', description: '' });
  const [editingHoliday, setEditingHoliday] = useState(null);
  const [creating, setCreating] = useState(false);
  // Replaces every former window.confirm(...) call (silently fails in Electron).
  const [confirmDialog, setConfirmDialog] = useState(null);

  useEffect(() => {
    loadHolidays();
  }, []);

  const loadHolidays = async () => {
    try {
      const result = await window.electron.getHolidaysList();
      if (result.success) {
        setHolidays(result.data);
      }
    } catch (error) {
      console.error('Failed to load holidays:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateHoliday = async () => {
    if (!formData.date.trim()) {
      window.toast.warning('Holiday date is required');
      return;
    }
    if (!formData.name.trim()) {
      window.toast.warning('Holiday name is required');
      return;
    }

    setCreating(true);
    try {
      const result = await window.electron.createHoliday(
        formData.date,
        formData.name,
        formData.description
      );
      if (result.success) {
        window.toast.success('Holiday created successfully!');
        setFormData({ date: '', name: '', description: '' });
        setShowForm(false);
        await loadHolidays();
      } else {
        window.toast.error('Error creating holiday: ' + (result.message || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error creating holiday:', error);
      window.toast.error('Error creating holiday: ' + error.message);
    } finally {
      setCreating(false);
    }
  };

  const handleEditHoliday = (holiday) => {
    setEditingHoliday(holiday);
    setFormData({
      date: holiday.date || '',
      name: holiday.name || '',
      description: holiday.description || ''
    });
    setShowEditForm(true);
  };

  const handleUpdateHoliday = async () => {
    if (!formData.date.trim()) {
      window.toast.warning('Holiday date is required');
      return;
    }
    if (!formData.name.trim()) {
      window.toast.warning('Holiday name is required');
      return;
    }

    setCreating(true);
    try {
      const result = await window.electron.updateHoliday(
        editingHoliday.id,
        formData.date,
        formData.name,
        formData.description
      );
      if (result.success) {
        window.toast.success('Holiday updated successfully!');
        setFormData({ date: '', name: '', description: '' });
        setShowEditForm(false);
        setEditingHoliday(null);
        await loadHolidays();
      } else {
        window.toast.error('Error updating holiday: ' + (result.message || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error updating holiday:', error);
      window.toast.error('Error updating holiday: ' + error.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteHoliday = (holidayId, holidayName) => {
    setConfirmDialog({
      title: 'Delete holiday?',
      message: `"${holidayName}" will be removed from the holiday calendar. This action cannot be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
      onConfirm: () => doDeleteHoliday(holidayId)
    });
  };

  const doDeleteHoliday = async (holidayId) => {
    try {
      const result = await window.electron.deleteHoliday(holidayId);
      if (result.success) {
        window.toast.success('Holiday deleted successfully!');
        await loadHolidays();
      } else {
        window.toast.error('Error deleting holiday: ' + (result.message || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error deleting holiday:', error);
      window.toast.error('Error deleting holiday: ' + error.message);
    }
  };

  // Format date for display (assumes YYYY-MM-DD format)
  const formatDate = (dateStr) => {
    try {
      const date = new Date(dateStr + 'T00:00:00');
      return date.toLocaleDateString('en-GB', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };

  if (loading) return <div className="loading">Loading holidays...</div>;

  return (
    <div className="manager-container">
      <div className="manager-header">
        <h2>Holiday Management</h2>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            className="btn btn-primary"
            onClick={() => setShowForm(true)}
          >
            + Add Holiday
          </button>
        </div>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>Add New Holiday</h3>
            <form onSubmit={e => { e.preventDefault(); handleCreateHoliday(); }}>
              <div className="form-group">
                <label>Holiday Date *</label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={e => setFormData({...formData, date: e.target.value})}
                  disabled={creating}
                />
              </div>
              <div className="form-group">
                <label>Holiday Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  placeholder="e.g., Christmas, Diwali, New Year"
                  disabled={creating}
                />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={formData.description}
                  onChange={e => setFormData({...formData, description: e.target.value})}
                  placeholder="Holiday description (optional)"
                  rows="3"
                  disabled={creating}
                />
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)} disabled={creating}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  {creating ? 'Creating...' : 'Add Holiday'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEditForm && editingHoliday && (
        <div className="modal-overlay" onClick={() => setShowEditForm(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>Edit Holiday</h3>
            <form onSubmit={e => { e.preventDefault(); handleUpdateHoliday(); }}>
              <div className="form-group">
                <label>Holiday Date *</label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={e => setFormData({...formData, date: e.target.value})}
                  disabled={creating}
                />
              </div>
              <div className="form-group">
                <label>Holiday Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  placeholder="e.g., Christmas, Diwali, New Year"
                  disabled={creating}
                />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={formData.description}
                  onChange={e => setFormData({...formData, description: e.target.value})}
                  placeholder="Holiday description (optional)"
                  rows="3"
                  disabled={creating}
                />
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowEditForm(false)} disabled={creating}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  {creating ? 'Updating...' : 'Update Holiday'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="table-wrapper">
        {holidays.length === 0 ? (
          <div className="empty-state">
            <p>No holidays added yet. Click "Add Holiday" to get started.</p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Holiday Name</th>
                <th>Description</th>
                <th style={{textAlign: 'center'}}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {holidays.map(holiday => (
                <tr key={holiday.id}>
                  <td><strong>{formatDate(holiday.date)}</strong></td>
                  <td>{holiday.name}</td>
                  <td>{holiday.description || '-'}</td>
                  <td style={{textAlign: 'center', display: 'flex', gap: '8px', justifyContent: 'center'}}>
                    <button
                      className="btn btn-secondary"
                      onClick={() => handleEditHoliday(holiday)}
                      style={{padding: '6px 12px', fontSize: '12px'}}
                    >
                      ✏️ Edit
                    </button>
                    <button
                      className="btn btn-danger"
                      onClick={() => handleDeleteHoliday(holiday.id, holiday.name)}
                      style={{padding: '6px 12px', fontSize: '12px'}}
                    >
                      🗑️ Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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

export default HolidayManagement;
