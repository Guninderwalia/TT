import React, { useState, useEffect } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import EmployeeManager from '../components/admin/EmployeeManager';
import DepartmentManager from '../components/admin/DepartmentManager';
import PayrollManager from '../components/admin/PayrollManager';
import AttendanceTracker from '../components/admin/AttendanceTracker';
import AuditDashboard from '../components/admin/AuditDashboard';
import DepositDashboard from '../components/admin/DepositDashboard';
import AdminTimeLogging from '../components/admin/AdminTimeLogging';
import AdminPerformanceReview from '../components/admin/AdminPerformanceReview';
import HolidayManagement from '../components/admin/HolidayManagement';
import AdminLeaveApprovals from '../components/admin/AdminLeaveApprovals';
import ChatWidget from '../components/common/ChatWidget';
import logoImage from '../assets/logo.png';
import NotificationBell from '../components/common/NotificationBell';
import QuickSignInChip from '../components/common/QuickSignInChip';
import SettingsPage from '../components/admin/SettingsPage';
import CelebrationsWidget from '../components/common/CelebrationsWidget';
import OrgChart from '../components/common/OrgChart';
import {
  HeadcountChart,
  AttendanceTodayChart,
  AttendanceTrendChart,
  TeamLiveStatusChart,
  deriveTeamMemberStatus
} from '../components/common/DashboardCharts';
import Avatar from '../components/common/Avatar';
// v4.4.3: "today" must match the office timezone so dashboard widgets
// see the same calendar day the backend stamped rows under.
import { getOfficeDate } from '../utils/officeTime';
import '../styles/dashboard.css';

