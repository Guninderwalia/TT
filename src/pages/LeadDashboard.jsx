import React, { useState, useEffect } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import EmployeeManager from '../components/admin/EmployeeManager';
import DepartmentAttendance from '../components/lead/DepartmentAttendance';
import LeaveApprovalHub from '../components/lead/LeaveApprovalHub';
import TeamPerformance from '../components/lead/TeamPerformance';
import LeadTimeLogging from '../components/lead/LeadTimeLogging';
// Personal-view components reused from the employee dashboard. A team lead is
// also an employee, so they should be able to log their own time, submit their
// own leave, etc. — alongside the team tabs.
import AttendanceLogger from '../components/employee/AttendanceLogger';
import LeaveCalendar from '../components/employee/LeaveCalendar';
import TimeLogging from '../components/employee/TimeLogging';
import EmployeePerformanceReview from '../components/employee/EmployeePerformanceReview';
import EmployeeDocuments from '../components/common/EmployeeDocuments';
import ChatWidget from '../components/common/ChatWidget';
import logoImage from '../assets/logo.png';
import NotificationBell from '../components/common/NotificationBell';
import CelebrationsWidget from '../components/common/CelebrationsWidget';
import {
  AttendanceTodayChart,
  WeeklyAttendanceChart,
  MyHoursChart,
  TeamLiveStatusChart,
  deriveTeamMemberStatus
} from '../components/common/DashboardCharts';
import Avatar from '../components/common/Avatar';
// v4.4.3: "today" anchored to office zone so widgets see the same day the
// backend wrote rows under (otherwise UK users see empty team-status).
import { getOfficeDate } from '../utils/officeTime';
import '../styles/dashboard.css';

function LeadDashboard({ user, onLogout }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeNav, setActiveNav] = useState('dashboard');
  // Profile picture for the header avatar — fetched on mount so we always
  // show the latest uploaded picture even if the auth session was created
  // before it was set.
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
    // ── Team management (lead-only) ──
    { id: 'employees', label: 'Team Members', icon: 'users', path: '/employees' },
    { id: 'attendance', label: 'Team Attendance', icon: 'calendar', path: '/attendance' },
    { id: 'approvals', label: 'Leave Approvals', icon: 'check-circle', path: '/approvals' },
    { id: 'performance', label: 'Team Performance', icon: 'trending-up', path: '/performance' },
    { id: 'team-timelogging', label: 'Team Time Logging', icon: 'clock', path: '/team-timelogging' },
    // ── Personal (also available as an employee) ──
    { id: 'my-timelogging', label: 'My Time Logging', icon: 'clock', path: '/my-timelogging' },
    { id: 'my-attendance', label: 'My Attendance', icon: 'calendar', path: '/my-attendance' },
    { id: 'my-leave', label: 'My Leave Requests', icon: 'calendar-check', path: '/my-leave' },
    { id: 'my-performance', label: 'My Performance', icon: 'star', path: '/my-performance' },
    { id: 'my-documents', label: 'My Documents', icon: 'file', path: '/my-documents' },
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
            <h1>Department Lead Dashboard</h1>
            <p className="welcome-text">Welcome, {user.fullName}</p>
          </div>
          <ChatWidget user={user} mode="header" />
          <NotificationBell user={user} />
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
            <Route path="/" element={<LeadOverview user={user} />} />
            {/* Team management routes */}
            <Route path="/employees/*" element={<EmployeeManager user={user} />} />
            <Route path="/attendance/*" element={<DepartmentAttendance user={user} />} />
            <Route path="/approvals/*" element={<LeaveApprovalHub user={user} />} />
            <Route path="/performance/*" element={<TeamPerformance user={user} />} />
            <Route path="/team-timelogging/*" element={<LeadTimeLogging user={user} />} />
            {/* Personal routes (same components the employee dashboard uses) */}
            <Route path="/my-timelogging/*" element={<TimeLogging user={user} />} />
            <Route path="/my-attendance/*" element={<AttendanceLogger user={user} />} />
            <Route path="/my-leave/*" element={<LeaveCalendar user={user} />} />
            <Route path="/my-performance/*" element={<EmployeePerformanceReview user={user} />} />
            <Route path="/my-documents/*" element={
              <div className="manager-container">
                <div className="manager-header">
                  <h2>My Documents</h2>
                  <p style={{ margin: 0, color: 'var(--text-2, #9ca3af)', fontSize: '14px' }}>
                    Contracts, ID copies, offer letters and other personal documents kept on file by HR.
                  </p>
                </div>
                <EmployeeDocuments userId={user.id} callerId={user.id} canManage={false} />
              </div>
            } />
          </Routes>
        </div>
      </div>
    </div>
  );
}

