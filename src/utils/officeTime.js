/**
 * Office-zone time helpers.
 *
 * Why this exists:
 *   `new Date()` returns the right UTC instant, but `.getHours()` / `format()`
 *   render in the OS's local timezone. So an employee whose laptop is set to
 *   AEST signs in at 09:00 UK time and the system stamps "19:00" because
 *   Sydney is +10 from UTC and the formatter uses local zone.
 *
 *   Stamping in a *fixed* office zone (Europe/London by default) means the
 *   row reads correctly regardless of where the employee's laptop thinks it
 *   is. The underlying UTC instant is unchanged — only the display string
 *   differs — so cross-timezone teams stay consistent in one canonical zone.
 *
 * This module ALSO supports an optional internet-time offset: call
 * `syncOfficeTimeFromInternet()` once on startup to fetch the true UTC from
 * a public time API and store the delta vs the local clock. Subsequent
 * calls to nowOffice() apply that offset, so even a deliberately-tampered
 * OS clock can't fool the timestamps. Falls back silently to local time
 * when offline.
 *
 * Both renderer and main process import this module via require(); webpack
 * handles the CommonJS interop on the renderer side.
 */

// Default office timezone — India Standard Time. Can be overridden at runtime
// via setOfficeTimezone() (called by the main process after reading the
// 'office_timezone' setting, and by the renderer on mount).
const DEFAULT_OFFICE_TZ = 'Asia/Kolkata';
let _officeTz = DEFAULT_OFFICE_TZ;

/** Override the office timezone at runtime. Pass any IANA zone (e.g.
 *  'Europe/London', 'America/New_York'). Invalid zones fall back to the
 *  default — Intl.DateTimeFormat will throw, so we validate first. */
function setOfficeTimezone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    // Smoke-test by constructing a formatter — throws on invalid zones.
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    _officeTz = tz;
    return true;
  } catch (_) {
    return false;
  }
}
function getOfficeTimezone() { return _officeTz; }

// Cached offset between the trusted source and the local Date.now().
// Positive means the local clock is BEHIND truth; negative means AHEAD.
// 0 (the default) means "we haven't synced yet — use the local clock as-is".
let _internetOffsetMs = 0;
let _lastSyncAt = 0;
let _syncSource = 'local';

function getInternetOffsetMs() { return _internetOffsetMs; }
function getLastSyncAt()       { return _lastSyncAt; }
function getSyncSource()       { return _syncSource; }

/**
 * Returns a Date adjusted by the cached internet offset. When no sync has
 * happened, equivalent to `new Date()`.
 */
function nowOffice() {
  return new Date(Date.now() + _internetOffsetMs);
}

/**
 * Format a Date in the configured office timezone, regardless of OS zone.
 * Uses Intl.DateTimeFormat which is available in both Node (>=14) and every
 * browser we ship to.
 *
 * @param {Date}   date  Defaults to nowOffice() (offset-corrected current time)
 * @param {string} tz    IANA timezone; defaults to Europe/London
 * @returns {{ date: string, hhmm: string, hhmmss: string }}
 *   - date:    YYYY-MM-DD in the office zone
 *   - hhmm:    HH:MM      in the office zone
 *   - hhmmss:  HH:MM:SS   in the office zone
 */
function formatInOfficeZone(date = nowOffice(), tz = _officeTz) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });
  const parts = fmt.formatToParts(date);
  const get = (t) => parts.find(p => p.type === t)?.value || '00';
  // Intl formats hours as "24" at the day boundary in en-GB — coerce to "00"
  // so HH:MM strings round-trip cleanly into SQLite's TIME columns.
  const h = get('hour') === '24' ? '00' : get('hour');
  const m = get('minute');
  const s = get('second');
  const y = get('year');
  const mo = get('month');
  const d = get('day');
  return {
    date:   `${y}-${mo}-${d}`,
    hhmm:   `${h}:${m}`,
    hhmmss: `${h}:${m}:${s}`
  };
}

/** Convenience: today's date in the office zone, as YYYY-MM-DD. */
function getOfficeDate(tz = _officeTz) {
  return formatInOfficeZone(nowOffice(), tz).date;
}
/** Convenience: current time in the office zone, as HH:MM. */
function getOfficeHHMM(tz = _officeTz) {
  return formatInOfficeZone(nowOffice(), tz).hhmm;
}
/** Convenience: current time in the office zone, as HH:MM:SS. */
function getOfficeHHMMSS(tz = _officeTz) {
  return formatInOfficeZone(nowOffice(), tz).hhmmss;
}

/**
 * Fetch true UTC from a public time API and cache the offset between it and
 * the local clock. Subsequent `nowOffice()` calls apply that offset.
 *
 * Tries a couple of free no-auth sources for resilience. Bails silently on
 * any failure (network down, rate limited, etc.) — leaves the offset at 0
 * so the app still works offline using the local clock.
 *
 * Safe to call from both main and renderer (uses fetch which is global in
 * both Node 18+ and browsers).
 */
async function syncOfficeTimeFromInternet() {
  const sources = [
    {
      name: 'worldtimeapi.org',
      url:  'https://worldtimeapi.org/api/timezone/Etc/UTC',
      parse: (j) => j && j.utc_datetime ? new Date(j.utc_datetime).getTime() : null
    },
    {
      name: 'timeapi.io',
      url:  'https://timeapi.io/api/Time/current/zone?timeZone=UTC',
      parse: (j) => j && j.dateTime ? new Date(j.dateTime + 'Z').getTime() : null
    }
  ];
  for (const src of sources) {
    try {
      const res = await fetch(src.url, { method: 'GET' });
      if (!res.ok) continue;
      const json = await res.json();
      const truthMs = src.parse(json);
      if (typeof truthMs !== 'number' || !Number.isFinite(truthMs)) continue;
      _internetOffsetMs = truthMs - Date.now();
      _lastSyncAt = Date.now();
      _syncSource = src.name;
      return { success: true, offsetMs: _internetOffsetMs, source: src.name };
    } catch (_) { /* try next source */ }
  }
  // All sources failed — keep using local clock.
  _syncSource = 'local';
  return { success: false, offsetMs: 0, source: 'local' };
}

module.exports = {
  DEFAULT_OFFICE_TZ,
  setOfficeTimezone,
  getOfficeTimezone,
  nowOffice,
  formatInOfficeZone,
  getOfficeDate,
  getOfficeHHMM,
  getOfficeHHMMSS,
  syncOfficeTimeFromInternet,
  getInternetOffsetMs,
  getLastSyncAt,
  getSyncSource
};
