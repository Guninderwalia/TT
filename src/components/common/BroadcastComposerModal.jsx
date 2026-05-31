import React, { useEffect, useMemo, useState } from 'react';

/**
 * BroadcastComposerModal
 *
 * One-shot fan-out send. Lets the current user pick a recipient set across:
 *   - Everyone (admin/MD only)
 *   - Specific departments (multi-select)
 *   - Specific roles (multi-select)
 *   - Specific individuals (multi-select)
 *
 * Then composes a single message + optional attachment and dispatches via
 * window.electron.chatBroadcast — one 1:1 conversation is created/used per
 * recipient and the same body goes into each.
 *
 * Permission model:
 *   - Admins / MDs / Managers: "Everyone" + all targeting modes available.
 *   - Department leads: limited to their own department + individuals.
 *   - Regular users: individuals only.
 *
 * Props:
 *   - user      : the logged-in user (for sender id + permission check)
 *   - onClose() : dismiss callback
 *   - onSent()  : optional callback after a successful broadcast (e.g. to
 *                 close the parent chat panel or refresh the conversation list)
 */
function BroadcastComposerModal({ user, onClose, onSent }) {
  const [allUsers, setAllUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);

  // Picker state
  const [mode, setMode] = useState('individuals'); // 'all' | 'departments' | 'roles' | 'individuals'
  const [pickedUserIds, setPickedUserIds] = useState(new Set());
  const [pickedDeptIds, setPickedDeptIds] = useState(new Set());
  const [pickedRoleNames, setPickedRoleNames] = useState(new Set());

  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  // Permissions
  const roleName = (user?.role_name || user?.roleName || user?.role || '').toLowerCase();
  const isAdminish = ['admin', 'administrator', 'md', 'manager'].includes(roleName);
  const isLead = user?.is_department_lead === 1 || user?.isLead === true;

  const allowedModes = useMemo(() => {
    if (isAdminish) return ['all', 'departments', 'roles', 'individuals'];
    if (isLead)     return ['departments', 'individuals'];
    return ['individuals'];
  }, [isAdminish, isLead]);

  useEffect(() => {
    // Default the mode to the first allowed option whenever permissions change.
    if (!allowedModes.includes(mode)) setMode(allowedModes[0]);
  }, [allowedModes, mode]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [emps, depts] = await Promise.all([
          window.electron.getEmployees ? window.electron.getEmployees() : Promise.resolve({ data: [] }),
          window.electron.getDepartments ? window.electron.getDepartments() : Promise.resolve({ data: [] }),
        ]);
        if (cancelled) return;

        let users = (emps?.data || []).filter(u => (u.status || 'active') === 'active' && u.id !== user?.id);
        // Leads only see their own department's roster in the individuals tab.
        if (!isAdminish && isLead && user?.department_id) {
          users = users.filter(u => String(u.department_id || u.departmentId) === String(user.department_id));
        }
        setAllUsers(users);

        let deps = depts?.data || [];
        if (!isAdminish && isLead && user?.department_id) {
          deps = deps.filter(d => String(d.id || d.deptId) === String(user.department_id));
        }
        setDepartments(deps);

        // Derive role list from employee rows (no dedicated handler).
        const roleSet = new Map();
        (emps?.data || []).forEach(u => {
          const r = u.role_name || u.roleName;
          if (r) roleSet.set(r, (roleSet.get(r) || 0) + 1);
        });
        setRoles(Array.from(roleSet.entries()).map(([name]) => ({ name })));
      } catch (e) {
        if (!cancelled) setError(e.message || 'Could not load recipients');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, isAdminish, isLead]);

  const toggleSet = (set, setter) => (id) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setter(next);
  };

  // Roughly estimate recipient count based on current selections.
  const estCount = useMemo(() => {
    if (mode === 'all') return allUsers.length;
    if (mode === 'departments') {
      return allUsers.filter(u => pickedDeptIds.has(u.department_id || u.departmentId)).length;
    }
    if (mode === 'roles') {
      return allUsers.filter(u => pickedRoleNames.has(u.role_name || u.roleName)).length;
    }
    return pickedUserIds.size;
  }, [mode, allUsers, pickedDeptIds, pickedRoleNames, pickedUserIds]);

  const send = async () => {
    setError('');
    if (!content.trim()) {
      setError('Type a message before sending.');
      return;
    }
    if (estCount === 0) {
      setError('Pick at least one recipient.');
      return;
    }
    if (estCount > 0 && mode === 'all' && !window.confirm(`Send this to all ${estCount} employees?`)) return;

    const recipients = {};
    if (mode === 'all')          recipients.all = true;
    if (mode === 'departments')  recipients.departmentIds = Array.from(pickedDeptIds);
    if (mode === 'roles')        recipients.roleNames     = Array.from(pickedRoleNames);
    if (mode === 'individuals')  recipients.userIds       = Array.from(pickedUserIds);

    setSending(true);
    try {
      const r = await window.electron.chatBroadcast(user.id, recipients, content.trim());
      if (r?.success) {
        window.toast?.success?.(`Broadcast sent to ${r.delivered}${r.failed ? ` (${r.failed} failed)` : ''}`);
        setContent('');
        setPickedUserIds(new Set());
        setPickedDeptIds(new Set());
        setPickedRoleNames(new Set());
        onSent?.();
        onClose?.();
      } else {
        setError(r?.message || 'Broadcast failed');
      }
    } catch (e) {
      setError(e.message || 'Broadcast failed');
    } finally {
      setSending(false);
    }
  };

  // ---- styles ----------------------------------------------------------------
  const overlay = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center'
  };
  const card = {
    background: 'var(--bg-2, #1f2937)', color: 'var(--text, #f3f4f6)',
    width: 'min(640px, 95vw)', maxHeight: '90vh', overflowY: 'auto',
    padding: '22px 26px', borderRadius: 12,
    boxShadow: '0 18px 50px rgba(0,0,0,0.45)',
    border: '1px solid rgba(255,255,255,0.08)'
  };
  const tabBtn = (active) => ({
    padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
    background: active ? '#3b82f6' : 'rgba(255,255,255,0.05)',
    color: active ? '#fff' : 'var(--text-2, #cbd5e1)',
    border: '1px solid ' + (active ? '#3b82f6' : 'rgba(255,255,255,0.1)'),
    fontSize: 13, fontWeight: 600
  });
  const pickRow = (selected) => ({
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
    background: selected ? 'rgba(59,130,246,0.12)' : 'transparent',
    border: '1px solid ' + (selected ? 'rgba(59,130,246,0.35)' : 'transparent')
  });

  return (
    <div className="modal-overlay" style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 19 }}>📣 Broadcast Message</h2>
          <button onClick={onClose}
            style={{ background: 'transparent', color: 'inherit', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>
            ✕
          </button>
        </div>
        <p style={{ margin: '2px 0 14px', fontSize: 12.5, color: 'var(--text-2, #9ca3af)' }}>
          One message → many recipients. A 1-to-1 chat is created with each person if needed.
        </p>

        {/* Mode tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          {allowedModes.includes('all')         && <div style={tabBtn(mode === 'all')}         onClick={() => setMode('all')}>Everyone</div>}
          {allowedModes.includes('departments') && <div style={tabBtn(mode === 'departments')} onClick={() => setMode('departments')}>By Department</div>}
          {allowedModes.includes('roles')       && <div style={tabBtn(mode === 'roles')}       onClick={() => setMode('roles')}>By Role</div>}
          {allowedModes.includes('individuals') && <div style={tabBtn(mode === 'individuals')} onClick={() => setMode('individuals')}>Pick People</div>}
        </div>

        {/* Recipient pickers */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '10px 12px', marginBottom: 14, maxHeight: 240, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ fontSize: 13, color: 'var(--text-2, #9ca3af)' }}>Loading…</div>
          ) : mode === 'all' ? (
            <div style={{ fontSize: 13, color: 'var(--text-2, #cbd5e1)' }}>
              This will send to <strong>{allUsers.length}</strong> active employee{allUsers.length === 1 ? '' : 's'} (excluding you).
            </div>
          ) : mode === 'departments' ? (
            departments.length === 0
              ? <div style={{ fontSize: 13, color: 'var(--text-2, #9ca3af)' }}>No departments available.</div>
              : departments.map(d => {
                  const id = d.id || d.deptId;
                  const checked = pickedDeptIds.has(id);
                  return (
                    <div key={id} style={pickRow(checked)} onClick={() => toggleSet(pickedDeptIds, setPickedDeptIds)(id)}>
                      <input type="checkbox" checked={checked} readOnly />
                      <span style={{ flex: 1 }}>{d.name || d.department_name || id}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-2, #9ca3af)' }}>
                        {allUsers.filter(u => String(u.department_id || u.departmentId) === String(id)).length} ppl
                      </span>
                    </div>
                  );
                })
          ) : mode === 'roles' ? (
            roles.length === 0
              ? <div style={{ fontSize: 13, color: 'var(--text-2, #9ca3af)' }}>No roles available.</div>
              : roles.map(r => {
                  const checked = pickedRoleNames.has(r.name);
                  return (
                    <div key={r.id || r.name} style={pickRow(checked)} onClick={() => toggleSet(pickedRoleNames, setPickedRoleNames)(r.name)}>
                      <input type="checkbox" checked={checked} readOnly />
                      <span style={{ flex: 1 }}>{r.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-2, #9ca3af)' }}>
                        {allUsers.filter(u => (u.role_name || u.roleName) === r.name).length} ppl
                      </span>
                    </div>
                  );
                })
          ) : (
            allUsers.length === 0
              ? <div style={{ fontSize: 13, color: 'var(--text-2, #9ca3af)' }}>No employees to pick from.</div>
              : allUsers.map(u => {
                  const checked = pickedUserIds.has(u.id);
                  return (
                    <div key={u.id} style={pickRow(checked)} onClick={() => toggleSet(pickedUserIds, setPickedUserIds)(u.id)}>
                      <input type="checkbox" checked={checked} readOnly />
                      <span style={{ flex: 1 }}>{u.full_name || u.fullName}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-2, #9ca3af)' }}>
                        {u.department_name || u.department || ''}
                      </span>
                    </div>
                  );
                })
          )}
        </div>

        {/* Compose */}
        <label style={{ fontSize: 12, color: 'var(--text-2, #cbd5e1)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>
          Message
        </label>
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="Type your message — same body goes to every recipient."
          rows={5}
          maxLength={4000}
          style={{
            width: '100%',
            marginTop: 6,
            padding: '10px 12px',
            background: 'rgba(0,0,0,0.25)',
            color: 'var(--text, #f3f4f6)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 8,
            fontSize: 14,
            fontFamily: 'inherit',
            resize: 'vertical'
          }}
        />
        <div style={{ fontSize: 11, color: 'var(--text-2, #9ca3af)', marginTop: 4, textAlign: 'right' }}>
          {content.length} / 4000
        </div>

        {error && (
          <div style={{
            marginTop: 10, padding: '8px 12px',
            background: 'rgba(239,68,68,0.12)',
            border: '1px solid rgba(239,68,68,0.35)',
            borderRadius: 6, color: '#fecaca', fontSize: 12.5
          }}>
            {error}
          </div>
        )}

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--text-2, #cbd5e1)' }}>
            Recipients: <strong style={{ color: 'var(--text, #f3f4f6)' }}>{estCount}</strong>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} disabled={sending} className="btn btn-secondary" style={{ padding: '8px 14px' }}>
              Cancel
            </button>
            <button onClick={send} disabled={sending || estCount === 0 || !content.trim()} className="btn btn-primary" style={{ padding: '8px 16px' }}>
              {sending ? 'Sending…' : `📣 Send to ${estCount || 0}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BroadcastComposerModal;
