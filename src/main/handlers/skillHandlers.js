const { v4: uuidv4 } = require('uuid');
const { writeAudit } = require('./_auditHelper');

/**
 * SQLite-backed skill handlers. Overrides the legacy JSON-store versions
 * in main.js that wrote to store.get('employeeSkills') and
 * store.get('predefinedSkills').
 *
 * Tables:
 *   predefined_skills (id, name, category)              ← seeded at init
 *   employee_skills   (id, user_id, skill_id, rating,
 *                      assessed_by, assessment_date)    ← UNIQUE(user_id, skill_id)
 *
 * Frontend shape:
 *   - skill:getList     → [{ id, name, category }]
 *   - skill:getByEmployee → [{ id, employeeId, skillId, rating, ... }]
 *   - skill:assess      → upserts by (employeeId, skillId)
 */

function mapAssessmentOut(row) {
  if (!row) return row;
  return {
    id: row.id,
    employeeId: row.user_id,
    skillId: row.skill_id,
    rating: row.rating,
    assessedBy: row.assessed_by,
    assessmentDate: row.assessment_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function register(ipcMain, db) {
  // Upsert a skill rating for a given (employee, skill) pair.
  ipcMain.handle('skill:assess', async (event, { employeeId, skillId, rating, currentUserId }) => {
    try {
      if (!employeeId || !skillId) {
        return { success: false, error: 'employeeId and skillId are required' };
      }
      if (rating == null || rating < 1 || rating > 5) {
        return { success: false, error: 'rating must be between 1 and 5' };
      }

      // Verify the skill exists (so we fail loudly instead of silently
      // recording ratings against a typo'd skillId).
      const skill = await db.get('SELECT id, name FROM predefined_skills WHERE id = ?', [skillId]);
      if (!skill) return { success: false, error: `Skill not found: ${skillId}` };

      const existing = await db.get(
        'SELECT id, rating FROM employee_skills WHERE user_id = ? AND skill_id = ?',
        [employeeId, skillId]
      );

      if (existing) {
        await db.run(
          `UPDATE employee_skills
              SET rating = ?, assessment_date = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, assessed_by = COALESCE(?, assessed_by)
            WHERE id = ?`,
          [rating, currentUserId || null, existing.id]
        );
        const row = await db.get('SELECT * FROM employee_skills WHERE id = ?', [existing.id]);
        await writeAudit(db, currentUserId || 'system', {
          action: 'SKILL_RATE_UPDATE',
          entityType: 'EMPLOYEE_SKILL',
          entityId: existing.id,
          oldValue: { employeeId, skillId, skill: skill.name, rating: existing.rating },
          newValue: { employeeId, skillId, skill: skill.name, rating }
        });
        console.log('[SKILL] Updated', employeeId, skillId, '=', rating);
        return { success: true, data: mapAssessmentOut(row) };
      }

      const id = uuidv4();
      await db.run(
        `INSERT INTO employee_skills (id, user_id, skill_id, rating, assessed_by)
         VALUES (?, ?, ?, ?, ?)`,
        [id, employeeId, skillId, rating, currentUserId || null]
      );
      const row = await db.get('SELECT * FROM employee_skills WHERE id = ?', [id]);
      await writeAudit(db, currentUserId || 'system', {
        action: 'SKILL_RATE_CREATE',
        entityType: 'EMPLOYEE_SKILL',
        entityId: id,
        oldValue: null,
        newValue: { employeeId, skillId, skill: skill.name, rating }
      });
      console.log('[SKILL] Assessed', employeeId, skillId, '=', rating);
      return { success: true, data: mapAssessmentOut(row) };
    } catch (error) {
      console.error('[SKILL] Assess error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('skill:getByEmployee', async (event, { employeeId }) => {
    try {
      const rows = await db.all(
        `SELECT es.* FROM employee_skills es WHERE es.user_id = ?`,
        [employeeId]
      );
      console.log(`[SKILL] Found ${rows.length} skills for employee ${employeeId}`);
      return { success: true, data: rows.map(mapAssessmentOut) };
    } catch (error) {
      console.error('[SKILL] Get by employee error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('skill:getList', async (event, _args) => {
    try {
      const rows = await db.all('SELECT id, name, category FROM predefined_skills ORDER BY name ASC');
      return { success: true, data: rows };
    } catch (error) {
      console.error('[SKILL] Get list error:', error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
