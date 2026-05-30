import React, { useEffect, useState } from 'react';

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
        </>
      )}
    </div>
  );
}

export default SettingsPage;
