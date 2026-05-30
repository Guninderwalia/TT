const { v4: uuidv4 } = require('uuid');

function register(ipcMain, db) {
  console.log('[DEPOSIT] Registering deposit:getAll');
  // Get all deposits with employee information
  ipcMain.handle('deposit:getAll', async (event) => {
    try {
      console.log('[DEPOSIT] Handler called: deposit:getAll');

      const deposits = await db.all(
        `SELECT pd.*, u.full_name as user_name, u.email
         FROM probation_deposits pd
         JOIN users u ON pd.user_id = u.id
         ORDER BY pd.created_at DESC`,
        []
      );

      console.log('[DEPOSIT] Found', deposits.length, 'deposits');

      // Calculate eligibility date (2 years from joining date)
      const enriched = await Promise.all((deposits || []).map(async (d) => {
        let eligibilityDate = null;
        let joiningDate = null;

        try {
          const empRecord = await db.get(
            'SELECT start_date FROM employment_records WHERE user_id = ?',
            [d.user_id]
          );

          if (empRecord?.start_date) {
            joiningDate = empRecord.start_date;
            const joining = new Date(joiningDate);
            eligibilityDate = new Date(joining.getFullYear() + 2, joining.getMonth(), joining.getDate())
              .toISOString().split('T')[0];
          }
        } catch (e) {
          console.error('[DEPOSIT] Error fetching employment record:', e.message);
        }

        return {
          ...d,
          joining_date: joiningDate,
          eligibility_date: eligibilityDate
        };
      }));

      console.log('[DEPOSIT] Returning', enriched.length, 'enriched deposits');
      return { success: true, data: enriched };
    } catch (error) {
      console.error('[DEPOSIT] Get all deposits error:', error);
      return { success: false, message: 'Failed to retrieve deposits: ' + error.message };
    }
  });

  console.log('[DEPOSIT] Registering deposit:getById');
  // Get deposit by ID
  ipcMain.handle('deposit:getById', async (event, { id }) => {
    try {
      const deposit = await db.get(
        `SELECT pd.*,
                u.full_name as user_name,
                u.id as user_id,
                u.email
         FROM probation_deposits pd
         JOIN users u ON pd.user_id = u.id
         WHERE pd.id = ?`,
        [id]
      );

      if (!deposit) {
        return { success: false, message: 'Deposit not found' };
      }

      // Calculate eligibility date
      let eligibilityDate = null;
      let joiningDate = null;

      try {
        const empRecord = await db.get(
          'SELECT start_date FROM employment_records WHERE user_id = ? LIMIT 1',
          [deposit.user_id]
        );

        if (empRecord && empRecord.start_date) {
          joiningDate = empRecord.start_date;
          const joining = new Date(joiningDate);
          eligibilityDate = new Date(joining.getFullYear() + 2, joining.getMonth(), joining.getDate())
            .toISOString().split('T')[0];
        }
      } catch (e) {
        console.error('Error fetching employment record:', e);
      }

      return { success: true, data: { ...deposit, joining_date: joiningDate, eligibility_date: eligibilityDate } };
    } catch (error) {
      console.error('Get deposit error:', error);
      return { success: false, message: 'Failed to retrieve deposit' };
    }
  });

  console.log('[DEPOSIT] Registering deposit:create');
  // Create deposit
  ipcMain.handle('deposit:create', async (event, { userId, depositAmount, deductionStartMonth, deductionEndMonth, currentUserId }) => {
    try {
      const depositId = uuidv4();

      await db.run(
        `INSERT INTO probation_deposits (id, user_id, deposit_amount, deduction_start_month, deduction_end_month, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [depositId, userId, depositAmount, deductionStartMonth || 1, deductionEndMonth || 2, 'held']
      );

      // Log audit
      await db.run(
        `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, old_value, new_value, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          uuidv4(),
          currentUserId || 'system',
          'DEPOSIT_CREATE',
          'Deposit',
          depositId,
          null,
          JSON.stringify({ userId, depositAmount, deductionStartMonth, deductionEndMonth })
        ]
      );

      return { success: true, message: 'Deposit created', depositId };
    } catch (error) {
      console.error('Create deposit error:', error);
      return { success: false, message: 'Failed to create deposit' };
    }
  });

  console.log('[DEPOSIT] Registering deposit:update');
  // Update deposit
  ipcMain.handle('deposit:update', async (event, { id, depositAmount, status, deductionStartMonth, deductionEndMonth, currentUserId }) => {
    try {
      const before = await db.get('SELECT * FROM probation_deposits WHERE id = ?', [id]);

      if (!before) {
        return { success: false, message: 'Deposit not found' };
      }

      const updates = [];
      const values = [];

      if (depositAmount !== undefined) {
        updates.push('deposit_amount = ?');
        values.push(depositAmount);
      }
      if (status !== undefined) {
        updates.push('status = ?');
        values.push(status);
      }
      if (deductionStartMonth !== undefined) {
        updates.push('deduction_start_month = ?');
        values.push(deductionStartMonth);
      }
      if (deductionEndMonth !== undefined) {
        updates.push('deduction_end_month = ?');
        values.push(deductionEndMonth);
      }

      if (updates.length === 0) {
        return { success: false, message: 'No fields to update' };
      }

      updates.push('updated_at = CURRENT_TIMESTAMP');
      values.push(id);

      await db.run(
        `UPDATE probation_deposits SET ${updates.join(', ')} WHERE id = ?`,
        values
      );

      const after = await db.get('SELECT * FROM probation_deposits WHERE id = ?', [id]);

      // Log audit
      await db.run(
        `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, old_value, new_value, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          uuidv4(),
          currentUserId || 'system',
          'DEPOSIT_UPDATE',
          'Deposit',
          id,
          JSON.stringify(before),
          JSON.stringify(after)
        ]
      );

      return { success: true, message: 'Deposit updated' };
    } catch (error) {
      console.error('[DEPOSIT] Update deposit error:', error.message);
      return { success: false, message: 'Failed to update deposit: ' + error.message };
    }
  });

  console.log('[DEPOSIT] Registering deposit:delete');
  // Delete deposit
  ipcMain.handle('deposit:delete', async (event, { id, currentUserId }) => {
    try {
      const before = await db.get('SELECT * FROM probation_deposits WHERE id = ?', [id]);

      if (!before) {
        return { success: false, message: 'Deposit not found' };
      }

      await db.run('DELETE FROM probation_deposits WHERE id = ?', [id]);

      // Log audit
      await db.run(
        `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, old_value, new_value, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          uuidv4(),
          currentUserId || 'system',
          'DEPOSIT_DELETE',
          'Deposit',
          id,
          JSON.stringify(before),
          null
        ]
      );

      return { success: true, message: 'Deposit deleted' };
    } catch (error) {
      console.error('Delete deposit error:', error);
      return { success: false, message: 'Failed to delete deposit' };
    }
  });

  console.log('[DEPOSIT] ✓ All 5 deposit handlers registered');
}

module.exports = { register };
