/**
 * Employee Document Attachment Handlers
 *
 * Manages contract, ID, offer letter and other employee documents.
 *
 * Storage:
 *   - File contents go to %APPDATA%/TaskTango/employee-documents/<user_id>/<uuid>.<ext>
 *     (subfolder per employee for cleanup on user deletion)
 *   - File metadata goes to the employee_documents SQLite table
 *
 * Role-based access (enforced in each handler):
 *   - admin / md / administrator → full access for any employee
 *   - lead / manager             → list + view documents for users in THEIR department
 *   - everyone else              → list + view ONLY their own documents
 *   - confidential flag          → admin-only regardless of role
 */

const { app } = require('electron');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { writeAudit } = require('./_auditHelper');

// Resolve the storage root. Lazy-initialised on first use so tests can mock
// app.getPath. Auto-creates the directory tree.
let _storageRoot = null;
function storageRoot() {
  if (_storageRoot) return _storageRoot;
  const base = app.getPath('userData');
  _storageRoot = path.join(base, 'employee-documents');
  if (!fs.existsSync(_storageRoot)) {
    fs.mkdirSync(_storageRoot, { recursive: true });
    console.log('[DOCUMENTS] Created storage root:', _storageRoot);
  }
  return _storageRoot;
}

// Per-employee subfolder so cleanup is easy when a user is removed
function employeeFolder(userId) {
  const folder = path.join(storageRoot(), String(userId));
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
  return folder;
}

// Reasonable extension whitelist — covers contracts, ID copies, offer letters,
// scanned documents and the occasional spreadsheet.
const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.txt', '.rtf',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp',
  '.xls', '.xlsx', '.csv'
]);

// 25 MB cap — keep the storage folder sane and prevent runaway uploads.
const MAX_FILE_SIZE = 25 * 1024 * 1024;

// Look up the caller's role + department for permission checks.
async function getUserContext(db, userId) {
  if (!userId) return null;
  const row = await db.get(
    `SELECT u.id, u.department_id, u.is_department_lead, r.name as role_name
     FROM users u
     LEFT JOIN roles r ON u.role_id = r.id
     WHERE u.id = ?`,
    [userId]
  );
  if (!row) return null;
  const role = (row.role_name || '').toLowerCase();
  return {
    id: row.id,
    departmentId: row.department_id,
    isLead: row.is_department_lead === 1,
    role,
    isAdmin: ['admin', 'administrator', 'md'].includes(role),
    isLeadRole: ['lead', 'manager'].includes(role) || row.is_department_lead === 1
  };
}

// Can the caller view documents belonging to ownerId?
async function canView(db, callerId, ownerId, isConfidential) {
  const caller = await getUserContext(db, callerId);
  if (!caller) return false;
  if (caller.isAdmin) return true;                  // admins see everything
  if (isConfidential) return false;                 // confidential = admin only
  if (caller.id === ownerId) return true;           // employees see their own
  if (caller.isLeadRole) {
    // Lead can see documents for members of their department
    const owner = await db.get('SELECT department_id FROM users WHERE id = ?', [ownerId]);
    return owner && owner.department_id === caller.departmentId;
  }
  return false;
}

// Can the caller upload/delete documents for ownerId? Admins only.
async function canManage(db, callerId) {
  const caller = await getUserContext(db, callerId);
  return !!(caller && caller.isAdmin);
}

