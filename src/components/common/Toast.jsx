import React, { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Lightweight toast notification system.
 *
 * Usage:
 *   1. Mount <ToastContainer /> once at the App root.
 *   2. Call window.toast.success('Saved!') / .error(...) / .info(...) anywhere.
 *
 * Behaviour:
 *   - Slides in from the top-right, auto-dismisses after 3s by default.
 *   - Click the × to dismiss immediately.
 *   - Replaces window.alert() for routine success/error messages.
 */

let _push = null;

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const toast = {
  show(message, type = 'info', durationMs = 3000) {
    if (_push) _push({ id: genId(), message, type, durationMs });
    else console.warn('[Toast] No ToastContainer mounted; message lost:', message);
  },
  success(msg, ms = 3000) { this.show(msg, 'success', ms); },
  error(msg, ms = 5000)   { this.show(msg, 'error',   ms); },
  warning(msg, ms = 4000) { this.show(msg, 'warning', ms); },
  info(msg, ms = 3000)    { this.show(msg, 'info',    ms); }
};

// Mirror onto window so non-React modules (e.g. legacy callbacks) can use it.
if (typeof window !== 'undefined') {
  window.toast = toast;
}

export function ToastContainer() {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef({});

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id]);
      delete timersRef.current[id];
    }
  }, []);

  useEffect(() => {
    _push = (t) => {
      setToasts(prev => [...prev, t]);
      if (t.durationMs > 0) {
        timersRef.current[t.id] = setTimeout(() => dismiss(t.id), t.durationMs);
      }
    };
    return () => { _push = null; };
  }, [dismiss]);

  const styles = {
    container: {
      position: 'fixed',
      top: '20px',
      right: '20px',
      zIndex: 999999,
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      pointerEvents: 'none'
    },
    toast: (type) => ({
      pointerEvents: 'auto',
      minWidth: '280px',
      maxWidth: '420px',
      padding: '12px 16px',
      borderRadius: '8px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
      display: 'flex',
      alignItems: 'flex-start',
      gap: '10px',
      animation: 'tt-toast-slide-in 0.22s ease-out',
      background:
        type === 'success' ? '#10b981' :
        type === 'error'   ? '#dc2626' :
        type === 'warning' ? '#f59e0b' :
                             '#1e40af',
      color: '#ffffff',
      fontSize: '13.5px',
      fontWeight: 500,
      lineHeight: 1.4
    }),
    icon: { fontSize: '18px', flexShrink: 0 },
    body: { flex: 1, wordBreak: 'break-word' },
    close: {
      background: 'transparent',
      border: 0,
      color: 'rgba(255,255,255,0.85)',
      cursor: 'pointer',
      fontSize: '18px',
      padding: 0,
      lineHeight: 1,
      flexShrink: 0
    }
  };

  const icon = (type) => (
    type === 'success' ? '✓' :
    type === 'error'   ? '✕' :
    type === 'warning' ? '⚠' :
                         'ℹ'
  );

  return (
    <>
      <style>{`
        @keyframes tt-toast-slide-in {
          from { transform: translateX(20px); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
      <div style={styles.container} aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} style={styles.toast(t.type)} role="alert">
            <span style={styles.icon}>{icon(t.type)}</span>
            <span style={styles.body}>{t.message}</span>
            <button
              style={styles.close}
              onClick={() => dismiss(t.id)}
              title="Dismiss"
              aria-label="Dismiss"
            >×</button>
          </div>
        ))}
      </div>
    </>
  );
}

export default ToastContainer;
