const { v4: uuidv4 } = require('uuid');
const { writeAudit } = require('./_auditHelper');

function register(ipcMain, db) {
  ipcMain.handle('department:getAll', async (event) => {
    try {
      const departments = await db.all(
        `SELECT d.*, u.full_name as lead_name,
         (SELECT COUNT(*) FROM users WHERE department_id = d.id AND status = 'active') as employee_count
         FROM departments d
         LEFT JOIN users u ON d.lead_id = u.id
         ORDER BY d.name`
      );
      return { success: true, data: departments };
    } catch (error) {
      console.error('Get all departments error:', error);
      return { success: false, message: 'Failed to retrieve departments' };
    }
  });

  ipcMain.handle('department:create', async (event, { name, description, currentUserId }) => {
    try {
      const id = uuidv4();
      await db.run(
        `INSERT INTO departments (id, name, description)
         VALUES (?, ?, ?)`,
        [id, name, description]
      );
      await writeAudit(db, currentUserId || 'system', {
        action: 'DEPARTMENT_CREATE',
        entityType: 'DEPARTMENT',
        entityId: id,
        oldValue: null,
        newValue: { name, description }
      });
      return { success: true, message: 'Department created', id };
    } catch (error) {
      console.error('Create department error:', error);
      return { success: false, message: 'Failed to create department' };
    }
  });

  ipcMain.handle('department:update', async (event, { id, name, description, currentUserId }) => {
    try {
      const before = await db.get('SELECT name, description FROM departments WHERE id = ?', [id]);
      await db.run(
        `UPDATE departments SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [name, description, id]
      );
      await writeAudit(db, currentUserId || 'system', {
        action: 'DEPARTMENT_UPDATE',
        entityType: 'DEPARTMENT',
        entityId: id,
        oldValue: before ? { name: before.name, description: before.description } : null,
        newValue: { name, description }
      });
      return { success: true, message: 'Department updated' };
    } catch (error) {
      console.error('Update department error:', error);
      return { success: false, message: 'Failed to update department' };
    }
  });

  ipcMain.handle('department:assignLead', async (event, { departmentId, userId, currentUserId }) => {
    try {
      // Sanity-check both records exist before touching anything, so a typo
      // in IDs gives a precise error rather than a silent no-op.
      const dept = await db.get('SELECT id, name FROM departments WHERE id = ?', [departmentId]);
      if (!dept) {
        return { success: false, message: 'Department not found', error: 'Department not found' };
      }
      const user = await db.get(
        `SELECT u.id, u.full_name, u.role_id, r.name as role_name
         FROM users u LEFT JOIN roles r ON u.role_id = r.id
         WHERE u.id = ?`,
        [userId]
      );
      if (!user) {
        return { success: false, message: 'Employee not found', error: 'Employee not found' };
      }

      // Assign the lead on the department.
      await db.run(
        `UPDATE departments SET lead_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [userId, departmentId]
      );

      // Mark the user as a department lead. ONLY change role_id if their
      // current role is "User" — promoting users → leads. Admins, MDs,
      // and Managers keep their existing role even when assigned as a
      // department lead. The previous version silently demoted any admin
      // who got assigned, which was the source of "I edited the admin and
      // now they're a Lead".
      if (user.role_name === 'User') {
        const leadRole = await db.get("SELECT id FROM roles WHERE name = 'Lead'");
        if (leadRole) {
          await db.run(
            `UPDATE users SET role_id = ?, is_department_lead = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [leadRole.id, userId]
          );
        } else {
          await db.run(
            `UPDATE users SET is_department_lead = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [userId]
          );
        }
      } else {
        await db.run(
          `UPDATE users SET is_department_lead = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [userId]
        );
      }

      await writeAudit(db, currentUserId || 'system', {
        action: 'DEPARTMENT_ASSIGN_LEAD',
        entityType: 'DEPARTMENT',
        entityId: departmentId,
        oldValue: null,
        newValue: { departmentName: dept.name, leadUserId: userId, leadName: user.full_name }
      });
      return { success: true, message: 'Department lead assigned', data: { departmentId, userId, departmentName: dept.name, userName: user.full_name } };
    } catch (error) {
      console.error('Assign department lead error:', error);
      return { success: false, message: 'Failed to assign department lead: ' + error.message, error: error.message };
    }
  });

  // SQLite-backed department:delete — overrides the JSON-store inline version
  // in main.js, which returns "Department not found" on fresh-seeded installs
  // because the JSON store is empty.
  ipcMain.handle('department:delete', async (event, { id, currentUserId }) => {
    try {
      const dept = await db.get('SELECT id, name, description FROM departments WHERE id = ?', [id]);
      if (!dept) {
        return { success: false, message: 'Department not found', error: 'Department not found' };
      }

      // Don't orphan users — refuse if any active user is still in this dept.
      const stillInDept = await db.get(
        `SELECT COUNT(*) as cnt FROM users WHERE department_id = ? AND status = 'active'`,
        [id]
      );
      if (stillInDept && stillInDept.cnt > 0) {
        return {
          success: false,
          message: `Cannot delete: ${stillInDept.cnt} active employee${stillInDept.cnt === 1 ? ' is' : 's are'} still in this department. Move them to another department first.`,
          error: 'Department has active employees'
        };
      }

      // Clear lead_id from any other departments that point at users in this
      // dept (defensive — shouldn't normally happen) and null out the FK on
      // inactive users before removing the row.
      await db.run(`UPDATE users SET department_id = NULL WHERE department_id = ?`, [id]);
      await db.run(`DELETE FROM departments WHERE id = ?`, [id]);

      await writeAudit(db, currentUserId || 'system', {
        action: 'DEPARTMENT_DELETE',
        entityType: 'DEPARTMENT',
        entityId: id,
        oldValue: { name: dept.name, description: dept.description },
        newValue: null
      });
      return { success: true, message: 'Department deleted', data: { id, name: dept.name } };
    } catch (error) {
      console.error('Delete department error:', error);
      return { success: false, message: 'Failed to delete department: ' + error.message, error: error.message };
    }
  });
}

module.exports = { register };
