const { v4: uuidv4 } = require('uuid');
const { differenceInCalendarDays } = require('date-fns');
const { writeAudit } = require('./_auditHelper');

/**
 * Apply the year-end carry-forward policy for ONE (user, leave_type) pair.
 *
 * Called from the lazy-seed block in leave:getBalance — when we're about to
 * create a fresh row for `toYear`, this first looks at the (toYear − 1) row
 * and computes how many days roll forward based on the leave type's policy
 * columns (carry_forward_enabled / max_carry_forward_days / encashment_enabled).
 *
 * Idempotent:
 *   - leave_balance_rollover_log has UNIQUE(user_id, leave_type_id, to_year),
 *     so running this twice will INSERT-OR-IGNORE the second time.
 *   - The caller still calls us safely on every getBalance because we
 *     short-circuit if a log row already exists.
 *
 * Returns the carry-forward amount (default 0 if not applicable / already
 * applied) so the caller can include it in total_allocated / remaining.
 */
async function applyRolloverIfNeeded(db, userId, leaveType, toYear, callerId) {
  try {
    // Guard: already applied for this (user, type, year)?
    const already = await db.get(
      `SELECT carried_forward FROM leave_balance_rollover_log
       WHERE user_id = ? AND leave_type_id = ? AND to_year = ?`,
      [userId, leaveType.id, toYear]
    );
    if (already) return Number(already.carried_forward) || 0;

    // Policy off? Nothing to do, but still log a 0-row so we don't keep
    // checking on every read.
    const enabled = leaveType.carry_forward_enabled === 1 || leaveType.carry_forward_enabled === true;
    if (!enabled) {
      await db.run(
        `INSERT OR IGNORE INTO leave_balance_rollover_log
           (id, user_id, leave_type_id, from_year, to_year, prev_remaining,
            carried_forward, encashed, forfeited, policy_snapshot)
         VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?)`,
        [uuidv4(), userId, leaveType.id, toYear - 1, toYear,
         JSON.stringify({ enabled: false })]
      );
      return 0;
    }

    // Look up previous year's row
    const prev = await db.get(
      `SELECT remaining FROM leave_balances
       WHERE user_id = ? AND leave_type_id = ? AND year = ?`,
      [userId, leaveType.id, toYear - 1]
    );
    if (!prev) {
      // Nothing to roll forward (new employee / no prior balance)
      await db.run(
        `INSERT OR IGNORE INTO leave_balance_rollover_log
           (id, user_id, leave_type_id, from_year, to_year, prev_remaining,
            carried_forward, encashed, forfeited, policy_snapshot)
         VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?)`,
        [uuidv4(), userId, leaveType.id, toYear - 1, toYear,
         JSON.stringify({ enabled, reason: 'no-prior-row' })]
      );
      return 0;
    }

    const prevRemaining = Math.max(0, Number(prev.remaining) || 0);
    const cap = Math.max(0, Number(leaveType.max_carry_forward_days) || 0);
    const carried   = cap > 0 ? Math.min(prevRemaining, cap) : prevRemaining;
    const leftover  = Math.max(0, prevRemaining - carried);
    const encashed  = (leaveType.encashment_enabled === 1 || leaveType.encashment_enabled === true) ? leftover : 0;
    const forfeited = leftover - encashed;

    await db.run(
      `INSERT OR IGNORE INTO leave_balance_rollover_log
         (id, user_id, leave_type_id, from_year, to_year, prev_remaining,
          carried_forward, encashed, forfeited, policy_snapshot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), userId, leaveType.id, toYear - 1, toYear,
       prevRemaining, carried, encashed, forfeited,
       JSON.stringify({
         enabled,
         max_carry_forward_days: leaveType.max_carry_forward_days,
         encashment_enabled: leaveType.encashment_enabled,
         expiry_months_after_year_end: leaveType.expiry_months_after_year_end
       })]
    );

    // Audit — produces an HR-compliance trail. Failure here is non-fatal.
    await writeAudit(db, callerId || 'system', {
      action: 'LEAVE_ROLLOVER_APPLY',
      entityType: 'LEAVE_BALANCE',
      entityId: `${userId}:${leaveType.id}:${toYear}`,
      oldValue: { year: toYear - 1, remaining: prevRemaining },
      newValue: { year: toYear, carriedForward: carried, encashed, forfeited }
    });

    return carried;
  } catch (err) {
    console.error('[LEAVE] applyRolloverIfNeeded error:', err);
    return 0; // Never block balance read because of a rollover hiccup
  }
}

/**
 * Count the number of working days (Mon-Sat) between two dates, inclusive.
 * Sundays are excluded — they are not counted against the employee's leave
 * balance. Matches the attendance auto-marking logic which also skips Sundays.
 */
/**
 * Audit helper. Safe to call without await — failures log but never bubble.
 */
async function writeLeaveAudit(db, userId, { action, entityId, oldValue, newValue }) {
  try {
    await db.run(
      `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, old_value, new_value, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        uuidv4(),
        userId || 'system',
        action,
        'LeaveRequest',
        entityId,
        oldValue == null ? null : JSON.stringify(oldValue),
        newValue == null ? null : JSON.stringify(newValue)
      ]
    );
  } catch (e) {
    console.error('[AUDIT] Failed to write leave audit log:', e.message);
  }
}

function countWorkingDaysExcludingSunday(startDate, endDate) {
  if (!startDate || !endDate) return 0;
  const start = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return 0;

  let count = 0;
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() !== 0) count++; // 0 = Sunday
  }
  return count;
}

/**
 * Calculate leave allocation based on joining date.
 *   - 25 days/year, prorated for mid-year joiners.
 *   - Employees still on probation get 0 (leave during probation is unpaid).
 *   - Once probation completes, accrual starts from probationEndDate, not
 *     joiningDate, so the months spent on probation don't count.
 *
 * Optional third arg: { isProbation, probationEndDate }
 */
