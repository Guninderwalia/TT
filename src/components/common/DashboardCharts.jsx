import React from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Doughnut, Bar, Line } from 'react-chartjs-2';
// v4.7.9 — Show numeric counts directly on chart segments instead of forcing
// users to hover for a tooltip. Registered as an opt-in plugin so the
// cartesian (bar / line) charts aren't cluttered with floating numbers —
// only the doughnut charts below set `plugins.datalabels.display = true`.
import ChartDataLabels from 'chartjs-plugin-datalabels';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  ChartDataLabels
);

const PALETTE = {
  present: '#10b981',
  absent:  '#ef4444',
  leave:   '#f59e0b',
  halfDay: '#a78bfa',
  gold:    '#f59e0b',
  blue:    '#1b7ba8',
  teal:    '#14b8a6',
  purple:  '#a78bfa',
  pink:    '#ec4899',
  amber:   '#fbbf24',
  green:   '#22c55e',
  red:     '#f87171'
};

const TEXT_COLOR = '#b3d4e8';
const GRID_COLOR = 'rgba(255,255,255,0.06)';

const baseOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: TEXT_COLOR, font: { size: 12 } } },
    title:  { display: false },
    // ChartDataLabels is registered globally so every chart sees it. Default
    // it OFF so bar / line charts stay clean; doughnut charts opt in below.
    datalabels: { display: false }
  }
};

// v4.7.9 — Doughnut overlay: white number on each slice, but hide the label
// when the slice is zero (avoids a row of "0"s when nothing has happened
// today) or so small it would overflow.
const doughnutOptions = {
  ...baseOptions,
  plugins: {
    ...baseOptions.plugins,
    datalabels: {
      display: (ctx) => {
        const v = ctx.dataset.data[ctx.dataIndex];
        if (!v) return false;
        const total = ctx.dataset.data.reduce((a, b) => a + (Number(b) || 0), 0);
        return total > 0 && (v / total) >= 0.04; // hide labels on <4% slices
      },
      color: '#fff',
      font: { weight: '700', size: 13 },
      formatter: (value) => value
    }
  }
};

const cartesianOptions = {
  ...baseOptions,
  scales: {
    x: { ticks: { color: TEXT_COLOR }, grid: { color: GRID_COLOR } },
    y: { ticks: { color: TEXT_COLOR }, grid: { color: GRID_COLOR }, beginAtZero: true }
  }
};

export function ChartCard({ title, height = 260, children, isEmpty }) {
  // Pulse v2 — ref to the chart body so the Export PDF button can grab the
  // underlying <canvas> and export it on the dark theme (no more white sheets).
  const bodyRef = React.useRef(null);
  const handleExport = async () => {
    const { exportChartElementToPdf } = await import('../../utils/chartPdf');
    await exportChartElementToPdf(bodyRef.current, title);
  };
  return (
    <div className="chart-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h3 className="chart-card-title" style={{ margin: 0 }}>{title}</h3>
        {!isEmpty && (
          <button
            onClick={handleExport}
            title="Export this chart as a PDF"
            style={{
              fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
              background: 'rgba(255,255,255,0.08)', color: 'inherit',
              border: '1px solid rgba(255,255,255,0.15)'
            }}
          >
            📄 Export PDF
          </button>
        )}
      </div>
      <div ref={bodyRef} className="chart-card-body" style={{ height }}>
        {isEmpty
          ? <div className="chart-empty">No data yet</div>
          : children}
      </div>
    </div>
  );
}