function AdminDashboard({ user, onLogout }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeNav, setActiveNav] = useState('dashboard');
  // The user object that flows in from auth doesn't always include the
  // profile picture (the session is created before the picture is uploaded
  // / changed). Pull a fresh employee record once so the header avatar shows
  // the up-to-date picture.
  const [myPicture, setMyPicture] = useState(
    user?.profile_picture_path || user?.profilePicturePath || ''
  );

  useEffect(() => {
    const path = location.pathname.split('/')[1];
    setActiveNav(path || 'dashboard');
  }, [location]);

  useEffect(() => {
    let cancelled = false;
    if (user?.id && !myPicture) {
      window.electron.getEmployeeById(user.id).then(res => {
        if (cancelled) return;
        const pic = res?.data?.profile_picture_path || res?.data?.profilePicturePath || '';
        if (pic) setMyPicture(pic);
      }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [user?.id]);

  const handleLogout = async () => {
    await window.electron.logout();
    onLogout();
  };

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: 'grid', path: '/' },
    { id: 'employees', label: 'Employees', icon: 'users', path: '/employees' },
    { id: 'departments', label: 'Departments', icon: 'layers', path: '/departments' },
    { id: 'attendance', label: 'Attendance', icon: 'calendar', path: '/attendance' },
    { id: 'holidays', label: 'Holidays', icon: 'gift', path: '/holidays' },
    { id: 'leave-approvals', label: 'Leave Approvals', icon: 'check-circle', path: '/leave-approvals' },
    { id: 'timelogging', label: 'Time Logging', icon: 'clock', path: '/timelogging' },
    { id: 'performance', label: 'Performance Review', icon: 'bar-chart-2', path: '/performance' },
    { id: 'payroll', label: 'Payroll', icon: 'dollar-sign', path: '/payroll' },
    { id: 'deposits', label: 'Security Deposits', icon: 'lock', path: '/deposits' },
    { id: 'audit', label: 'Audit Logs', icon: 'shield', path: '/audit' },
    { id: 'org-chart', label: 'Org Chart', icon: 'sitemap', path: '/org-chart' },
    { id: 'settings', label: 'Settings', icon: 'settings', path: '/settings' },
  ];

  return (
    <div className="dashboard-shell">
      <Sidebar
        user={user}
        navItems={navItems}
        activeNav={activeNav}
        onNavChange={(id) => {
          setActiveNav(id);
          navigate(`/${id === 'dashboard' ? '' : id}`);
        }}
        onLogout={handleLogout}
      />

      <div className="dashboard-content">
        <div className="dashboard-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
          <div style={{ flex: 1 }}>
            <h1>{user.role_name === 'MD' ? 'Managing Director Dashboard' : 'Administrator Dashboard'}</h1>
            <p className="welcome-text">Welcome back, {user.fullName}</p>
          </div>
          <QuickSignInChip user={user} />
          <ChatWidget user={user} mode="header" />
          <NotificationBell user={user} />
          {/* Bigger header avatar — shows uploaded picture, falls back to initial */}
          <div style={{
            width: 80, height: 80, borderRadius: '50%', overflow: 'hidden',
            background: '#f59e0b', color: '#ffffff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '32px', fontWeight: 700, flexShrink: 0,
            border: '3px solid rgba(255,255,255,0.15)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.25)'
          }}>
            {myPicture ? (
              <img
                src={myPicture}
                alt={user.fullName}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            ) : (
              (user.fullName || '?').charAt(0).toUpperCase()
            )}
          </div>
        </div>

        <div className="dashboard-main">
          {/* Logo Watermark */}
          <div className="logo-watermark">
            <img src={logoImage} alt="Task Tango Watermark" />
          </div>

          <Routes>
            <Route path="/" element={<AdminOverview user={user} />} />
            <Route path="/employees/*" element={<EmployeeManager user={user} />} />
            <Route path="/departments/*" element={<DepartmentManager />} />
            <Route path="/attendance/*" element={<AttendanceTracker user={user} />} />
            <Route path="/holidays/*" element={<HolidayManagement />} />
            <Route path="/leave-approvals/*" element={<AdminLeaveApprovals user={user} />} />
            <Route path="/timelogging/*" element={<AdminTimeLogging />} />
            <Route path="/performance/*" element={<AdminPerformanceReview user={user} />} />
            <Route path="/payroll/*" element={<PayrollManager />} />
            <Route path="/deposits/*" element={<DepositDashboard user={user} />} />
            <Route path="/audit/*" element={<AuditDashboard />} />
            <Route path="/org-chart/*" element={<OrgChart />} />
            <Route path="/settings/*" element={<SettingsPage user={user} />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

function AdminOverview({ user }) {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    totalEmployees: 0,
    departments: 0,
    activeLeaveRequests: 0,
    pendingPayrolls: 0
  });
  const [upcomingLeaves, setUpcomingLeaves] = useState([]);
  // Employees whose probation ends in the next 30 days — admin reminder to
  // flip the "Probation Completed" flag once they pass.
  const [probationSoon, setProbationSoon] = useState([]);
  // Chart datasets
  const [chartEmployees, setChartEmployees] = useState([]);
  const [chartDepartments, setChartDepartments] = useState([]);
  const [attendanceToday, setAttendanceToday] = useState([]);
  const [summary30d, setSummary30d] = useState([]);
  // v4.2: company-wide live "who's on right now" snapshot.
  const [companyToday, setCompanyToday] = useState([]);
  // v4.7.1 — true if today is Sat/Sun or a public holiday. Drives the
  // "On Holiday" label on the live status widget so the dashboard doesn't
  // turn red on weekends.
  // v4.7.3 — nonWorkingLabel carries the day name ('Sunday') or
  // holiday name ('Diwali') so the pill says something meaningful.
  const [isNonWorkingToday, setIsNonWorkingToday] = useState(false);
  const [nonWorkingLabel, setNonWorkingLabel] = useState(null);

  useEffect(() => {
    const loadStats = async () => {
      try {
        // Office-zone "today" so we agree with what the backend wrote.
        const todayIso = getOfficeDate();
        // 30-day range start computed from the local Date but converted via
        // office zone — close enough for a 30-day window; the off-by-an-hour
        // at the boundary doesn't matter for the trend chart.
        const startDateObj = new Date();
        startDateObj.setDate(startDateObj.getDate() - 29);
        const startIso = startDateObj.toISOString().split('T')[0];

        const [employees, departments, upcoming, todayAttendance, rangeSummary, companyLive, nonWorking] = await Promise.all([
          window.electron.getEmployees(),
          window.electron.getDepartments(),
          // No departmentId → admin sees ALL upcoming approved leaves
          window.electron.getUpcomingLeaves(),
          window.electron.getAttendanceByDate(todayIso),
          window.electron.getAttendanceRangeSummary(startIso, todayIso),
          // No departmentId → company-wide live snapshot (admins see everyone).
          window.electron.getTeamToday(),
          // v4.7.1 — ask the backend if today is a non-working day so the
          // status widget can show "On Holiday" instead of red "Absent" rows
          // for everyone who didn't sign in.
          window.electron.isTodayNonWorking ? window.electron.isTodayNonWorking() : Promise.resolve({ isNonWorking: false })
        ]);
        setIsNonWorkingToday(!!nonWorking?.isNonWorking);
        setNonWorkingLabel(nonWorking?.label || null);
        setStats({
          totalEmployees: employees.data?.length || 0,
          departments: departments.data?.length || 0,
          activeLeaveRequests: 0,
          pendingPayrolls: 0
        });
        setUpcomingLeaves(Array.isArray(upcoming?.data) ? upcoming.data : []);
        setChartEmployees(Array.isArray(employees?.data) ? employees.data : []);
        setChartDepartments(Array.isArray(departments?.data) ? departments.data : []);
        setAttendanceToday(Array.isArray(todayAttendance?.data) ? todayAttendance.data : []);
        setSummary30d(Array.isArray(rangeSummary?.data) ? rangeSummary.data : []);
        setCompanyToday(Array.isArray(companyLive?.data) ? companyLive.data : []);

        // Probation ending soon — naive client-side calc from joining date.
        // Default probation length is 3 months; we flag anyone still on
        // probation whose probation end falls in the next 30 days.
        try {
          const today = new Date();
          const horizon = new Date();
          horizon.setDate(horizon.getDate() + 30);
          const list = (employees.data || []).filter(emp => {
            const onProb = emp.is_probation === 1 || emp.isProbation === true;
            if (!onProb) return false;
            const joined = emp.joiningDate ? new Date(emp.joiningDate) : null;
            const probEnd = emp.probation_end_date ? new Date(emp.probation_end_date) : null;
            const endDate = probEnd || (joined ? new Date(joined.getFullYear(), joined.getMonth() + 3, joined.getDate()) : null);
            return endDate && endDate >= today && endDate <= horizon;
          }).map(emp => {
            const joined = new Date(emp.joiningDate);
            const probEnd = emp.probation_end_date
              ? new Date(emp.probation_end_date)
              : new Date(joined.getFullYear(), joined.getMonth() + 3, joined.getDate());
            return { ...emp, _probEnd: probEnd };
          }).sort((a, b) => a._probEnd - b._probEnd);
          setProbationSoon(list);
        } catch (_) { /* non-fatal */ }
      } catch (error) {
        console.error('Failed to load stats:', error);
      }
    };

    loadStats();
  }, []);

  return (
    <div className="overview-container">
      <div className="stats-grid">
        <div className="stat-card" onClick={() => navigate('/employees')} style={{cursor: 'pointer'}}>
          <div className="stat-icon">👥</div>
          <div className="stat-content">
            <h3>Total Employees</h3>
            <p className="stat-number">{stats.totalEmployees}</p>
          </div>
        </div>
        <div className="stat-card" onClick={() => navigate('/departments')} style={{cursor: 'pointer'}}>
          <div className="stat-icon">🏢</div>
          <div className="stat-content">
            <h3>Departments</h3>
            <p className="stat-number">{stats.departments}</p>
          </div>
        </div>
        <div className="stat-card" onClick={() => navigate('/audit')} style={{cursor: 'pointer'}}>
          <div className="stat-icon">📋</div>
          <div className="stat-content">
            <h3>Activity Logs</h3>
            <p className="stat-number">{stats.activeLeaveRequests}</p>
          </div>
        </div>
        <div className="stat-card" onClick={() => navigate('/payroll')} style={{cursor: 'pointer'}}>
          <div className="stat-icon">💰</div>
          <div className="stat-content">
            <h3>Payroll Management</h3>
            <p className="stat-number">{stats.pendingPayrolls}</p>
          </div>
        </div>
      </div>

      {/* v4.2 — Company-wide live snapshot. Doughnut + per-employee roster
          with department + status pill, so admin can see at a glance who's
          working, on a break, signed off, absent, or on leave right now.
          Sits ABOVE the historical Analytics block to mirror the lead view. */}
      <h3 style={{ marginTop: '24px', marginBottom: '8px', color: 'var(--text)' }}>Live Employee Status</h3>
      <div className="charts-grid">
        <TeamLiveStatusChart teamRows={companyToday} title="Company Status — Right Now" isNonWorkingDay={isNonWorkingToday} nonWorkingLabel={nonWorkingLabel} />
        <div className="chart-card">
          <h3 className="chart-card-title">Who's On Right Now</h3>
          <div className="chart-card-body" style={{ height: 260, overflowY: 'auto', padding: '4px 2px' }}>
            {companyToday.length === 0 ? (
              <div className="chart-empty">No employees yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {companyToday.map(row => {
                  const s = deriveTeamMemberStatus(row, isNonWorkingToday, nonWorkingLabel);
                  return (
                    <div key={row.userId} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 10px',
                      background: 'var(--bg-3)',
                      borderRadius: 8,
                      borderLeft: `3px solid ${s.color}`
                    }}>
                      <Avatar src={row.profilePicturePath} name={row.fullName} size={32} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.fullName}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-2)' }}>
                          {row.departmentName || '—'}
                          {row.startTime ? ` · In: ${row.startTime}` : ''}
                          {row.endTime ? ` · Out: ${row.endTime}` : ''}
                        </div>
                      </div>
                      <span style={{
                        background: s.color, color: '#fff',
                        fontSize: 11, fontWeight: 700,
                        padding: '3px 9px', borderRadius: 999,
                        whiteSpace: 'nowrap'
                      }}>{s.label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Analytics charts — at-a-glance look at headcount distribution,
          today's attendance, and the 30-day trend. */}
      <h3 style={{ marginTop: '24px', marginBottom: '8px', color: 'var(--text)' }}>Analytics</h3>
      <div className="charts-grid wide-first">
        <AttendanceTrendChart summary={summary30d} days={30} />
        <HeadcountChart employees={chartEmployees} departments={chartDepartments} />
        <AttendanceTodayChart attendanceRows={attendanceToday} />
      </div>

      {/* Probation reminders — flag employees whose probation ends in the
          next 30 days, so admin can flip the flag at the right time. */}
      {probationSoon.length > 0 && (
        <>
          <h3 style={{ marginTop: '24px', marginBottom: '8px', color: 'var(--text)' }}>⏳ Probation Ending Soon</h3>
          <div className="form-section" style={{ marginTop: '8px' }}>
            <table className="table" style={{ marginBottom: 0 }}>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Joined</th>
                  <th>Probation Ends</th>
                  <th>Days Left</th>
                </tr>
              </thead>
              <tbody>
                {probationSoon.map(emp => {
                  const days = Math.ceil((emp._probEnd - new Date()) / (1000 * 60 * 60 * 24));
                  return (
                    <tr key={emp.id}>
                      <td>{emp.fullName}</td>
                      <td>{emp.joiningDate}</td>
                      <td>{emp._probEnd.toISOString().split('T')[0]}</td>
                      <td>
                        <span style={{
                          padding: '2px 8px', borderRadius: 10, fontWeight: 700,
                          background: days <= 7 ? '#fee2e2' : '#fef3c7',
                          color:      days <= 7 ? '#7f1d1d' : '#78350f'
                        }}>{days} day{days !== 1 ? 's' : ''}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Birthdays + work anniversaries — company-wide for admins */}
      <CelebrationsWidget />

      {/* Upcoming Leaves — company-wide so admins can plan around absences */}
      <div style={{ marginTop: '24px', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <h3 style={{ margin: 0, color: 'var(--text)' }}>Upcoming Leaves (Company-wide)</h3>
        {upcomingLeaves.length > 0 && (
          <button
            type="button"
            onClick={async () => {
              const { buildIcsCalendar, downloadIcs } = await import('../utils/icsExport');
              downloadIcs(
                buildIcsCalendar(upcomingLeaves, { calendarName: 'TaskTango — Company Leaves' }),
                'tasktango-company-leaves.ics'
              );
            }}
            className="btn btn-secondary"
            style={{ padding: '6px 12px', fontSize: 12 }}
            title="Download as .ics for Outlook / Google Calendar / Apple Calendar"
          >📅 Export to Calendar</button>
        )}
      </div>
      <div className="form-section" style={{ marginTop: '8px' }}>
        {upcomingLeaves.length === 0 ? (
          <p style={{ color: 'var(--text-2)', margin: 0 }}>No upcoming approved leaves.</p>
        ) : (
          <table className="table" style={{ marginBottom: 0 }}>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Department</th>
                <th>From</th>
                <th>To</th>
                <th>Days</th>
                <th>Type</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {upcomingLeaves.map(lv => (
                <tr key={lv.id}>
                  <td>{lv.full_name}</td>
                  <td>{lv.department_name || '-'}</td>
                  <td>{lv.start_date}</td>
                  <td>{lv.end_date}</td>
                  <td>{lv.days_count}</td>
                  <td>
                    {lv.leave_type_name}
                    {(lv.reason || '').includes('[UNPAID') && (
                      <span style={{ marginLeft: 6, fontSize: '11px', padding: '2px 6px', borderRadius: 8, background: '#fef3c7', color: '#78350f', fontWeight: 700 }}>
                        UNPAID
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`badge badge-${lv.status === 'approved' ? 'success' : 'warning'}`}>
                      {lv.status === 'approved' ? 'Approved' : 'Pending Final'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="welcome-section">
        <h2>System Status</h2>
        <div className="status-list">
          <div className="status-item">
            <span className="status-badge ok">✓</span>
            <span>Database Connection: Active</span>
          </div>
          <div className="status-item">
            <span className="status-badge ok">✓</span>
            <span>Offline Mode: Enabled</span>
          </div>
          <div className="status-item">
            <span className="status-badge ok">✓</span>
            <span>Data Encryption: Active</span>
          </div>
          <div className="status-item">
            <span className="status-badge ok">✓</span>
            <span>Audit Logging: Enabled</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AdminDashboard;
