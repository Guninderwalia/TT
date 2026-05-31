import React, { useState, useEffect } from 'react';
// Use HashRouter instead of BrowserRouter so routing works under file:// URLs
// (Electron production builds load from file://, where BrowserRouter's path
// doesn't match "/" and the app renders a blank screen).
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import AdminDashboard from './pages/AdminDashboard';
import LeadDashboard from './pages/LeadDashboard';
import EmployeeDashboard from './pages/EmployeeDashboard';
import { ToastContainer } from './components/common/Toast';
import { applyTheme, getTheme } from './components/common/ThemeToggle';
import { setOfficeTimezone, syncOfficeTimeFromInternet } from './utils/officeTime';
import './styles/app.css';

// Apply the saved theme BEFORE React renders anything. This is at module
// scope so it runs once when the JS bundle loads, preventing a flash of
// dark theme on a light-mode user's reload.
applyTheme(getTheme());

// Bump this single constant when packaging a new build. The label is rendered
// in the bottom-right corner on every screen (incl. login) so it's easy to
// confirm which version is running. Click the badge to open the About modal.
const BUILD_VERSION = 'Production v4.5';
const APP_DEVELOPER = 'Guninder Ahluwalia';
const APP_YEAR      = new Date().getFullYear();

// Intercept window.alert so the dozens of existing alert(...) calls render
// as non-blocking toasts. Routed by content heuristics so the colour matches
// the intent (errors → red, success → green, etc.).
if (typeof window !== 'undefined' && !window.__alertPatched) {
  const _origAlert = window.alert.bind(window);
  window.alert = (msg) => {
    try {
      const s = String(msg || '');
      const lower = s.toLowerCase();
      const isError =
        lower.startsWith('error') ||
        lower.startsWith('could not') ||
        lower.startsWith('failed') ||
        lower.startsWith('cannot') ||
        lower.includes('could not ') ||
        lower.includes('failed to ');
      const isSuccess =
        lower.includes('success') ||
        lower.includes('saved') ||
        lower.includes('approved') ||
        lower.includes('updated') ||
        lower.includes('created');
      if (window.toast) {
        if (isError) return window.toast.error(s);
        if (isSuccess) return window.toast.success(s);
        return window.toast.info(s);
      }
    } catch (_) { /* fall through */ }
    _origAlert(msg);
  };
  window.__alertPatched = true;
}

function BuildBadge({ onClick }) {
  return (
    <button
      onClick={onClick}
      title={`TaskTango ${BUILD_VERSION} — click for About`}
      style={{
        position: 'fixed',
        right: '10px',
        bottom: '8px',
        padding: '3px 9px',
        borderRadius: '10px',
        background: 'rgba(0, 0, 0, 0.55)',
        color: '#d1d5db',
        fontSize: '11px',
        fontWeight: 600,
        letterSpacing: '0.4px',
        fontFamily: 'Consolas, "Courier New", monospace',
        border: '1px solid rgba(255,255,255,0.12)',
        cursor: 'pointer',
        zIndex: 9999,
        userSelect: 'none'
      }}
    >
      Build {BUILD_VERSION}
    </button>
  );
}

