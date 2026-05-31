import React, { useEffect, useState } from 'react';
import SessionManagementPanel from '../common/SessionManagementPanel';

/**
 * Admin Settings page — key/value editor for system-wide defaults, plus a
 * one-click DB backup download. All entries auto-save on blur.
 */

const FIELDS = [
  {
    key: 'company_name',
    label: 'Company Name',
    help: 'Shown in the sidebar header and in reports.',
    type: 'text'
  },
  {
    key: 'default_annual_leave',
    label: 'Default Annual Leave Entitlement (days/year)',
    help: 'Used for new employee balances. Existing balances aren\'t changed retroactively.',
    type: 'number',
    min: 0,
    step: 0.5
  },
  {
    key: 'probation_months',
    label: 'Probation Length (months)',
    help: 'Drives the "Probation ending soon" reminder on the admin dashboard.',
    type: 'number',
    min: 0,
    step: 1
  },
  {
    key: 'working_hours_start',
    label: 'Default Start Time (HH:MM)',
    help: 'Used as the default for new employees; existing employees keep their per-record start time.',
    type: 'text',
    placeholder: '09:00'
  },
  {
    key: 'working_hours_end',
    label: 'Default End Time (HH:MM)',
    help: 'Used as the default for new employees; existing employees keep their per-record end time.',
    type: 'text',
    placeholder: '18:00'
  },
  {
    // v4.3 — Office timezone. All sign-in / sign-out / break stamps render
    // in this zone regardless of where the employee's laptop is set, so
    // cross-timezone teams see consistent times. Defaults to Asia/Kolkata.
    key: 'office_timezone',
    label: 'Office Timezone',
    help: 'IANA zone (e.g. Asia/Kolkata, Europe/London, America/New_York). All time stamps display in this zone. Takes effect on next app launch.',
    type: 'select',
    options: [
      { value: 'Asia/Kolkata',      label: 'India Standard Time (Asia/Kolkata)' },
      { value: 'Europe/London',     label: 'UK (Europe/London)' },
      { value: 'Europe/Berlin',     label: 'Central Europe (Europe/Berlin)' },
      { value: 'America/New_York',  label: 'US Eastern (America/New_York)' },
      { value: 'America/Chicago',   label: 'US Central (America/Chicago)' },
      { value: 'America/Denver',    label: 'US Mountain (America/Denver)' },
      { value: 'America/Los_Angeles', label: 'US Pacific (America/Los_Angeles)' },
      { value: 'Australia/Sydney',  label: 'Australia East (Australia/Sydney)' },
      { value: 'Asia/Singapore',    label: 'Singapore (Asia/Singapore)' },
      { value: 'Asia/Dubai',        label: 'Dubai (Asia/Dubai)' },
      { value: 'UTC',               label: 'UTC' }
    ]
  }
];

