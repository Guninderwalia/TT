import React, { useEffect, useState } from 'react';

/**
 * Theme toggle — flips the app between dark (default) and light mode.
 *
 * Implementation:
 *   - The light theme is defined in src/styles/app.css under
 *     `body[data-tt-theme="light"]` and overrides the CSS variables that
 *     differ from dark (bg / text / border tones).
 *   - The active theme is stored in localStorage under TT_THEME.
 *   - applyTheme() is also called from App.jsx as early as possible so the
 *     first paint matches the user's preference (no flash of dark on a
 *     light user's reload).
 *
 * The dark colour scheme stays the default; this component just toggles
 * the data attribute on <body>.
 */

const STORAGE_KEY = 'TT_THEME';

export function getTheme() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' ? 'light' : 'dark';
  } catch (_) {
    return 'dark';
  }
}

export function applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  try { document.body.setAttribute('data-tt-theme', t); } catch (_) {}
  try { localStorage.setItem(STORAGE_KEY, t); } catch (_) {}
}

function ThemeToggle({ compact = false }) {
  const [theme, setTheme] = useState(getTheme());

  // Keep the body attribute in sync if the value changes here.
  useEffect(() => { applyTheme(theme); }, [theme]);

  const toggle = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Compact = single icon button (sidebar). Full = label + icon.
  const isDark = theme === 'dark';
  const title = isDark ? 'Switch to light theme' : 'Switch to dark theme';

  if (compact) {
    return (
      <button
        type="button"
        onClick={toggle}
        title={title}
        aria-label={title}
        style={{
          background: 'transparent',
          border: '1px solid var(--border, rgba(255,255,255,0.12))',
          color: 'var(--text, #fff)',
          width: 32,
          height: 32,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
          cursor: 'pointer',
          transition: 'background 0.15s'
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        {isDark ? '☀️' : '🌙'}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={title}
      aria-label={title}
      className="logout-btn"
      style={{ fontSize: '12px' }}
    >
      {isDark ? '☀️ Light' : '🌙 Dark'}
    </button>
  );
}

export default ThemeToggle;
