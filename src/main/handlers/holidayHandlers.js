const { v4: uuidv4 } = require('uuid');
const { writeAudit } = require('./_auditHelper');

function register(ipcMain, db, store) {
  // Helper to determine if we're using database or store
  const useDatabase = !!db;

  // Schema notes:
  //   Table is `public_holidays`, column is `holiday_name`.
  // Frontend expectations:
  //   Components read `h.name` and `h.date`, so DB rows are mapped on the
  //   way out and incoming `name` is mapped to `holiday_name` going in.

  function mapRowOut(row) {
    if (!row) return row;
    return {
      id: row.id,
      name: row.holiday_name,
      holiday_name: row.holiday_name,
      date: row.date,
      description: row.description,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  // Get all holidays
  ipcMain.handle('holiday:getList', async (event) => {
    try {
      if (useDatabase) {
        const rows = await db.all(
          `SELECT * FROM public_holidays ORDER BY date ASC`
        );
        return { success: true, data: rows.map(mapRowOut) };
      } else {
        const holidays = store.get('holidays', []);
        const sorted = holidays.sort((a, b) => new Date(a.date) - new Date(b.date));
        return { success: true, data: sorted };
      }
    } catch (error) {
      console.error('Get holidays error:', error);
      return { success: false, message: 'Failed to retrieve holidays' };
    }
  });

  // Create a new holiday
  ipcMain.handle('holiday:create', async (event, { date, name, description, currentUserId }) => {
    try {
      if (!date || !name) {
        return { success: false, message: 'Date and name are required' };
      }

      const holidayId = uuidv4();
      const holidayData = { id: holidayId, date, name, description, createdAt: new Date().toISOString() };

      if (useDatabase) {
        await db.run(
          `INSERT INTO public_holidays (id, holiday_name, date, description)
           VALUES (?, ?, ?, ?)`,
          [holidayId, name, date, description || null]
        );
      } else {
        const holidays = store.get('holidays', []);
        holidays.push(holidayData);
        store.set('holidays', holidays);
      }

      await writeAudit(db, currentUserId || 'system', {
        action: 'HOLIDAY_CREATE',
        entityType: 'HOLIDAY',
        entityId: holidayId,
        oldValue: null,
        newValue: { name, date, description }
      });
      console.log(`[HOLIDAY] Created holiday: ${name} on ${date}`);
      return { success: true, message: 'Holiday created successfully', data: holidayData };
    } catch (error) {
      console.error('Create holiday error:', error);
      return { success: false, message: 'Failed to create holiday' };
    }
  });

  // Update an existing holiday
  ipcMain.handle('holiday:update', async (event, { id, date, name, description, currentUserId }) => {
    try {
      if (!date || !name) {
        return { success: false, message: 'Date and name are required' };
      }

      let before = null;
      if (useDatabase) {
        before = await db.get('SELECT * FROM public_holidays WHERE id = ?', [id]);
        await db.run(
          `UPDATE public_holidays
              SET holiday_name = ?, date = ?, description = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
          [name, date, description || null, id]
        );
      } else {
        const holidays = store.get('holidays', []);
        const index = holidays.findIndex(h => h.id === id);
        if (index !== -1) {
          before = { ...holidays[index] };
          holidays[index] = { ...holidays[index], date, name, description, updatedAt: new Date().toISOString() };
          store.set('holidays', holidays);
        }
      }

      await writeAudit(db, currentUserId || 'system', {
        action: 'HOLIDAY_UPDATE',
        entityType: 'HOLIDAY',
        entityId: id,
        oldValue: before ? { name: before.holiday_name || before.name, date: before.date, description: before.description } : null,
        newValue: { name, date, description }
      });
      console.log(`[HOLIDAY] Updated holiday: ${name} on ${date}`);
      return { success: true, message: 'Holiday updated successfully' };
    } catch (error) {
      console.error('Update holiday error:', error);
      return { success: false, message: 'Failed to update holiday' };
    }
  });

  // Delete a holiday
  ipcMain.handle('holiday:delete', async (event, { id, currentUserId }) => {
    try {
      let before = null;
      if (useDatabase) {
        before = await db.get('SELECT * FROM public_holidays WHERE id = ?', [id]);
        await db.run('DELETE FROM public_holidays WHERE id = ?', [id]);
      } else {
        const holidays = store.get('holidays', []);
        before = holidays.find(h => h.id === id);
        const filtered = holidays.filter(h => h.id !== id);
        store.set('holidays', filtered);
      }

      await writeAudit(db, currentUserId || 'system', {
        action: 'HOLIDAY_DELETE',
        entityType: 'HOLIDAY',
        entityId: id,
        oldValue: before ? { name: before.holiday_name || before.name, date: before.date, description: before.description } : null,
        newValue: null
      });
      console.log(`[HOLIDAY] Deleted holiday: ${id}`);
      return { success: true, message: 'Holiday deleted successfully' };
    } catch (error) {
      console.error('Delete holiday error:', error);
      return { success: false, message: 'Failed to delete holiday' };
    }
  });

  // Get holidays for a specific month/year
  ipcMain.handle('holiday:getByMonth', async (event, { year, month }) => {
    try {
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const endDate = `${year}-${String(month).padStart(2, '0')}-31`;

      if (useDatabase) {
        const rows = await db.all(
          `SELECT * FROM public_holidays
            WHERE date BETWEEN ? AND ?
            ORDER BY date ASC`,
          [startDate, endDate]
        );
        return { success: true, data: rows.map(mapRowOut) };
      } else {
        const holidays = store.get('holidays', []);
        const filtered = holidays.filter(h => h.date >= startDate && h.date <= endDate);
        const sorted = filtered.sort((a, b) => new Date(a.date) - new Date(b.date));
        return { success: true, data: sorted };
      }
    } catch (error) {
      console.error('Get holidays by month error:', error);
      return { success: false, message: 'Failed to retrieve holidays' };
    }
  });
}

module.exports = { register };