// About modal — opened by clicking the build badge or from the desktop Help
// menu. Same content runs in the web build (where there is no native menu)
// so users can see who built it and which version they're on.
//
// Also lists every training guide so web users (who don't get the native Help
// menu) can open them with one click. Guides ship under /training-guides/*.html
// (CRA copies public/training-guides into build/ automatically).
function AboutModal({ onClose, roleClass }) {
  // Open a static guide. Desktop uses shell.openExternal via the preload
  // bridge; web just opens in a new tab.
  const openGuide = (filename) => {
    const url = `${window.location.origin || ''}/training-guides/${filename}`;
    try {
      if (window.electron && typeof window.electron.openExternal === 'function') {
        window.electron.openExternal(url);
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (_) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  // Show every guide, but float the role-specific one to the top so the
  // primary CTA matches who's reading.
  const allGuides = [
    { role: 'admin', label: '🛡️ Administrator Training Guide', file: 'Admin_Training_Guide.html' },
    { role: 'lead',  label: '🧭 Department Lead Training Guide', file: 'Lead_Training_Guide.html' },
    { role: 'user',  label: '🧑‍💼 Employee Training Guide', file: 'Employee_Training_Guide.html' },
    { role: null,    label: '📊 Performance Review Scoring Guide', file: 'Performance_Review_Scoring_Guide.html' },
  ];
  const ordered = [
    ...allGuides.filter(g => g.role === roleClass),
    ...allGuides.filter(g => g.role !== roleClass)
  ];

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-2, #1a3a52)', color: 'var(--text, #fff)',
          minWidth: 380, maxWidth: '92vw', width: 460, padding: '24px 28px',
          borderRadius: 12, boxShadow: '0 16px 40px rgba(0,0,0,0.45)',
          border: '1px solid rgba(255,255,255,0.08)',
          textAlign: 'center', maxHeight: '90vh', overflowY: 'auto'
        }}
      >
        <h2 style={{ marginTop: 0, marginBottom: 6, fontSize: 22 }}>TaskTango</h2>
        <div style={{
          fontFamily: 'Consolas, "Courier New", monospace',
          fontSize: 13, color: 'var(--text-2, #9ca3af)', marginBottom: 18
        }}>
          {BUILD_VERSION}
        </div>

        <div style={{ textAlign: 'left', fontSize: 13, lineHeight: 1.7 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '6px 0' }}>
            <span style={{ color: 'var(--text-2, #9ca3af)' }}>Developed by</span>
            <strong>{APP_DEVELOPER}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '6px 0' }}>
            <span style={{ color: 'var(--text-2, #9ca3af)' }}>Build year</span>
            <strong>{APP_YEAR}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
            <span style={{ color: 'var(--text-2, #9ca3af)' }}>Platform</span>
            <strong>{typeof window !== 'undefined' && window.electron && !window.__isWebShim ? 'Desktop (Electron)' : 'Web'}</strong>
          </div>
        </div>

        {/* Training guides — always shown so web users have a way in */}
        <div style={{ marginTop: 22, textAlign: 'left' }}>
          <div style={{
            fontSize: 11, textTransform: 'uppercase', letterSpacing: '1.2px',
            color: 'var(--text-2, #9ca3af)', fontWeight: 700, marginBottom: 8
          }}>
            📚 Training guides
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ordered.map(g => (
              <button
                key={g.file}
                onClick={() => openGuide(g.file)}
                style={{
                  textAlign: 'left',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: 'var(--text, #fff)',
                  borderRadius: 8,
                  padding: '8px 12px',
                  fontSize: 13,
                  cursor: 'pointer'
                }}
              >
                {g.label}
              </button>
            ))}
          </div>
          <p style={{
            fontSize: 10.5, color: 'var(--text-2, #9ca3af)',
            margin: '10px 0 0', fontStyle: 'italic'
          }}>
            All four guides written by Guninder Ahluwalia.
          </p>
        </div>

        <p style={{ fontSize: 11, color: 'var(--text-2, #9ca3af)', marginTop: 18, marginBottom: 0 }}>
          Enterprise HR &amp; Employee Management
        </p>

        <button
          onClick={onClose}
          className="btn btn-primary"
          style={{ marginTop: 18, padding: '8px 22px' }}
          autoFocus
        >
          Close
        </button>
      </div>
    </div>
  );
}

// Light / dark theme toggle. Stored in localStorage so it survives reloads.
function useTheme() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('tt-theme') || 'dark'; } catch (_) { return 'dark'; }
  });
  useEffect(() => {
    try { localStorage.setItem('tt-theme', theme); } catch (_) {}
    document.body.setAttribute('data-tt-theme', theme);
  }, [theme]);
  return [theme, setTheme];
}

function ThemeToggle({ theme, setTheme }) {
  return (
    <button
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      style={{
        position: 'fixed',
        right: '12px',
        bottom: '34px',
        zIndex: 9998,
        width: 32,
        height: 32,
        borderRadius: '50%',
        border: '1px solid rgba(255,255,255,0.2)',
        background: 'rgba(0,0,0,0.5)',
        color: '#ffffff',
        cursor: 'pointer',
        fontSize: '15px',
        lineHeight: 1
      }}
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  );
}

