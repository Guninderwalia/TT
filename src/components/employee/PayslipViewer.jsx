import React, { useState, useEffect } from 'react';

function PayslipViewer({ user }) {
  const [payrolls, setPayrolls] = useState([]);
  const [selectedPayroll, setSelectedPayroll] = useState(null);

  useEffect(() => {
    loadPayrolls();
  }, [user.id]);

  const loadPayrolls = async () => {
    try {
      const result = await window.electron.getPayrollHistory(user.id);
      if (result.success) {
        setPayrolls(result.data);
        if (result.data.length > 0) {
          setSelectedPayroll(result.data[0]);
        }
      }
    } catch (error) {
      console.error('Failed to load payrolls:', error);
    }
  };

  return (
    <div className="manager-container">
      <div className="manager-header">
        <h2>My Payslips & Earnings</h2>
      </div>

      <div className="form-section">
        <h3>Select Payroll Period</h3>
        <div className="payroll-selector">
          {payrolls.map(pr => (
            <button
              key={pr.id}
              className={`payroll-btn ${selectedPayroll?.id === pr.id ? 'active' : ''}`}
              onClick={() => setSelectedPayroll(pr)}
            >
              {pr.payroll_month}/{pr.payroll_year}
            </button>
          ))}
        </div>
      </div>

      {selectedPayroll && (
        <div className="payslip-container">
          <div className="payslip-header">
            <h2>Payslip</h2>
            <p>{selectedPayroll.payroll_month}/{selectedPayroll.payroll_year}</p>
          </div>

          <div className="payslip-grid">
            <div className="payslip-section">
              <h3>Earnings</h3>
              <div className="payslip-row">
                <span>Base Salary</span>
                <span>₹{selectedPayroll.base_salary?.toLocaleString()}</span>
              </div>
              <div className="payslip-row">
                <span>Overtime</span>
                <span>₹{selectedPayroll.overtime_amount?.toLocaleString() || 0}</span>
              </div>
              <div className="payslip-row">
                <span>Bonus</span>
                <span>₹{selectedPayroll.bonus_amount?.toLocaleString() || 0}</span>
              </div>
              <div className="payslip-row total">
                <span>Gross Earnings</span>
                <span>₹{selectedPayroll.gross_amount?.toLocaleString()}</span>
              </div>
            </div>

            <div className="payslip-section">
              <h3>Deductions</h3>
              <div className="payslip-row">
                <span>Attendance Deduction</span>
                <span>-₹{selectedPayroll.attendance_deduction?.toLocaleString() || 0}</span>
              </div>
              <div className="payslip-row">
                <span>Probation Deposit</span>
                <span>-₹{selectedPayroll.probation_deposit_deduction?.toLocaleString() || 0}</span>
              </div>
              <div className="payslip-row total">
                <span>Net Salary</span>
                <span>₹{selectedPayroll.net_amount?.toLocaleString()}</span>
              </div>
            </div>
          </div>

          <div className="payslip-status">
            <span className={`badge badge-${selectedPayroll.status === 'Done' ? 'success' : 'warning'}`}>
              {selectedPayroll.status}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export default PayslipViewer;