function SettingsPage({ user }) {
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(null);
  const [downloading, setDownloading] = useState(false);
  // Leave-rollover policy table — one row per leave type
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [policyDirty, setPolicyDirty] = useState({}); // { [leaveTypeId]: true }
  const [policySaving, setPolicySaving] = useState({}); // { [leaveTypeId]: bool }

  useEffect(() => {
    (async () => {
      try {
        const r = await window.electron.listSettings();
        if (r && r.success) setValues(r.data || {});
      } catch (_) {}
      try {
        const lp = await window.electron.listLeaveTypesWithPolicy();
        if (lp && lp.success) setLeaveTypes(lp.data || []);
      } catch (_) {}
      finally { setLoading(false); }
    })();
  }, []);

  const updatePolicyField = (id, field, value) => {
    setLeaveTypes(prev => prev.map(lt => lt.id === id ? { ...lt, [field]: value } : lt));
    setPolicyDirty(prev => ({ ...prev, [id]: true }));
  };

  const savePolicy = async (lt) => {
    try {
      setPolicySaving(prev => ({ ...prev, [lt.id]: true }));
      const r = await window.electron.updateLeaveTypePolicy({
        leaveTypeId: lt.id,
        annualEntitlement: lt.annualEntitlement,
        carryForwardEnabled: lt.carryForwardEnabled,
        maxCarryForwardDays: lt.maxCarryForwardDays,
        expiryMonthsAfterYearEnd: lt.expiryMonthsAfterYearEnd,
        encashmentEnabled: lt.encashmentEnabled,
        currentUserId: user?.id
      });
      if (r && r.success) {
        window.toast?.success(`Saved policy for ${lt.name}.`);
        setPolicyDirty(prev => { const c = { ...prev }; delete c[lt.id]; return c; });
      } else {
        window.toast?.error('Could not save: ' + (r?.message || 'Unknown error'));
      }
    } catch (e) {
      window.toast?.error('Could not save: ' + e.message);
    } finally {
      setPolicySaving(prev => { const c = { ...prev }; delete c[lt.id]; return c; });
    }
  };

  const handleChange = (key, v) => setValues(prev => ({ ...prev, [key]: v }));

  const handleSave = async (key) => {
    try {
      setSavingKey(key);
      const r = await window.electron.setSetting(key, values[key]);
      if (r && r.success) {
        if (window.toast) window.toast.success('Setting saved.');
      } else {
        if (window.toast) window.toast.error('Could not save: ' + (r?.message || 'Unknown error'));
      }
    } catch (e) {
      if (window.toast) window.toast.error('Could not save: ' + e.message);
    } finally {
      setSavingKey(null);
    }
  };

  const handleBackup = async () => {
    try {
      setDownloading(true);
      const r = await window.electron.downloadDbBackup();
      if (!r || !r.success) {
        if (window.toast) window.toast.error('Backup failed: ' + (r?.message || 'Unknown error'));
        return;
      }
      // v4.4.2: r.data is now a base64 string (so the binary survives
      // JSON-over-HTTP on the web build). Decode back to bytes before the
      // Blob — otherwise the downloaded file contains the literal base64
      // text instead of the SQLite binary.
      const binary = atob(r.data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = r.filename || 'tasktango-backup.db';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      if (window.toast) window.toast.success('Backup downloaded.');
    } catch (e) {
      if (window.toast) window.toast.error('Backup failed: ' + e.message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="manager-container">
      <div className="manager-header">
        <h2>⚙️ Settings</h2>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-2)' }}>Loading settings…</p>
      ) : (
        <>
          <div className="form-section">
            <h3>Defaults</h3>
            <p style={{ color: 'var(--text-2)', fontSize: '13px', marginTop: 0 }}>
              These values control company-wide defaults. Each field auto-saves when you click Save.
            </p>
            {FIELDS.map(f => (
              <div key={f.key} className="form-group" style={{ marginBottom: '14px' }}>
                <label>{f.label}</label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {f.type === 'select' ? (
                    <select
                      value={values[f.key] ?? ''}
                      onChange={e => handleChange(f.key, e.target.value)}
                      style={{ flex: 1, padding: '8px 12px', borderRadius: '6px' }}
                    >
                      {(values[f.key] === '' || values[f.key] == null) && (
                        <option value="">Select…</option>
                      )}
                      {(f.options || []).map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={f.type}
                      value={values[f.key] ?? ''}
                      onChange={e => handleChange(f.key, e.target.value)}
                      placeholder={f.placeholder || ''}
                      min={f.min}
                      step={f.step}
                      style={{ flex: 1, padding: '8px 12px', borderRadius: '6px' }}
                    />
                  )}
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => handleSave(f.key)}
                    disabled={savingKey === f.key}
                    style={{ padding: '8px 16px', fontSize: '13px' }}
                  >
                    {savingKey === f.key ? 'Saving…' : 'Save'}
                  </button>
                </div>
                {f.help && (
                  <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-2)' }}>{f.help}</p>
                )}
              </div>
            ))}
          </div>

          <div className="form-section">
            <h3>🌴 Leave Rollover Policy</h3>
            <p style={{ color: 'var(--text-2)', fontSize: '13px', marginTop: 0 }}>
              When a new calendar year starts, unused balance for each leave type is rolled forward
              according to its policy. Days above the cap are encashed (if enabled) or forfeited.
              Changes apply from the next year's first balance read — historical rollovers are unaffected.
            </p>
            {leaveTypes.length === 0 ? (
              <p style={{ color: 'var(--text-2)' }}>No leave types configured.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table" style={{ fontSize: '13px' }}>
                  <thead>
                    <tr>
                      <th>Leave Type</th>
                      <th style={{ width: '90px' }}>Entitlement</th>
                      <th style={{ width: '110px' }}>Carry forward</th>
                      <th style={{ width: '110px' }}>Max carry days</th>
                      <th style={{ width: '120px' }}>Expiry (months)</th>
                      <th style={{ width: '110px' }}>Encash extra</th>
                      <th style={{ width: '110px', textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaveTypes.map(lt => (
                      <tr key={lt.id}>
                        <td><strong>{lt.name}</strong></td>
                        <td>
                          <input
                            type="number" min="0" step="0.5"
                            value={lt.annualEntitlement ?? 0}
                            onChange={e => updatePolicyField(lt.id, 'annualEntitlement', e.target.value)}
                            style={{ width: '70px', padding: '4px 6px' }}
                          />
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={!!lt.carryForwardEnabled}
                            onChange={e => updatePolicyField(lt.id, 'carryForwardEnabled', e.target.checked)}
                            title="Roll unused days to next year"
                          />
                        </td>
                        <td>
                          <input
                            type="number" min="0" step="1"
                            value={lt.maxCarryForwardDays ?? 0}
                            disabled={!lt.carryForwardEnabled}
                            onChange={e => updatePolicyField(lt.id, 'maxCarryForwardDays', e.target.value)}
                            title="Maximum days that may carry forward. 0 = unlimited (cap = whatever was unused)."
                            style={{ width: '80px', padding: '4px 6px' }}
                          />
                        </td>
                        <td>
                          <input
                            type="number" min="0" step="1"
                            value={lt.expiryMonthsAfterYearEnd ?? 0}
                            disabled={!lt.carryForwardEnabled}
                            onChange={e => updatePolicyField(lt.id, 'expiryMonthsAfterYearEnd', e.target.value)}
                            title="Carried days expire this many months into the new year. 0 = no expiry."
                            style={{ width: '80px', padding: '4px 6px' }}
                          />
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={!!lt.encashmentEnabled}
                            disabled={!lt.carryForwardEnabled}
                            onChange={e => updatePolicyField(lt.id, 'encashmentEnabled', e.target.checked)}
                            title="Days above the cap are encashed instead of forfeited"
                          />
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={!policyDirty[lt.id] || policySaving[lt.id]}
                            onClick={() => savePolicy(lt)}
                            style={{ padding: '4px 12px', fontSize: '12px' }}
                          >
                            {policySaving[lt.id] ? 'Saving…' : (policyDirty[lt.id] ? 'Save' : '✓ Saved')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p style={{ fontSize: '12px', color: 'var(--text-2)', marginTop: '8px' }}>
              <strong>Example:</strong> Annual Leave 25, Carry forward ✓, Max 5, Encash extra ✗ — an employee
              with 8 days unused at year-end will start the next year with 25 + 5 = 30 days; the other 3 are forfeited.
            </p>
          </div>

          <div className="form-section">
            <h3>🛡️ Database Backup</h3>
            <p style={{ color: 'var(--text-2)', fontSize: '13px', marginTop: 0 }}>
              Download a full snapshot of the TaskTango database. Keep these somewhere safe — they're
              the only way to recover from data loss.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleBackup}
              disabled={downloading}
            >
              {downloading ? 'Preparing…' : '⬇️ Download Backup'}
            </button>
            <p style={{ fontSize: '12px', color: 'var(--text-2)', marginTop: '8px' }}>
              Restoring from a backup requires copying the .db file into{' '}
              <code>%APPDATA%\TaskTango\</code> while the app is closed.
            </p>
          </div>

          {/* v4.7.4 — Configure which days of the week are non-working.
              Drives the cron auto-mark-absent + the "Sunday/Holiday" pill
              on dashboards. Default is Sunday only. */}
          <WeeklyOffDaysPanel />

          {/* v4.6 — Active session management — admins can also see this
              same panel for THEIR account; the same component is mounted
              for non-admins via the dashboard pages. */}
          <SessionManagementPanel />

          {/* v4.5 — Wipe Test Data ====================================== */}
          <WipeTestDataPanel />
        </>
      )}
    </div>
  );
}

// One-click admin nuke for everything an employee can generate. Keeps the
// admin user(s) + lookups (roles, leave types, settings) so the app boots
// straight into a clean production state. Requires typing "WIPE" to confirm.
function WipeTestDataPanel() {
  const [confirmText, setConfirmText] = React.useState('');
  const [wiping, setWiping] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [error, setError] = React.useState('');

  const handleWipe = async () => {
    setError('');
    setResult(null);
    setWiping(true);
    try {
      const r = await window.electron.wipeTestData('WIPE');
      if (r?.success) {
        setResult(r.wiped || {});
        setConfirmText('');
        if (window.toast) window.toast.success('Test data wiped. Reload the page to see the clean state.');
      } else {
        setError(r?.message || 'Wipe failed');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setWiping(false);
    }
  };

  return (
    <div className="form-section" style={{ borderLeft: '4px solid #ef4444' }}>
      <h3>💥 Wipe Test Data</h3>
      <p style={{ color: 'var(--text-2)', fontSize: '13px', marginTop: 0 }}>
        Deletes every employee, attendance row, time log, leave request, payroll record, chat
        message, document, and audit entry — but keeps your admin account, roles, leave types,
        timezone, and other settings intact. Useful for clearing test data before going live.
      </p>
      <p style={{ color: '#ef4444', fontSize: '13px', fontWeight: 600, marginBottom: 12 }}>
        ⚠️ This is irreversible. Take a Database Backup first.
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder='Type WIPE to confirm'
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          style={{
            flex: '1 1 220px', padding: '8px 12px', borderRadius: 6,
            border: '1px solid var(--border)', background: 'var(--bg-3)', color: 'var(--text)'
          }}
          disabled={wiping}
        />
        <button
          type="button"
          className="btn btn-danger"
          onClick={handleWipe}
          disabled={wiping || confirmText !== 'WIPE'}
          title={confirmText !== 'WIPE' ? 'Type WIPE to enable' : 'Wipe all test data'}
        >
          {wiping ? 'Wiping…' : 'Wipe All Test Data'}
        </button>
      </div>
      {error && (
        <p style={{ marginTop: 12, color: '#ef4444', fontSize: 13 }}>{error}</p>
      )}
      {result && (
        <div style={{ marginTop: 12, padding: 10, background: 'rgba(16,185,129,0.1)', borderRadius: 6, fontSize: 12 }}>
          <strong>Wipe summary:</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {Object.entries(result).map(([table, count]) => (
              <li key={table}>{table}: {count} row{count === 1 ? '' : 's'}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// v4.7.4 — Configure which days of the week are weekly off (non-working).
// Backed by app_settings.non_working_dow as a CSV of day-of-week numbers
// (0=Sun, 6=Sat). Drives the cron auto-mark-absent + the "Sunday/Holiday"
// pill on the live status widget.
function WeeklyOffDaysPanel() {
  const DAYS = [
    { dow: 0, label: 'Sunday',    short: 'Sun' },
    { dow: 1, label: 'Monday',    short: 'Mon' },
    { dow: 2, label: 'Tuesday',   short: 'Tue' },
    { dow: 3, label: 'Wednesday', short: 'Wed' },
    { dow: 4, label: 'Thursday',  short: 'Thu' },
    { dow: 5, label: 'Friday',    short: 'Fri' },
    { dow: 6, label: 'Saturday',  short: 'Sat' },
  ];
  const [selected, setSelected] = React.useState(new Set([0])); // default Sunday only
  const [loaded, setLoaded]     = React.useState(false);
  const [saving, setSaving]     = React.useState(false);
  const [savedAt, setSavedAt]   = React.useState(null);
  const [error, setError]       = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await window.electron.getSetting('non_working_dow');
        if (cancelled) return;
        const raw = r?.value ?? r?.data?.value ?? r;
        if (typeof raw === 'string' && raw.trim()) {
          const parsed = raw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n >= 0 && n <= 6);
          if (parsed.length > 0) setSelected(new Set(parsed));
        }
      } catch (e) {
        if (!cancelled) setError(e.message || 'Could not load setting');
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const toggle = (dow) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(dow)) next.delete(dow); else next.add(dow);
      return next;
    });
  };

  const save = async () => {
    setError('');
    setSaving(true);
    try {
      const value = Array.from(selected).sort((a, b) => a - b).join(',');
      const r = await window.electron.setSetting('non_working_dow', value);
      if (r?.success === false) {
        setError(r.message || 'Could not save');
      } else {
        setSavedAt(new Date());
        window.toast?.success?.(selected.size === 0
          ? 'No weekly off days — cron will run every day.'
          : `Weekly off days saved: ${Array.from(selected).map(d => DAYS[d].short).join(', ')}`);
      }
    } catch (e) {
      setError(e.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      background: 'var(--bg-3, #1f2937)',
      border: '1px solid var(--border, #374151)',
      borderRadius: 10,
      padding: '18px 22px',
      margin: '16px 0'
    }}>
      <h3 style={{ margin: '0 0 6px', fontSize: 16, color: 'var(--text, #f3f4f6)' }}>
        📅 Weekly Off Days
      </h3>
      <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--text-2, #9ca3af)' }}>
        Tick the days your company is closed. On those days the auto-Absent cron skips and the dashboard shows the day name (e.g. <strong>Sunday</strong>) instead of red Absent rows. Anyone who DOES sign in still shows their real status — sign-in always wins.
      </p>

      {error && (
        <div style={{ padding: '8px 12px', marginBottom: 10, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 6, color: '#fecaca', fontSize: 12.5 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {DAYS.map(d => {
          const on = selected.has(d.dow);
          return (
            <button
              key={d.dow}
              onClick={() => toggle(d.dow)}
              disabled={!loaded}
              style={{
                padding: '8px 14px',
                borderRadius: 8,
                cursor: 'pointer',
                background: on ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.04)',
                color: on ? '#a5b4fc' : 'var(--text-2, #cbd5e1)',
                border: '1px solid ' + (on ? 'rgba(99,102,241,0.55)' : 'rgba(255,255,255,0.12)'),
                fontWeight: on ? 700 : 500,
                fontSize: 13,
                minWidth: 90
              }}
              title={on ? 'Click to remove from weekly off' : 'Click to mark as weekly off'}
            >
              {on ? '✓ ' : ''}{d.label}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={save}
          disabled={saving || !loaded}
          className="btn btn-primary"
          style={{ padding: '8px 16px' }}
        >
          {saving ? 'Saving…' : 'Save Weekly Off Days'}
        </button>
        {savedAt && (
          <span style={{ fontSize: 12, color: 'var(--text-2, #9ca3af)' }}>
            Saved at {savedAt.toLocaleTimeString()}
          </span>
        )}
        <span style={{ fontSize: 12, color: 'var(--text-2, #9ca3af)', marginLeft: 'auto' }}>
          Default: <strong>Sunday only</strong>
        </span>
      </div>

      <p style={{ margin: '12px 0 0', fontSize: 11.5, color: 'var(--text-2, #9ca3af)' }}>
        Common patterns: <strong>Sun</strong> (India / Middle East 6-day week) · <strong>Sat + Sun</strong> (UK / US 5-day week) · <strong>Fri + Sat</strong> (Saudi / UAE).
      </p>
    </div>
  );
}

export default SettingsPage;
