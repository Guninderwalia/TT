import React, { useEffect, useState, useRef, useCallback } from 'react';

/**
 * Bell icon with unread badge + dropdown of recent notifications.
 *
 * Polls unread count every 30s. Loads the full list lazily when the user
 * opens the dropdown. Click a notification → marks it read. "Mark all as
 * read" link in the header. Closes when clicking outside.
 */
function NotificationBell({ user }) {
  const myId = user?.id || user?.user_id || user?.userId || user?.uid;
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef(null);

  const refreshCount = useCallback(async () => {
    if (!myId || !window.electron?.unreadNotifications) return;
    try {
      const r = await window.electron.unreadNotifications(myId);
      if (r && r.success) setUnreadCount(r.count || 0);
    } catch (_) { /* ignore polling errors */ }
  }, [myId]);

  const loadList = useCallback(async () => {
    if (!myId || !window.electron?.listNotifications) return;
    try {
      setLoading(true);
      const r = await window.electron.listNotifications(myId, { limit: 25 });
      if (r && r.success) setItems(Array.isArray(r.data) ? r.data : []);
    } catch (_) { /* ignore */ }
    finally { setLoading(false); }
  }, [myId]);

  useEffect(() => {
    if (!myId) return;
    refreshCount();
    const t = setInterval(refreshCount, 30000);
    return () => clearInterval(t);
  }, [myId, refreshCount]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const toggle = async () => {
    const willOpen = !open;
    setOpen(willOpen);
    if (willOpen) loadList();
  };

  const handleClickItem = async (n) => {
    if (!n.is_read && window.electron?.markNotificationRead) {
      try {
        await window.electron.markNotificationRead(n.id, myId);
        setItems(prev => prev.map(x => x.id === n.id ? { ...x, is_read: 1 } : x));
        setUnreadCount(c => Math.max(0, c - 1));
      } catch (_) {}
    }
  };

  const handleMarkAll = async () => {
    if (!window.electron?.markAllNotificationsRead) return;
    try {
      await window.electron.markAllNotificationsRead(myId);
      setItems(prev => prev.map(x => ({ ...x, is_read: 1 })));
      setUnreadCount(0);
    } catch (_) {}
  };

  const formatWhen = (ts) => {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      const now = new Date();
      const diffMs = now - d;
      const mins = Math.floor(diffMs / 60000);
      if (mins < 1)   return 'just now';
      if (mins < 60)  return `${mins} min ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24)   return `${hrs}h ago`;
      const days = Math.floor(hrs / 24);
      if (days < 7)   return `${days}d ago`;
      return d.toLocaleDateString();
    } catch (_) { return ''; }
  };

  const iconForType = (type) =>
    type === 'success' ? '✓' :
    type === 'warning' ? '⚠' :
    type === 'error'   ? '✕' :
                         'ℹ';

  if (!myId) return null;

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={toggle}
        title="Notifications"
        style={{
          background: 'transparent',
          border: 0,
          cursor: 'pointer',
          padding: '6px 10px',
          borderRadius: '50%',
          fontSize: '22px',
          position: 'relative',
          lineHeight: 1
        }}
        aria-label={`Notifications (${unreadCount} unread)`}
      >
        🔔
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute',
            top: '0px', right: '0px',
            minWidth: '18px', height: '18px',
            padding: '0 5px',
            background: '#dc2626',
            color: '#ffffff',
            borderRadius: '9px',
            fontSize: '11px',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '2px solid var(--bg, #0f1f2e)'
          }}>{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          right: 0,
          top: '110%',
          width: '340px',
          maxHeight: '460px',
          overflowY: 'auto',
          background: 'var(--bg-2, #1a3a52)',
          border: '1px solid var(--border, rgba(255,255,255,0.1))',
          borderRadius: '10px',
          boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
          zIndex: 9999
        }}>
          <div style={{
            padding: '10px 14px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid var(--border, rgba(255,255,255,0.1))'
          }}>
            <strong style={{ color: 'var(--text, #fff)' }}>Notifications</strong>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAll}
                style={{
                  background: 'transparent',
                  border: 0,
                  color: '#60a5fa',
                  cursor: 'pointer',
                  fontSize: '12px',
                  padding: 0
                }}
              >
                Mark all as read
              </button>
            )}
          </div>

          {loading ? (
            <div style={{ padding: '14px', color: 'var(--text-2, #ccc)', fontSize: '13px' }}>Loading…</div>
          ) : items.length === 0 ? (
            <div style={{ padding: '20px 14px', color: 'var(--text-2, #ccc)', fontSize: '13px', textAlign: 'center' }}>
              No notifications yet.
            </div>
          ) : items.map(n => (
            <div
              key={n.id}
              onClick={() => handleClickItem(n)}
              style={{
                padding: '10px 14px',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                cursor: n.is_read ? 'default' : 'pointer',
                background: n.is_read ? 'transparent' : 'rgba(96,165,250,0.08)',
                display: 'flex',
                gap: '10px',
                alignItems: 'flex-start'
              }}
            >
              <span style={{
                fontSize: '16px',
                color:
                  n.type === 'success' ? '#10b981' :
                  n.type === 'warning' ? '#f59e0b' :
                  n.type === 'error'   ? '#dc2626' :
                                         '#60a5fa',
                marginTop: '2px'
              }}>{iconForType(n.type)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  color: 'var(--text, #fff)',
                  fontWeight: n.is_read ? 500 : 700,
                  fontSize: '13px',
                  marginBottom: '2px'
                }}>{n.title}</div>
                {n.message && (
                  <div style={{ color: 'var(--text-2, #ccc)', fontSize: '12px', lineHeight: 1.4 }}>
                    {n.message}
                  </div>
                )}
                <div style={{ color: 'var(--text-3, #888)', fontSize: '11px', marginTop: '4px' }}>
                  {formatWhen(n.created_at)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default NotificationBell;
