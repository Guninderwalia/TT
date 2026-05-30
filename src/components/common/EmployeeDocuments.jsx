import React, { useEffect, useRef, useState } from 'react';
import ConfirmModal from './ConfirmModal';

/**
 * EmployeeDocuments
 *
 * Document attachment panel for a single employee. Reused in three places:
 *
 *   - AdminPerformanceReview / EmployeeManager  →  canManage=true   (full CRUD)
 *   - Lead "Team Members" detail view           →  canManage=false  (view only)
 *   - Employee "My Profile" view                →  canManage=false  (view only, own files)
 *
 * Role gating is enforced on the backend too — these flags only hide UI.
 *
 * Props:
 *   userId      — the employee whose docs we're showing
 *   callerId    — the currently-signed-in user (needed for permission checks)
 *   canManage   — show Upload + Delete buttons (admin only)
 *   compact     — render in compact (card) form instead of full table (optional)
 */
function EmployeeDocuments({ userId, callerId, canManage = false, compact = false }) {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    documentType: 'Contract',
    description: '',
    isConfidential: false,
    file: null
  });
  const fileInputRef = useRef(null);
  // Replaces window.confirm — Electron returns null silently from confirm,
  // so the delete button on documents was doing nothing in the desktop app.
  const [confirmDialog, setConfirmDialog] = useState(null);

  // (Re)load whenever the target employee or caller changes.
  useEffect(() => {
    if (userId && callerId) loadDocuments();
  }, [userId, callerId]); // loadDocuments is stable enough for this lookup

  const loadDocuments = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await window.electron.listEmployeeDocuments(userId, callerId);
      if (result.success) {
        setDocuments(result.data || []);
      } else {
        setError(result.message || 'Could not load documents');
      }
    } catch (e) {
      console.error('[EmployeeDocuments] load error:', e);
      setError('Could not load documents: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  // Turn a File into base64. Browser-safe (no Buffer dependency in renderer).
  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result || '';
        // result is "data:<mime>;base64,<payload>" — strip the prefix
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const handleUpload = async (e) => {
    e.preventDefault();
    const { file, documentType, description, isConfidential } = uploadForm;
    if (!file) {
      setError('Please select a file');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const fileDataBase64 = await fileToBase64(file);
      const result = await window.electron.uploadEmployeeDocument({
        userId,
        documentType,
        originalFilename: file.name,
        fileDataBase64,
        mimeType: file.type || 'application/octet-stream',
        description,
        isConfidential,
        uploadedBy: callerId
      });
      if (result.success) {
        // Reset form + reload list
        setUploadForm({ documentType: 'Contract', description: '', isConfidential: false, file: null });
        if (fileInputRef.current) fileInputRef.current.value = '';
        setShowUploadForm(false);
        await loadDocuments();
      } else {
        setError(result.message || 'Upload failed');
      }
    } catch (e) {
      console.error('[EmployeeDocuments] upload error:', e);
      setError('Upload failed: ' + e.message);
    } finally {
      setUploading(false);
    }
  };

  // Open the document in a new tab (most browsers will render PDFs and images
  // inline; everything else will prompt the user to download).
  const handleView = async (doc) => {
    try {
      const result = await window.electron.downloadEmployeeDocument(doc.id, callerId);
      if (!result.success) {
        setError(result.message || 'Download failed');
        return;
      }
      const { fileDataBase64, mimeType, originalFilename } = result.data;
      const byteString = atob(fileDataBase64);
      const bytes = new Uint8Array(byteString.length);
      for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i);
      const blob = new Blob([bytes], { type: mimeType || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      // Open in a new tab; if blocked, fall back to forcing a download link
      const win = window.open(url, '_blank', 'noopener,noreferrer');
      if (!win) {
        const a = document.createElement('a');
        a.href = url;
        a.download = originalFilename;
        a.click();
      }
      // Revoke after a delay so the new tab actually loads the content
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      console.error('[EmployeeDocuments] view error:', e);
      setError('Could not open document: ' + e.message);
    }
  };

  const handleDelete = (doc) => {
    setConfirmDialog({
      title: 'Delete document?',
      message: `"${doc.originalFilename}" will be permanently removed. This cannot be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
      onConfirm: () => doDelete(doc)
    });
  };

  const doDelete = async (doc) => {
    try {
      const result = await window.electron.deleteEmployeeDocument(doc.id, callerId);
      if (result.success) {
        await loadDocuments();
      } else {
        setError(result.message || 'Delete failed');
      }
    } catch (e) {
      console.error('[EmployeeDocuments] delete error:', e);
      setError('Delete failed: ' + e.message);
    }
  };

  const formatSize = (bytes) => {
    if (!bytes) return '-';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  };

  const formatDate = (s) => {
    if (!s) return '-';
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  return (
    <div style={{ marginTop: compact ? '12px' : '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h3 style={{ margin: 0, fontSize: compact ? '15px' : '18px' }}>
          📎 Documents {documents.length > 0 && <span style={{ fontWeight: 'normal', color: 'var(--text-2, #94a3b8)', fontSize: '13px' }}>({documents.length})</span>}
        </h3>
        {canManage && !showUploadForm && (
          <button
            className="btn btn-primary"
            onClick={() => setShowUploadForm(true)}
            style={{ padding: '6px 14px', fontSize: '13px' }}
          >
            + Upload Document
          </button>
        )}
      </div>

      {error && (
        <div className="error-message" style={{ marginBottom: '12px' }}>
          <span>✗ {error}</span>
        </div>
      )}

      {/* Upload form */}
      {canManage && showUploadForm && (
        <form
          onSubmit={handleUpload}
          style={{
            background: 'rgba(59, 130, 246, 0.05)',
            border: '1px solid rgba(59, 130, 246, 0.2)',
            borderRadius: '8px',
            padding: '14px 16px',
            marginBottom: '16px'
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '10px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px', fontWeight: 600 }}>
                Document Type
              </label>
              <select
                value={uploadForm.documentType}
                onChange={(e) => setUploadForm({ ...uploadForm, documentType: e.target.value })}
                style={{ width: '100%', padding: '6px 8px' }}
                disabled={uploading}
              >
                <option>Contract</option>
                <option>ID Copy</option>
                <option>Offer Letter</option>
                <option>Passport</option>
                <option>Visa / Work Permit</option>
                <option>Resume / CV</option>
                <option>Education Certificate</option>
                <option>Experience Letter</option>
                <option>Bank Details</option>
                <option>Tax Document</option>
                <option>Other</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px', fontWeight: 600 }}>
                File <span style={{ color: 'var(--text-3, #6b7280)' }}>(PDF, DOC, image, max 25 MB)</span>
              </label>
              <input
                ref={fileInputRef}
                type="file"
                onChange={(e) => setUploadForm({ ...uploadForm, file: e.target.files[0] || null })}
                accept=".pdf,.doc,.docx,.txt,.rtf,.png,.jpg,.jpeg,.gif,.webp,.bmp,.xls,.xlsx,.csv"
                style={{ width: '100%', padding: '4px' }}
                disabled={uploading}
              />
            </div>
          </div>
          <div style={{ marginBottom: '10px' }}>
            <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px', fontWeight: 600 }}>
              Description (optional)
            </label>
            <input
              type="text"
              value={uploadForm.description}
              onChange={(e) => setUploadForm({ ...uploadForm, description: e.target.value })}
              placeholder="e.g. Signed contract - effective 1 Jan 2026"
              style={{ width: '100%', padding: '6px 8px' }}
              disabled={uploading}
            />
          </div>
          <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              id="confidential-checkbox"
              type="checkbox"
              checked={uploadForm.isConfidential}
              onChange={(e) => setUploadForm({ ...uploadForm, isConfidential: e.target.checked })}
              disabled={uploading}
            />
            <label htmlFor="confidential-checkbox" style={{ fontSize: '13px', cursor: 'pointer' }}>
              🔒 Confidential — only admins/MD can see this document
            </label>
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => { setShowUploadForm(false); setError(''); }}
              disabled={uploading}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={uploading || !uploadForm.file}>
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </form>
      )}

      {/* Document list */}
      {loading ? (
        <p style={{ color: 'var(--text-2, #94a3b8)' }}>Loading documents…</p>
      ) : documents.length === 0 ? (
        <p style={{ color: 'var(--text-2, #94a3b8)', fontStyle: 'italic' }}>
          No documents uploaded yet.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ fontSize: '13px' }}>
            <thead>
              <tr>
                <th>Type</th>
                <th>File Name</th>
                <th>Size</th>
                <th>Uploaded</th>
                <th>By</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {documents.map(doc => (
                <tr key={doc.id}>
                  <td>
                    {doc.documentType}
                    {doc.isConfidential && (
                      <span title="Confidential — admin only" style={{ marginLeft: '6px' }}>🔒</span>
                    )}
                  </td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{doc.originalFilename}</div>
                    {doc.description && (
                      <div style={{ fontSize: '11px', color: 'var(--text-3, #6b7280)', marginTop: '2px' }}>
                        {doc.description}
                      </div>
                    )}
                  </td>
                  <td>{formatSize(doc.fileSize)}</td>
                  <td>{formatDate(doc.uploadedAt)}</td>
                  <td>{doc.uploadedByName || '-'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="btn btn-sm"
                      onClick={() => handleView(doc)}
                      style={{ marginRight: '6px', padding: '4px 10px', fontSize: '12px' }}
                      title="Open in a new tab"
                    >
                      👁 View
                    </button>
                    {canManage && (
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleDelete(doc)}
                        style={{ padding: '4px 10px', fontSize: '12px' }}
                        title="Delete this document"
                      >
                        🗑
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirmDialog && (
        <ConfirmModal
          isOpen={true}
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          tone={confirmDialog.tone}
          onConfirm={confirmDialog.onConfirm}
          onClose={() => setConfirmDialog(null)}
        />
      )}
    </div>
  );
}

export default EmployeeDocuments;
