import React, { useState, useEffect } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import EmployeeManager from '../components/admin/EmployeeManager';
import AttendanceLogger from '../components/employee/AttendanceLogger';
import LeaveCalendar from '../components/employee/LeaveCalendar';
import TimeLogging from '../components/employee/TimeLogging';
import EmployeePerformanceReview from '../components/employee/EmployeePerformanceReview';
import EmployeeDocuments from '../components/common/EmployeeDocuments';
import ProbationDepositPanel from '../components/common/ProbationDepositPanel';
import OrgChart from '../components/common/OrgChart';
import ChatWidget from '../components/common/ChatWidget';
import logoImage from '../assets/logo.png';
import NotificationBell from '../components/common/NotificationBell';
import QuickSignInChip from '../components/common/QuickSignInChip';
import '../styles/dashboard.css';

function EmployeeDashboard({ user, onLogout }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeNav, setActiveNav] = useState('dashboard');
  // Header-avatar picture — pulled fresh in case the auth session doesn't
  // include the latest upload.
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
    { id: 'directory', label: 'Employee Directory', icon: 'users', path: '/directory' },
    { id: 'timelogging', label: 'Time Logging', icon: 'clock', path: '/timelogging' },
    { id: 'attendance', label: 'Attendance', icon: 'calendar', path: '/attendance' },
    { id: 'leave', label: 'Leave Requests', icon: 'calendar-check', path: '/leave' },
    { id: 'performance', label: 'My Performance', icon: 'trending-up', path: '/performance' },
    { id: 'documents', label: 'My Documents', icon: 'file', path: '/documents' },
    { id: 'org-chart', label: 'Org Chart', icon: 'sitemap', path: '/org-chart' },
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
            <h1>My Dashboard</h1>
            <p className="welcome-text">Welcome, {user.fullName}</p>
          </div>
          <QuickSignInChip user={user} />
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
            <Route path="/" element={<EmployeeOverview user={user} />} />
            <Route path="/directory/*" element={<EmployeeManager user={user} />} />
            <Route path="/timelogging/*" element={<TimeLogging user={user} />} />
            <Route path="/attendance/*" element={<AttendanceLogger user={user} />} />
            <Route path="/leave/*" element={<LeaveCalendar user={user} />} />
            <Route path="/performance/*" element={<EmployeePerformanceReview user={user} />} />
            <Route path="/org-chart/*" element={<OrgChart />} />
            <Route path="/documents/*" element={
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

function EmployeeOverview({ user }) {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [attendance, setAttendance] = useState(null);
  const [leaves, setLeaves] = useState(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const empData = await window.electron.getEmployeeById(user.id);
        const leaveBalance = await window.electron.getLeaveBalance(user.id);

        console.log('[DASHBOARD] Employee data loaded:', empData.data);
        setProfile(empData.data);
        setLeaves(leaveBalance.data);
      } catch (error) {
        console.error('Failed to load profile:', error);
      }
    };

    loadData();
  }, [user.id]);

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

      // If today's day-of-month is before the joining day, this month
      // hasn't fully completed yet, so don't count it.
      if (now.getDate() < startD) {
        months -= 1;
      }

      // Borrow from years if months went negative.
      if (months < 0) {
        years -= 1;
        months += 12;
      }

      if (years < 0) return 'N/A';
      return `${years}y ${months}m`;
    } catch (error) {
      return 'N/A';
    }
  };

  return (
    <div className="overview-container">
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
                user.fullName.charAt(0)
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

          {/* v4.7.5 — Probation security deposit, read-only for the employee.
              Reassures them their first months' salary isn't lost — it's held
              and released after probation. */}
          <ProbationDepositPanel userId={user.id} canManage={false} currentUserId={user.id} />
        </div>
      </div>

      <div className="stats-grid">
        <div
          className="stat-card action-card"
          onClick={() => navigate('/timelogging')}
          style={{ cursor: 'pointer' }}
        >
          <div className="stat-icon">⏱️</div>
          <div className="stat-content">
            <h3>Log Your Time</h3>
            <p className="stat-description">Record work hours and breaks</p>
          </div>
        </div>
        <div
          className="stat-card"
          onClick={() => navigate('/leave')}
          style={{ cursor: 'pointer' }}
          title="Open Leave Requests"
        >
          <div className="stat-icon">📅</div>
          <div className="stat-content">
            <h3>Annual Leave Balance</h3>
            <p className="stat-number">
              {Array.isArray(leaves) ? (leaves.find(l => l.leave_type_name === 'Annual Leave')?.remaining || 0) : 0}
            </p>
          </div>
        </div>
        <div
          className="stat-card"
          onClick={() => navigate('/performance')}
          style={{ cursor: 'pointer' }}
          title="Open My Performance"
        >
          <div className="stat-icon">🎯</div>
          <div className="stat-content">
            <h3>Punctuality</h3>
            <p className="stat-number">95%</p>
          </div>
        </div>
        <div
          className="stat-card"
          onClick={() => navigate('/performance')}
          style={{ cursor: 'pointer' }}
          title="Open My Performance"
        >
          <div className="stat-icon">⭐</div>
          <div className="stat-content">
            <h3>Performance Score</h3>
            <p className="stat-number">4.2/5</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default EmployeeDashboard;
