/**
 * Tiny iCalendar (.ics) generator for leave requests.
 *
 * RFC-5545 minimal subset — enough for Outlook, Google Calendar, Apple
 * Calendar to render an all-day event spanning the leave window. We don't
 * pull in a full ics library because the format is simple and the bundle
 * footprint matters on the web build.
 *
 * Usage:
 *   const ics = buildIcsCalendar(leaves);  // array of { id, startDate, endDate, leaveTypeName, status, fullName }
 *   downloadIcs(ics, 'tasktango-leaves.ics');
 */

function pad(n) { return String(n).padStart(2, '0'); }

// Convert a YYYY-MM-DD string to the ICS-required YYYYMMDD format.
function toIcsDate(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return `${m[1]}${m[2]}${m[3]}`;
}

// DTEND on an all-day event is EXCLUSIVE — to cover up-to-and-including
// the leave end date, we need to advance by one day.
function nextDay(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return toIcsDate(d.toISOString().split('T')[0]);
}

// RFC-5545 line folding: lines > 75 octets must wrap.
function fold(line) {
  if (line.length <= 75) return line;
  const out = [];
  let i = 0;
  while (i < line.length) {
    out.push((i === 0 ? '' : ' ') + line.slice(i, i + 73));
    i += 73;
  }
  return out.join('\r\n');
}

function escape(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function buildIcsCalendar(leaves = [], { calendarName = 'TaskTango Leaves' } = {}) {
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth()+1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TaskTango//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    fold(`X-WR-CALNAME:${escape(calendarName)}`),
    'X-WR-TIMEZONE:Asia/Kolkata'
  ];

  for (const lv of leaves) {
    const dtStart = toIcsDate(lv.startDate || lv.start_date);
    const dtEnd   = nextDay(lv.endDate || lv.end_date);
    if (!dtStart || !dtEnd) continue;
    const summary = `${lv.fullName || lv.full_name || 'Leave'} — ${lv.leaveTypeName || lv.leave_type_name || 'Leave'}`;
    const status = String(lv.status || '').toUpperCase();
    const description = `${lv.leaveTypeName || ''} · ${lv.daysCount || lv.days_count || '?'} days · ${status}`;
    const uid = `${lv.id || (dtStart + Math.random().toString(36).slice(2, 8))}@tasktango`;
    lines.push('BEGIN:VEVENT');
    lines.push(fold(`UID:${uid}`));
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART;VALUE=DATE:${dtStart}`);
    lines.push(`DTEND;VALUE=DATE:${dtEnd}`);
    lines.push(fold(`SUMMARY:${escape(summary)}`));
    lines.push(fold(`DESCRIPTION:${escape(description)}`));
    lines.push(`STATUS:${status === 'APPROVED' ? 'CONFIRMED' : status === 'PENDING' ? 'TENTATIVE' : 'CANCELLED'}`);
    lines.push('TRANSP:TRANSPARENT');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

function downloadIcs(icsString, filename = 'tasktango-leaves.ics') {
  const blob = new Blob([icsString], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { buildIcsCalendar, downloadIcs };