function register(ipcMain, db) {
  // ----------------------------------------------------------------------
  // UPLOAD — admin only
  // Renderer sends base64-encoded file data + metadata. We decode, write to
  // disk, and record the metadata row.
  // ----------------------------------------------------------------------
  ipcMain.handle('document:upload', async (_event, params) => {
    try {
      const {
        userId,                  // employee the document belongs to
        documentType,            // 'Contract' / 'ID Copy' / 'Offer Letter' / 'Other'
        originalFilename,
        fileDataBase64,          // base64-encoded file bytes
        mimeType,
        description = '',
        isConfidential = false,
        uploadedBy               // caller's user id
      } = params || {};

      if (!await canManage(db, uploadedBy)) {
        return { success: false, message: 'Only admins can upload documents' };
      }
      if (!userId || !originalFilename || !fileDataBase64) {
        return { success: false, message: 'userId, originalFilename, and fileDataBase64 are required' };
      }
      // Verify the employee exists — fail fast instead of orphaning files.
      const employee = await db.get('SELECT id FROM users WHERE id = ?', [userId]);
      if (!employee) {
        return { success: false, message: 'Employee not found' };
      }

      // Extension + size guards
      const ext = path.extname(originalFilename).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        return { success: false, message: `File type ${ext || '(none)'} is not allowed` };
      }
      const buffer = Buffer.from(fileDataBase64, 'base64');
      if (buffer.length > MAX_FILE_SIZE) {
        return { success: false, message: `File exceeds the ${MAX_FILE_SIZE / 1024 / 1024} MB limit` };
      }

      // Write the file with a UUID name to avoid collisions + path-traversal
      const docId = uuidv4();
      const storedFilename = `${docId}${ext}`;
      const fullPath = path.join(employeeFolder(userId), storedFilename);
      fs.writeFileSync(fullPath, buffer);

      // Record metadata
      await db.run(
        `INSERT INTO employee_documents
          (id, user_id, document_type, original_filename, stored_filename,
           file_size, mime_type, description, is_confidential, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          docId, userId, documentType || 'Other', originalFilename, storedFilename,
          buffer.length, mimeType || null, description || null,
          isConfidential ? 1 : 0, uploadedBy
        ]
      );

      await writeAudit(db, uploadedBy, {
        action: 'DOCUMENT_UPLOAD',
        entityType: 'EMPLOYEE_DOCUMENT',
        entityId: docId,
        oldValue: null,
        newValue: {
          userId, documentType: documentType || 'Other',
          originalFilename, fileSize: buffer.length,
          isConfidential: !!isConfidential
        }
      });
      console.log(`[DOCUMENTS] ✓ Uploaded "${originalFilename}" for user ${userId} (${buffer.length} bytes)`);
      return {
        success: true,
        data: { id: docId, storedFilename, fileSize: buffer.length },
        message: 'Document uploaded successfully'
      };
    } catch (error) {
      console.error('[DOCUMENTS] Upload error:', error);
      return { success: false, message: error.message };
    }
  });

  // ----------------------------------------------------------------------
  // LIST documents for an employee. Honours role-based access.
  // ----------------------------------------------------------------------
  ipcMain.handle('document:list', async (_event, params) => {
    try {
      const { userId, callerId } = params || {};
      if (!userId) return { success: false, message: 'userId is required' };

      const caller = await getUserContext(db, callerId);
      if (!caller) return { success: false, message: 'Unauthorized' };

      // Quick gate: non-admin/lead employees can only list their own.
      if (!caller.isAdmin && !caller.isLeadRole && caller.id !== userId) {
        return { success: false, message: 'You can only view your own documents' };
      }
      // Leads can only list for their department
      if (caller.isLeadRole && !caller.isAdmin) {
        const owner = await db.get('SELECT department_id FROM users WHERE id = ?', [userId]);
        if (!owner || owner.department_id !== caller.departmentId) {
          return { success: false, message: 'You can only view documents for your department' };
        }
      }

      const rows = await db.all(
        `SELECT d.id, d.user_id, d.document_type, d.original_filename,
                d.stored_filename, d.file_size, d.mime_type, d.description,
                d.is_confidential, d.uploaded_by, d.uploaded_at,
                u.full_name as uploaded_by_name
         FROM employee_documents d
         LEFT JOIN users u ON d.uploaded_by = u.id
         WHERE d.user_id = ?
         ORDER BY d.uploaded_at DESC`,
        [userId]
      );

      // Strip out confidential rows for non-admin callers
      const visible = rows.filter(r => caller.isAdmin || r.is_confidential !== 1);

      // Frontend-friendly camelCase shape
      const data = visible.map(r => ({
        id: r.id,
        userId: r.user_id,
        documentType: r.document_type,
        originalFilename: r.original_filename,
        storedFilename: r.stored_filename,
        fileSize: r.file_size,
        mimeType: r.mime_type,
        description: r.description,
        isConfidential: r.is_confidential === 1,
        uploadedBy: r.uploaded_by,
        uploadedByName: r.uploaded_by_name,
        uploadedAt: r.uploaded_at
      }));

      return { success: true, data };
    } catch (error) {
      console.error('[DOCUMENTS] List error:', error);
      return { success: false, message: error.message };
    }
  });

  // ----------------------------------------------------------------------
  // DOWNLOAD a single document — returns base64-encoded contents so the
  // renderer can offer "open" / "save as" / preview.
  // ----------------------------------------------------------------------
  ipcMain.handle('document:download', async (_event, params) => {
    try {
      const { documentId, callerId } = params || {};
      if (!documentId) return { success: false, message: 'documentId is required' };

      const doc = await db.get(
        `SELECT * FROM employee_documents WHERE id = ?`, [documentId]
      );
      if (!doc) return { success: false, message: 'Document not found' };

      const ok = await canView(db, callerId, doc.user_id, doc.is_confidential === 1);
      if (!ok) return { success: false, message: 'You do not have permission to view this document' };

      const fullPath = path.join(employeeFolder(doc.user_id), doc.stored_filename);
      if (!fs.existsSync(fullPath)) {
        return { success: false, message: 'File missing from storage (was it moved or deleted?)' };
      }
      const buffer = fs.readFileSync(fullPath);

      return {
        success: true,
        data: {
          id: doc.id,
          originalFilename: doc.original_filename,
          mimeType: doc.mime_type,
          fileSize: doc.file_size,
          fileDataBase64: buffer.toString('base64')
        }
      };
    } catch (error) {
      console.error('[DOCUMENTS] Download error:', error);
      return { success: false, message: error.message };
    }
  });

  // ----------------------------------------------------------------------
  // DELETE — admin only. Removes both the DB row and the file on disk.
  // ----------------------------------------------------------------------
  ipcMain.handle('document:delete', async (_event, params) => {
    try {
      const { documentId, callerId } = params || {};
      if (!documentId) return { success: false, message: 'documentId is required' };

      if (!await canManage(db, callerId)) {
        return { success: false, message: 'Only admins can delete documents' };
      }

      const doc = await db.get(
        `SELECT user_id, stored_filename, original_filename
         FROM employee_documents WHERE id = ?`,
        [documentId]
      );
      if (!doc) return { success: false, message: 'Document not found' };

      const fullPath = path.join(employeeFolder(doc.user_id), doc.stored_filename);
      try {
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      } catch (e) {
        // Log but continue — we still want to remove the DB row even if the
        // file is already gone.
        console.warn('[DOCUMENTS] Could not delete file on disk:', e.message);
      }

      await db.run('DELETE FROM employee_documents WHERE id = ?', [documentId]);
      await writeAudit(db, callerId, {
        action: 'DOCUMENT_DELETE',
        entityType: 'EMPLOYEE_DOCUMENT',
        entityId: documentId,
        oldValue: { userId: doc.user_id, originalFilename: doc.original_filename },
        newValue: null
      });
      console.log(`[DOCUMENTS] ✓ Deleted document "${doc.original_filename}"`);
      return { success: true, message: 'Document deleted' };
    } catch (error) {
      console.error('[DOCUMENTS] Delete error:', error);
      return { success: false, message: error.message };
    }
  });
}

module.exports = { register };