// A1 — Headcount by Department (doughnut)
export function HeadcountChart({ employees = [], departments = [] }) {
  const counts = {};
  for (const emp of employees) {
    const deptId = emp.department_id || emp.departmentId;
    if (deptId) counts[deptId] = (counts[deptId] || 0) + 1;
  }
  const labels = [];
  const data = [];
  for (const dept of departments) {
    labels.push(dept.name);
    data.push(counts[dept.id] || 0);
  }
  const colors = [PALETTE.blue, PALETTE.teal, PALETTE.gold, PALETTE.purple, PALETTE.pink, PALETTE.amber, PALETTE.green, PALETTE.red];
  const isEmpty = !data.length || data.every(v => v === 0);
  return (
    <ChartCard title="Headcount by Department" isEmpty={isEmpty}>
      <Doughnut
        data={{
          labels,
          datasets: [{ data, backgroundColor: colors.slice(0, labels.length), borderWidth: 0 }]
        }}
        options={doughnutOptions}
      />
    </ChartCard>
  );
}

// A2 / L1 — Today's Attendance breakdown (doughnut)
export function AttendanceTodayChart({ attendanceRows = [], title = "Today's Attendance" }) {
  let present = 0, absent = 0, onLeave = 0, halfDay = 0;
  for (const r of attendanceRows) {
    const status = (r.status || '').toLowerCase();
    if (r.isHalfDay || r.is_half_day === 1) halfDay++;
    else if (status === 'present') present++;
    else if (status === 'absent')  absent++;
    else if (status === 'leave')   onLeave++;
  }
  const data = [present, absent, onLeave, halfDay];
  const isEmpty = data.every(v => v === 0);
  return (
    <ChartCard title={title} isEmpty={isEmpty}>
      <Doughnut
        data={{
          labels: ['Present', 'Absent', 'Leave', 'Half-day'],
          datasets: [{
            data,
            backgroundColor: [PALETTE.present, PALETTE.absent, PALETTE.leave, PALETTE.halfDay],
            borderWidth: 0
          }]
        }}
        options={doughnutOptions}
      />
    </ChartCard>
  );
}

// Build labels + datasets for a date range from the range-summary payload.
// Fills zero-rows for any date with no attendance recorded so the axis is continuous.
function buildRangeSeries({ summary, days, labelFormatter }) {
  const byDate = new Map();
  for (const r of summary) byDate.set(r.date, r);

  const today = new Date();
  const labels = [];
  const present = [];
  const absent  = [];
  const onLeave = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const iso = d.toISOString().split('T')[0];
    const row = byDate.get(iso) || {};
    labels.push(labelFormatter(d));
    present.push(Number(row.present) || 0);
    absent.push(Number(row.absent)   || 0);
    onLeave.push(Number(row.on_leave) || 0);
  }
  const isEmpty = present.every(v => v === 0)
               && absent.every(v => v === 0)
               && onLeave.every(v => v === 0);
  return { labels, present, absent, onLeave, isEmpty };
}

// A3 — 30-day attendance trend (stacked area line)
export function AttendanceTrendChart({ summary = [], days = 30, title }) {
  const labelFormatter = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const { labels, present, absent, onLeave, isEmpty } = buildRangeSeries({ summary, days, labelFormatter });
  const datasets = [
    { label: 'Present', data: present, borderColor: PALETTE.present, backgroundColor: PALETTE.present + '55', fill: true, tension: 0.25, pointRadius: 0 },
    { label: 'Absent',  data: absent,  borderColor: PALETTE.absent,  backgroundColor: PALETTE.absent  + '55', fill: true, tension: 0.25, pointRadius: 0 },
    { label: 'Leave',   data: onLeave, borderColor: PALETTE.leave,   backgroundColor: PALETTE.leave   + '55', fill: true, tension: 0.25, pointRadius: 0 }
  ];
  const options = {
    ...cartesianOptions,
    scales: {
      x: { ...cartesianOptions.scales.x, stacked: true, ticks: { ...cartesianOptions.scales.x.ticks, maxTicksLimit: 10 } },
      y: { ...cartesianOptions.scales.y, stacked: true }
    }
  };
  return (
    <ChartCard title={title || `Attendance — Last ${days} Days`} height={280} isEmpty={isEmpty}>
      <Line data={{ labels, datasets }} options={options} />
    </ChartCard>
  );
}

