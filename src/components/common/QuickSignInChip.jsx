import React, { useEffect, useState } from 'react';
import { getOfficeDate } from '../../utils/officeTime';

/**
 * QuickSignInChip — a compact "stamp my time" widget for every dashboard
 * header. Saves three clicks per person per day: no need to navigate to
 * the Attendance page to record sign-in/sign-out.
 *
 * States (driven off today's attendance row):
 *   ▶  Sign In   — no row yet, or no sign_in_time
 *   ●  In · 09:42 — signed in, not yet signed out (clickable → Sign Out)
 *   ■  Out · 18:05 — both stamped (read-only)
 *
 * Shows nothing for admins/managers/leads if you'd rather they have a
 * cleaner header — pass `hideForRoles={['Admin','MD']}` to hide. By
 * default it's visible to everyone.
 */
function QuickSignInChip({ user, hideForRoles = [] }) {
  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(false);

  const myId = user?.id;
  const roleName = String(user?.role_name || user?.roleName || '').toLowerCase();
  const hide = hideForRoles.some(r => String(r).toLowerCase() === roleName);

  const today = getOfficeDate();

  const load = async () => {
    if (!myId || hide) return;
    try {
      // 1-day history window is enough to grab today's row.
      const r = await window.electron.getAttendanceHistory(myId, today, today);
      const list = (r && r.success && Array.isArray(r.data)) ? r.data : [];
      setRow(list.find(x => x.date === today) || null);
    } catch (_) { /* best-effort */ }
  };

  useEffect(() => {
    if (!myId || hide) return;
    load();
    // Refresh every 60s so the chip stays in sync if the user signs in on
    // the Attendance page directly.
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [myId, today]); // eslint-disable-line

  if (!myId || hide) return null;

  const signedIn = !!row?.signInTime;
  const signedOut = !!row?.signOutTime;

  const handleSignIn = async () => {
    if (loading || signedIn) return;
    setLoading(true);
    try {
      const r = await window.electron.signIn(myId);
      if (r?.success) {
        window.toast?.success?.('Signed in');
        await load();
      } else {
        window.toast?.error?.('Sign in failed: ' + (r?.message || r?.error || 'unknown'));
      }
    } catch (e) {
      window.toast?.error?.('Sign in failed: ' + e.message);
    } finally { setLoading(false); }
  };

  const handleSignOut = async () => {
    if (loading || signedOut || !signedIn) return;
    setLoading(true);
    try {
      const r = await window.electron.signOut(myId);
      if (r?.success) {
        window.toast?.success?.('Signed out');
        await load();
      } else {
        window.toast?.error?.('Sign out failed: ' + (r?.message || r?.error || 'unknown'));
      }
    } catch (e) {
      window.toast?.error?.('Sign out failed: ' + e.message);
    } finally { setLoading(false); }
  };

  // Three visual states.
  let bg, color, label, onClick, title;
  if (signedOut) {
    bg = 'rgba(59,130,246,0.18)'; color = '#60a5fa';
    label = `■ Done · ${String(row.signOutTime).slice(0,5)}`;
    onClick = null; title = `Signed in at ${String(row.signInTime).slice(0,5)} · out at ${String(row.signOutTime).slice(0,5)}`;
  } else if (signedIn) {
    bg = 'rgba(16,185,129,0.22)'; color = '#10b981';
    label = `● In · ${String(row.signInTime).slice(0,5)}`;
    onClick = handleSignOut; title = 'Click to Sign Out';
  } else {
    bg = 'rgba(245,158,11,0.22)'; color = '#f59e0b';
    label = '▶ Sign In';
    onClick = handleSignIn; title = 'Stamp today\'s sign-in time';
  }

  return (
    <button
      type="button"
      onClick={onClick || undefined}
      disabled={loading || !onClick}
      title={title}
      style={{
        background: bg, color, border: `1px solid ${color}`,
        padding: '6px 12px', borderRadius: 999,
        fontSize: 12, fontWeight: 700,
        cursor: onClick && !loading ? 'pointer' : 'default',
        opacity: loading ? 0.6 : 1,
        whiteSpace: 'nowrap'
      }}
    >{loading ? '…' : label}</button>
  );
}

export default QuickSignInChip;
