import React, { useState, useEffect } from 'react';
import { buildSalarySlipDoc, generatePdf } from '../../utils/pdf/pdfGenerator';
import logoImage from '../../assets/logo.png';

function PayrollManager() {
  const [departments, setDepartments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [payrollData, setPayrollData] = useState(null);
  const [loading, setLoading] = useState(false);
  // Pulse v2 — paid status (item 5) for the currently-shown employee/month.
  const [paidStatus, setPaidStatus] = useState({ isPaid: false, paidAt: null });
  const [savingPaid, setSavingPaid] = useState(false);

  const handleTogglePaid = async () => {
    if (!payrollData || !selectedEmployee) return;
    setSavingPaid(true);
    try {
      const sc = payrollData.salaryComponents;
      const res = await window.electron.setPayrollPaidStatus({
        userId: selectedEmployee,
        month,
        year,
        isPaid: !paidStatus.isPaid,
        baseSalary: parseFloat(sc.baseSalary) || 0,
        grossAmount: parseFloat(sc.grossSalary) || 0,
        netAmount: parseFloat(sc.netSalary) || 0
      });
      if (res?.success) {
        setPaidStatus({ isPaid: res.data.isPaid, paidAt: res.data.paidAt });
        window.toast?.success?.(res.message || 'Updated');
      } else {
        window.toast?.error?.(res?.message || 'Could not update paid status');
      }
    } catch (e) {
      window.toast?.error?.('Error: ' + e.message);
    } finally {
      setSavingPaid(false);
    }
  };

  // Load departments on mount
  useEffect(() => {
    loadDepartments();
  }, []);

  // Load employees when department changes
  useEffect(() => {
    if (selectedDepartment) {
      loadEmployees(selectedDepartment);
      setSelectedEmployee('');
    }
  }, [selectedDepartment]);

  const loadDepartments = async () => {
    try {
      const result = await window.electron.getDepartments();
      if (result.success) {
        setDepartments(result.data || []);
      }
    } catch (error) {
      console.error('Failed to load departments:', error);
    }
  };

  const loadEmployees = async (departmentId) => {
    try {
      const result = await window.electron.getDepartmentEmployees(departmentId);
      if (result.success) {
        setEmployees(result.data || []);
      } else {
        console.error('[PAYROLL] Failed to load employees:', result.error);
        setEmployees([]);
      }
    } catch (error) {
      console.error('[PAYROLL] Exception loading employees:', error);
      setEmployees([]);
    }
  };

  const getWorkingDaysInMonth = (year, month) => {
    let workingDays = 0;
    const daysInMonth = new Date(year, month, 0).getDate();

    // Count working days (Monday-Saturday, exclude Sunday)
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(Date.UTC(year, month - 1, day));
      const dayOfWeek = date.getUTCDay();
      // Count Monday (1) to Saturday (6), exclude Sunday (0)
      if (dayOfWeek !== 0) {
        workingDays++;
      }
    }
    return workingDays;
  };

  const calculatePayroll = async () => {
    if (!selectedEmployee || !selectedDepartment) {
      window.toast.warning('Please select both department and employee');
      return;
    }

    setLoading(true);
    try {
      // Get employee details
      const empResult = await window.electron.getEmployeeById(selectedEmployee);
      if (!empResult.success || !empResult.data) {
        window.toast.error('Failed to load employee details');
        setLoading(false);
        return;
      }

      const employee = empResult.data;
      const baseSalary = employee.baseSalary || employee.base_salary || 0;


      // Get all dates in the month
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const endDate = new Date(year, month, 0).toISOString().split('T')[0];

      // Get attendance records for the month
      const attResult = await window.electron.getAttendanceHistory(selectedEmployee, startDate, endDate);
      const attendanceRecords = attResult.success ? (attResult.data || []) : [];

      // Calculate working days and attendance breakdown
      const workingDays = getWorkingDaysInMonth(year, month);
      let presentDays = 0;
      let absentDays = 0;
      let leaveDays = 0;
      let halfDays = 0;

      // Count each status using UTC to avoid timezone offset issues
      const daysInMonth = new Date(year, month, 0).getDate();

      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(Date.UTC(year, month - 1, day));
        const dayOfWeek = date.getUTCDay();
        if (dayOfWeek === 0) continue; // Skip Sundays

        const dateStr = date.toISOString().split('T')[0];
        const record = attendanceRecords.find(r => r.date === dateStr);

        if (!record) {
          // No record for this day, treat as absent
          absentDays++;
        } else {
          // Convert status to lowercase for case-insensitive comparison
          const status = record.status ? record.status.toLowerCase() : '';

          switch (status) {
            case 'present':
              presentDays++;
              break;
            case 'absent':
              absentDays++;
              break;
            case 'leave':
              leaveDays++;
              break;
            case 'half-day':
              halfDays++;
              break;
            default:
              // If status is not recognized, treat as absent
              absentDays++;
          }
        }
      }

      // Calculate payroll
      const dailyRate = baseSalary / workingDays;
      const payForPresent = presentDays * dailyRate;
      const payForLeave = leaveDays * dailyRate; // Paid leave
      const payForHalfDay = halfDays * dailyRate * 0.5;
      const absentDeduction = absentDays * dailyRate; // No pay for absent (already excluded from gross)

      const grossSalary = payForPresent + payForLeave + payForHalfDay;
      // Net salary equals gross salary (absent days already deducted via lower gross calculation)
      // In case of future tax deductions, they would be applied here
      const netSalary = grossSalary;

      setPayrollData({
        employee: employee,
        month,
        year,
        workingDays,
        attendanceBreakdown: {
          presentDays,
          absentDays,
          leaveDays,
          halfDays
        },
        salaryComponents: {
          baseSalary,
          dailyRate: dailyRate.toFixed(2),
          payForPresent: payForPresent.toFixed(2),
          payForLeave: payForLeave.toFixed(2),
          payForHalfDay: payForHalfDay.toFixed(2),
          absentDeduction: absentDeduction.toFixed(2),
          grossSalary: grossSalary.toFixed(2),
          netSalary: netSalary.toFixed(2)
        },
        attendanceRecords
      });

      // Pulse v2 — load whether this month is already marked paid.
      try {
        const ps = await window.electron.getPayrollPaidStatus(selectedEmployee, month, year);
        setPaidStatus(ps?.success ? { isPaid: ps.data.isPaid, paidAt: ps.data.paidAt } : { isPaid: false, paidAt: null });
      } catch (_) {
        setPaidStatus({ isPaid: false, paidAt: null });
      }
    } catch (error) {
      console.error('Failed to calculate payroll:', error);
      window.toast.error('Error calculating payroll: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount) => {
    return '₹' + parseFloat(amount).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  };

  // Build and download the same payslip as a styled PDF (instead of opening
  // a print window). Uses the shared pdfMake template.
  const handleDownloadSalarySlipPdf = async () => {
    if (!payrollData) return;
    try {
      const sc = payrollData.salaryComponents || {};
      const emp = payrollData.employee || {};
      const monthName = new Date(2000, payrollData.month - 1).toLocaleString('en-IN', { month: 'long' });
      // Earnings = whatever is positive on the slip; Deductions = whatever is negative.
      const earnings = [
        { label: 'Base Salary',     amount: sc.baseSalary || 0 },
        sc.overtimeAmount   ? { label: 'Overtime',          amount: sc.overtimeAmount }   : null,
        sc.allowances       ? { label: 'Allowances',        amount: sc.allowances }       : null,
        sc.bonusAmount      ? { label: 'Bonus',             amount: sc.bonusAmount }      : null
      ].filter(Boolean);
      const deductions = [
        sc.absentDeduction  ? { label: 'Absent Deduction',  amount: sc.absentDeduction }  : null,
        sc.lateDeduction    ? { label: 'Late Deduction',    amount: sc.lateDeduction }    : null,
        sc.expenses         ? { label: 'Expenses',          amount: sc.expenses }         : null,
        sc.taxDeduction     ? { label: 'Tax',               amount: sc.taxDeduction }     : null,
        sc.pfDeduction      ? { label: 'PF',                amount: sc.pfDeduction }      : null
      ].filter(Boolean);
      const doc = buildSalarySlipDoc({
        employeeName: emp.full_name || emp.fullName,
        employeeId: emp.id,
        designation: emp.role_name || emp.role || 'Employee',
        department: emp.department_name || emp.department || '',
        joiningDate: emp.joiningDate || emp.start_date,
        month: monthName,
        year: payrollData.year,
        baseSalary: sc.baseSalary,
        earnings,
        deductions,
        workingDays: payrollData.attendance?.workingDays,
        paidDays: payrollData.attendance?.paidDays,
        leavesTaken: payrollData.attendance?.leavesTaken,
        lopDays: payrollData.attendance?.lopDays,
        bankName: emp.bankName,
        accountNumber: emp.bankAccountNumber
      });
      const safeName = (emp.full_name || emp.fullName || 'employee').replace(/[^a-z0-9_\-]/gi, '_');
      const result = await generatePdf(doc, `Salary_Slip_${safeName}_${monthName}_${payrollData.year}.pdf`);
      if (result.success) {
        window.toast.success('Salary slip downloaded.');
      } else {
        window.toast.error('Could not generate: ' + (result.error || 'Unknown error'));
      }
    } catch (e) {
      console.error('[SALARY PDF] generation failed:', e);
      window.toast.error('Could not generate salary slip: ' + e.message);
    }
  };

  const printPayslip = () => {
    if (!payrollData) return;

    const monthName = new Date(2000, payrollData.month - 1).toLocaleString('en-IN', { month: 'long' });
    const printWindow = window.open('', '_blank');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Payslip - ${payrollData.employee.fullName || payrollData.employee.full_name}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: white;
            padding: 20px;
            color: #333;
          }
          .payslip {
            max-width: 900px;
            margin: 0 auto;
            background: white;
            border: 2px solid #f59e0b;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
          }
          .header {
            background: linear-gradient(135deg, #0f1f2e 0%, #1a3a52 100%);
            color: white;
            padding: 30px;
            text-align: center;
            border-bottom: 4px solid #f59e0b;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 20px;
          }
          .header-logo {
            width: 60px;
            height: 60px;
            border-radius: 8px;
            background: rgba(255,255,255,0.1);
            padding: 4px;
            flex-shrink: 0;
          }
          .header-logo img {
            width: 100%;
            height: 100%;
            object-fit: contain;
          }
          .header-content {
            flex: 1;
          }
          .header h1 { font-size: 28px; margin-bottom: 5px; }
          .header p { font-size: 13px; opacity: 0.9; margin: 3px 0; }
          .content { padding: 30px; }
          .section { margin-bottom: 30px; }
          .section-title {
            font-size: 14px;
            font-weight: bold;
            color: #0f1f2e;
            border-bottom: 2px solid #f59e0b;
            padding-bottom: 10px;
            margin-bottom: 15px;
            text-transform: uppercase;
            letter-spacing: 1px;
          }
          .employee-info {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 20px;
          }
          .info-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #eee;
            font-size: 14px;
          }
          .info-label { font-weight: 600; color: #555; }
          .info-value { color: #333; }
          .attendance-grid {
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            gap: 15px;
            margin-bottom: 20px;
          }
          .attendance-card {
            background: #f5f5f5;
            padding: 15px;
            border-radius: 6px;
            text-align: center;
            border-left: 4px solid #f59e0b;
          }
          .attendance-card .label {
            font-size: 12px;
            color: #666;
            margin-bottom: 8px;
          }
          .attendance-card .value {
            font-size: 24px;
            font-weight: bold;
            color: #1a1a2e;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
          }
          thead {
            background: #f5f5f5;
            border-top: 2px solid #ddd;
            border-bottom: 2px solid #ddd;
          }
          th {
            padding: 12px;
            text-align: left;
            font-weight: 600;
            color: #555;
            font-size: 13px;
          }
          td {
            padding: 12px;
            border-bottom: 1px solid #eee;
            font-size: 14px;
          }
          .label-column { width: 50%; }
          .amount-column { width: 50%; text-align: right; }
          tr.summary-row {
            background: #f9f9f9;
            font-weight: bold;
            border-top: 2px solid #ddd;
            border-bottom: 2px solid #ddd;
          }
          tr.summary-row td { padding: 15px 12px; }
          .positive { color: #27ae60; }
          .negative { color: #e74c3c; }
          .net-salary {
            background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
            padding: 20px;
            border-radius: 6px;
            text-align: center;
            margin: 20px 0;
            color: white;
          }
          .net-salary .label { font-size: 16px; margin-bottom: 10px; }
          .net-salary .amount { font-size: 36px; font-weight: bold; }
          .footer {
            text-align: center;
            padding: 20px;
            border-top: 1px solid #eee;
            font-size: 12px;
            color: #999;
          }
          .print-button-container {
            text-align: center;
            padding: 20px;
            border-top: 1px solid #eee;
          }
          .print-button-container button {
            padding: 10px 20px;
            background: #f59e0b;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            font-weight: bold;
            transition: background 0.2s;
          }
          .print-button-container button:hover {
            background: #d97706;
          }
          @media print {
            body { padding: 0; }
            .print-button-container { display: none; }
            .payslip { box-shadow: none; border: none; }
          }
        </style>
      </head>
      <body>
        <div class="payslip">
          <div class="header">
            <div class="header-logo">
              <img src="${logoImage}" alt="Task Tango Logo" />
            </div>
            <div class="header-content">
              <h1>PAYSLIP</h1>
              <p>Task Tango Financial Services</p>
              <p style="font-size: 12px; opacity: 0.8;">HR & Employee Management System</p>
            </div>
          </div>

          <div class="content">
            <!-- Employee Information -->
            <div class="section">
              <div class="section-title">Employee Information</div>
              <div class="employee-info">
                <div>
                  <div class="info-row">
                    <span class="info-label">Name:</span>
                    <span class="info-value">${payrollData.employee.fullName || payrollData.employee.full_name}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">Employee ID:</span>
                    <span class="info-value">${payrollData.employee.id}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">Department:</span>
                    <span class="info-value">${payrollData.employee.department_name || 'N/A'}</span>
                  </div>
                </div>
                <div>
                  <div class="info-row">
                    <span class="info-label">Month:</span>
                    <span class="info-value">${monthName} ${payrollData.year}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">Date of Issue:</span>
                    <span class="info-value">${new Date().toLocaleDateString('en-IN')}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Attendance Breakdown -->
            <div class="section">
              <div class="section-title">Attendance Summary</div>
              <div class="attendance-grid">
                <div class="attendance-card">
                  <div class="label">Working Days</div>
                  <div class="value">${payrollData.workingDays}</div>
                </div>
                <div class="attendance-card">
                  <div class="label">Present</div>
                  <div class="value positive">${payrollData.attendanceBreakdown.presentDays}</div>
                </div>
                <div class="attendance-card">
                  <div class="label">Leave (Paid)</div>
                  <div class="value">${payrollData.attendanceBreakdown.leaveDays}</div>
                </div>
                <div class="attendance-card">
                  <div class="label">Half Day</div>
                  <div class="value">${payrollData.attendanceBreakdown.halfDays}</div>
                </div>
                <div class="attendance-card">
                  <div class="label">Absent</div>
                  <div class="value negative">${payrollData.attendanceBreakdown.absentDays}</div>
                </div>
              </div>
            </div>

            <!-- Salary Calculation -->
            <div class="section">
              <div class="section-title">Salary Calculation</div>
              <table>
                <tbody>
                  <tr>
                    <td class="label-column"><strong>Base Salary</strong></td>
                    <td class="amount-column"><strong>${formatCurrency(payrollData.salaryComponents.baseSalary)}</strong></td>
                  </tr>
                  <tr>
                    <td class="label-column">Daily Rate (Base Salary ÷ ${payrollData.workingDays} days)</td>
                    <td class="amount-column">${formatCurrency(payrollData.salaryComponents.dailyRate)}</td>
                  </tr>
                </tbody>
              </table>

              <div style="margin-bottom: 20px;">
                <h4 style="margin-bottom: 10px; color: #555;">Earnings:</h4>
                <table>
                  <tbody>
                    <tr>
                      <td class="label-column">Present Days (${payrollData.attendanceBreakdown.presentDays} days × ${formatCurrency(payrollData.salaryComponents.dailyRate)})</td>
                      <td class="amount-column positive"><strong>${formatCurrency(payrollData.salaryComponents.payForPresent)}</strong></td>
                    </tr>
                    <tr>
                      <td class="label-column">Paid Leave (${payrollData.attendanceBreakdown.leaveDays} days × ${formatCurrency(payrollData.salaryComponents.dailyRate)})</td>
                      <td class="amount-column positive"><strong>${formatCurrency(payrollData.salaryComponents.payForLeave)}</strong></td>
                    </tr>
                    <tr>
                      <td class="label-column">Half Days (${payrollData.attendanceBreakdown.halfDays} days × ${formatCurrency(payrollData.salaryComponents.dailyRate)} × 0.5)</td>
                      <td class="amount-column positive"><strong>${formatCurrency(payrollData.salaryComponents.payForHalfDay)}</strong></td>
                    </tr>
                    <tr class="summary-row">
                      <td class="label-column">Gross Salary</td>
                      <td class="amount-column positive">${formatCurrency(payrollData.salaryComponents.grossSalary)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style="margin-bottom: 20px;">
                <h4 style="margin-bottom: 10px; color: #555;">Deductions:</h4>
                <table>
                  <tbody>
                    <tr>
                      <td class="label-column">Absent Days (${payrollData.attendanceBreakdown.absentDays} days × ${formatCurrency(payrollData.salaryComponents.dailyRate)})</td>
                      <td class="amount-column negative"><strong>-${formatCurrency(payrollData.salaryComponents.absentDeduction)}</strong></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Net Salary -->
            <div class="net-salary">
              <div class="label">Net Salary</div>
              <div class="amount">${formatCurrency(payrollData.salaryComponents.netSalary)}</div>
            </div>

            <!-- Footer -->
            <div class="footer">
              <p>This is a system-generated payslip. No signature required.</p>
              <p style="margin-top: 10px;">For queries, please contact the HR Department.</p>
            </div>
          </div>

          <div class="print-button-container">
            <button onclick="window.print()">🖨️ Print Payslip</button>
          </div>
        </div>
      </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
  };

  return (
    <div className="manager-container">
      <div className="manager-header">
        <h2>Payroll Management</h2>
      </div>

      {/* Selection Section */}
      <div className="form-section">
        <h3>Calculate Payroll</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px', marginBottom: '16px' }}>
          <div className="form-group">
            <label>Department</label>
            <select
              value={selectedDepartment}
              onChange={(e) => setSelectedDepartment(e.target.value)}
              style={{ width: '100%', padding: '8px' }}
            >
              <option value="">Select Department</option>
              {departments.map(dept => (
                <option key={dept.id} value={dept.id}>
                  {dept.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Employee</label>
            {!selectedDepartment ? (
              <select disabled style={{ width: '100%', padding: '8px' }}>
                <option>Select Department First</option>
              </select>
            ) : employees.length === 0 ? (
              <div style={{ padding: '8px', backgroundColor: '#fff3cd', border: '1px solid #ffc107', borderRadius: '4px', color: '#856404' }}>
                No employees in this department
              </div>
            ) : (
              <select
                value={selectedEmployee}
                onChange={(e) => setSelectedEmployee(e.target.value)}
                style={{ width: '100%', padding: '8px' }}
              >
                <option value="">Select Employee</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>
                    {emp.full_name || emp.fullName}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="form-group">
            <label>Month</label>
            <select
              value={month}
              onChange={(e) => setMonth(parseInt(e.target.value))}
              style={{ width: '100%', padding: '8px' }}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => (
                <option key={m} value={m}>
                  {new Date(2000, m - 1).toLocaleString('en-IN', { month: 'long' })}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Year</label>
            <select
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value))}
              style={{ width: '100%', padding: '8px' }}
            >
              <option value="2024">2024</option>
              <option value="2025">2025</option>
              <option value="2026">2026</option>
            </select>
          </div>
        </div>

        <button
          className="btn btn-primary"
          onClick={calculatePayroll}
          disabled={!selectedEmployee || loading}
          style={{ marginBottom: '16px' }}
        >
          {loading ? 'Calculating...' : 'Calculate Payroll'}
        </button>
      </div>

      {/* Payroll Details */}
      {payrollData && (
        <>
          {/* Summary Cards */}
          <div className="form-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                Payroll for {payrollData.employee.full_name || payrollData.employee.fullName} - {new Date(2000, payrollData.month - 1).toLocaleString('en-IN', { month: 'long' })} {payrollData.year}
                {paidStatus.isPaid && (
                  <span
                    className="badge badge-success"
                    title={paidStatus.paidAt ? `Marked paid on ${new Date(paidStatus.paidAt).toLocaleString('en-IN')}` : 'Paid'}
                    style={{ fontSize: '12px' }}
                  >
                    ✓ Paid
                  </span>
                )}
              </h3>
              <div style={{ display: 'flex', gap: '8px', marginLeft: '12px' }}>
                {/* Pulse v2 (item 5) — Mark this month paid / unpaid. */}
                <button
                  className="btn"
                  onClick={handleTogglePaid}
                  disabled={savingPaid}
                  style={{
                    background: paidStatus.isPaid ? '#6b7280' : '#16a34a',
                    color: 'white', border: 'none'
                  }}
                  title={paidStatus.isPaid ? 'Revert to unpaid' : 'Mark this month as paid'}
                >
                  {savingPaid ? '…' : paidStatus.isPaid ? '↩ Mark Unpaid' : '💰 Mark as Paid'}
                </button>
                <button
                  className="btn btn-primary"
                  onClick={printPayslip}
                >
                  🖨️ Print Payslip
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => handleDownloadSalarySlipPdf()}
                  title="Download as PDF"
                  style={{ backgroundColor: '#1e3a8a' }}
                >
                  📄 Download PDF
                </button>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '16px' }}>
              <div style={{ padding: '16px', backgroundColor: 'var(--bg-2)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <p style={{ margin: '0 0 8px 0', color: 'var(--text-2)' }}>Base Salary</p>
                <p style={{ margin: '0', fontSize: '18px', fontWeight: 'bold' }}>
                  {formatCurrency(payrollData.salaryComponents.baseSalary)}
                </p>
              </div>
              <div style={{ padding: '16px', backgroundColor: 'var(--bg-2)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <p style={{ margin: '0 0 8px 0', color: 'var(--text-2)' }}>Gross Salary</p>
                <p style={{ margin: '0', fontSize: '18px', fontWeight: 'bold', color: '#4caf50' }}>
                  {formatCurrency(payrollData.salaryComponents.grossSalary)}
                </p>
              </div>
              <div style={{ padding: '16px', backgroundColor: 'var(--bg-2)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <p style={{ margin: '0 0 8px 0', color: 'var(--text-2)' }}>Absent Deduction</p>
                <p style={{ margin: '0', fontSize: '18px', fontWeight: 'bold', color: '#ff6b6b' }}>
                  -{formatCurrency(payrollData.salaryComponents.absentDeduction)}
                </p>
              </div>
              <div style={{ padding: '16px', backgroundColor: 'var(--bg-2)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <p style={{ margin: '0 0 8px 0', color: 'var(--text-2)' }}>Net Salary</p>
                <p style={{ margin: '0', fontSize: '18px', fontWeight: 'bold', color: '#ffc107' }}>
                  {formatCurrency(payrollData.salaryComponents.netSalary)}
                </p>
              </div>
            </div>
          </div>

          {/* Attendance Breakdown */}
          <div className="form-section">
            <h3>Attendance Breakdown</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px', marginBottom: '16px' }}>
              <div style={{ padding: '12px', backgroundColor: 'var(--bg-2)', borderRadius: '8px', textAlign: 'center' }}>
                <p style={{ margin: '0 0 8px 0', color: 'var(--text-2)' }}>Working Days</p>
                <p style={{ margin: '0', fontSize: '16px', fontWeight: 'bold' }}>{payrollData.workingDays}</p>
              </div>
              <div style={{ padding: '12px', backgroundColor: 'var(--bg-2)', borderRadius: '8px', textAlign: 'center' }}>
                <p style={{ margin: '0 0 8px 0', color: 'var(--text-2)' }}>Present</p>
                <p style={{ margin: '0', fontSize: '16px', fontWeight: 'bold', color: '#4caf50' }}>
                  {payrollData.attendanceBreakdown.presentDays}
                </p>
              </div>
              <div style={{ padding: '12px', backgroundColor: 'var(--bg-2)', borderRadius: '8px', textAlign: 'center' }}>
                <p style={{ margin: '0 0 8px 0', color: 'var(--text-2)' }}>Leave (Paid)</p>
                <p style={{ margin: '0', fontSize: '16px', fontWeight: 'bold', color: '#2196f3' }}>
                  {payrollData.attendanceBreakdown.leaveDays}
                </p>
              </div>
              <div style={{ padding: '12px', backgroundColor: 'var(--bg-2)', borderRadius: '8px', textAlign: 'center' }}>
                <p style={{ margin: '0 0 8px 0', color: 'var(--text-2)' }}>Half Day</p>
                <p style={{ margin: '0', fontSize: '16px', fontWeight: 'bold', color: '#ff9800' }}>
                  {payrollData.attendanceBreakdown.halfDays}
                </p>
              </div>
              <div style={{ padding: '12px', backgroundColor: 'var(--bg-2)', borderRadius: '8px', textAlign: 'center' }}>
                <p style={{ margin: '0 0 8px 0', color: 'var(--text-2)' }}>Absent (No Pay)</p>
                <p style={{ margin: '0', fontSize: '16px', fontWeight: 'bold', color: '#ff6b6b' }}>
                  {payrollData.attendanceBreakdown.absentDays}
                </p>
              </div>
            </div>
          </div>

          {/* Salary Calculation Details */}
          <div className="form-section">
            <h3>Salary Calculation</h3>
            <table className="table" style={{ marginBottom: '16px' }}>
              <tbody>
                <tr>
                  <td>Base Salary</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(payrollData.salaryComponents.baseSalary)}</td>
                </tr>
                <tr>
                  <td>Daily Rate (Base Salary ÷ Working Days)</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(payrollData.salaryComponents.dailyRate)}</td>
                </tr>
                <tr style={{ backgroundColor: 'var(--bg-2)' }}>
                  <td><strong>Pay Components</strong></td>
                  <td></td>
                </tr>
                <tr>
                  <td>&nbsp;&nbsp;&nbsp;&nbsp;Present Days ({payrollData.attendanceBreakdown.presentDays} days × {formatCurrency(payrollData.salaryComponents.dailyRate)})</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(payrollData.salaryComponents.payForPresent)}</td>
                </tr>
                <tr>
                  <td>&nbsp;&nbsp;&nbsp;&nbsp;Paid Leave ({payrollData.attendanceBreakdown.leaveDays} days × {formatCurrency(payrollData.salaryComponents.dailyRate)})</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(payrollData.salaryComponents.payForLeave)}</td>
                </tr>
                <tr>
                  <td>&nbsp;&nbsp;&nbsp;&nbsp;Half Days ({payrollData.attendanceBreakdown.halfDays} days × {formatCurrency(payrollData.salaryComponents.dailyRate)} × 0.5)</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(payrollData.salaryComponents.payForHalfDay)}</td>
                </tr>
                <tr style={{ backgroundColor: 'var(--bg-2)', fontWeight: 'bold', color: '#4caf50' }}>
                  <td>Gross Salary</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(payrollData.salaryComponents.grossSalary)}</td>
                </tr>
                <tr>
                  <td>Absent Days Deduction ({payrollData.attendanceBreakdown.absentDays} days × {formatCurrency(payrollData.salaryComponents.dailyRate)})</td>
                  <td style={{ textAlign: 'right', color: '#ff6b6b' }}>-{formatCurrency(payrollData.salaryComponents.absentDeduction)}</td>
                </tr>
                <tr style={{ backgroundColor: 'var(--bg-2)', fontWeight: 'bold', fontSize: '16px', color: '#ffc107' }}>
                  <td>Net Salary</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(payrollData.salaryComponents.netSalary)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Attendance Records */}
          <div className="table-wrapper">
            <h3>Attendance Records</h3>
            {payrollData.attendanceRecords.length === 0 ? (
              <p style={{ textAlign: 'center', padding: '20px', color: 'var(--text-2)' }}>No attendance records found</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Day</th>
                    <th>Sign In</th>
                    <th>Sign Out</th>
                    <th>Hours Worked</th>
                    <th>Status</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {payrollData.attendanceRecords.map((record, idx) => {
                    const date = new Date(record.date + 'T00:00:00');
                    const dayName = date.toLocaleString('en-IN', { weekday: 'short' });
                    const formattedDate = date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

                    const formatTime = (isoString) => {
                      if (!isoString) return '-';
                      const d = new Date(isoString);
                      return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
                    };

                    const getHoursWorked = (signIn, signOut) => {
                      if (!signIn || !signOut) return '-';
                      const start = new Date(signIn);
                      const end = new Date(signOut);
                      const hours = (end - start) / (1000 * 60 * 60);
                      return hours.toFixed(2) + ' hrs';
                    };

                    return (
                      <tr key={idx}>
                        <td>{formattedDate}</td>
                        <td>{dayName}</td>
                        <td>{formatTime(record.signInTime)}</td>
                        <td>{formatTime(record.signOutTime)}</td>
                        <td>{getHoursWorked(record.signInTime, record.signOutTime)}</td>
                        <td>
                          <span className={`badge badge-${
                            record.status === 'present' ? 'success' :
                            record.status === 'absent' ? 'danger' :
                            record.status === 'leave' ? 'info' :
                            'warning'
                          }`}>
                            {record.status}
                          </span>
                        </td>
                        <td>{record.notes || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default PayrollManager;
