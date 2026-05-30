import React, { useState, useEffect } from 'react';
import TimeLogging from '../employee/TimeLogging';
import '../../styles/admin-timelogging.css';

/**
 * LeadTimeLogging
 *
 * Mirrors AdminTimeLogging but department-scoped: a lead can only inspect time
 * logs for employees in their own department. The lead's own time logs are
 * reached via the separate "My Time Logging" route on the sidebar.
 */
function LeadTimeLogging({ user }) {
  const [employees, setEmployees] = useState([]);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Read either snake_case or camelCase on the user object — the rest of the
  // codebase mixes both depending on which API the value came through.
  const departmentId = user?.department_id || user?.departmentId || null;
  const departmentName = user?.department_name || user?.departmentName || 'your department';

  useEffect(() => {
    if (departmentId) loadTeam(departmentId);
  }, [departmentId]);

  const loadTeam = async (deptId) => {
    try {
      const result = await window.electron.getDepartmentEmployees(deptId);
      if (result?.success) {
        // Sort by name for easier scanning.
        const list = (result.data || []).slice().sort((a, b) =>
          String(a.full_name || a.fullName || '').localeCompare(String(b.full_name || b.fullName || ''))
        );
        setEmployees(list);
      } else {
        setErrorMessage('Failed to load team members');
      }
    } catch (error) {
      console.error('[LeadTimeLogging] failed to load team:', error);
      setErrorMessage('Failed to load team members: ' + error.message);
    }
  };

  const selectedEmployeeObj = employees.find(
    e => (e.id || e.empId) === selectedEmployee
  );

  if (!departmentId) {
    return (
      <div className="admin-timelogging-container">
        <div className="empty-state">
          <p>This view is only available to department leads. Please contact admin if you should be set up as one.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-timelogging-container">
      <div className="timelogging-header">
        <h2>Team Time Logging</h2>
        <p>Inspect time logs and activities for anyone in {departmentName}.</p>
      </div>

      {errorMessage && (
        <div className="error-message">
          <span>✗ {errorMessage}</span>
        </div>
      )}

      <div className="filters-section">
        <div className="filter-group">
          <label htmlFor="employee-filter">Team Member</label>
          <select
            id="employee-filter"
            value={selectedEmployee}
            onChange={(e) => setSelectedEmployee(e.target.value)}
            className="filter-select"
          >
            <option value="">Select a team member</option>
            {employees.map(emp => (
              <option key={emp.id || emp.empId} value={emp.id || emp.empId}>
                {emp.full_name || emp.fullName || emp.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {selectedEmployeeObj ? (
        <div className="admin-employee-view">
          <div className="admin-viewing-banner">
            <strong>Viewing as lead:</strong>{' '}
            {selectedEmployeeObj.full_name || selectedEmployeeObj.fullName || selectedEmployeeObj.name}
            <span className="admin-viewing-note">
              {' '}— read access to time logs and activities for your team
            </span>
          </div>
          {/*
            Re-mount the embedded TimeLogging component when the selected
            employee changes so its internal state (date, time buffer, events,
            graph range) resets per employee. We pass the team member as the
            "user" prop — TimeLogging will load THEIR logs but the button-based
            stamping will still work if the lead wants to correct a missed
            sign-off on their team's behalf (loading those buttons stamps for
            the team member, audit-logged with the lead's currentUserId by the
            shared handler).
          */}
          <TimeLogging
            key={selectedEmployeeObj.id || selectedEmployeeObj.empId}
            user={{
              id: selectedEmployeeObj.id || selectedEmployeeObj.empId,
              fullName:
                selectedEmployeeObj.full_name ||
                selectedEmployeeObj.fullName ||
                selectedEmployeeObj.name,
              email: selectedEmployeeObj.email
            }}
          />
        </div>
      ) : (
        <div className="empty-state">
          <p>Select a team member to view their time logs.</p>
        </div>
      )}
    </div>
  );
}

export default LeadTimeLogging;
