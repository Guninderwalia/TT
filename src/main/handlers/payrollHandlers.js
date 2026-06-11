const { v4: uuidv4 } = require('uuid');
const { writeAudit } = require('./_auditHelper');
const { canAccessUser, denied } = require('./_authz');
const { emailUser } = require('../mailer');

function register(ipcMain, db) {
  ipcMain.handle('payroll:getData', async (event, { userId, month, year }) => {
    try {
      if (!(await canAccessUser(db, event, userId))) return denied();
      let payroll = await db.get(
        `SELECT * FROM payroll
         WHERE user_id = ? AND payroll_month = ? AND payroll_year = ?`,
        [userId, month, year]
      );

      if (!payroll) {
        // Calculate payroll for the month
        payroll = await calculateMonthlyPayroll(db, userId, month, year);
      }

      return { success: true, data: payroll };
    } catch (error) {
      console.error('Get payroll data error:', error);
      return { success: false, message: 'Failed to retrieve payroll' };
    }
  });

  ipcMain.handle('payroll:processMonthly', async (event, { month, year, currentUserId }) => {
    try {
      const employees = await db.all(
        `SELECT DISTINCT user_id FROM employment_records`
      );

      let processedCount = 0;
      for (const emp of employees) {
        const result = await calculateMonthlyPayroll(db, emp.user_id, month, year);
        if (result.success) processedCount++;
      }

      await writeAudit(db, currentUserId || 'system', {
        action: 'PAYROLL_PROCESS_MONTHLY',
        entityType: 'PAYROLL',
        entityId: `${year}-${String(month).padStart(2, '0')}`,
        oldValue: null,
        newValue: { month, year, processedCount }
      });
      return { success: true, message: `Processed ${processedCount} payrolls` };
    } catch (error) {
      console.error('Process monthly payroll error:', error);
      return { success: false, message: 'Payroll processing failed' };
    }
  });

  ipcMain.handle('payroll:addExpense', async (event, { payrollId, category, amount, description, currentUserId }) => {
    try {
      const expenseId = uuidv4();
      await db.run(
        `INSERT INTO monthly_expenses (id, payroll_id, category, amount, description)
         VALUES (?, ?, ?, ?, ?)`,
        [expenseId, payrollId, category, amount, description]
      );

      // Recalculate payroll net amount
      await recalculatePayrollNet(db, payrollId);

      await writeAudit(db, currentUserId || 'system', {
        action: 'PAYROLL_EXPENSE_ADD',
        entityType: 'PAYROLL_EXPENSE',
        entityId: expenseId,
        oldValue: null,
        newValue: { payrollId, category, amount, description }
      });
      return { success: true, message: 'Expense added', expenseId };
    } catch (error) {
      console.error('Add expense error:', error);
      return { success: false, message: 'Failed to add expense' };
    }
  });

  // Pulse v2 — fetch the paid status for one employee/month so the UI can
  // show a Paid badge.
  ipcMain.handle('payroll:getPaidStatus', async (event, { userId, month, year } = {}) => {
    try {
      if (!userId || !month || !year) return { success: false, message: 'userId, month, year required' };
      const row = await db.get(
        `SELECT status, paid_at, paid_by FROM payroll
         WHERE user_id = ? AND payroll_month = ? AND payroll_year = ?`,
        [userId, month, year]
      );
      const isPaid = row && String(row.status || '').toLowerCase() === 'paid';
      return { success: true, data: { isPaid: !!isPaid, paidAt: row?.paid_at || null, paidBy: row?.paid_by || null } };
    } catch (error) {
      console.error('Get paid status error:', error);
      return { success: false, message: 'Failed to read paid status' };
    }
  });

  // Pulse v2 — mark a month's payroll Paid / Unpaid. Upserts the payroll row
  // (the manager computes figures live, so we persist the amounts the admin is
  // looking at). Admin/MD only; audited.
  ipcMain.handle('payroll:setPaidStatus', async (event, { userId, month, year, isPaid, baseSalary, grossAmount, netAmount, currentUserId } = {}) => {
    try {
      if (!userId || !month || !year) return { success: false, message: 'userId, month, year required' };
      const actorId = (event?.sender?.id) || currentUserId || null;
      if (!actorId) return { success: false, message: 'Not authenticated' };
      const caller = await db.get(
        `SELECT r.name AS role_name FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.id = ?`,
        [actorId]
      );
      const role = ((caller && caller.role_name) || '').toLowerCase();
      if (!['admin', 'administrator', 'md', 'managing director'].includes(role)) {
        return { success: false, message: 'Only Admin or MD can mark payroll paid' };
      }

      const status = isPaid ? 'Paid' : 'Pending';
      const paidAt = isPaid ? new Date().toISOString() : null;
      const paidBy = isPaid ? actorId : null;

      const existing = await db.get(
        `SELECT * FROM payroll WHERE user_id = ? AND payroll_month = ? AND payroll_year = ?`,
        [userId, month, year]
      );
      if (existing) {
        await db.run(
          `UPDATE payroll SET status = ?, paid_at = ?, paid_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [status, paidAt, paidBy, existing.id]
        );
      } else {
        await db.run(
          `INSERT INTO payroll
             (id, user_id, payroll_month, payroll_year, base_salary, gross_amount, net_amount, status, paid_at, paid_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [uuidv4(), userId, month, year, Number(baseSalary) || 0, Number(grossAmount) || 0, Number(netAmount) || 0, status, paidAt, paidBy]
        );
      }

      await writeAudit(db, actorId, {
        action: isPaid ? 'PAYROLL_MARK_PAID' : 'PAYROLL_MARK_UNPAID',
        entityType: 'PAYROLL',
        entityId: `${userId}:${year}-${String(month).padStart(2, '0')}`,
        oldValue: existing ? { status: existing.status } : null,
        newValue: { userId, month, year, status, netAmount: Number(netAmount) || 0 }
      });

      // v5.4 — email the employee when their salary is marked paid (best-effort).
      if (isPaid) {
        const monthName = new Date(2000, (Number(month) || 1) - 1).toLocaleString('en-IN', { month: 'long' });
        emailUser(db, userId, `💰 Your ${monthName} ${year} salary has been paid`,
          'Salary paid',
          `<p>Your salary for <strong>${monthName} ${year}</strong> has been marked as <strong>paid</strong>` +
          (Number(netAmount) ? ` (net ₹${Number(netAmount).toLocaleString('en-IN')})` : '') + `.</p>`
        );
      }
      return { success: true, message: isPaid ? 'Marked as paid' : 'Marked as unpaid', data: { isPaid: !!isPaid, paidAt, paidBy } };
    } catch (error) {
      console.error('Set paid status error:', error);
      return { success: false, message: 'Failed to update paid status: ' + error.message };
    }
  });

  ipcMain.handle('payroll:getHistory', async (event, { userId }) => {
    try {
      if (!(await canAccessUser(db, event, userId))) return denied();
      const history = await db.all(
        `SELECT * FROM payroll
         WHERE user_id = ?
         ORDER BY payroll_year DESC, payroll_month DESC`,
        [userId]
      );
      return { success: true, data: history };
    } catch (error) {
      console.error('Get payroll history error:', error);
      return { success: false, message: 'Failed to retrieve history' };
    }
  });
}

async function calculateMonthlyPayroll(db, userId, month, year) {
  try {
    const employment = await db.get(
      'SELECT * FROM employment_records WHERE user_id = ?',
      [userId]
    );

    if (!employment) {
      return { success: false, message: 'Employment record not found' };
    }

    const baseSalary = employment.base_salary;
    const daysInMonth = new Date(year, month, 0).getDate();
    const dailyRate = baseSalary / 26; // 6-day work week = 26 days/month

    // Calculate late/early deduction
    const attendanceRecords = await db.all(
      `SELECT * FROM attendance
       WHERE user_id = ? AND strftime('%m', date) = ? AND strftime('%Y', date) = ?`,
      [userId, String(month).padStart(2, '0'), year]
    );

    let totalLateHours = 0;
    let totalEarlyHours = 0;
    let totalAbsentDays = 0;
    let totalHalfDays = 0;

    for (const record of attendanceRecords) {
      if (record.status === 'Absent') totalAbsentDays += 1;
      if (record.is_half_day) totalHalfDays += 1;
      totalLateHours += record.late_hours || 0;
      totalEarlyHours += record.early_departure_hours || 0;
    }

    // Deductions: Absent = full day, Half-Day = 50%, Late/Early = hourly
    const hourlyRate = dailyRate / 9; // 9-hour work day
    const absentDeduction = totalAbsentDays * dailyRate;
    const halfDayDeduction = totalHalfDays * (dailyRate * 0.5);
    const lateEarlyDeduction = (totalLateHours + totalEarlyHours) * hourlyRate;
    const attendanceDeduction = absentDeduction + halfDayDeduction + lateEarlyDeduction;

    // Get overtime amount
    const overtimeRecords = await db.all(
      `SELECT COALESCE(SUM(amount), 0) as total FROM overtime
       WHERE user_id = ? AND strftime('%m', date) = ? AND strftime('%Y', date) = ? AND status = 'approved'`,
      [userId, String(month).padStart(2, '0'), year]
    );
    const overtimeAmount = overtimeRecords[0]?.total || 0;

    // v4.7.5 — Probation deposit deduction.
    //
    // Rule: during the first N months from joining, the employee's WHOLE
    // monthly salary is held back as a refundable security deposit. The
    // deduction window is stored on the probation_deposits row as
    // deduction_start_month..deduction_end_month (1-based, counted from
    // the join month). Net pay for those months should be 0 (before any
    // overtime / bonus), then normal salary from month N+1 onwards.
    //
    // Previously this divided deposit_amount by 2 every month the
    // is_probation flag was on — buggy because (a) probation may be
    // longer than 2 months so the deduction kept firing, (b) it had no
    // concept of WHICH month this payroll was for.
    let probationDeduction = 0;
    const probationRecord = await db.get(
      `SELECT * FROM probation_deposits WHERE user_id = ? AND status = 'held'`,
      [userId]
    );
    if (probationRecord && employment.start_date) {
      // Month-of-employment for this payroll period (1-based).
      // e.g. joined 2026-04-15, payroll for May 2026 → monthOfEmployment = 2.
      const joinDate = new Date(employment.start_date + 'T12:00:00Z');
      const joinYear  = joinDate.getUTCFullYear();
      const joinMonth = joinDate.getUTCMonth() + 1; // 1-12
      const monthOfEmployment = (year - joinYear) * 12 + (month - joinMonth) + 1;

      const startM = probationRecord.deduction_start_month || 1;
      const endM   = probationRecord.deduction_end_month   || 2;
      if (monthOfEmployment >= startM && monthOfEmployment <= endM) {
        // Deduct exactly one month's portion of the deposit, so net
        // salary for the month works out to zero (before overtime / bonus).
        const monthsInWindow = Math.max(1, endM - startM + 1);
        probationDeduction = probationRecord.deposit_amount / monthsInWindow;
      }
    }

    // Get monthly expenses
    let bonusAmount = 0;
    let reimbursementAmount = 0;

    const existingPayroll = await db.get(
      `SELECT id FROM payroll WHERE user_id = ? AND payroll_month = ? AND payroll_year = ?`,
      [userId, month, year]
    );

    if (existingPayroll) {
      const expenses = await db.all(
        `SELECT * FROM monthly_expenses WHERE payroll_id = ?`,
        [existingPayroll.id]
      );
      for (const exp of expenses) {
        if (exp.category === 'Bonus') bonusAmount += exp.amount;
        if (exp.category === 'Reimbursement') reimbursementAmount += exp.amount;
      }
    }

    // Calculate totals
    const grossAmount = baseSalary + overtimeAmount + bonusAmount + reimbursementAmount;
    const netAmount = grossAmount - attendanceDeduction - probationDeduction;

    // Insert or update payroll
    const payrollId = uuidv4();
    await db.run(
      `INSERT OR REPLACE INTO payroll
       (id, user_id, payroll_month, payroll_year, base_salary, overtime_amount, bonus_amount,
        reimbursement_amount, attendance_deduction, probation_deposit_deduction, gross_amount, net_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [payrollId, userId, month, year, baseSalary, overtimeAmount, bonusAmount,
       reimbursementAmount, attendanceDeduction, probationDeduction, grossAmount, netAmount]
    );

    return { success: true, data: { id: payrollId, baseSalary, grossAmount, netAmount } };
  } catch (error) {
    console.error('Calculate payroll error:', error);
    return { success: false, message: 'Payroll calculation failed' };
  }
}

async function recalculatePayrollNet(db, payrollId) {
  const payroll = await db.get('SELECT * FROM payroll WHERE id = ?', [payrollId]);
  const expenses = await db.all(
    'SELECT SUM(amount) as total FROM monthly_expenses WHERE payroll_id = ?',
    [payrollId]
  );

  const expensesTotal = expenses[0]?.total || 0;
  const newGross = payroll.base_salary + payroll.overtime_amount + expensesTotal;
  const newNet = newGross - payroll.attendance_deduction - payroll.probation_deposit_deduction;

  await db.run(
    `UPDATE payroll SET gross_amount = ?, net_amount = ? WHERE id = ?`,
    [newGross, newNet, payrollId]
  );
}

module.exports = { register };
