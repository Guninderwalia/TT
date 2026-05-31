import React, { useEffect, useState, useCallback } from 'react';

/**
 * SessionManagementPanel
 *
 * Drop into any Settings page. Lists the current user's active login sessions
 * (one row per device the user is signed into) and lets them:
 *   - End a single other session ("Sign out this device")
 *   - End every OTHER session in one click ("Sign out everywhere else")
 *
 * The CURRENT session is highlighted and cannot be revoked here — use the
 * normal Logout button for that.
 *
 * Backed by:
 *   GET    auth:listMySessions      → list rows
 *   POST   auth:revokeSession       → revoke one by id
 *   POST   auth:revokeAllOtherSessions
 */
function SessionManagementPanel() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await window.electron.listMySessions();
      if (r?.success) {
        setSessions(r.data || []);
      } else {
        setError(r?.message || 'Could not load sessions');
      }
    } catch (e) {
      setError(e.message || 'Could not load sessions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const revokeOne = async (sessionId) => {
    if (!sessionId) return;
    setBusy(true);
    try {
      const r = await window.electron.revokeSession(sessionId);
      if (r?.success) {
        window.toast?.success?.('Session ended');
        load();
      } else {
        window.toast?.error?.(r?.message || 'Failed to end session');
      }
    } catch (e) {
      window.toast?.error?.(e.message || 'Failed to end session');
    } finally {
      setBusy(false);
    }
  };

  const revokeAllOther = async () => {
    setBusy(true);
    try {
      const r = await window.electron.revokeAllOtherSessions();
      if (r?.success) {
        window.toast?.success?.(`Ended ${r.revoked || 0} session${r.revoked === 1 ? '' : 's'}`);
        load();
      } else {
        window.toast?.error?.(r?.message || 'Failed to end other sessions');
      }
    } catch (e) {
      window.toast?.error?.(e.message || 'Failed to end other sessions');
    } finally {
      setBusy(false);
    }
  };

  const fmtTime = (iso) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString();
    } catch (_) { return iso; }
  };

  const otherCount = sessions.filter(s => !s.isCurrent).length;

  return (
    <div style={{
      background: 'var(--bg-3, #1f2937)',
      border: '1px solid var(--border, #374151)',
      borderRadius: 10,
      padding: '18px 22px',
      margin: '16px 0'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text, #f3f4f6)' }}>
          🔐 Your Active Sessions
        </h3>
        <button
          onClick={load}
          disabled={loading}
          className="btn btn-secondary btn-sm"
          style={{ padding: '4px 10px', fontSize: 12 }}
        >
          ↻ Refresh
        </button>
      </div>
      <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--text-2, #9ca3af)' }}>
        Every device that's currently logged into your account. If you don't recognise one, end it immediately and change your password.
      </p>

      {error && (
        <div style={{
          padding: '8px 12px', background: 'rgba(239,68,68,0.12)',
          border: '1px solid rgba(239,68,68,0.35)', borderRadius: 6,
          color: '#fecaca', fontSize: 12.5, marginBottom: 10
        }}>
          {error}
        </div>
      )}

      {otherCount > 0 && (
        <div style={{ marginBottom: 10 }}>
          <button
            onClick={revokeAllOther}
            disabled={busy}
            className="btn btn-danger btn-sm"
            style={{ padding: '6px 12px', fontSize: 12 }}
          >
            🛑 Sign out everywhere else ({otherCount})
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--text-2, #9ca3af)', fontSize: 13 }}>Loading…</div>
      ) : sessions.length === 0 ? (
        <div style={{ color: 'var(--text-2, #9ca3af)', fontSize: 13 }}>
          No active sessions found. (Refresh to retry.)
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sessions.map(s => (
            <div
              key={s.id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px',
                background: s.isCurrent ? 'rgba(16,185,129,0.08)' : 'rgba(255,255,255,0.03)',
                border: '1px solid ' + (s.isCurrent ? 'rgba(16,185,129,0.35)' : 'rgba(255,255,255,0.08)'),
                borderRadius: 8
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text, #f3f4f6)' }}>
                  {s.device_label || 'Unknown device'}
                  {s.isCurrent && (
                    <span style={{
                      marginLeft: 8, fontSize: 10, padding: '1px 7px',
                      borderRadius: 8, background: '#10b981', color: '#ffffff', fontWeight: 700
                    }}>
                      THIS DEVICE
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-2, #9ca3af)', marginTop: 3 }}>
                  IP: <code style={{ background: 'rgba(255,255,255,0.05)', padding: '0 4px', borderRadius: 3 }}>{s.ip_address || 'local'}</code>
                  &nbsp;·&nbsp; Started {fmtTime(s.created_at)}
                  &nbsp;·&nbsp; Last seen {fmtTime(s.last_seen_at)}
                </div>
              </div>
              {!s.isCurrent && (
                <button
                  onClick={() => revokeOne(s.id)}
                  disabled={busy}
                  className="btn btn-secondary btn-sm"
                  style={{ padding: '5px 10px', fontSize: 12, marginLeft: 12 }}
                  title="End this session"
                >
                  End session
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default SessionManagementPanel;
