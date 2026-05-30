import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, CheckCircle, AlertCircle } from 'lucide-react';
import '../../styles/changePasswordModal.css';

function ChangePasswordModal({ isFirstLogin = false, onSuccess, onCancel, user }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [passwordStrength, setPasswordStrength] = useState(null);
  const [validationErrors, setValidationErrors] = useState([]);

  useEffect(() => {
    // Validate new password in real-time
    if (newPassword) {
      validatePasswordRealTime(newPassword);
    } else {
      setPasswordStrength(null);
      setValidationErrors([]);
    }
  }, [newPassword]);

  const validatePasswordRealTime = async (password) => {
    try {
      const result = await window.electron.validatePassword(password);
      setPasswordStrength(result.strength);
      setValidationErrors(result.errors);
    } catch (err) {
      console.error('Password validation error:', err);
    }
  };

  const getStrengthColor = () => {
    if (!passwordStrength) return '#d3d3d3';
    switch (passwordStrength.label) {
      case 'Weak':
        return '#ef4444';
      case 'Fair':
        return '#f97316';
      case 'Good':
        return '#eab308';
      case 'Strong':
        return '#22c55e';
      case 'Very Strong':
        return '#16a34a';
      default:
        return '#d3d3d3';
    }
  };

  const isFormValid = () => {
    if (isFirstLogin) {
      return newPassword && confirmPassword && validationErrors.length === 0 && newPassword === confirmPassword;
    } else {
      return currentPassword && newPassword && confirmPassword && validationErrors.length === 0 && newPassword === confirmPassword;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      let result;
      if (isFirstLogin) {
        result = await window.electron.changePasswordFirstLogin(newPassword, confirmPassword);
      } else {
        result = await window.electron.changePassword(currentPassword, newPassword, confirmPassword);
      }

      if (result.success) {
        // Show success message briefly
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setValidationErrors([]);
        setPasswordStrength(null);

        // Call onSuccess callback
        if (onSuccess) {
          onSuccess();
        }
      } else {
        setError(result.message || 'Failed to change password');
      }
    } catch (err) {
      console.error('Password change error:', err);
      setError('An error occurred while changing your password');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    if (!isFirstLogin && onCancel) {
      onCancel();
    }
  };

  return (
    <div className="change-password-overlay">
      <div className="change-password-modal">
        <div className="modal-header">
          <h2>
            {isFirstLogin ? 'Set Your Password' : 'Change Password'}
          </h2>
          <p className="modal-subtitle">
            {isFirstLogin
              ? 'Welcome! Please set a secure password for your account to continue.'
              : 'Update your password to keep your account secure.'}
          </p>
        </div>

        {error && (
          <div className="alert alert-error">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="password-form">
          {/* Current Password Field (only if not first login) */}
          {!isFirstLogin && (
            <div className="form-group">
              <label htmlFor="currentPassword">Current Password</label>
              <div className="password-input-wrapper">
                <input
                  id="currentPassword"
                  type={showCurrentPassword ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter your current password"
                  disabled={loading}
                  required={!isFirstLogin}
                  className="password-input"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="toggle-password-btn"
                  disabled={loading}
                  tabIndex="-1"
                >
                  {showCurrentPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
          )}

          {/* New Password Field */}
          <div className="form-group">
            <label htmlFor="newPassword">
              {isFirstLogin ? 'Password' : 'New Password'}
            </label>
            <div className="password-input-wrapper">
              <input
                id="newPassword"
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter a strong password"
                disabled={loading}
                required
                className="password-input"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="toggle-password-btn"
                disabled={loading}
                tabIndex="-1"
              >
                {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            {/* Password Strength Indicator */}
            {newPassword && passwordStrength && (
              <div className="password-strength-container">
                <div className="strength-bar-background">
                  <div
                    className="strength-bar-fill"
                    style={{
                      width: `${passwordStrength.percentage}%`,
                      backgroundColor: getStrengthColor()
                    }}
                  />
                </div>
                <span className="strength-label" style={{ color: getStrengthColor() }}>
                  Strength: {passwordStrength.label}
                </span>
              </div>
            )}

            {/* Validation Errors */}
            {validationErrors.length > 0 && (
              <div className="validation-errors">
                {validationErrors.map((error, idx) => (
                  <div key={idx} className="validation-error-item">
                    <AlertCircle size={14} />
                    <span>{error}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Password Requirements */}
            {newPassword && validationErrors.length === 0 && (
              <div className="password-requirements-met">
                <div className="requirement-item">
                  <CheckCircle size={14} />
                  <span>Password meets all requirements</span>
                </div>
              </div>
            )}
          </div>

          {/* Confirm Password Field */}
          <div className="form-group">
            <label htmlFor="confirmPassword">Confirm Password</label>
            <div className="password-input-wrapper">
              <input
                id="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your password"
                disabled={loading}
                required
                className="password-input"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="toggle-password-btn"
                disabled={loading}
                tabIndex="-1"
              >
                {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            {/* Password Match Indicator */}
            {confirmPassword && (
              <div className="password-match-indicator">
                {newPassword === confirmPassword ? (
                  <div className="match-valid">
                    <CheckCircle size={14} />
                    <span>Passwords match</span>
                  </div>
                ) : (
                  <div className="match-invalid">
                    <AlertCircle size={14} />
                    <span>Passwords do not match</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="modal-actions">
            <button
              type="submit"
              disabled={!isFormValid() || loading}
              className="btn-submit"
            >
              {loading ? (
                <>
                  <span className="spinner" />
                  Setting Password...
                </>
              ) : (
                isFirstLogin ? 'Set Password & Continue' : 'Update Password'
              )}
            </button>

            {!isFirstLogin && (
              <button
                type="button"
                onClick={handleCancel}
                disabled={loading}
                className="btn-cancel"
              >
                Cancel
              </button>
            )}
          </div>

          {isFirstLogin && (
            <p className="note-text">
              You must set a password before you can access the dashboard.
            </p>
          )}
        </form>
      </div>
    </div>
  );
}

export default ChangePasswordModal;
