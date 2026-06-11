import React, { useEffect, useState } from 'react';

/**
 * ProbationDepositPanel
 *
 * Renders an employee's probation security deposit:
 *   - Amount being held (= base_salary × deposit_months)
 *   - Window months 1..N from joining when payroll deducts to fund it
 *   - Status: held / released
 *   - Admin-only "Release Deposit" button (typically clicked after the
 *     employee clears probation)
 *
 * Used in two places:
 *   1. Employee's own dashboard — read-only "your money's safe" view.
 *   2. Admin Employee Manager — with the Release button.
 *
 * Props:
 *   userId         — whose deposit to show
 *   canManage      — true → show Release button (admin only)
 *   currentUserId  — actor id for audit trail
 *   onChange       — optional callback after a release succeeds
 */
function ProbationDepositPanel({ userId, canManage = false, currentUserId, onChange }) {
  const [deposit, setDeposit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [releasing, setReleasing] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const r = await window.electron.getDepositByUser(userId);
      if (r?.success) {
        setDeposit(r.data || null);
      } else {
        setError(r?.message || 'Could not load deposit');
      }
    } catch (e) {
      setError(e.message || 'Could not load deposit');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (userId) load(); /* eslint-disable-line */ }, [userId]);

  const release = async () => {
    if (!deposit?.id) return;
    if (!window.confirm(`Release this deposit of ₹${Number(deposit.deposit_amount).toLocaleString('en-IN')}? This is normally done after probation ends successfully.`)) return;
    setReleasing(true);
    try {
      const r = await window.electron.releaseDeposit(deposit.id, currentUserId, null);
      if (r?.success) {
        window.toast?.success?.('Deposit released');
        onChange?.();
        load();
      } else {
        window.toast?.error?.(r?.message || 'Failed to release deposit');
      }
    } catch (e) {
      window.toast?.error?.(e.message || 'Failed to release deposit');
    } finally {
      setReleasing(false);
    }
  };

  if (loading) {
    return <div style={panel}><em style={{ color: 'var(--text-2)' }}>Loading deposit…</em></div>;
  }

  if (!deposit) {
    return (
      <div style={panel}>
        <div style={titleStyle}>🏦 Probation Security Deposit</div>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-2)' }}>
          No deposit on file. New employees get one auto-created — existing employees
          will only have one if an admin set it up manually.
        </p>
      </div>
    );
  }

  const amt = Number(deposit.deposit_amount || 0);
  const startM = deposit.deduction_start_month || 1;
  const endM   = deposit.deduction_end_month   || 2;
  const monthsInWindow = Math.max(1, endM - startM + 1);
  const perMonth = amt / monthsInWindow;

  // Compute current month-of-employment to show the progress bar.
  let monthOfEmployment = null;
  if (deposit.joining_date) {
    const j = new Date(deposit.joining_date + 'T12:00:00Z');
    const now = new Date();
    monthOfEmployment = (now.getUTCFullYear() - j.getUTCFullYear()) * 12
      + (now.getUTCMonth() - j.getUTCMonth()) + 1;
  }
  const progressPct = monthOfEmployment != null
    ? Math.min(100, Math.max(0, ((Math.min(monthOfEmployment, endM) - startM + 1) / monthsInWindow) * 100))
    : null;

  const isHeld = deposit.status === 'held';

  return (
    <div style={panel}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={titleStyle}>🏦 Probation Security Deposit</div>
        <span style={{
          padding: '3px 10px', borderRadius: 10, fontSize: 11, fontWeight: 700,
          background: isHeld ? 'rgba(245,158,11,0.18)' : 'rgba(16,185,129,0.18)',
          color: isHeld ? '#fbbf24' : '#34d399',
          border: '1px solid ' + (isHeld ? 'rgba(245,158,11,0.45)' : 'rgba(16,185,129,0.45)')
        }}>
          {isHeld ? '⏳ HELD' : '✓ RELEASED'}
        </span>
      </div>

      <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-2, #9ca3af)' }}>
        Your first {monthsInWindow} month{monthsInWindow === 1 ? '' : 's'}' salary {isHeld ? 'is being held' : 'was held'} as a refundable security deposit.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <Stat label="Total deposit"    value={`₹${amt.toLocaleString('en-IN')}`} />
        <Stat label="Per month"        value={`₹${Math.round(perMonth).toLocaleString('en-IN')}`} />
        <Stat label="Months withheld"  value={`${monthsInWindow} (months ${startM}-${endM})`} />
        <Stat label="Status"           value={isHeld ? 'Held' : `Released ${deposit.released_date || ''}`} />
      </div>

      {isHeld && progressPct != null && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text-2, #9ca3af)', marginBottom: 4 }}>
            Funding progress (month {Math.min(monthOfEmployment, endM)} of {endM})
          </div>
          <div style={{ height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              width: `${progressPct}%`, height: '100%',
              background: 'linear-gradient(90deg, #f59e0b 0%, #10b981 100%)',
              transition: 'width 0.4s'
            }} />
          </div>
        </div>
      )}

      {canManage && isHeld && (
        <button
          onClick={release}
          disabled={releasing}
          className="btn btn-primary"
          style={{ padding: '8px 14px' }}
        >
          {releasing ? 'Releasing…' : '✓ Release Deposit'}
        </button>
      )}

      {error && (
        <div style={{ marginTop: 10, padding: '6px 10px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 6, color: '#fecaca', fontSize: 12 }}>
          {error}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-2, #9ca3af)', fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text, #f3f4f6)', marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

const panel = {
  background: 'var(--bg-3, #1f2937)',
  border: '1px solid var(--border, #374151)',
  borderRadius: 10,
  padding: '16px 18px',
  margin: '14px 0'
};
const titleStyle = { fontSize: 15, fontWeight: 700, color: 'var(--text, #f3f4f6)' };

export default ProbationDepositPanel;
