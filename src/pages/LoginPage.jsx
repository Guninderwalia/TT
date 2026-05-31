import React, { useState } from 'react';
import '../styles/login.css';
import logoImage from '../assets/logo.png';
import ChangePasswordModal from '../components/modals/ChangePasswordModal';

function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [loginUser, setLoginUser] = useState(null);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      let result;

      // Use window.ipcRenderer or window.electron from preload
      if (window.ipcRenderer) {
        console.log('[LOGIN] Using window.ipcRenderer');
        result = await window.ipcRenderer.invoke('auth:login', { email, password });
      } else if (window.electron && window.electron.login) {
        console.log('[LOGIN] Using window.electron.login');
        result = await window.electron.login(email, password);
      } else {
        throw new Error('Electron API not available');
      }

      if (result.success) {
        // Check if first login
        if (result.isFirstLogin) {
          // Show password modal instead of logging in
          setLoginUser(result.user);
          setShowPasswordModal(true);
        } else {
          // Normal login
          onLogin(result.user);
        }
        // Clear form
        setEmail('');
        setPassword('');
      } else {
        setError(result.message || 'Login failed');
      }
    } catch (err) {
      setError('An error occurred during login');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordModalSuccess = () => {
    setShowPasswordModal(false);
    // Now proceed with login
    if (loginUser) {
      onLogin(loginUser);
    }
  };

  const handlePasswordModalCancel = () => {
    setShowPasswordModal(false);
    setLoginUser(null);
    // Logout the user
    window.electron.logout();
  };

  return (
    <>
      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <div className="logo-circle">
              <img src={logoImage} alt="Task Tango" className="logo-image-login" />
            </div>
            <h1>Task Tango</h1>
            <p className="subtitle">Financial Services HR Management System</p>
          </div>

          {error && <div className="error-message">{error}</div>}

          <form onSubmit={handleLogin} className="login-form">
            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email address"
                disabled={loading}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                disabled={loading}
                required
              />
            </div>

            <button type="submit" className="login-button" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          {/* Always-visible developer credit so users on the web build know
              who's behind the app without needing to open the About dialog. */}
          <div style={{
            marginTop: 24, paddingTop: 14,
            borderTop: '1px solid rgba(255,255,255,0.08)',
            textAlign: 'center',
            fontSize: 11,
            color: 'rgba(255,255,255,0.55)',
            letterSpacing: '0.3px',
            lineHeight: 1.6
          }}>
            Designed &amp; developed by <strong style={{ color: 'rgba(255,255,255,0.85)' }}>Guninder Ahluwalia</strong>
            <br />
            <span style={{ fontFamily: 'Consolas, "Courier New", monospace', fontSize: 10, opacity: 0.7 }}>
              Production v4.6.2 · © {new Date().getFullYear()}
            </span>
          </div>
        </div>
      </div>

      {showPasswordModal && (
        <ChangePasswordModal
          isFirstLogin={true}
          user={loginUser}
          onSuccess={handlePasswordModalSuccess}
          onCancel={handlePasswordModalCancel}
        />
      )}
    </>
  );
}

export default LoginPage;
