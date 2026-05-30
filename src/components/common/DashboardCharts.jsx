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
  Filler
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
    title:  { display: false }
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
  return (
    <div className="chart-card">
      <h3 className="chart-card-title">{title}</h3>
      <div className="chart-card-body" style={{ height }}>
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
        options={baseOptions}
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
        options={baseOptions}
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
  ON_LEAVE:    { key: 'on-leave',    label: 'On Leave',    color: '#a78bfa' }
};

export function deriveTeamMemberStatus(row) {
  const s = (row?.attendanceStatus || '').toLowerCase();
  if (s === 'absent')   return TEAM_STATUS.ABSENT;
  if (s === 'leave')    return TEAM_STATUS.ON_LEAVE;
  if (!row?.startTime)  return TEAM_STATUS.NOT_STARTED;
  if (row?.endTime)     return TEAM_STATUS.SIGNED_OFF;
  if (row?.breakStartTime && !row?.breakEndTime) return TEAM_STATUS.ON_BREAK;
  return TEAM_STATUS.WORKING;
}

// New for v4.1 — Live "right now" team status. Doughnut counts grouped by
// the six statuses above. Pair this with the roster list below it in the
// LeadOverview render so leads can see both shape and detail at a glance.
export function TeamLiveStatusChart({ teamRows = [], title = 'Team Status — Right Now' }) {
  const counts = {
    [TEAM_STATUS.WORKING.key]:     0,
    [TEAM_STATUS.ON_BREAK.key]:    0,
    [TEAM_STATUS.SIGNED_OFF.key]:  0,
    [TEAM_STATUS.NOT_STARTED.key]: 0,
    [TEAM_STATUS.ABSENT.key]:      0,
    [TEAM_STATUS.ON_LEAVE.key]:    0
  };
  for (const row of teamRows) {
    const s = deriveTeamMemberStatus(row);
    counts[s.key]++;
  }
  const order = [TEAM_STATUS.WORKING, TEAM_STATUS.ON_BREAK, TEAM_STATUS.NOT_STARTED, TEAM_STATUS.SIGNED_OFF, TEAM_STATUS.ABSENT, TEAM_STATUS.ON_LEAVE];
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
        options={baseOptions}
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
