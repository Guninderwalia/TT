import React, { useState, useEffect } from 'react';

function TeamPerformance({ user }) {
  const [employees, setEmployees] = useState([]);
  const [performanceData, setPerformanceData] = useState([]);
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setDate(1);
    return date.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadDepartmentEmployees();
  }, []);

  useEffect(() => {
    if (employees.length > 0) {
      calculatePerformanceMetrics();
    }
  }, [employees, startDate, endDate]);

  const loadDepartmentEmployees = async () => {
    try {
      const result = await window.electron.getDepartmentEmployees?.(user.department_id) || { data: [] };

      if (result.success) {
        setEmployees(result.data || []);
      } else {
        // Fallback: get all employees and filter by department
        const allEmployees = await window.electron.getEmployees?.() || { data: [] };
        const filtered = (allEmployees.data || []).filter(e => e.department_id === user.department_id);
        setEmployees(filtered);
      }
    } catch (error) {
      console.error('Failed to load department employees:', error);
    }
  };

  const calculatePerformanceMetrics = async () => {
    setLoading(true);
    try {
      const metrics = [];

      for (const emp of employees) {
        try {
          const attendanceResult = await window.electron.getAttendanceHistory(emp.id, startDate, endDate);
          const timeLoggingResult = await window.electron.getTimeLogs(emp.id, startDate, endDate);
          const reviewResult = await window.electron.getManagerReview(emp.id);
          const skillsResult = await window.electron.getEmployeeSkills(emp.id);

          const attendanceData = attendanceResult.data || [];
          const timeLoggingData = timeLoggingResult.data || [];

          const kpis = calculateKPIs(attendanceData, timeLoggingData, reviewResult?.data, skillsResult?.data, emp.startTime || '09:00');
          metrics.push({
            id: emp.id,
            name: emp.fullName,
            email: emp.email,
            ...kpis
          });
        } catch (error) {
          console.error(`Failed to calculate metrics for employee ${emp.id}:`, error);
          metrics.push({
            id: emp.id,
            name: emp.fullName,
            email: emp.email,
            attendanceRate: 0,
            punctualityScore: 0,
            consistencyScore: 0,
            latenessImpact: 0,
            managerRating: 0,
            avgSkillRating: 0,
            overallScore: 0
          });
        }
      }

      setPerformanceData(metrics);
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

  const calculateKPIs = (attendanceData, timeLoggingData, review = null, skills = [], employeeStartTime = '09:00') => {
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

    const expectedStartTime = parseTimeToMinutes(employeeStartTime) ?? (9 * 60);
    // Only count present-status days where sign-in was on time (prevents
    // half-day/leave rows from inflating punctuality past 100%).
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
      overallScore: parseFloat(overallScore.toFixed(2))
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

  return (
    <div className="manager-container">
      <div className="manager-header">
        <h2>Team Performance Analytics</h2>
      </div>

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
        {!loading && performanceData.length === 0 && <p>No team members to display</p>}

        {!loading && performanceData.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Team Member</th>
                  <th>Attendance (%)</th>
                  <th>Punctuality (%)</th>
                  <th>Consistency (%)</th>
                  <th>Manager Rating</th>
                  <th>Avg Skill Rating</th>
                  <th>Overall Score</th>
                </tr>
              </thead>
              <tbody>
                {performanceData.map(emp => (
                  <tr key={emp.id}>
                    <td>
                      <div>
                        <strong>{emp.name}</strong>
                        <br />
                        <small style={{ color: 'var(--text-3)' }}>{emp.email}</small>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '60px', height: '8px', backgroundColor: '#e5e7eb', borderRadius: '4px' }}>
                          <div style={{
                            width: `${emp.attendanceRate}%`,
                            height: '100%',
                            backgroundColor: getScoreColor(emp.attendanceRate),
                            borderRadius: '4px'
                          }} />
                        </div>
                        <span style={{ fontSize: '12px' }}>{emp.attendanceRate.toFixed(1)}</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '60px', height: '8px', backgroundColor: '#e5e7eb', borderRadius: '4px' }}>
                          <div style={{
                            width: `${emp.punctualityScore}%`,
                            height: '100%',
                            backgroundColor: getScoreColor(emp.punctualityScore),
                            borderRadius: '4px'
                          }} />
                        </div>
                        <span style={{ fontSize: '12px' }}>{emp.punctualityScore.toFixed(1)}</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '60px', height: '8px', backgroundColor: '#e5e7eb', borderRadius: '4px' }}>
                          <div style={{
                            width: `${emp.consistencyScore}%`,
                            height: '100%',
                            backgroundColor: getScoreColor(emp.consistencyScore),
                            borderRadius: '4px'
                          }} />
                        </div>
                        <span style={{ fontSize: '12px' }}>{emp.consistencyScore.toFixed(1)}</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '16px' }}>
                        {emp.managerRating > 0 ? (
                          <>
                            {[1, 2, 3, 4, 5].map(star => (
                              <span key={star} style={{ color: star <= emp.managerRating ? '#fbbf24' : '#d1d5db' }}>
                                ★
                              </span>
                            ))}
                          </>
                        ) : (
                          <span style={{ fontSize: '12px', color: 'var(--text-3)' }}>-</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span style={{ fontSize: '14px', fontWeight: '500' }}>
                        {emp.avgSkillRating > 0 ? `${emp.avgSkillRating.toFixed(1)}/5` : '-'}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${getScoreBadge(emp.overallScore)}`}>
                        {emp.overallScore.toFixed(1)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default TeamPerformance;
