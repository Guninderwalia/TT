import React from 'react';

/**
 * Small SVG donut showing what fraction of an employee's profile is filled,
 * plus a one-liner of what's missing. Drops onto My Profile, the Edit
 * Employee modal, anywhere a single employee record is in scope.
 *
 * Fields counted (and how to add fresh ones):
 *   - Pick the user-facing fields HR actually wants on file.
 *   - Score is (filled / total) × 100.
 *   - "Missing" list is shown so the user knows exactly what to fill next.
 */

const FIELDS = [
  { key: 'profile_picture_path', label: 'Profile photo',  aliases: ['profilePicturePath'] },
  { key: 'phone',                label: 'Phone number',   aliases: [] },
  { key: 'date_of_birth',        label: 'Date of birth',  aliases: ['dateOfBirth'] },
  { key: 'email',                label: 'Email address',  aliases: [] },
  { key: 'department_id',        label: 'Department',     aliases: ['departmentId'] },
  { key: 'bankAccountNumber',    label: 'Bank account',   aliases: ['account_number'] },
  { key: 'ifscCode',             label: 'Bank IFSC',      aliases: ['ifsc_code'] }
];

function pick(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== null && v !== undefined && String(v).trim() !== '') return v;
  }
  return null;
}

export function calcCompleteness(employee = {}) {
  const filled = [];
  const missing = [];
  for (const f of FIELDS) {
    const v = pick(employee, [f.key, ...f.aliases]);
    if (v) filled.push(f.label); else missing.push(f.label);
  }
  const pct = Math.round((filled.length / FIELDS.length) * 100);
  return { pct, filled, missing, total: FIELDS.length };
}

function ProfileCompleteness({ employee, size = 80, showMissing = true }) {
  const { pct, missing, total, filled } = calcCompleteness(employee || {});

  // Donut geometry.
  const stroke = Math.max(6, Math.round(size * 0.12));
  const radius = (size - stroke) / 2;
  const c = 2 * Math.PI * radius;
  const offset = c * (1 - pct / 100);

  const color = pct >= 90 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#ef4444';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size}>
          {/* Background ring */}
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            stroke="rgba(255,255,255,0.1)"
            strokeWidth={stroke}
            fill="none"
          />
          {/* Foreground ring (rotated -90° so it starts at 12 o'clock) */}
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            fill="none"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: 'stroke-dashoffset 400ms ease' }}
          />
        </svg>
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontSize: Math.round(size * 0.22), color
        }}>{pct}%</div>
      </div>
      {showMissing && (
        <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
          <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
            Profile {pct === 100 ? 'complete' : 'completeness'}
          </div>
          <div>
            {filled.length} of {total} fields filled
            {missing.length > 0 && (
              <>
                {' · still need: '}
                <span style={{ color: '#f59e0b' }}>{missing.slice(0, 3).join(', ')}{missing.length > 3 ? `, +${missing.length - 3} more` : ''}</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ProfileCompleteness;
