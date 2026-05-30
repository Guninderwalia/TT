import React, { useState, useEffect } from 'react';
import TimeLogging from '../employee/TimeLogging';
import '../../styles/admin-timelogging.css';

function AdminTimeLogging() {
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    loadDepartments();
    loadEmployees();
  }, []);

  const loadDepartments = async () => {
    try {
      const result = await window.electron.getDepartments();
      if (result.success) setDepartments(result.data || []);
    } catch (error) {
      console.error('Failed to load departments:', error);
      setErrorMessage('Failed to load departments');
    }
  };

  const loadEmployees = async (deptId = '') => {
    try {
      const result = deptId
        ? await window.electron.getDepartmentEmployees(deptId)
        : await window.electron.getEmployees();
      if (result.success) setEmployees(result.data || []);
    } catch (error) {
      console.error('Failed to load employees:', error);
      setErrorMessage('Failed to load employees');
    }
  };

  const handleDepartmentChange = (deptId) => {
    setSelectedDepartment(deptId);
    setSelectedEmployee('');
    loadEmployees(deptId);
  };

  const selectedEmployeeObj = employees.find(
    e => (e.id || e.empId) === selectedEmployee
  );

  return (
    <div className="admin-timelogging-container">
      <div className="timelogging-header">
        <h2>Employee Time Logging Management</h2>
        <p>Select an employee to view and manage their time logs, activities, and analytics</p>
      </div>

      {errorMessage && (
        <div className="error-message">
          <span>✗ {errorMessage}</span>
        </div>
      )}

      <div className="filters-section">
        <div className="filter-group">
          <label htmlFor="department-filter">Department</label>
          <select
            id="department-filter"
            value={selectedDepartment}
            onChange={(e) => handleDepartmentChange(e.target.value)}
            className="filter-select"
          >
            <option value="">All Departments</option>
            {departments.map(dept => (
              <option key={dept.id || dept.deptId} value={dept.id || dept.deptId}>
                {dept.name || dept.deptName}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="employee-filter">Employee</label>
          <select
            id="employee-filter"
            value={selectedEmployee}
            onChange={(e) => setSelectedEmployee(e.target.value)}
            className="filter-select"
          >
            <option value="">Select Employee</option>
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
            <strong>Viewing as admin:</strong>{' '}
            {selectedEmployeeObj.full_name || selectedEmployeeObj.fullName || selectedEmployeeObj.name}
            <span className="admin-viewing-note">
              {' '}— full edit access on this employee's time logs and activities
            </span>
          </div>
          {/*
            Re-mount the embedded employee component whenever the selected
            employee changes so its internal state (selected date, time log
            buffer, events, graph range) resets cleanly per employee.
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
          <p>Select an employee to view their time logs, activities, and analytics</p>
        </div>
      )}
    </div>
  );
}

export default AdminTimeLogging;