function LeadOverview({ user }) {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [leaves, setLeaves] = useState(null);
  const [upcomingLeaves, setUpcomingLeaves] = useState([]);
  const [stats, setStats] = useState({
    teamSize: 0,
    presentToday: 0,
    absentToday: 0,
    onLeave: 0,
    pendingApprovals: 0
  });
  // Chart datasets
  const [attendanceTodayRows, setAttendanceTodayRows] = useState([]);
  const [summary7d, setSummary7d] = useState([]);
  const [myTimeLogs, setMyTimeLogs] = useState([]);
  // v4.1: live team status (Working / On Break / Signed Off / Not Started /
  // Absent / On Leave) for each active team member.
  const [teamToday, setTeamToday] = useState([]);

  // Allow either snake_case or camelCase on the user object so this works
  // regardless of where the user object was loaded from.
  const departmentId = user?.department_id || user?.departmentId || null;

  useEffect(() => {
    const loadData = async () => {
      try {
        // Office-zone "today" — match what the backend stamps so the
        // freshly-saved row is found on first refresh.
        const today = getOfficeDate();
        // Range start points are window boundaries; off-by-one at the edge
        // is harmless for the weekly stack and 12-week line chart.
        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - 6);
        const weekStartIso = weekStart.toISOString().split('T')[0];
        const hoursStart = new Date();
        hoursStart.setDate(hoursStart.getDate() - 12 * 7);
        const hoursStartIso = hoursStart.toISOString().split('T')[0];

        const [empData, leaveBalance, employees, leaveRequests, attendanceToday, upcoming, weekSummary, hoursHistory, teamLive] = await Promise.all([
          window.electron.getEmployeeById(user.id),
          window.electron.getLeaveBalance(user.id),
          window.electron.getDepartmentEmployees(departmentId),
          window.electron.getDepartmentLeaveRequests(departmentId),
          window.electron.getAttendanceByDate(today, departmentId),
          window.electron.getUpcomingLeaves(departmentId),
          window.electron.getAttendanceRangeSummary(weekStartIso, today, departmentId),
          window.electron.getTimeLogs(user.id, hoursStartIso, today),
          window.electron.getTeamToday(departmentId)
        ]);

        setProfile(empData.data);
        setLeaves(leaveBalance.data);
        setUpcomingLeaves(Array.isArray(upcoming?.data) ? upcoming.data : []);

        const attendanceRows = Array.isArray(attendanceToday?.data) ? attendanceToday.data : [];
        const presentToday = attendanceRows.filter(r => (r.status || '').toLowerCase() === 'present').length;
        const absentToday  = attendanceRows.filter(r => (r.status || '').toLowerCase() === 'absent').length;
        const onLeave      = attendanceRows.filter(r => (r.status || '').toLowerCase() === 'leave').length;

        setStats({
          teamSize: employees.data?.length || 0,
          presentToday,
          absentToday,
          onLeave,
          pendingApprovals: leaveRequests.data?.filter(r => r.status === 'pending').length || 0
        });
        setAttendanceTodayRows(attendanceRows);
        setSummary7d(Array.isArray(weekSummary?.data) ? weekSummary.data : []);
        setMyTimeLogs(Array.isArray(hoursHistory?.data) ? hoursHistory.data : []);
        setTeamToday(Array.isArray(teamLive?.data) ? teamLive.data : []);
      } catch (error) {
        console.error('Failed to load lead dashboard data:', error);
      }
    };
    loadData();
  }, [user, departmentId]);

  // Tenure calculation — same logic the Employee dashboard uses (handles
  // year-borrow and day-of-month correctly).
  const calculateTenure = (startDate) => {
    if (!startDate) return 'N/A';
    try {
      // Parse YYYY-MM-DD directly to avoid timezone shift. `new Date('2022-06-06')`
      // becomes UTC midnight and reads back one day earlier in any west-of-UTC
      // timezone, so we extract the parts ourselves.
      const m = String(startDate).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      let startY, startM, startD;
      if (m) {
        startY = +m[1]; startM = +m[2]; startD = +m[3];
      } else {
        const d = new Date(startDate);
        if (isNaN(d.getTime())) return 'N/A';
        startY = d.getFullYear(); startM = d.getMonth() + 1; startD = d.getDate();
      }
      const now = new Date();
      let years  = now.getFullYear() - startY;
      let months = (now.getMonth() + 1) - startM;
      if (now.getDate() < startD) months -= 1;
      if (months < 0) { years -= 1; months += 12; }
      if (years < 0) return 'N/A';
      return `${years}y ${months}m`;
    } catch (error) {
      return 'N/A';
    }
  };

  const annualLeaveRemaining = Array.isArray(leaves)
    ? (leaves.find(l => l.leave_type_name === 'Annual Leave')?.remaining || 0)
    : 0;

  const clickableCard = {
    cursor: 'pointer',
    transition: 'transform 0.15s ease, box-shadow 0.15s ease'
  };
  const cardHover = (e, on) => {
    e.currentTarget.style.transform = on ? 'translateY(-2px)' : '';
    e.currentTarget.style.boxShadow = on ? '0 6px 18px rgba(0,0,0,0.18)' : '';
  };

  return (
    <div className="overview-container">
      {/* My Profile (same shape as Employee dashboard) */}
      <div className="profile-section">
        <div className="profile-card">
          <div className="profile-header">
            <div className="profile-avatar" style={{ overflow: 'hidden', padding: 0 }}>
              {profile?.profile_picture_path || profile?.profilePicturePath ? (
                <img
                  src={profile?.profile_picture_path || profile?.profilePicturePath}
                  alt={user.fullName}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                user.fullName?.charAt(0)
              )}
            </div>
            <div className="profile-info">
              <h2>{user.fullName}</h2>
              <p>{user.email}</p>
            </div>
          </div>

          {profile && (
            <div className="profile-details">
              <div className="detail-row">
                <span className="detail-label">Phone:</span>
                <span className="detail-value">{profile?.phone || 'N/A'}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Department:</span>
                <span className="detail-value">{profile?.department_name && profile.department_name !== 'null' ? profile.department_name : 'N/A'}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Tenure:</span>
                <span className="detail-value">{profile?.joiningDate ? calculateTenure(profile.joiningDate) : 'N/A'}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Employment Type:</span>
                <span className="detail-value">{profile?.employment_type && profile.employment_type !== 'null' ? profile.employment_type : 'N/A'}</span>
              </div>
              {/* Base Salary intentionally hidden from the profile view —
                  it's only visible inside the Edit Employee modal. */}
              <div className="detail-row">
                <span className="detail-label">Bank Account:</span>
                <span className="detail-value">{profile?.bankAccountNumber ? `****${profile.bankAccountNumber.slice(-4)}` : 'N/A'}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Bank Code (IFSC):</span>
                <span className="detail-value">{profile?.ifscCode || 'N/A'}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Status:</span>
                <span className="detail-value">
                  {profile?.is_probation ? '🔴 Probation' : '🟢 Permanent'}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* My Quick Stats — matches Employee dashboard */}
      <h3 style={{ marginTop: '24px', marginBottom: '8px', color: 'var(--text)' }}>My Quick Stats</h3>
      <div className="stats-grid">
        <div
          className="stat-card action-card"
          style={clickableCard}
          onClick={() => navigate('/my-timelogging')}
          onMouseEnter={(e) => cardHover(e, true)}
          onMouseLeave={(e) => cardHover(e, false)}
          title="Open My Time Logging"
        >
          <div className="stat-icon">⏱️</div>
          <div className="stat-content">
            <h3>Log Your Time</h3>
            <p className="stat-description">Record work hours and breaks</p>
          </div>
        </div>
        <div
          className="stat-card"
          style={clickableCard}
          onClick={() => navigate('/my-leave')}
          onMouseEnter={(e) => cardHover(e, true)}
          onMouseLeave={(e) => cardHover(e, false)}
          title="Open My Leave Requests"
        >
          <div className="stat-icon">📅</div>
          <div className="stat-content">
            <h3>Annual Leave Balance</h3>
            <p className="stat-number">{annualLeaveRemaining}</p>
          </div>
        </div>
        <div
          className="stat-card"
          style={clickableCard}
          onClick={() => navigate('/my-performance')}
          onMouseEnter={(e) => cardHover(e, true)}
          onMouseLeave={(e) => cardHover(e, false)}
          title="Open My Performance"
        >
          <div className="stat-icon">🎯</div>
          <div className="stat-content">
            <h3>Punctuality</h3>
            <p className="stat-number">—</p>
          </div>
        </div>
        <div
          className="stat-card"
          style={clickableCard}
          onClick={() => navigate('/my-performance')}
          onMouseEnter={(e) => cardHover(e, true)}
          onMouseLeave={(e) => cardHover(e, false)}
          title="Open My Performance"
        >
          <div className="stat-icon">⭐</div>
          <div className="stat-content">
            <h3>Performance Score</h3>
            <p className="stat-number">—</p>
          </div>
        </div>
      </div>

      {/* Team Overview — lead-only */}
      <h3 style={{ marginTop: '24px', marginBottom: '8px', color: 'var(--text)' }}>Team Overview</h3>
      <div className="stats-grid">
        <div
          className="stat-card"
          style={clickableCard}
          onClick={() => navigate('/employees')}
          onMouseEnter={(e) => cardHover(e, true)}
          onMouseLeave={(e) => cardHover(e, false)}
          title="Open Team Members"
        >
          <div className="stat-icon">👥</div>
          <div className="stat-content">
            <h3>Team Size</h3>
            <p className="stat-number">{stats.teamSize}</p>
          </div>
        </div>
        <div
          className="stat-card"
          style={clickableCard}
          onClick={() => navigate('/attendance?filter=present')}
          onMouseEnter={(e) => cardHover(e, true)}
          onMouseLeave={(e) => cardHover(e, false)}
          title="Show only Present employees"
        >
          <div className="stat-icon">✅</div>
          <div className="stat-content">
            <h3>Present Today</h3>
            <p className="stat-number">{stats.presentToday}</p>
          </div>
        </div>
        <div
          className="stat-card"
          style={clickableCard}
          onClick={() => navigate('/attendance?filter=absent')}
          onMouseEnter={(e) => cardHover(e, true)}
          onMouseLeave={(e) => cardHover(e, false)}
          title="Show only Absent employees"
        >
          <div className="stat-icon">❌</div>
          <div className="stat-content">
            <h3>Absent Today</h3>
            <p className="stat-number">{stats.absentToday}</p>
          </div>
        </div>
        <div
          className="stat-card"
          style={clickableCard}
          onClick={() => navigate('/attendance?filter=leave')}
          onMouseEnter={(e) => cardHover(e, true)}
          onMouseLeave={(e) => cardHover(e, false)}
          title="Show only employees On Leave"
        >
          <div className="stat-icon">🏖️</div>
          <div className="stat-content">
            <h3>On Leave</h3>
            <p className="stat-number">{stats.onLeave}</p>
          </div>
        </div>
        <div
          className="stat-card"
          style={clickableCard}
          onClick={() => navigate('/approvals')}
          onMouseEnter={(e) => cardHover(e, true)}
          onMouseLeave={(e) => cardHover(e, false)}
          title="Open Leave Approvals"
        >
          <div className="stat-icon">📋</div>
          <div className="stat-content">
            <h3>Pending Approvals</h3>
            <p className="stat-number">{stats.pendingApprovals}</p>
          </div>
        </div>
      </div>

      {/* v4.1 — Live team status. Doughnut + per-employee roster so the lead
          can both see the shape (how many are on right now?) and the detail
          (who exactly is on a break?). Sits ABOVE the historical analytics so
          it's the first thing the lead sees on the home page. */}
      <h3 style={{ marginTop: '24px', marginBottom: '8px', color: 'var(--text)' }}>Live Team Status</h3>
      <div className="charts-grid">
        <TeamLiveStatusChart teamRows={teamToday} />
        <div className="chart-card">
          <h3 className="chart-card-title">Who's On Right Now</h3>
          <div className="chart-card-body" style={{ height: 260, overflowY: 'auto', padding: '4px 2px' }}>
            {teamToday.length === 0 ? (
              <div className="chart-empty">No team members yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {teamToday.map(row => {
                  const s = deriveTeamMemberStatus(row);
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
                          {row.startTime ? `In: ${row.startTime}` : '—'}
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

      {/* Analytics — team attendance snapshot + week trend + lead's own
          hours over the last 12 weeks. */}
      <h3 style={{ marginTop: '24px', marginBottom: '8px', color: 'var(--text)' }}>Analytics</h3>
      <div className="charts-grid wide-first">
        <WeeklyAttendanceChart summary={summary7d} days={7} />
        <AttendanceTodayChart attendanceRows={attendanceTodayRows} title="Team Status Today" />
        <MyHoursChart timeLogs={myTimeLogs} weeks={12} />
      </div>

      {/* Birthdays + work anniversaries — scoped to the lead's team */}
      <CelebrationsWidget departmentId={departmentId} title="🎉 Team Birthdays & Anniversaries" />

      {/* Upcoming Leaves — plan around your team's approved absences */}
      <h3 style={{ marginTop: '24px', marginBottom: '8px', color: 'var(--text)' }}>Upcoming Leaves</h3>
      <div className="form-section" style={{ marginTop: '8px' }}>
        {upcomingLeaves.length === 0 ? (
          <p style={{ color: 'var(--text-2)', margin: 0 }}>No upcoming approved leaves for your team.</p>
        ) : (
          <table className="table" style={{ marginBottom: 0 }}>
            <thead>
              <tr>
                <th>Employee</th>
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
        <h2>Quick Actions</h2>
        <p>Click any tile above to jump to that section. You can also use the sidebar on the left.</p>
      </div>
    </div>
  );
}

export default LeadDashboard;
