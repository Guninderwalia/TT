// Pulse v5.2 — single source of truth for time/date formatting.
//
// The DB stores sign-in/out and break times as "HH:MM:SS" (or "HH:MM") TIME
// strings, NOT ISO datetimes. Several components historically reimplemented
// their own formatter with `new Date("09:00:00")` — which is Invalid Date —
// causing the "Invalid Date" bug in the attendance table. Import these helpers
// instead of writing new ones.

// "H:MM" / "HH:MM" / "HH:MM:SS" → minutes since midnight (or null).
export function hmToMinutes(value) {
  if (!value || typeof value !== 'string') return null;
  const m = value.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// Format a time value as a friendly 12-hour string, e.g. "9:05 AM".
// Accepts "HH:MM[:SS]" TIME strings (the DB shape) and ISO datetimes.
// Returns '-' for blank / unparseable input.
export function formatTime12h(value) {
  if (!value) return '-';
  if (typeof value === 'string' && /^\d{1,2}:\d{2}(:\d{2})?$/.test(value)) {
    const [h, m] = value.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour12 = ((h + 11) % 12) + 1;
    return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
  }
  const date = new Date(value);
  if (isNaN(date.getTime())) return '-';
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

// Format a YYYY-MM-DD date string as "Mon, 1 Jun, 2026". Anchored at local
// midnight to avoid timezone slippage. Returns '-' for blank input.
export function formatDateLong(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString + 'T00:00:00');
  if (isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString('en-IN', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

// Decimal hours between two time values (TIME strings or ISO). null if either
// is missing or end is not after start.
export function hoursBetween(inT, outT) {
  const a = hmToMinutes(inT);
  const b = hmToMinutes(outT);
  if (a === null || b === null || b <= a) return null;
  return (b - a) / 60;
}

// "X.XX hrs" worked between two times, or '-' when not computable.
export function formatHoursWorked(inT, outT) {
  const h = hoursBetween(inT, outT);
  return h === null ? '-' : `${h.toFixed(2)} hrs`;
}
