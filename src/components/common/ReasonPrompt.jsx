import React, { useEffect, useRef, useState } from 'react';

/**
 * Tiny modal that asks the user for a reason (or any short text) before an
 * action like rejecting a leave request. Replaces `window.prompt`, which is
 * disabled in Electron by default (returns null silently → "Reject button
 * does nothing") and is inconsistent across browsers in web mode.
 *
 * Usage pattern (controlled):
 *   const [prompt, setPrompt] = useState(null);
 *   ...
 *   onClick={() => setPrompt({
 *     title: 'Reject leave?',
 *     placeholder: 'Optional reason',
 *     onSubmit: (reason) => doReject(req.id, reason),
 *   })}
 *
 *   {prompt && <ReasonPrompt {...prompt} onClose={() => setPrompt(null)} />}
 */
function ReasonPrompt({
  title = 'Enter a reason',
  message = '',
  placeholder = 'Reason (optional)',
  submitLabel = 'Submit',
  cancelLabel = 'Cancel',
  required = false,
  defaultValue = '',
  onSubmit,
  onClose
}) {
  const [value, setValue] = useState(defaultValue);
  const taRef = useRef(null);

  // Auto-focus the textarea so the user can start typing immediately.
  useEffect(() => {
    if (taRef.current) {
      taRef.current.focus();
      // Place caret at the end of any preset text
      try { taRef.current.setSelectionRange(value.length, value.length); } catch (_) {}
    }
  }, []);

  // Esc closes the modal — matches the global keyboard shortcut convention.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose && onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    const trimmed = (value || '').trim();
    if (required && !trimmed) {
      if (taRef.current) taRef.current.focus();
      return;
    }
    if (typeof onSubmit === 'function') onSubmit(trimmed);
    if (typeof onClose === 'function') onClose();
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        // Click on the dim backdrop closes the modal (matches every other
        // modal in the app). Clicks on the panel itself do not bubble here.
        if (e.target === e.currentTarget) {
          onClose && onClose();
        }
      }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 10000
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: 'var(--bg-2, #1f2937)',
          color: 'var(--text, #f3f4f6)',
          padding: '20px 22px',
          borderRadius: '10px',
          width: 'min(440px, 92vw)',
          boxShadow: '0 18px 50px rgba(0,0,0,0.45)',
          border: '1px solid rgba(255,255,255,0.08)'
        }}
      >
        <h3 style={{ margin: '0 0 6px 0', fontSize: '18px' }}>{title}</h3>
        {message && (
          <p style={{ margin: '0 0 12px 0', color: 'var(--text-2, #cbd5e1)', fontSize: '13px' }}>
            {message}
          </p>
        )}
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          rows={4}
          style={{
            width: '100%',
            resize: 'vertical',
            padding: '10px 12px',
            borderRadius: '6px',
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'rgba(0,0,0,0.25)',
            color: 'inherit',
            fontFamily: 'inherit',
            fontSize: '14px',
            boxSizing: 'border-box'
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
          >
            {cancelLabel}
          </button>
          <button
            type="submit"
            className="btn btn-primary"
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

export default ReasonPrompt;