// Auto-logout after a period of inactivity. Listens for any user input;
// the timer resets on each event. Fires onTimeout when nothing happens for
// `idleMs` milliseconds.
function useIdleLogout({ idleMs, enabled, onTimeout }) {
  useEffect(() => {
    if (!enabled) return;
    let timer = null;
    const reset = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(onTimeout, idleMs);
    };
    const events = ['mousedown', 'keydown', 'touchstart', 'mousemove', 'scroll'];
    events.forEach(ev => window.addEventListener(ev, reset, { passive: true }));
    reset();
    return () => {
      if (timer) clearTimeout(timer);
      events.forEach(ev => window.removeEventListener(ev, reset));
    };
  }, [idleMs, enabled, onTimeout]);
}

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useTheme();
  const [showAbout, setShowAbout] = useState(false);

  // v4.3: pull the admin-configured office timezone once on mount and sync
  // internet time so every renderer-side time stamp uses the right zone +
  // trusted clock. Fire-and-forget — defaults (Asia/Kolkata + local clock)
  // are fine if either fails.
  useEffect(() => {
    (async () => {
      try {
        const r = await window.electron?.getSetting?.('office_timezone');
        const tz = r?.value || r?.data?.value || r;
        if (typeof tz === 'string' && tz) setOfficeTimezone(tz);
      } catch (_) { /* default zone is fine */ }
      try { await syncOfficeTimeFromInternet(); } catch (_) {}
    })();
    // Hourly re-sync so a long-lived session doesn't drift.
    const t = setInterval(() => { syncOfficeTimeFromInternet().catch(() => {}); }, 60 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  // Auto-logout after 30 min of inactivity once logged in.
  useIdleLogout({
    idleMs: 30 * 60 * 1000,
    enabled: !!user,
    onTimeout: () => {
      if (window.toast) window.toast.warning('Signed out after 30 minutes of inactivity.');
      if (window.electron?.logout) window.electron.logout().catch(() => {});
      setUser(null);
    }
  });

  // Global keyboard shortcuts:
  //   Esc      → close the topmost modal-overlay
  //   Ctrl+S   → save (submit the currently-focused form, or the visible modal's primary button)
  //   Ctrl+/   → show shortcut help
  const [showShortcuts, setShowShortcuts] = useState(false);
  useEffect(() => {
    const findForm = () => {
      const overlay = document.querySelector('.modal-overlay');
      const inOverlay = overlay && overlay.querySelector('form');
      if (inOverlay) return inOverlay;
      // Otherwise, the form that contains the currently focused element
      const active = document.activeElement;
      if (active && active.closest) {
        const f = active.closest('form');
        if (f) return f;
      }
      // Last fallback: the first visible form on the page
      return document.querySelector('form');
    };

    const onKey = (e) => {
      // Esc: close the modal
      if (e.key === 'Escape') {
        const overlay = document.querySelector('.modal-overlay');
        if (overlay) {
          const cancelBtn = overlay.querySelector('button.btn-secondary');
          if (cancelBtn) cancelBtn.click();
          else overlay.click();
          return;
        }
        if (showShortcuts) setShowShortcuts(false);
        return;
      }

      const ctrlOrCmd = e.ctrlKey || e.metaKey;

      // Ctrl+S → submit the visible form
      if (ctrlOrCmd && e.key.toLowerCase() === 's') {
        const form = findForm();
        if (form) {
          e.preventDefault();
          // Prefer requestSubmit so HTML validation fires; fall back to a click
          if (typeof form.requestSubmit === 'function') {
            form.requestSubmit();
          } else {
            const submitBtn = form.querySelector('button[type="submit"], button.btn-primary');
            if (submitBtn) submitBtn.click();
          }
          if (window.toast) window.toast.info('Saving…', 1000);
        }
        return;
      }

      // Ctrl+/ → show shortcuts cheatsheet
      if (ctrlOrCmd && (e.key === '/' || e.key === '?')) {
        e.preventDefault();
        setShowShortcuts(s => !s);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showShortcuts]);

  useEffect(() => {
    const initializeApp = async () => {
      try {
        console.log('[APP] Initializing app...');

        // Use window.ipcRenderer if available (from preload)
        if (window.ipcRenderer) {
          console.log('[APP] Using window.ipcRenderer from preload');
          // Wrap in a 5-second timeout so a stuck IPC call doesn't lock the UI on a blank screen.
          const currentUser = await Promise.race([
            window.ipcRenderer.invoke('auth:getCurrentUser'),
            new Promise((resolve) => setTimeout(() => {
              console.warn('[APP] getCurrentUser timed out after 5s, continuing without user');
              resolve(null);
            }, 5000))
          ]);
          console.log('[APP] currentUser resolved:', currentUser);
          setUser(currentUser);
        } else if (window.electron) {
          console.log('[APP] Using window.electron from preload');
          const currentUser = await window.electron.getCurrentUser();
          console.log('[APP] currentUser resolved:', currentUser);
          setUser(currentUser);
        } else {
          console.error('[APP] No electron API available - window.ipcRenderer and window.electron are both undefined');
        }
      } catch (error) {
        console.error('[APP] Failed to get current user:', error);
      } finally {
        console.log('[APP] Finished initialization, setting loading=false');
        setLoading(false);
      }
    };

    initializeApp();
  }, []);

  // Classifies the user into one of: 'admin' | 'lead' | 'user'.
  // The original role_name (e.g. 'MD', 'Manager') is preserved on the user
  // object so dashboards can render role-specific titles
  // (e.g. "Managing Director Dashboard" for MD).
  //
  // Note: A user can be marked as a department lead (is_department_lead = 1)
  // even if their underlying role_name is "User". In that case we still want
  // to route them to the Lead Dashboard so they can approve their team's leave.
  function classifyRole(u) {
    const r = (u?.role_name || u?.role || '').toLowerCase();
    if (r === 'administrator' || r === 'admin' || r === 'md' || r === 'manager') return 'admin';
    if (r === 'lead') return 'lead';
    if (u?.is_department_lead === 1 || u?.is_department_lead === true || u?.isLead === true) return 'lead';
    return 'user';
  }

  const roleClass = user ? classifyRole(user) : null;

  // Tell the main process which role is active so the application menu shows
  // the right Help → Training Guide. Re-fires on logout (roleClass=null) so
  // the role-specific guide disappears from the Help menu.
  //
  // IMPORTANT: This useEffect MUST stay above any conditional return below
  // (the `if (loading)` short-circuit). Hooks must be called in the same
  // order on every render — putting a hook after an early return causes
  // React error #310 ("Rendered more hooks than during the previous render")
  // the moment `loading` flips from true → false.
  useEffect(() => {
    if (window.electron && typeof window.electron.notifyUserRole === 'function') {
      try { window.electron.notifyUserRole(roleClass); } catch (_) {}
    }
  }, [roleClass]);

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loader"></div>
        <p>TaskTango Loading...</p>
      </div>
    );
  }

  console.log('[APP] Render — user:', user?.email, '| role_name:', user?.role_name, '| roleClass:', roleClass);

  return (
    <>
      <Router>
        <Routes>
          {!user ? (
            <>
              <Route path="/" element={<LoginPage onLogin={setUser} />} />
              <Route path="*" element={<Navigate to="/" />} />
            </>
          ) : (
            <>
              {roleClass === 'admin' && (
                <Route path="/*" element={<AdminDashboard user={user} onLogout={() => setUser(null)} />} />
              )}
              {roleClass === 'lead' && (
                <Route path="/*" element={<LeadDashboard user={user} onLogout={() => setUser(null)} />} />
              )}
              {roleClass === 'user' && (
                <Route path="/*" element={<EmployeeDashboard user={user} onLogout={() => setUser(null)} />} />
              )}
            </>
          )}
        </Routes>
      </Router>
      <ToastContainer />
      <ThemeToggle theme={theme} setTheme={setTheme} />
      {showShortcuts && (
        <ShortcutsHelp onClose={() => setShowShortcuts(false)} />
      )}
      <BuildBadge onClick={() => setShowAbout(true)} />
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} roleClass={roleClass} />}
    </>
  );
}