const calculateLeaveAllocation = (joiningDate, year = new Date().getFullYear(), probationInfo) => {
  if (!joiningDate) {
    return 0;
  }

  let isProbation = false;
  let probationEndDate = null;
  if (probationInfo && typeof probationInfo === 'object') {
    isProbation = probationInfo.isProbation === true || probationInfo.isProbation === 1;
    probationEndDate = probationInfo.probationEndDate || null;
  } else if (probationInfo === true || probationInfo === 1) {
    isProbation = true;
  }

  if (isProbation) {
    return 0;
  }

  try {
    let effectiveStart = new Date(joiningDate);
    if (probationEndDate) {
      const pe = new Date(probationEndDate);
      if (!isNaN(pe.getTime()) && pe > effectiveStart) effectiveStart = pe;
    }
    const startYear  = effectiveStart.getFullYear();
    const startMonth = effectiveStart.getMonth();

    if (startYear < year) return 25;
    if (startYear > year) return 0;

    if (startYear === year) {
      const monthsRemaining = 12 - startMonth;
      const daysAllocated = (monthsRemaining / 12) * 25;
      return Math.round(daysAllocated * 10) / 10;
    }

    return 0;
  } catch (error) {
    console.error('Error calculating leave allocation:', error);
    return 0;
  }
};

