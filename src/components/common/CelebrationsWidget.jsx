import React, { useEffect, useState } from 'react';
import Avatar from './Avatar';

/**
 * Birthdays + Work-Anniversaries widget.
 * Pass `departmentId` to scope to a single team (Lead Dashboard).
 * Pass nothing for company-wide (Admin Dashboard).
 */
function CelebrationsWidget({ departmentId = null, windowDays = 30, title = '🎉 Birthdays & Anniversaries' }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const r = await window.electron.getUpcomingCelebrations({ departmentId, windowDays });
        if (cancelled) return;
        setItems(r && r.success && Array.isArray(r.data) ? r.data : []);
      } catch (_) { /* no-op */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [departmentId, windowDays]);

  const fmtDate = (iso) => {
    try {
      return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    } catch (_) { return iso; }
  };
  const whenLabel = (daysAway) => {
    if (daysAway <= 0)  return 'Today';
    if (daysAway === 1) return 'Tomorrow';
    if (daysAway < 7)   return `In ${daysAway} days`;
    return `In ${daysAway} days`;
  };

  return (
    <>
      <h3 style={{ marginTop: '24px', marginBottom: '8px', color: 'var(--text)' }}>{title}</h3>
      <div className="form-section" style={{ marginTop: '8px' }}>
        {loading ? (
          <p style={{ color: 'var(--text-2)', margin: 0 }}>Loading…</p>
        ) : items.length === 0 ? (
          <p style={{ color: 'var(--text-2)', margin: 0 }}>
            No birthdays or work anniversaries in the next {windowDays} days.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {items.map((ev, idx) => (
              <div
                key={`${ev.type}-${ev.userId}-${idx}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  background: ev.daysAway === 0
                    ? 'rgba(245, 158, 11, 0.15)'
                    : 'var(--bg-3, rgba(255,255,255,0.04))',
                  border: ev.daysAway === 0 ? '1px solid #f59e0b' : '1px solid var(--border, rgba(255,255,255,0.06))'
                }}
              >
                <Avatar src={ev.profile_picture_path} name={ev.name} size={36} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: 'var(--text)' }}>
                    {ev.type === 'birthday' ? '🎂' : '🎉'} {ev.name}
                    {ev.department && (
                      <span style={{ marginLeft: 8, fontSize: '11px', color: 'var(--text-2)', fontWeight: 400 }}>
                        ({ev.department})
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-2)' }}>
                    {ev.type === 'birthday'
                      ? `Turning ${ev.age} on ${fmtDate(ev.date)}`
                      : `${ev.years} year${ev.years > 1 ? 's' : ''} at the company — ${fmtDate(ev.date)}`}
                  </div>
                </div>
                <span style={{
                  padding: '2px 10px',
                  borderRadius: 12,
                  fontWeight: 700,
                  fontSize: 11,
                  background: ev.daysAway === 0 ? '#f59e0b' : 'rgba(255,255,255,0.08)',
                  color:      ev.daysAway === 0 ? '#1f2937' : 'var(--text-2)'
                }}>{whenLabel(ev.daysAway)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export default CelebrationsWidget;
