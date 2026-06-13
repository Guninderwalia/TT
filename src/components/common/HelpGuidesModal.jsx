import React from 'react';

/**
 * Help & Training Guides modal
 *
 * Lists the role-specific training guide plus the Performance Review Scoring
 * Guide that everyone needs. Works in BOTH Electron and web mode:
 *
 *   - Web mode: opens the guide HTML directly in a new tab via window.open()
 *     (the React build serves /training-guides/* as static files).
 *
 *   - Electron mode: also opens in a new tab — the same path resolves because
 *     the web server inside Electron serves the public folder too. (If you'd
 *     rather use the native menu, that still works as before.)
 */
function HelpGuidesModal({ isOpen, onClose, roleClass }) {
  if (!isOpen) return null;

  // Map role to its dedicated guide. Defaults to the employee guide.
  const roleGuide = roleClass === 'admin'
    ? { file: 'Admin_Training_Guide.html', label: '🛡️ Administrator Training Guide',
        description: 'Full system administration, employee management, payroll, audits, and settings.' }
    : roleClass === 'lead'
    ? { file: 'Lead_Training_Guide.html', label: '🧭 Department Lead Training Guide',
        description: 'How to manage your team — attendance, leave approvals, performance reviews.' }
    : { file: 'Employee_Training_Guide.html', label: '🧑‍💼 Employee Training Guide',
        description: 'Daily tasks — sign-in, time logging, leave requests, your performance.' };

  // Always include the performance review scoring guide
  const scoringGuide = {
    file: 'Performance_Review_Scoring_Guide.html',
    label: '📊 Performance Review Scoring Guide',
    description: 'How attendance, punctuality, skills, and ratings combine into your score.'
  };

  const openGuide = (filename) => {
    // Build a path relative to the current host so it works in BOTH modes:
    //   - Electron: window.location is http://localhost:3002 (the embedded server)
    //   - Web: window.location is the LAN host the user browsed to
    // The React build copies /public/training-guides/* into /build/training-guides/*,
    // which is served as a static asset.
    const url = `/training-guides/${filename}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
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
          padding: '24px 28px',
          borderRadius: '12px',
          width: 'min(520px, 92vw)',
          boxShadow: '0 18px 50px rgba(0,0,0,0.45)',
          border: '1px solid rgba(255,255,255,0.08)'
        }}
      >
        <h2 style={{ margin: '0 0 8px 0', fontSize: '20px' }}>📖 Training Guides</h2>
        <p style={{ margin: '0 0 18px 0', color: 'var(--text-2, #cbd5e1)', fontSize: '13px' }}>
          Click a guide to open it in a new tab. Bookmark it for quick reference.
        </p>

        {/* Role-specific guide */}
        <GuideCard
          onClick={() => openGuide(roleGuide.file)}
          label={roleGuide.label}
          description={roleGuide.description}
        />

        {/* Performance review scoring guide (everyone needs it) */}
        <GuideCard
          onClick={() => openGuide(scoringGuide.file)}
          label={scoringGuide.label}
          description={scoringGuide.description}
        />

        {/* v4.6 — Always-visible About panel so web users can confirm
            version and developer without hunting for the corner badge. */}
        <div style={{
          marginTop: 18, padding: '14px 16px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 8
        }}>
          <div style={{
            fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.2,
            color: 'var(--text-2, #94a3b8)', fontWeight: 700, marginBottom: 6
          }}>
            About Task Tango Pulse
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--text, #f3f4f6)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
              <span style={{ color: 'var(--text-2, #94a3b8)' }}>Version</span>
              <strong>Production v5.6</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
              <span style={{ color: 'var(--text-2, #94a3b8)' }}>Developed by</span>
              <strong>Guninder Ahluwalia</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
              <span style={{ color: 'var(--text-2, #94a3b8)' }}>Build year</span>
              <strong>{new Date().getFullYear()}</strong>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function GuideCard({ onClick, label, description }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '8px',
        padding: '14px 16px',
        marginBottom: '10px',
        cursor: 'pointer',
        transition: 'background 0.15s, border-color 0.15s'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(59, 130, 246, 0.08)';
        e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.4)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
      }}
    >
      <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>
        {label}
      </div>
      <div style={{ fontSize: '12px', color: 'var(--text-2, #94a3b8)' }}>
        {description}
      </div>
    </div>
  );
}

export default HelpGuidesModal;
