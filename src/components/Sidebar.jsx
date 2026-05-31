import React, { useState } from 'react';
import '../styles/sidebar.css';
import logoImage from '../assets/logo.png';
import ChangePasswordModal from './common/ChangePasswordModal';
import HelpGuidesModal from './common/HelpGuidesModal';
import ThemeToggle from './common/ThemeToggle';
import SessionManagementPanel from './common/SessionManagementPanel';

function Sidebar({ user, navItems, activeNav, onNavChange, onLogout }) {
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showSessionsModal, setShowSessionsModal] = useState(false);

  if (!user) {
    return null;
  }

  // Derive role class for the help modal so we can show the right guide
  const roleName = (user.role_name || user.roleName || user.role || 'Employee').toLowerCase();
  const roleClass = ['admin', 'administrator', 'md'].includes(roleName) ? 'admin'
    : ['lead', 'manager'].includes(roleName) ? 'lead'
    : 'user';

  return (
    <div className="sidebar">
      <div className="logo-area">
        <div className="logo-row">
          <img src={logoImage} alt="Task Tango" className="logo-image" />
          <div className="logo-text">
            <div className="logo-name">Task Tango</div>
            <div className="logo-tag">Financial Services</div>
          </div>
        </div>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-group">
          <div className="nav-group-label">Main</div>
          {navItems && navItems.map((item) => (
            <button
              key={item.id}
              className={`nav-btn ${activeNav === item.id ? 'active' : ''}`}
              onClick={() => onNavChange(item.id)}
              title={item.label}
            >
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </nav>

      <div className="sidebar-footer">
        <div className="user-profile">
          <div className="user-avatar" style={{ overflow: 'hidden', padding: 0 }}>
            {user.profile_picture_path || user.profilePicturePath ? (
              <img
                src={user.profile_picture_path || user.profilePicturePath}
                alt={user.fullName || 'User'}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              user.fullName ? user.fullName.charAt(0) : '?'
            )}
          </div>
          <div className="user-info">
            <div className="user-name">{user.fullName || 'User'}</div>
            <div className="user-role">{user.role_name || user.roleeName || 'Employee'}</div>
          </div>
          {/* Theme toggle — fixed-size circle to the right of the user block. */}
          <ThemeToggle compact />
        </div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
          <button
            className="logout-btn"
            onClick={() => setShowHelpModal(true)}
            title="Training Guides & Help"
            style={{ flex: 1, fontSize: '12px' }}
          >
            📖 Help
          </button>
          <button
            className="logout-btn"
            onClick={() => setShowPasswordModal(true)}
            title="Change Password"
            style={{ flex: 1, fontSize: '12px' }}
          >
            🔐 Password
          </button>
          <button
            className="logout-btn"
            onClick={() => setShowSessionsModal(true)}
            title="Active Sessions"
            style={{ flex: 1, fontSize: '12px' }}
          >
            🔐 Sessions
          </button>
          <button className="logout-btn" onClick={onLogout} title="Logout" style={{ flex: 1 }}>
            Logout
          </button>
        </div>

        {/* Always-visible developer credit at the very bottom of the sidebar.
            Shown on every dashboard page so users on the web build see who
            built the app without needing to open About. */}
        <div style={{
          marginTop: 4, paddingTop: 10,
          borderTop: '1px solid rgba(255,255,255,0.06)',
          textAlign: 'center',
          fontSize: 10.5,
          color: 'rgba(255,255,255,0.45)',
          lineHeight: 1.5,
          letterSpacing: '0.2px'
        }}>
          Designed &amp; developed by<br />
          <strong style={{ color: 'rgba(255,255,255,0.75)' }}>Guninder Ahluwalia</strong>
        </div>
      </div>

      <ChangePasswordModal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
      />

      <HelpGuidesModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        roleClass={roleClass}
      />

      {showSessionsModal && (
        <div
          className="modal-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setShowSessionsModal(false); }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 10000
          }}
        >
          <div style={{
            background: 'var(--bg-2, #1f2937)',
            color: 'var(--text, #f3f4f6)',
            padding: '24px 28px',
            borderRadius: 12,
            width: 'min(560px, 95vw)',
            maxHeight: '90vh',
            overflowY: 'auto',
            boxShadow: '0 18px 50px rgba(0,0,0,0.45)',
            border: '1px solid rgba(255,255,255,0.08)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <h2 style={{ margin: 0, fontSize: 20 }}>🔐 Account Security</h2>
              <button
                onClick={() => setShowSessionsModal(false)}
                style={{
                  background: 'transparent', color: 'inherit',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 14
                }}
              >
                ✕
              </button>
            </div>
            <p style={{ margin: '4px 0 14px', fontSize: 12.5, color: 'var(--text-2, #cbd5e1)' }}>
              Manage devices that are currently signed into your account.
            </p>
            <SessionManagementPanel />
          </div>
        </div>
      )}
    </div>
  );
}

export default Sidebar;
