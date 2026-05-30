import React, { useState, useEffect } from 'react';
import ConfirmModal from '../common/ConfirmModal';

function DepartmentManager() {
  const [departments, setDepartments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', description: '' });
  const [editingDept, setEditingDept] = useState(null);
  // When set, ConfirmModal renders — replaces every former window.confirm
  // call (Electron silently returns null from window.confirm).
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadDepartments();
    loadEmployees();
  }, []);


  const loadDepartments = async () => {
    try {
      const result = await window.electron.getDepartments();
      if (result.success) {
        setDepartments(result.data);
      }
    } catch (error) {
      console.error('Failed to load departments:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadEmployees = async () => {
    try {
      const result = await window.electron.getEmployees();
      if (result.success) {
        setEmployees(result.data);
      }
    } catch (error) {
      console.error('Failed to load employees:', error);
    }
  };

  const getDepartmentTeamLead = (departmentId) => {
    // Find all employees in this department who are marked as team lead
    const departmentTeamLeads = employees.filter(
      emp => emp.departmentId === departmentId && emp.isLead === true
    );

    if (departmentTeamLeads.length > 0) {
      // Return the first team lead's name
      const teamLead = departmentTeamLeads[0];
      return teamLead.fullName || teamLead.full_name || 'Unknown Team Lead';
    }

    return null;
  };

  const handleCreateDepartment = async () => {
    if (!formData.name.trim()) {
      window.toast.warning('Department name is required');
      return;
    }

    setCreating(true);
    try {
      const result = await window.electron.createDepartment(formData.name, formData.description);
      if (result.success) {
        window.toast.success('Department created successfully!');
        setFormData({ name: '', description: '' });
        setShowForm(false);
        await loadDepartments();
      } else {
        window.toast.error('Error creating department: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error creating department:', error);
      window.toast.error('Error creating department: ' + error.message);
    } finally {
      setCreating(false);
    }
  };

  const handleEditDepartment = (dept) => {
    setEditingDept(dept);
    setFormData({ name: dept.name, description: dept.description || '' });
    setShowEditForm(true);
  };

  const handleUpdateDepartment = async () => {
    if (!formData.name.trim()) {
      window.toast.warning('Department name is required');
      return;
    }

    setCreating(true);
    try {
      const result = await window.electron.updateDepartment(editingDept.id, formData.name, formData.description);
      if (result.success) {
        window.toast.success('Department updated successfully!');
        setFormData({ name: '', description: '' });
        setShowEditForm(false);
        setEditingDept(null);
        await loadDepartments();
      } else {
        window.toast.error('Error updating department: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error updating department:', error);
      window.toast.error('Error updating department: ' + error.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteDepartment = (deptId, deptName) => {
    setConfirmDialog({
      title: 'Delete department?',
      message: `"${deptName}" will be removed. Employees in it will be left unassigned. This action cannot be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
      onConfirm: () => doDeleteDepartment(deptId)
    });
  };

  const doDeleteDepartment = async (deptId) => {
    try {
      const result = await window.electron.deleteDepartment(deptId);
      if (result.success) {
        window.toast.success('Department deleted successfully!');
        await loadDepartments();
      } else {
        window.toast.error('Error deleting department: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error deleting department:', error);
      window.toast.error('Error deleting department: ' + error.message);
    }
  };

  if (loading) return <div className="loading">Loading departments...</div>;

  return (
    <div className="manager-container">
      <div className="manager-header">
        <h2>Department Management</h2>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            className="btn btn-primary"
            onClick={() => setShowForm(true)}
          >
            + Create Department
          </button>
        </div>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>Create New Department</h3>
            <form onSubmit={e => { e.preventDefault(); handleCreateDepartment(); }}>
              <div className="form-group">
                <label>Department Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  placeholder="e.g., Engineering, HR, Sales"
                  disabled={creating}
                />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={formData.description}
                  onChange={e => setFormData({...formData, description: e.target.value})}
                  placeholder="Department description (optional)"
                  rows="3"
                  disabled={creating}
                />
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)} disabled={creating}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  {creating ? 'Creating...' : 'Create Department'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEditForm && editingDept && (
        <div className="modal-overlay" onClick={() => setShowEditForm(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>Edit Department</h3>
            <form onSubmit={e => { e.preventDefault(); handleUpdateDepartment(); }}>
              <div className="form-group">
                <label>Department Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  placeholder="e.g., Engineering, HR, Sales"
                  disabled={creating}
                />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={formData.description}
                  onChange={e => setFormData({...formData, description: e.target.value})}
                  placeholder="Department description (optional)"
                  rows="3"
                  disabled={creating}
                />
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowEditForm(false)} disabled={creating}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  {creating ? 'Updating...' : 'Update Department'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="table-wrapper">
        {departments.length === 0 ? (
          <div className="empty-state">
            <p>No departments created yet. Click "Create Department" to get started.</p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Department Name</th>
                <th>Description</th>
                <th>Team Lead</th>
                <th style={{textAlign: 'center'}}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {departments.map(dept => {
                const teamLeadName = getDepartmentTeamLead(dept.id);
                return (
                <tr key={dept.id}>
                  <td><strong>{dept.name}</strong></td>
                  <td>{dept.description || '-'}</td>
                  <td>
                    {teamLeadName ? (
                      <span className="badge" style={{backgroundColor: '#f59e0b', color: 'white'}}>👔 {teamLeadName}</span>
                    ) : (
                      <span style={{color: 'var(--text-2)'}}>Unassigned</span>
                    )}
                  </td>
                  <td style={{textAlign: 'center', display: 'flex', gap: '8px', justifyContent: 'center'}}>
                    <button
                      className="btn btn-secondary"
                      onClick={() => handleEditDepartment(dept)}
                      style={{padding: '6px 12px', fontSize: '12px'}}
                    >
                      ✏️ Edit
                    </button>
                    <button
                      className="btn btn-danger"
                      onClick={() => handleDeleteDepartment(dept.id, dept.name)}
                      style={{padding: '6px 12px', fontSize: '12px'}}
                    >
                      🗑️ Delete
                    </button>
                  </td>
                </tr>
              );
              })}
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

export default DepartmentManager;
