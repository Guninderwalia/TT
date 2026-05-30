import React, { useEffect } from 'react';

/**
 * Yes / No confirmation modal.
 *
 * Replaces `window.confirm`, which Electron disables by default (returns
 * `null` with no dialog → destructive buttons silently fail). React modal
 * instead — works identically in Electron and the web shim.
 *
 * Two ways to use it:
 *
 *   A) Controlled — render directly with isOpen
 *      <ConfirmModal isOpen={show} onConfirm={...} onClose={() => setShow(false)} />
 *
 *   B) Object pattern — same shape we use for ReasonPrompt
 *      const [confirm, setConfirm] = useState(null);
 *      setConfirm({ title: 'Delete employee?', onConfirm: () => doDelete() });
 *      {confirm && <ConfirmModal {...confirm} onClose={() => setConfirm(null)} />}
 *
 * Variants:
 *   - tone='danger'  → red Confirm button (destructive actions)
 *   - tone='primary' → blue Confirm button (default, non-destructive)
 */
function ConfirmModal({
  isOpen = true,
  title = 'Are you sure?',
  message = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  onConfirm,
  onClose
}) {
  // Esc closes the modal — matches every other modal in the app.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose && onClose();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleConfirm();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (typeof onConfirm === 'function') onConfirm();
    if (typeof onClose === 'function') onClose();
  };

  // Colour swap for the Confirm button depending on what it does
  const confirmBg = tone === 'danger' ? '#dc2626' : '#3b82f6';
  const confirmHover = tone === 'danger' ? '#b91c1c' : '#2563eb';

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        // Click on the dim backdrop closes (matches every other modal)
        if (e.target === e.currentTarget) onClose && onClose();
      }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 10000
      }}
    >
      <div
        style={{
          background: 'var(--bg-2, #1f2937)',
          color: 'var(--text, #f3f4f6)',
          padding: '22px 26px',
          borderRadius: '10px',
          width: 'min(440px, 92vw)',
          boxShadow: '0 18px 50px rgba(0,0,0,0.45)',
          border: '1px solid rgba(255,255,255,0.08)'
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <h3 id="confirm-title" style={{ margin: '0 0 10px 0', fontSize: '18px' }}>{title}</h3>
        {message && (
          <p style={{ margin: '0 0 18px 0', color: 'var(--text-2, #cbd5e1)', fontSize: '13.5px', lineHeight: 1.55 }}>
            {message}
          </p>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '4px' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            autoFocus
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            style={{
              padding: '8px 18px',
              background: confirmBg,
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = confirmHover}
            onMouseLeave={(e) => e.currentTarget.style.background = confirmBg}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmModal;