// L2 — Team attendance this week (stacked bar)
export function WeeklyAttendanceChart({ summary = [], days = 7, title = 'Team Attendance — This Week' }) {
  const labelFormatter = (d) => d.toLocaleDateString(undefined, { weekday: 'short' });
  const { labels, present, absent, onLeave, isEmpty } = buildRangeSeries({ summary, days, labelFormatter });
  const datasets = [
    { label: 'Present', data: present, backgroundColor: PALETTE.present, stack: 's' },
    { label: 'Absent',  data: absent,  backgroundColor: PALETTE.absent,  stack: 's' },
    { label: 'Leave',   data: onLeave, backgroundColor: PALETTE.leave,   stack: 's' }
  ];
  const options = {
    ...cartesianOptions,
    scales: {
      x: { ...cartesianOptions.scales.x, stacked: true },
      y: { ...cartesianOptions.scales.y, stacked: true }
    }
  };
  return (
    <ChartCard title={title} isEmpty={isEmpty}>
      <Bar data={{ labels, datasets }} options={options} />
    </ChartCard>
  );
}

// v4.1 — Derive a single status label for a team member from their today
// row (attendance + time_logs). Exported so the roster list can colour-pill
// each name with the same logic the chart uses.
export const TEAM_STATUS = {
  WORKING:     { key: 'working',     label: 'Working',     color: '#10b981' },
  ON_BREAK:    { key: 'on-break',    label: 'On Break',    color: '#f59e0b' },
  SIGNED_OFF:  { key: 'signed-off',  label: 'Signed Off',  color: '#3b82f6' },
  NOT_STARTED: { key: 'not-started', label: 'Not Started', color: '#94a3b8' },
  ABSENT:      { key: 'absent',      label: 'Absent',      color: '#ef4444' },
  ON_LEAVE:    { key: 'on-leave',    label: 'On Leave',    color: '#a78bfa' },
  // v4.7.1 — indigo, distinct from On Leave to avoid confusion. Used when
  // today is Sat/Sun (or in the public_holidays table) for any employee
  // who didn't sign in. Anyone who DID sign in still shows their real
  // status (Working / Signed Off etc.) because sign-in trumps the
  // non-working-day label — they clearly chose to work.
  //
  // v4.7.3 — Label is just "Holiday" by default but dashboards pass the
  // actual day-of-week ('Sunday') or public holiday name ('Diwali') so
  // the pill reads correctly. "On Holiday" was misleading — it sounded
  // like the employee had booked PTO when really it's just the weekend.
  ON_HOLIDAY:  { key: 'on-holiday',  label: 'Holiday',     color: '#6366f1' }
};

// v4.7.1 — Added `isNonWorkingDay` flag. When true, employees who never
// signed in are labelled with the day name (Sunday) or holiday name
// instead of the misleading red "Absent" / "Not Started" pair that
// filled the dashboard every weekend.
//
// v4.7.3 — Optional `nonWorkingLabel` arg overrides the default 'Holiday'
// label so the pill can say 'Sunday' / 'Diwali' / etc.
//
// Sign-in always wins the priority order so someone who works a weekend
// keeps their real status (Working / Signed Off / etc.).
export function deriveTeamMemberStatus(row, isNonWorkingDay = false, nonWorkingLabel = null) {
  const s = (row?.attendanceStatus || '').toLowerCase();
  // Real working signals always come first — they prove the person showed
  // up regardless of what attendance.status says.
  if (s === 'leave')                                return TEAM_STATUS.ON_LEAVE;
  if (row?.endTime)                                 return TEAM_STATUS.SIGNED_OFF;
  if (row?.breakStartTime && !row?.breakEndTime)    return TEAM_STATUS.ON_BREAK;
  if (row?.startTime)                               return TEAM_STATUS.WORKING;
  // No sign-in:
  if (isNonWorkingDay) {
    return nonWorkingLabel
      ? { ...TEAM_STATUS.ON_HOLIDAY, label: nonWorkingLabel }
      : TEAM_STATUS.ON_HOLIDAY;
  }
  if (s === 'absent')                               return TEAM_STATUS.ABSENT;
  return TEAM_STATUS.NOT_STARTED;
}