// Cheatsheet shown when the user hits Ctrl+/. Lists the keyboard shortcuts
// that the app honours globally.
function ShortcutsHelp({ onClose }) {
  const items = [
    { keys: 'Esc',     label: 'Close the open modal' },
    { keys: 'Ctrl + S', label: 'Save / submit the current form' },
    { keys: 'Ctrl + /', label: 'Show / hide this shortcuts list' }
  ];
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-2, #1a3a52)', color: 'var(--text, #fff)',
          minWidth: 320, maxWidth: '90vw', padding: '20px 24px',
          borderRadius: 12, boxShadow: '0 16px 40px rgba(0,0,0,0.45)',
          border: '1px solid rgba(255,255,255,0.08)'
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: 12 }}>⌨️ Keyboard Shortcuts</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {items.map(it => (
              <tr key={it.keys}>
                <td style={{ padding: '6px 0' }}>
                  <kbd style={{
                    background: 'rgba(255,255,255,0.08)', padding: '3px 8px',
                    borderRadius: 4, border: '1px solid rgba(255,255,255,0.18)',
                    fontFamily: 'Consolas, monospace', fontSize: 12
                  }}>{it.keys}</kbd>
                </td>
                <td style={{ padding: '6px 0 6px 16px' }}>{it.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: 11, color: 'var(--text-2, #ccc)', marginTop: 14, marginBottom: 0 }}>
          Press Esc or click outside to dismiss.
        </p>
      </div>
    </div>
  );
}

export default App;
