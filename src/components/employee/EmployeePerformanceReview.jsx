import React, { useState, useEffect } from 'react';
import { getOfficeDate } from '../../utils/officeTime';

function EmployeePerformanceReview({ user }) {
  const [performanceData, setPerformanceData] = useState(null);
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setDate(1);
    return date.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(getOfficeDate());
  const [loading, setLoading] = useState(false);
  const [employeeInfo, setEmployeeInfo] = useState(null);
  const [managerReview, setManagerReview] = useState(null);
  const [employeeSkills, setEmployeeSkills] = useState([]);

  useEffect(() => {
    loadEmployeeInfo();
  }, []);

  useEffect(() => {
    if (user?.id) {
      calculatePerformanceMetrics();
    }
  }, [user, startDate, endDate]);

  const loadEmployeeInfo = async () => {
    try {
      const result = await window.electron.getEmployeeById(user.id);
      if (result.success) {
        setEmployeeInfo(result.data);
      }
    } catch (error) {
      console.error('Failed to load employee info:', error);
    }
  };

  const calculatePerformanceMetrics = async () => {
    setLoading(true);
    try {
      const attendanceResult = await window.electron.getAttendanceHistory(user.id, startDate, endDate);
      const timeLoggingResult = await window.electron.getTimeLogs(user.id, startDate, endDate);
      const reviewResult = await window.electron.getManagerReview(user.id);
      const skillsResult = await window.electron.getEmployeeSkills(user.id);

      const attendanceData = attendanceResult.data || [];
      const timeLoggingData = timeLoggingResult.data || [];

      if (reviewResult && reviewResult.data) {
        setManagerReview(reviewResult.data);
      }
      if (skillsResult && skillsResult.data) {
        setEmployeeSkills(skillsResult.data);
      }

      const kpis = calculateKPIs(attendanceData, timeLoggingData, reviewResult?.data, skillsResult?.data);
      setPerformanceData(kpis);
    } catch (error) {
      console.error('Failed to calculate performance metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  // Count working days (Mon-Fri) between two dates inclusive
  const countWorkingDays = (start, end) => {
    if (!start || !end) return 0;
    const startD = new Date(start);
    const endD = new Date(end);
    if (isNaN(startD) || isNaN(endD) || endD < startD) return 0;
    let count = 0;
    const cur = new Date(startD);
    while (cur <= endD) {
      const day = cur.getDay();
      if (day !== 0 && day !== 6) count++;
      cur.setDate(cur.getDate() + 1);
    }
    return count;
  };

  // Parse time string (HH:MM, HH:MM:SS, or ISO) to minutes since midnight
  const parseTimeToMinutes = (timeStr) => {
    if (!timeStr || typeof timeStr !== 'string') return null;
    if (timeStr.includes('T') && timeStr.includes('Z')) {
      const d = new Date(timeStr);
      if (isNaN(d)) return null;
      return d.getUTCHours() * 60 + d.getUTCMinutes();
    }
    const parts = timeStr.split(':');
    if (parts.length < 2) return null;
    const hours = parseInt(parts[0], 10);
    const mins = parseInt(parts[1], 10);
    if (isNaN(hours) || isNaN(mins)) return null;
    return hours * 60 + mins;
  };

  const calculateKPIs = (attendanceData, timeLoggingData, review = null, skills = []) => {
    const totalWorkingDays = countWorkingDays(startDate, endDate);
    // Attendance counts any status except "absent" (so leave days don't hurt
    // the score). Punctuality uses the stricter "present" subset below.
    const attendedDays = (attendanceData || []).filter(a => {
      const status = (a.status || '').toLowerCase();
      return status && status !== 'absent';
    }).length;
    const presentDays = (attendanceData || []).filter(a => {
      return (a.status || '').toLowerCase() === 'present';
    }).length;
    const attendanceRate = totalWorkingDays > 0
      ? Math.min(100, (attendedDays / totalWorkingDays) * 100)
      : 0;

    const employeeStartTime = user?.startTime || '09:00';
    const expectedStartTime = parseTimeToMinutes(employeeStartTime) ?? (9 * 60);

    // Only count present-status days where sign-in was on time (matches the
    // intent of "punctuality" and prevents scores >100% when half-day/leave
    // rows had early sign-ins).
    const punctualDays = (attendanceData || []).filter(a => {
      const status = (a.status || '').toLowerCase();
      if (status !== 'present') return false;
      const signInTime = a.sign_in_time || a.signInTime;
      const signInMinutes = parseTimeToMinutes(signInTime);
      if (signInMinutes === null) return false;
      return signInMinutes <= expectedStartTime;
    }).length;
    const punctualityScore = presentDays > 0
      ? Math.min(100, (punctualDays / presentDays) * 100)
      : 0;

    let totalHours = 0;
    let loggingDays = 0;
    if (Array.isArray(timeLoggingData) && timeLoggingData.length > 0) {
      timeLoggingData.forEach(log => {
        if (log.startTime && log.endTime) {
          const [startH, startM] = log.startTime.split(':').map(Number);
          const [endH, endM] = log.endTime.split(':').map(Number);

          let breakMinutes = 0;
          if (log.breakStartTime && log.breakEndTime) {
            const [breakStartH, breakStartM] = log.breakStartTime.split(':').map(Number);
            const [breakEndH, breakEndM] = log.breakEndTime.split(':').map(Number);
            breakMinutes = (breakEndH * 60 + breakEndM) - (breakStartH * 60 + breakStartM);
          }

          const totalMinutes = (endH * 60 + endM) - (startH * 60 + startM) - breakMinutes;
          const hours = totalMinutes / 60;
          totalHours += hours;
          loggingDays++;
        }
      });
    }
    const avgWorkingHours = loggingDays > 0 ? totalHours / loggingDays : 0;
    const consistencyScore = Math.min(100, (avgWorkingHours / 8) * 100);

    let totalLateMinutes = 0;
    (attendanceData || []).forEach(a => {
      const signInTime = a.sign_in_time || a.signInTime;
      const signInMinutes = parseTimeToMinutes(signInTime);
      if (signInMinutes !== null && signInMinutes > expectedStartTime) {
        totalLateMinutes += signInMinutes - expectedStartTime;
      }
    });
    const totalWorkingMinutes = totalHours * 60;
    const latenessImpact = totalWorkingMinutes > 0 ? (totalLateMinutes / totalWorkingMinutes) * 100 : 0;

    // Calculate manager rating (1-5 scale converted to 0-100)
    const managerRating = review ? review.rating * 20 : 0;

    // Calculate average skill rating (1-5 scale converted to 0-100)
    let avgSkillRating = 0;
    if (Array.isArray(skills) && skills.length > 0) {
      const totalSkillRating = skills.reduce((sum, skill) => sum + (skill.rating || 0), 0);
      avgSkillRating = (totalSkillRating / skills.length) * 20;
    }

    // Calculate overall score (weighted average)
    // Weights: Skills 40%, Manager Rating 20%, Attendance 10%, Punctuality 10%,
    // Consistency 10%, Lateness 10%. Total = 100%.
    // Lateness contributes 0 when no time logs exist (no free credit).
    const latenessScore = totalHours > 0 ? Math.max(0, 100 - latenessImpact) : 0;

    const overallScore =
      (attendanceRate    * 0.10) +
      (punctualityScore  * 0.10) +
      (consistencyScore  * 0.10) +
      (latenessScore     * 0.10) +
      (managerRating     * 0.20) +
      (avgSkillRating    * 0.40);

    return {
      attendanceRate: parseFloat(attendanceRate.toFixed(2)),
      punctualityScore: parseFloat(punctualityScore.toFixed(2)),
      consistencyScore: parseFloat(consistencyScore.toFixed(2)),
      latenessImpact: parseFloat(latenessImpact.toFixed(2)),
      managerRating: review ? review.rating : 0,
      avgSkillRating: avgSkillRating > 0 ? parseFloat((avgSkillRating / 20).toFixed(1)) : 0,
      overallScore: parseFloat(overallScore.toFixed(2)),
      workingDays: totalWorkingDays,
      presentDays,
      loggingDays,
      avgWorkingHours: parseFloat(avgWorkingHours.toFixed(2))
    };
  };

  const getScoreColor = (score) => {
    if (score >= 80) return '#10b981';
    if (score >= 60) return '#f59e0b';
    return '#ef4444';
  };

  const getScoreBadge = (score) => {
    if (score >= 80) return 'badge-success';
    if (score >= 60) return 'badge-warning';
    return 'badge-danger';
  };

  const getScoreLabel = (score) => {
    if (score >= 90) return 'Excellent';
    if (score >= 80) return 'Very Good';
    if (score >= 70) return 'Good';
    if (score >= 60) return 'Satisfactory';
    return 'Needs Improvement';
  };

  return (
    <div className="manager-container">
      <div className="manager-header">
        <h2>My Performance</h2>
      </div>

      {employeeInfo && (
        <div className="form-section">
          <h3>Employee Profile</h3>
          <div style={{
            padding: '20px',
            backgroundColor: 'var(--bg-2)',
            borderRadius: '8px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '15px'
          }}>
            <div>
              <p style={{ color: 'var(--text-3)', fontSize: '0.9em' }}>Full Name</p>
              <p style={{ fontWeight: '600', marginTop: '5px' }}>{employeeInfo.fullName}</p>
            </div>
            <div>
              <p style={{ color: 'var(--text-3)', fontSize: '0.9em' }}>Department</p>
              <p style={{ fontWeight: '600', marginTop: '5px' }}>
                {employeeInfo.department_name || employeeInfo.departmentName || employeeInfo.department || 'N/A'}
              </p>
            </div>
            <div>
              <p style={{ color: 'var(--text-3)', fontSize: '0.9em' }}>Email</p>
              <p style={{ fontWeight: '600', marginTop: '5px' }}>{employeeInfo.email}</p>
            </div>
            <div>
              <p style={{ color: 'var(--text-3)', fontSize: '0.9em' }}>Role</p>
              <p style={{ fontWeight: '600', marginTop: '5px' }}>
                {employeeInfo.role || employeeInfo.role_name || 'N/A'}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="form-section">
        <h3>Date Range</h3>
        <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="form-group">
            <label>Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="form-section">
        <h3>Performance Metrics</h3>
        {loading && <p>Calculating metrics...</p>}
        {!loading && performanceData && (
          <>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '20px',
              marginBottom: '30px'
            }}>
              {[
                { label: 'Overall Performance', value: performanceData.overallScore, icon: '🎯' },
                { label: 'Attendance Rate', value: performanceData.attendanceRate, icon: '📅' },
                { label: 'Punctuality Score', value: performanceData.punctualityScore, icon: '⏰' },
                { label: 'Consistency Score', value: performanceData.consistencyScore, icon: '📊' }
              ].map((metric, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '20px',
                    backgroundColor: 'var(--bg-2)',
                    borderRadius: '8px',
                    border: `2px solid ${getScoreColor(metric.value)}`,
                    textAlign: 'center'
                  }}
                >
                  <div style={{ fontSize: '24px', marginBottom: '10px' }}>{metric.icon}</div>
                  <p style={{ color: 'var(--text-3)', fontSize: '0.9em', marginBottom: '10px' }}>
                    {metric.label}
                  </p>
                  <p style={{
                    fontSize: '32px',
                    fontWeight: '700',
                    color: getScoreColor(metric.value),
                    marginBottom: '5px'
                  }}>
                    {metric.value.toFixed(1)}%
                  </p>
                  {metric.label === 'Overall Performance' && (
                    <p style={{
                      fontSize: '0.9em',
                      color: getScoreColor(metric.value),
                      fontWeight: '600'
                    }}>
                      {getScoreLabel(metric.value)}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div style={{
              padding: '20px',
              backgroundColor: 'var(--bg-2)',
              borderRadius: '8px',
              marginBottom: '20px'
            }}>
              <h4 style={{ marginBottom: '15px' }}>Summary</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                <div>
                  <p style={{ color: 'var(--text-3)', fontSize: '0.9em' }}>Days Present</p>
                  <p style={{ fontSize: '20px', fontWeight: '600', marginTop: '5px' }}>
                    {performanceData.presentDays} / {performanceData.workingDays}
                  </p>
                </div>
                <div>
                  <p style={{ color: 'var(--text-3)', fontSize: '0.9em' }}>Average Working Hours</p>
                  <p style={{ fontSize: '20px', fontWeight: '600', marginTop: '5px' }}>
                    {performanceData.avgWorkingHours} hours/day
                  </p>
                </div>
                <div>
                  <p style={{ color: 'var(--text-3)', fontSize: '0.9em' }}>Lateness Impact</p>
                  <p style={{ fontSize: '20px', fontWeight: '600', marginTop: '5px', color: '#ef4444' }}>
                    {performanceData.latenessImpact.toFixed(1)}%
                  </p>
                </div>
                <div>
                  <p style={{ color: 'var(--text-3)', fontSize: '0.9em' }}>Time Logs Recorded</p>
                  <p style={{ fontSize: '20px', fontWeight: '600', marginTop: '5px' }}>
                    {performanceData.loggingDays} days
                  </p>
                </div>
              </div>
            </div>

            <div style={{
              padding: '20px',
              backgroundColor: 'var(--bg-2)',
              borderRadius: '8px',
              marginBottom: '20px'
            }}>
              <h4 style={{ marginBottom: '15px' }}>Performance Rating</h4>
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ width: '100%', height: '12px', backgroundColor: '#e5e7eb', borderRadius: '6px' }}>
                    <div style={{
                      width: `${performanceData.overallScore}%`,
                      height: '100%',
                      backgroundColor: getScoreColor(performanceData.overallScore),
                      borderRadius: '6px',
                      transition: 'width 0.3s ease'
                    }} />
                  </div>
                </div>
                <span className={`badge ${getScoreBadge(performanceData.overallScore)}`}>
                  {performanceData.overallScore.toFixed(1)}%
                </span>
              </div>
            </div>

            {managerReview && (
              <div style={{
                padding: '20px',
                backgroundColor: 'var(--bg-2)',
                borderRadius: '8px',
                marginBottom: '20px'
              }}>
                <h4 style={{ marginBottom: '12px' }}>Manager Review</h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', gap: '4px', fontSize: '24px' }}>
                    {[1, 2, 3, 4, 5].map(star => (
                      <span key={star} style={{ color: star <= managerReview.rating ? '#fbbf24' : '#d1d5db' }}>
                        ★
                      </span>
                    ))}
                  </div>
                  <span style={{ fontSize: '14px', fontWeight: '600' }}>
                    {managerReview.rating}/5
                  </span>
                </div>
                {managerReview.comments && (
                  <div style={{
                    padding: '12px',
                    backgroundColor: 'var(--bg-1)',
                    borderRadius: '4px',
                    borderLeft: '3px solid #3b82f6'
                  }}>
                    <p style={{ margin: 0, fontSize: '14px', lineHeight: '1.5' }}>
                      {managerReview.comments}
                    </p>
                  </div>
                )}
                <p style={{ margin: '12px 0 0 0', fontSize: '12px', color: 'var(--text-3)' }}>
                  Last reviewed: {new Date(managerReview.reviewDate).toLocaleDateString()}
                </p>
              </div>
            )}

            {employeeSkills.length > 0 && (
              <div style={{
                padding: '20px',
                backgroundColor: 'var(--bg-2)',
                borderRadius: '8px'
              }}>
                <h4 style={{ marginBottom: '15px' }}>Skill Assessment</h4>
                {employeeSkills.map(skill => (
                  <div key={skill.skillId} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 0',
                    borderBottom: '1px solid var(--border)'
                  }}>
                    <div>
                      <p style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: '500' }}>
                        {skill.skillId.replace('-', ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: '4px', fontSize: '16px' }}>
                      {[1, 2, 3, 4, 5].map(star => (
                        <span key={star} style={{ color: star <= skill.rating ? '#fbbf24' : '#d1d5db' }}>
                          ★
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default EmployeePerformanceReview;