function register(ipcMain, db) {
  ipcMain.handle('leave:request', async (event, { leaveTypeId, startDate, endDate, reason, userId, isHalfDay, halfDaySession }) => {
    try {
      // The frontend now passes user.id explicitly. The old version used
      // event.sender.id (a WebContents id, e.g. 1) which never matched a
      // real users.id, so leave_balances came back empty and EVERY request
      // failed with "Insufficient leave balance" — even when the user had
      // plenty of days left.
      if (!userId) {
        return { success: false, message: 'userId required', error: 'userId required' };
      }

      // Half-day leave: forces start == end, and counts as 0.5 days.
      // halfDaySession ('morning' | 'afternoon') is stamped into the reason
      // so approvers + the employee can see which half was taken.
      let daysCount;
      if (isHalfDay) {
        if (startDate !== endDate) {
          return { success: false, message: 'Half-day leave must be for a single date.' };
        }
        // Check it's not a Sunday — Sundays are not working days.
        const d = new Date(startDate + 'T00:00:00');
        if (d.getDay() === 0) {
          return { success: false, message: 'Half-day leave cannot fall on a Sunday.' };
        }
        daysCount = 0.5;
      } else {
        // Count only Mon-Sat. Sundays are not deducted from leave balance and
        // are not auto-marked as Leave on the attendance side (see approve flow).
        daysCount = countWorkingDaysExcludingSunday(startDate, endDate);
      }

      if (daysCount <= 0) {
        return { success: false, message: 'Selected dates have no working days (Mon-Sat)' };
      }

      // Check balance
      const currentYear = new Date().getFullYear();
      const balance = await db.get(
        `SELECT * FROM leave_balances
         WHERE user_id = ? AND leave_type_id = ? AND year = ?`,
        [userId, leaveTypeId, currentYear]
      );

      if (!balance) {
        return { success: false, message: 'No leave balance found for this leave type. Re-open Leave Requests to seed it, then try again.' };
      }

      // Check if the employee is on probation — they can submit but the
      // request is recorded as UNPAID and the balance is never deducted.
      const empProbation = await db.get(
        'SELECT is_probation FROM employment_records WHERE user_id = ?',
        [userId]
      );
      const isProbation = empProbation && empProbation.is_probation === 1;

      // Anyone whose remaining balance is short of the requested days also
      // goes through as UNPAID — we no longer block these. This means
      // employees can ALWAYS request leave; the only question is whether
      // it's paid or not. Approvers see the [UNPAID] tag up-front and the
      // approval handler skips balance deduction.
      const shortOfBalance = balance.remaining < daysCount;
      const isUnpaid = isProbation || shortOfBalance;

      // Tag the reason so approvers see the unpaid status immediately. Give
      // the most accurate label depending on which condition triggered it.
      let effectiveReason = reason || '';
      if (isHalfDay) {
        const session = (halfDaySession || 'morning').toLowerCase();
        const sessionLabel = session === 'afternoon' ? 'Afternoon' : 'Morning';
        effectiveReason = `[HALF-DAY · ${sessionLabel}] ${effectiveReason}`.trim();
      }
      if (isProbation) {
        effectiveReason = `[UNPAID — on probation] ${effectiveReason}`.trim();
      } else if (shortOfBalance) {
        effectiveReason = `[UNPAID — balance was ${balance.remaining}, needed ${daysCount}] ${effectiveReason}`.trim();
      }

      const requestId = uuidv4();
      await db.run(
        `INSERT INTO leave_requests (id, user_id, leave_type_id, start_date, end_date, days_count, reason, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [requestId, userId, leaveTypeId, startDate, endDate, daysCount, effectiveReason, 'pending']
      );

      // Route the approval. Normal employees go to their department lead.
      // BUT a department lead requesting their OWN leave must NOT be routed
      // to themselves — they'd see their own request in their Leave Approval
      // Hub and could rubber-stamp it. Skip the lead stage in that case and
      // hand it straight to admin/MD. The training guide already promises
      // this behaviour ("your request skips the lead-approval stage").
      const user = await db.get(
        `SELECT u.*, r.name as role_name FROM users u
         LEFT JOIN roles r ON u.role_id = r.id
         WHERE u.id = ?`,
        [userId]
      );
      const requesterIsLead = user && user.is_department_lead === 1;
      const requesterRole = ((user && user.role_name) || '').toLowerCase();
      const requesterIsAdmin = ['admin', 'administrator', 'md', 'manager'].includes(requesterRole);

      let approver = null;
      // Only look for a department lead if the requester is a regular employee.
      if (!requesterIsLead && !requesterIsAdmin) {
        approver = await db.get(
          'SELECT * FROM users WHERE department_id = ? AND is_department_lead = 1 AND status = ? AND id != ?',
          [user.department_id, 'active', userId]
        );
      }

      // Auto-mark the request as already lead-approved when we skip the lead
      // stage, so the admin queue (which shows lead_approved requests) picks
      // it up. Without this the request sits as 'pending' and never reaches
      // the admin's queue — which is the exact bug Isha was hitting.
      const skippedLeadStage = !approver;

      if (!approver) {
        // Fall through to MD / Administrator / Admin (in that priority order).
        // 'Admin' must be included because the seeded default admin user is
        // assigned that role name, not 'Administrator'. Also exclude the
        // requester themselves so an admin/MD doesn't approve their own leave.
        approver = await db.get(
          `SELECT u.* FROM users u
           JOIN roles r ON u.role_id = r.id
           WHERE u.status = 'active'
             AND r.name IN ('MD', 'Administrator', 'Admin')
             AND u.id != ?
           ORDER BY CASE r.name
             WHEN 'MD' THEN 0
             WHEN 'Administrator' THEN 1
             WHEN 'Admin' THEN 2
             ELSE 3
           END
           LIMIT 1`,
          [userId]
        );
        if (approver) {
          if (requesterIsLead) {
            console.log('[LEAVE] Requester is the department lead — skipping lead stage, assigning to admin/MD:', approver.full_name);
          } else if (requesterIsAdmin) {
            console.log('[LEAVE] Requester is admin/MD — assigning to another admin/MD:', approver.full_name);
          } else {
            console.log('[LEAVE] No department lead for', user.department_id, '— assigning to admin/MD:', approver.full_name);
          }
        }
      }

      // If we skipped the lead stage, advance the request status so the admin
      // queue (which filters by lead_approved + pending-from-no-lead-dept)
      // surfaces it. Otherwise it stays 'pending' for the lead to review.
      if (skippedLeadStage && approver) {
        await db.run(
          `UPDATE leave_requests SET status = 'lead_approved' WHERE id = ?`,
          [requestId]
        );
      }

      if (approver) {
        const approvalId = uuidv4();
        await db.run(
          `INSERT INTO approval_requests (id, request_type, request_id, requested_by, assigned_to)
           VALUES (?, ?, ?, ?, ?)`,
          [approvalId, 'leave_request', requestId, userId, approver.id]
        );
      } else {
        console.warn('[LEAVE] No approver found (no lead, no admin/MD) — request will be unassigned:', requestId);
      }

      return { success: true, message: 'Leave request submitted', requestId };
    } catch (error) {
      console.error('Request leave error:', error);
      return { success: false, message: 'Failed to submit leave request' };
    }
  });

  ipcMain.handle('leave:getBalance', async (event, { userId }) => {
    try {
      const currentYear = new Date().getFullYear();

      // 0. Lazy backfill: if this user has NO balance rows for the current
      // year, create one row per leave_type. This covers bulk-imported
      // employees and any older user whose balances were never seeded —
      // without it the "Loading leave balance…" / "No leave types available"
      // state in the Leave Calendar would never resolve.
      const existingCount = await db.get(
        `SELECT COUNT(*) as n FROM leave_balances WHERE user_id = ? AND year = ?`,
        [userId, currentYear]
      );
      if (!existingCount || existingCount.n === 0) {
        // Include the rollover policy columns so applyRolloverIfNeeded has them.
        const types = await db.all(
          `SELECT id, annual_entitlement, carry_forward_enabled,
                  max_carry_forward_days, expiry_months_after_year_end,
                  encashment_enabled
           FROM leave_types`
        );
        // Look up joining date AND probation status so probationers get a
        // zero allocation (their leave is unpaid until probation completes).
        const empRow = await db.get(
          'SELECT start_date, is_probation, probation_end_date FROM employment_records WHERE user_id = ?',
          [userId]
        );
        const probInfo = empRow ? {
          isProbation: empRow.is_probation === 1,
          probationEndDate: empRow.probation_end_date
        } : undefined;
        for (const t of types) {
          let allocated = t.annual_entitlement || 0;
          if (empRow && empRow.start_date) {
            const prorated = calculateLeaveAllocation(empRow.start_date, currentYear, probInfo);
            if (Number.isFinite(prorated) && prorated >= 0) allocated = prorated;
          }
          // Apply year-end carry-forward from (currentYear − 1) → currentYear.
          // 0 when no prior balance row exists OR the policy is off.
          const carried = await applyRolloverIfNeeded(db, userId, t, currentYear, null);
          await db.run(
            `INSERT INTO leave_balances
               (id, user_id, leave_type_id, year, total_allocated, used,
                carried_forward, remaining)
             VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
            [uuidv4(), userId, t.id, currentYear, allocated, carried, allocated + carried]
          );
        }
        console.log(`[LEAVE] Lazily seeded ${types.length} balance row(s) for user ${userId}`);
      }

      // 1. Fetch raw balances + leave type metadata
      const balances = await db.all(
        `SELECT lb.*, lt.name as leave_type_name, lt.annual_entitlement
         FROM leave_balances lb
         JOIN leave_types lt ON lb.leave_type_id = lt.id
         WHERE lb.user_id = ? AND lb.year = ?`,
        [userId, currentYear]
      );

      // 2. Look up the user's joining date + probation status so the prorated
      // entitlement honours both (probationers get 0).
      const employment = await db.get(
        `SELECT start_date, is_probation, probation_end_date FROM employment_records WHERE user_id = ?`,
        [userId]
      );
      const joiningDate = employment ? employment.start_date : null;
      const probInfo    = employment ? {
        isProbation: employment.is_probation === 1,
        probationEndDate: employment.probation_end_date
      } : undefined;

      // 3. Sum up days held by PENDING leave requests, per leave type, so we
      //    can reduce "remaining" the moment a request is submitted instead of
      //    waiting for approval.
      const pendingRows = await db.all(
        `SELECT leave_type_id, SUM(days_count) as pending_days
         FROM leave_requests
         WHERE user_id = ? AND status = 'pending'
         GROUP BY leave_type_id`,
        [userId]
      );
      const pendingByType = {};
      pendingRows.forEach((r) => { pendingByType[r.leave_type_id] = r.pending_days || 0; });

      // 4. Compute prorated entitlement based on joining date + probation.
      //    Remaining = allocated - used - pending.
      //    BUT if the admin has manually set this balance (manual_override=1),
      //    use the stored total_allocated as-is and skip the auto recompute.
      const enriched = balances.map((b) => {
        let allocated = b.total_allocated;
        const isManual = b.manual_override === 1;
        if (!isManual) {
          if (b.leave_type_name === 'Annual Leave' && joiningDate) {
            allocated = calculateLeaveAllocation(joiningDate, currentYear, probInfo);
          } else if (!allocated) {
            allocated = b.annual_entitlement || 0;
          }
        }
        const used = b.used || 0;
        const pending = pendingByType[b.leave_type_id] || 0;
        const remaining = Math.max(0, allocated - used - pending);
        return {
          ...b,
          total_allocated: allocated,
          total: allocated,
          used,
          pending,
          remaining,
          manual_override: isManual,
          joining_date: joiningDate
        };
      });

      return { success: true, data: enriched };
    } catch (error) {
      console.error('Get leave balance error:', error);
      return { success: false, message: 'Failed to retrieve balance' };
    }
  });

  ipcMain.handle('leave:getRequests', async (event, { userId }) => {
    try {
      const requests = await db.all(
        `SELECT lr.*, lt.name as leave_type_name
         FROM leave_requests lr
         JOIN leave_types lt ON lr.leave_type_id = lt.id
         WHERE lr.user_id = ?
         ORDER BY lr.requested_at DESC`,
        [userId]
      );
      return { success: true, data: requests };
    } catch (error) {
      console.error('Get leave requests error:', error);
      return { success: false, message: 'Failed to retrieve requests' };
    }
  });

  ipcMain.handle('leave:approveRequest', async (event, { requestId, notes, currentUserId }) => {
    try {
      const request = await db.get('SELECT * FROM leave_requests WHERE id = ?', [requestId]);
      if (!request) {
        return { success: false, message: 'Leave request not found' };
      }

      // Identify who is approving so we can decide whether this is a lead's
      // first-pass approval (forwards to admin) or a final approval (deducts
      // balance + marks attendance).
      const approverId = currentUserId || event.sender.id;
      const approver = approverId
        ? await db.get(
            `SELECT u.*, r.name as role_name
             FROM users u JOIN roles r ON u.role_id = r.id
             WHERE u.id = ?`,
            [approverId]
          )
        : null;
      const approverIsAdmin = approver && ['MD', 'Administrator'].includes(approver.role_name);
      const approverIsLead = approver && approver.is_department_lead === 1;

      // Two-step flow: when a non-admin lead approves a still-pending request,
      // move it to 'lead_approved' and forward to admin/MD for final sign-off.
      // Balance is NOT deducted yet and attendance is NOT yet marked — those
      // only happen on the final admin approval below.
      if (approverIsLead && !approverIsAdmin && request.status === 'pending') {
        // Look for the most senior available approver among MD / Administrator
        // / Admin. The previous version omitted 'Admin' — but the seeded
        // admin user has role name "Admin", not "Administrator" — so the
        // query returned nothing and the lead's "Approve" click silently
        // failed with "No administrator available for final approval".
        const admin = await db.get(
          `SELECT u.* FROM users u
           JOIN roles r ON u.role_id = r.id
           WHERE u.status = 'active' AND r.name IN ('MD', 'Administrator', 'Admin')
           ORDER BY CASE r.name
             WHEN 'MD' THEN 0
             WHEN 'Administrator' THEN 1
             WHEN 'Admin' THEN 2
             ELSE 3
           END
           LIMIT 1`
        );

        if (!admin) {
          return { success: false, message: 'No administrator available for final approval. Please ensure at least one active user has role MD, Administrator, or Admin.' };
        }

        await db.run(
          `UPDATE leave_requests
           SET status = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          ['lead_approved', approverId, requestId]
        );

        // Hand the approval off to the admin/MD.
        await db.run(
          `INSERT INTO approval_requests (id, request_type, request_id, requested_by, assigned_to)
           VALUES (?, ?, ?, ?, ?)`,
          [uuidv4(), 'leave_request', requestId, request.user_id, admin.id]
        );

        // Let the employee know their lead has signed off.
        await db.run(
          `INSERT INTO notifications (id, user_id, title, message, type, related_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            uuidv4(),
            request.user_id,
            'Leave Approved by Lead',
            'Your team lead approved your leave request. Waiting for administrator final approval.',
            'info',
            requestId
          ]
        );

        await writeLeaveAudit(db, approverId, {
          action: 'LEAVE_LEAD_APPROVE',
          entityId: requestId,
          oldValue: { status: 'pending' },
          newValue: {
            status: 'lead_approved',
            approvedBy: approver?.full_name,
            forwardedTo: admin.full_name,
            forwardedRole: admin.role_name,
            request: {
              start_date: request.start_date,
              end_date: request.end_date,
              days_count: request.days_count,
              reason: request.reason
            }
          }
        });

        console.log('[LEAVE] Lead approved request', requestId, '→ forwarded to', admin.full_name, '(', admin.role_name, ')');
        return {
          success: true,
          message: 'Approved. Forwarded to administrator for final approval.',
          stage: 'lead_approved'
        };
      }

      // Final approval path: deduct balance, mark attendance, send notification.
      const currentYear = new Date().getFullYear();

      // If the request was submitted while the employee was on probation
      // (reason prefixed with [UNPAID — on probation]) OR they're still on
      // probation now, skip the balance deduction — their leave is unpaid.
      const isUnpaid = (request.reason || '').includes('[UNPAID');
      const empRow = await db.get(
        'SELECT is_probation FROM employment_records WHERE user_id = ?',
        [request.user_id]
      );
      const onProbationNow = empRow && empRow.is_probation === 1;
      const skipBalanceDeduction = isUnpaid || onProbationNow;

      if (!skipBalanceDeduction) {
        await db.run(
          `UPDATE leave_balances
           SET used = used + ?, remaining = remaining - ?
           WHERE user_id = ? AND leave_type_id = ? AND year = ?`,
          [request.days_count, request.days_count, request.user_id, request.leave_type_id, currentYear]
        );
      } else {
        console.log(`[LEAVE] Skipping balance deduction for unpaid/probation leave: ${requestId}`);
      }

      await db.run(
        `UPDATE leave_requests
         SET status = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        ['approved', approverId, requestId]
      );

      // ========================================================================
      // AUTO-MARK ATTENDANCE FOR APPROVED LEAVE PERIOD
      // ========================================================================
      // Create attendance records for each day of approved leave
      // Skip weekends (Saturdays and Sundays)
      const startDate = new Date(request.start_date + 'T00:00:00Z');
      const endDate = new Date(request.end_date + 'T00:00:00Z');

      for (let currentDate = new Date(startDate); currentDate <= endDate; currentDate.setUTCDate(currentDate.getUTCDate() + 1)) {
        const dayOfWeek = currentDate.getUTCDay();

        // Skip Sundays only (0 = Sunday; Saturday is a working day)
        if (dayOfWeek === 0) {
          continue;
        }

        const dateStr = currentDate.toISOString().split('T')[0]; // Format: YYYY-MM-DD
        const attendanceId = uuidv4();

        // Check if attendance record already exists for this date
        const existing = await db.get(
          'SELECT * FROM attendance WHERE user_id = ? AND date = ?',
          [request.user_id, dateStr]
        );

        // Detect half-day by the marker we put in the reason at submission.
        const isHalfDayReq = (request.reason || '').includes('[HALF-DAY');
        const halfFlag = isHalfDayReq ? 1 : 0;

        if (!existing) {
          // Create new attendance record. For a half-day leave we still mark
          // the day as 'Leave' so the calendar shows it, but set is_half_day
          // so the reporting + display flag a partial-day absence.
          await db.run(
            `INSERT INTO attendance (id, user_id, date, status, is_half_day, notes, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [attendanceId, request.user_id, dateStr, 'Leave', halfFlag, `Approved leave: ${request.reason || 'N/A'}`]
          );
          console.log(`[LEAVE] Auto-marked ${dateStr} as Leave${halfFlag ? ' (half-day)' : ''} for user ${request.user_id}`);
        } else if (existing.status !== 'Leave') {
          // Update existing record if not already marked as leave
          await db.run(
            `UPDATE attendance SET status = ?, is_half_day = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
             WHERE user_id = ? AND date = ?`,
            ['Leave', halfFlag, `Approved leave: ${request.reason || 'N/A'}`, request.user_id, dateStr]
          );
          console.log(`[LEAVE] Updated ${dateStr} to Leave${halfFlag ? ' (half-day)' : ''} status for user ${request.user_id}`);
        }
      }

      // Create notification
      const notifId = uuidv4();
      await db.run(
        `INSERT INTO notifications (id, user_id, title, message, type, related_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [notifId, request.user_id, 'Leave Approved', 'Your leave request has been approved', 'info', requestId]
      );

      await writeLeaveAudit(db, approverId, {
        action: 'LEAVE_APPROVE',
        entityId: requestId,
        oldValue: { status: request.status },
        newValue: {
          status: 'approved',
          approvedBy: approver?.full_name,
          approverRole: approver?.role_name,
          request: {
            user_id: request.user_id,
            start_date: request.start_date,
            end_date: request.end_date,
            days_count: request.days_count,
            reason: request.reason
          },
          notes
        }
      });

      return { success: true, message: 'Leave request approved' };
    } catch (error) {
      console.error('Approve leave error:', error);
      return { success: false, message: 'Failed to approve request' };
    }
  });

  ipcMain.handle('leave:rejectRequest', async (event, { requestId, reason, currentUserId }) => {
    try {
      const request = await db.get('SELECT * FROM leave_requests WHERE id = ?', [requestId]);
      if (!request) {
        return { success: false, message: 'Leave request not found' };
      }

      await db.run(
        `UPDATE leave_requests
         SET status = ?, rejected_reason = ?
         WHERE id = ?`,
        ['rejected', reason, requestId]
      );

      // Create notification
      const notifId = uuidv4();
      await db.run(
        `INSERT INTO notifications (id, user_id, title, message, type, related_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [notifId, request.user_id, 'Leave Rejected', `Your leave request was rejected: ${reason}`, 'warning', requestId]
      );

      const rejecterId = currentUserId || event?.sender?.id;
      const rejecter = rejecterId
        ? await db.get(
            `SELECT u.full_name, r.name as role_name
             FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?`,
            [rejecterId]
          )
        : null;

      await writeLeaveAudit(db, rejecterId, {
        action: 'LEAVE_REJECT',
        entityId: requestId,
        oldValue: { status: request.status },
        newValue: {
          status: 'rejected',
          rejectedBy: rejecter?.full_name,
          rejecterRole: rejecter?.role_name,
          reason,
          request: {
            user_id: request.user_id,
            start_date: request.start_date,
            end_date: request.end_date,
            days_count: request.days_count
          }
        }
      });

      return { success: true, message: 'Leave request rejected' };
    } catch (error) {
      console.error('Reject leave error:', error);
      return { success: false, message: 'Failed to reject request' };
    }
  });

  // ==========================================================================
  // CANCEL — employees can withdraw their own leave request at any stage:
  //   - pending             → just set to cancelled
  //   - lead_approved       → set to cancelled (no balance change yet)
  //   - approved            → restore balance + remove auto-marked Leave
  //                           attendance rows + set to cancelled
  //   - rejected / cancelled → no-op (already finalised)
  //
  // The user must own the request — leads/admins cancel by rejecting via the
  // existing approval flow.
  // ==========================================================================
  ipcMain.handle('leave:cancelRequest', async (event, { requestId, userId, reason }) => {
    try {
      if (!requestId || !userId) {
        return { success: false, message: 'requestId and userId are required' };
      }

      const request = await db.get('SELECT * FROM leave_requests WHERE id = ?', [requestId]);
      if (!request) return { success: false, message: 'Leave request not found' };

      // Only the owner can cancel their own request
      if (request.user_id !== userId) {
        return { success: false, message: 'You can only cancel your own leave requests' };
      }

      if (request.status === 'cancelled') {
        return { success: false, message: 'This request is already cancelled' };
      }
      if (request.status === 'rejected') {
        return { success: false, message: 'A rejected request cannot be cancelled' };
      }

      const wasApproved = request.status === 'approved';

      // If the request was already approved, restore the deducted balance.
      if (wasApproved) {
        const year = new Date(request.start_date).getFullYear();
        await db.run(
          `UPDATE leave_balances
              SET used = MAX(0, used - ?),
                  remaining = remaining + ?
            WHERE user_id = ? AND leave_type_id = ? AND year = ?`,
          [request.days_count, request.days_count, request.user_id, request.leave_type_id, year]
        );

        // Remove the attendance rows that were auto-marked as Leave for this
        // request. We only touch rows whose notes start with the auto-mark
        // prefix, so any manual attendance edits during the leave window stay
        // intact.
        await db.run(
          `DELETE FROM attendance
            WHERE user_id = ?
              AND date BETWEEN ? AND ?
              AND status = 'Leave'
              AND notes LIKE 'Approved leave:%'`,
          [request.user_id, request.start_date, request.end_date]
        );
      }

      // Update the request status. Reuse rejected_reason to record why it
      // was withdrawn so leads/admins can see the history.
      await db.run(
        `UPDATE leave_requests
            SET status = 'cancelled',
                rejected_reason = ?
          WHERE id = ?`,
        [reason || 'Withdrawn by employee', requestId]
      );

      // Clean up the pending approval task (so it disappears from the
      // approver's queue immediately).
      try {
        await db.run(
          `DELETE FROM approval_requests
            WHERE request_type = 'leave_request' AND request_id = ?`,
          [requestId]
        );
      } catch (e) { /* table may not exist on older DBs — non-fatal */ }

      // Notify the employee (acts as a receipt) and the approver chain
      try {
        const notifId = uuidv4();
        await db.run(
          `INSERT INTO notifications (id, user_id, title, message, type, related_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [notifId, request.user_id,
           'Leave Request Cancelled',
           wasApproved
             ? 'Your approved leave was cancelled. Your leave balance has been restored.'
             : 'Your leave request was cancelled.',
           'info', requestId]
        );
      } catch (e) { /* notifications are optional */ }

      try {
        await writeLeaveAudit(db, userId, {
          action: 'LEAVE_CANCEL',
          entityId: requestId,
          oldValue: { status: request.status },
          newValue: { status: 'cancelled', reason: reason || null, balanceRestored: wasApproved }
        });
      } catch (e) { /* audit is optional */ }

      return {
        success: true,
        message: wasApproved
          ? 'Leave cancelled and balance restored.'
          : 'Leave request cancelled.'
      };
    } catch (error) {
      console.error('Cancel leave error:', error);
      return { success: false, message: 'Failed to cancel request: ' + error.message };
    }
  });

  // ==========================================================================
  // MANUAL BALANCE OVERRIDE — admins can set an employee's "remaining" leave
  // for a given leave type. The system computes total_allocated as
  //   total = remaining + used
  // (so the displayed "Remaining" matches what the admin typed once any
  // currently-approved usage is accounted for), and sets manual_override = 1
  // so the auto-proration in getBalance leaves the row alone going forward.
  //
  // Reset behaviour: passing remaining = null (or undefined) clears the
  // override and lets the auto allocation take over again.
  // ==========================================================================
  ipcMain.handle('leave:setBalanceManual', async (event, { userId, leaveTypeId, remaining, currentUserId } = {}) => {
    try {
      if (!userId || !leaveTypeId) {
        return { success: false, message: 'userId and leaveTypeId are required' };
      }
      const currentYear = new Date().getFullYear();

      const existing = await db.get(
        `SELECT * FROM leave_balances WHERE user_id = ? AND leave_type_id = ? AND year = ?`,
        [userId, leaveTypeId, currentYear]
      );
      const usedCount = existing ? (existing.used || 0) : 0;

      // Reset path — admin cleared the field, let auto allocation resume.
      if (remaining === null || remaining === undefined || remaining === '') {
        if (existing) {
          await db.run(
            `UPDATE leave_balances
                SET manual_override = 0, updated_at = CURRENT_TIMESTAMP
              WHERE id = ?`,
            [existing.id]
          );
        }
        try {
          await writeLeaveAudit(db, currentUserId || 'system', {
            action: 'LEAVE_BALANCE_RESET',
            entityId: existing ? existing.id : null,
            oldValue: existing ? { remaining: existing.remaining, manual: existing.manual_override === 1 } : null,
            newValue: { manual: false }
          });
        } catch (_) {}
        return { success: true, message: 'Manual override cleared. Auto allocation will resume.' };
      }

      const remainingNum = parseFloat(remaining);
      if (!Number.isFinite(remainingNum) || remainingNum < 0) {
        return { success: false, message: 'Remaining must be a non-negative number' };
      }

      // Round to one decimal to match the rest of the system
      const remainingRounded = Math.round(remainingNum * 10) / 10;
      const totalAllocated   = Math.round((remainingRounded + usedCount) * 10) / 10;

      if (existing) {
        await db.run(
          `UPDATE leave_balances
              SET total_allocated = ?, remaining = ?, manual_override = 1, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
          [totalAllocated, remainingRounded, existing.id]
        );
      } else {
        await db.run(
          `INSERT INTO leave_balances (id, user_id, leave_type_id, year, total_allocated, used, remaining, manual_override)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
          [uuidv4(), userId, leaveTypeId, currentYear, totalAllocated, 0, remainingRounded]
        );
      }

      try {
        await writeLeaveAudit(db, currentUserId || 'system', {
          action: 'LEAVE_BALANCE_OVERRIDE',
          entityId: userId,
          oldValue: existing ? { remaining: existing.remaining, total: existing.total_allocated } : null,
          newValue: { remaining: remainingRounded, total: totalAllocated, manual: true }
        });
      } catch (_) {}

      return {
        success: true,
        message: `Remaining set to ${remainingRounded} day(s).`,
        data: { totalAllocated, used: usedCount, remaining: remainingRounded }
      };
    } catch (error) {
      console.error('Set leave balance error:', error);
      return { success: false, message: 'Failed to update balance: ' + error.message };
    }
  });

  // ==========================================================================
  // UPCOMING LEAVES — approved (or lead-approved) leaves whose end_date is
  // today or later. Used by the Lead/Admin dashboards to plan around staff
  // absences. departmentId is optional — leads pass theirs to see team only;
  // admins omit it to see everyone.
  // ==========================================================================
  ipcMain.handle('leave:getUpcoming', async (event, { departmentId } = {}) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      let sql = `SELECT lr.*, lt.name as leave_type_name,
                        u.full_name, u.department_id, d.name as department_name
                 FROM leave_requests lr
                 JOIN leave_types lt ON lr.leave_type_id = lt.id
                 JOIN users u ON lr.user_id = u.id
                 LEFT JOIN departments d ON u.department_id = d.id
                 WHERE lr.status IN ('approved', 'lead_approved')
                   AND lr.end_date >= ?`;
      const params = [today];
      if (departmentId) {
        sql += ` AND u.department_id = ?`;
        params.push(departmentId);
      }
      sql += ` ORDER BY lr.start_date ASC, u.full_name ASC`;
      const rows = await db.all(sql, params);
      return { success: true, data: rows };
    } catch (error) {
      console.error('Get upcoming leaves error:', error);
      return { success: false, message: 'Failed to retrieve upcoming leaves' };
    }
  });

  ipcMain.handle('leave:getDepartmentRequests', async (event, { departmentId, leadId } = {}) => {
    try {
      // leadId is optional. When provided, exclude that user's OWN requests so
      // a department lead never sees their own leave in their approval queue.
      // The leave:request handler also auto-skips the lead stage for a lead's
      // own request (status goes straight to 'lead_approved'), so in practice
      // this filter only matters as a safety net for legacy rows or future
      // tweaks.
      const sql = `SELECT lr.*, lt.name as leave_type_name, u.full_name
                   FROM leave_requests lr
                   JOIN leave_types lt ON lr.leave_type_id = lt.id
                   JOIN users u ON lr.user_id = u.id
                   WHERE u.department_id = ?
                     AND lr.status = 'pending'
                     ${leadId ? 'AND lr.user_id != ?' : ''}
                   ORDER BY lr.requested_at DESC`;
      const params = leadId ? [departmentId, leadId] : [departmentId];
      const requests = await db.all(sql, params);
      return { success: true, data: requests };
    } catch (error) {
      console.error('Get department leave requests error:', error);
      return { success: false, message: 'Failed to retrieve requests' };
    }
  });

  // Returns every leave request that needs admin/MD attention. Used by the
  // admin Leave Approvals page.
  //
  // Previously this query JOINed approval_requests and filtered by
  // assigned_to, which caused two problems:
  //   (1) "Admin sees nothing" — when forwarding after a lead approval, the
  //       query picks the single most-senior admin (MD beats Administrator
  //       beats Admin) and assigns only that one user. Any OTHER admin/MD
  //       opening their queue sees an empty list because nothing was assigned
  //       to them.
  //   (2) "MD sees duplicates" — approval_requests has no UNIQUE on
  //       (request_id, assigned_to), so any time a request got routed twice
  //       (lead change mid-flow, admin fallback at submit + lead-forward
  //       later, etc.), there'd be two rows pointing at the same leave
  //       request. The JOIN then produced two visible rows in the UI.
  //
  // New approach: query leave_requests directly. Show:
  //   - All 'lead_approved' requests (waiting for admin final sign-off)
  //   - All 'pending' requests in departments with NO active lead
  //     (those bypass stage 1 and need admin action)
  // The admin queue is now a single shared list across all MD/Administrator/
  // Admin users — they all see the same thing, anyone can action it.
  ipcMain.handle('leave:getAssignedRequests', async (event, _args = {}) => {
    try {
      const requests = await db.all(
        `SELECT lr.*,
                lt.name as leave_type_name,
                u.full_name,
                u.email,
                d.name as department_name,
                lead.full_name as lead_full_name
         FROM leave_requests lr
         JOIN leave_types lt ON lr.leave_type_id = lt.id
         JOIN users u ON lr.user_id = u.id
         LEFT JOIN departments d ON u.department_id = d.id
         LEFT JOIN users lead ON lr.approved_by = lead.id AND lr.status = 'lead_approved'
         WHERE lr.status = 'lead_approved'
            OR (lr.status = 'pending' AND NOT EXISTS (
                  SELECT 1 FROM users dl
                  WHERE dl.department_id = u.department_id
                    AND dl.is_department_lead = 1
                    AND dl.status = 'active'
            ))
         ORDER BY lr.requested_at DESC`
      );
      return { success: true, data: requests };
    } catch (error) {
      console.error('Get assigned leave requests error:', error);
      return { success: false, message: 'Failed to retrieve assigned requests' };
    }
  });

  // Calculate leave allocation based on joining date
  ipcMain.handle('leave:calculateAllocation', async (event, { joiningDate, year }) => {
    try {
      const allocation = calculateLeaveAllocation(joiningDate, year);
      return { success: true, data: { allocation, year } };
    } catch (error) {
      console.error('Calculate allocation error:', error);
      return { success: false, message: 'Failed to calculate allocation' };
    }
  });

  // Get employee leave allocation
  ipcMain.handle('leave:getEmployeeAllocation', async (event, { userId }) => {
    try {
      const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
      if (!user) {
        return { success: false, message: 'User not found' };
      }

      const currentYear = new Date().getFullYear();
      const allocation = calculateLeaveAllocation(user.joining_date, currentYear);

      return {
        success: true,
        data: {
          userId,
          joiningDate: user.joining_date,
          allocationYear: currentYear,
          allocatedDays: allocation,
          allocatedAmount: Math.floor(allocation * 100) / 100 // Format to 2 decimals
        }
      };
    } catch (error) {
      console.error('Get employee allocation error:', error);
      return { success: false, message: 'Failed to retrieve allocation' };
    }
  });

  // -------------------------------------------------------------------------
  // Rollover-policy CRUD — used by Admin Settings → Leave Rollover Policy
  // -------------------------------------------------------------------------

  // List every leave type + its current policy (admins edit this table).
  ipcMain.handle('leave:listLeaveTypes', async () => {
    try {
      const rows = await db.all(
        `SELECT id, name, annual_entitlement,
                COALESCE(carry_forward_enabled, 0)        as carry_forward_enabled,
                COALESCE(max_carry_forward_days, 0)       as max_carry_forward_days,
                COALESCE(expiry_months_after_year_end, 0) as expiry_months_after_year_end,
                COALESCE(encashment_enabled, 0)           as encashment_enabled
         FROM leave_types ORDER BY name ASC`
      );
      return {
        success: true,
        data: rows.map(r => ({
          id: r.id,
          name: r.name,
          annualEntitlement:        r.annual_entitlement,
          carryForwardEnabled:      r.carry_forward_enabled === 1,
          maxCarryForwardDays:      r.max_carry_forward_days,
          expiryMonthsAfterYearEnd: r.expiry_months_after_year_end,
          encashmentEnabled:        r.encashment_enabled === 1
        }))
      };
    } catch (error) {
      console.error('[LEAVE] listLeaveTypes error:', error);
      return { success: false, message: error.message };
    }
  });

  // Update the rollover policy for a single leave type. Admin-only.
  // Annual entitlement is included in the editable set so the same form can
  // tweak the headline number (e.g. "Annual Leave 25 → 22").
  ipcMain.handle('leave:updateLeaveTypePolicy', async (event, params = {}) => {
    try {
      const {
        leaveTypeId,
        annualEntitlement,
        carryForwardEnabled,
        maxCarryForwardDays,
        expiryMonthsAfterYearEnd,
        encashmentEnabled,
        currentUserId
      } = params;
      if (!leaveTypeId) return { success: false, message: 'leaveTypeId is required' };

      const before = await db.get('SELECT * FROM leave_types WHERE id = ?', [leaveTypeId]);
      if (!before) return { success: false, message: 'Leave type not found' };

      // Clamp & coerce so SQLite doesn't silently store junk values
      const cleanInt   = (v) => (v == null || v === '') ? null : Math.max(0, parseInt(v, 10) || 0);
      const cleanBool  = (v) => v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;

      await db.run(
        `UPDATE leave_types
            SET annual_entitlement           = COALESCE(?, annual_entitlement),
                carry_forward_enabled        = ?,
                max_carry_forward_days       = ?,
                expiry_months_after_year_end = ?,
                encashment_enabled           = ?
          WHERE id = ?`,
        [
          cleanInt(annualEntitlement),
          cleanBool(carryForwardEnabled),
          cleanInt(maxCarryForwardDays)      || 0,
          cleanInt(expiryMonthsAfterYearEnd) || 0,
          cleanBool(encashmentEnabled),
          leaveTypeId
        ]
      );

      await writeAudit(db, currentUserId || 'system', {
        action: 'LEAVE_POLICY_UPDATE',
        entityType: 'LEAVE_TYPE',
        entityId: leaveTypeId,
        oldValue: {
          annualEntitlement:        before.annual_entitlement,
          carryForwardEnabled:      before.carry_forward_enabled === 1,
          maxCarryForwardDays:      before.max_carry_forward_days,
          expiryMonthsAfterYearEnd: before.expiry_months_after_year_end,
          encashmentEnabled:        before.encashment_enabled === 1
        },
        newValue: {
          annualEntitlement, carryForwardEnabled, maxCarryForwardDays,
          expiryMonthsAfterYearEnd, encashmentEnabled
        }
      });
      return { success: true, message: 'Policy updated' };
    } catch (error) {
      console.error('[LEAVE] updateLeaveTypePolicy error:', error);
      return { success: false, message: error.message };
    }
  });

  // Audit / debugging helper: show every rollover that has been applied for a
  // user — handy when the Leave Calendar shows a balance the user disputes.
  ipcMain.handle('leave:getRolloverHistory', async (event, { userId } = {}) => {
    try {
      if (!userId) return { success: false, message: 'userId is required' };
      const rows = await db.all(
        `SELECT log.id, log.leave_type_id, lt.name as leave_type_name,
                log.from_year, log.to_year, log.prev_remaining,
                log.carried_forward, log.encashed, log.forfeited,
                log.policy_snapshot, log.applied_at
         FROM leave_balance_rollover_log log
         LEFT JOIN leave_types lt ON log.leave_type_id = lt.id
         WHERE log.user_id = ?
         ORDER BY log.to_year DESC, lt.name ASC`,
        [userId]
      );
      return { success: true, data: rows };
    } catch (error) {
      console.error('[LEAVE] getRolloverHistory error:', error);
      return { success: false, message: error.message };
    }
  });
}

module.exports = { register };