// New for v4.1 — Live "right now" team status. Doughnut counts grouped by
// the six statuses above. Pair this with the roster list below it in the
// LeadOverview render so leads can see both shape and detail at a glance.
export function TeamLiveStatusChart({ teamRows = [], title = 'Team Status — Right Now', isNonWorkingDay = false, nonWorkingLabel = null }) {
  const counts = {
    [TEAM_STATUS.WORKING.key]:     0,
    [TEAM_STATUS.ON_BREAK.key]:    0,
    [TEAM_STATUS.SIGNED_OFF.key]:  0,
    [TEAM_STATUS.NOT_STARTED.key]: 0,
    [TEAM_STATUS.ABSENT.key]:      0,
    [TEAM_STATUS.ON_LEAVE.key]:    0,
    [TEAM_STATUS.ON_HOLIDAY.key]:  0
  };
  for (const row of teamRows) {
    const s = deriveTeamMemberStatus(row, isNonWorkingDay, nonWorkingLabel);
    counts[s.key]++;
  }
  // v4.7.3 — show the day name (Sunday) or holiday name on the donut
  // legend instead of the generic "Holiday".
  const holidaySlot = nonWorkingLabel
    ? { ...TEAM_STATUS.ON_HOLIDAY, label: nonWorkingLabel }
    : TEAM_STATUS.ON_HOLIDAY;
  const order = [TEAM_STATUS.WORKING, TEAM_STATUS.ON_BREAK, TEAM_STATUS.NOT_STARTED, TEAM_STATUS.SIGNED_OFF, TEAM_STATUS.ABSENT, TEAM_STATUS.ON_LEAVE, holidaySlot];
  const labels = order.map(s => s.label);
  const data   = order.map(s => counts[s.key]);
  const colors = order.map(s => s.color);
  const isEmpty = data.every(v => v === 0);
  return (
    <ChartCard title={title} isEmpty={isEmpty}>
      <Doughnut
        data={{
          labels,
          datasets: [{ data, backgroundColor: colors, borderWidth: 0 }]
        }}
        options={doughnutOptions}
      />
    </ChartCard>
  );
}

// L4 — My hours logged, last 12 weeks (line)
export function MyHoursChart({ timeLogs = [], weeks = 12, title = 'My Hours — Last 12 Weeks' }) {
  // Bucket each log into its Monday-anchored week.
  const mondayOf = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = (day === 0 ? -6 : 1 - day);
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  };
  const isoDate = (d) => d.toISOString().split('T')[0];

  const buckets = {};
  for (const log of timeLogs) {
    const dateField = log.date || (log.start_time && String(log.start_time).slice(0, 10));
    if (!dateField) continue;
    const key = isoDate(mondayOf(dateField));
    const hrs = Number(log.netHours ?? log.net_hours ?? log.totalHours ?? log.total_hours ?? 0);
    if (!Number.isFinite(hrs)) continue;
    buckets[key] = (buckets[key] || 0) + hrs;
  }

  const today = mondayOf(new Date());
  const labels = [];
  const data = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = new Date(today);
    ws.setDate(today.getDate() - i * 7);
    const key = isoDate(ws);
    labels.push(ws.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
    data.push(Math.round((buckets[key] || 0) * 10) / 10);
  }
  const isEmpty = data.every(v => v === 0);
  return (
    <ChartCard title={title} isEmpty={isEmpty}>
      <Line
        data={{
          labels,
          datasets: [{
            label: 'Hours',
            data,
            borderColor: PALETTE.gold,
            backgroundColor: PALETTE.gold + '40',
            fill: true,
            tension: 0.3,
            pointRadius: 3,
            pointBackgroundColor: PALETTE.gold
          }]
        }}
        options={cartesianOptions}
      />
    </ChartCard>
  );
}
