import React, { useState } from 'react';
import '../styles/sidebar.css';
import logoImage from '../assets/logo.png';
import ChangePasswordModal from './common/ChangePasswordModal';
import HelpGuidesModal from './common/HelpGuidesModal';
import ThemeToggle from './common/ThemeToggle';

function Sidebar({ user, navItems, activeNav, onNavChange, onLogout }) {
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);

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
          <button className="logout-btn" onClick={onLogout} title="Logout" style={{ flex: 1 }}>
            Logout
          </button>
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
    </div>
  );
}

export default Sidebar;
