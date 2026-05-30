import React, { useState, useEffect } from 'react';
import ManagerReviewForm from './ManagerReviewForm';
import SkillAssessmentForm from './SkillAssessmentForm';
import { buildPerformanceReviewDoc, generatePdf } from '../../utils/pdf/pdfGenerator';
import { getOfficeDate } from '../../utils/officeTime';

function AdminPerformanceReview({ user }) {
  const [employees, setEmployees] = useState([]);
  const [performanceData, setPerformanceData] = useState([]);
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setDate(1);
    return date.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(getOfficeDate());
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [showSkillForm, setShowSkillForm] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [managerReviews, setManagerReviews] = useState({});
  const [employeeSkillsMap, setEmployeeSkillsMap] = useState({});

  useEffect(() => {
    loadEmployeesAndDepartments();
  }, []);

  useEffect(() => {
    if (employees.length > 0) {
      calculatePerformanceMetrics();
    }
  }, [employees, startDate, endDate, departmentFilter]);

  const loadEmployeesAndDepartments = async () => {
    try {
      const empResult = await window.electron.getEmployees();
      const deptResult = await window.electron.getDepartments();

      if (empResult.success) {
        setEmployees(empResult.data || []);
      }
      if (deptResult.success) {
        setDepartments(deptResult.data || []);
      }
    } catch (error) {
      console.error('Failed to load employees and departments:', error);
    }
  };

  const calculatePerformanceMetrics = async () => {
    setLoading(true);
    try {
      const metrics = [];
      // Department IDs are TEXT (UUIDs) in SQLite — parseInt always returned
      // NaN, so the old filter excluded everyone whenever a department was
      // selected. Also coerce both sides to string and accept either the
      // camelCase or snake_case shape since the employee record arrives via
      // a couple of different mappers depending on the caller.
      const filteredEmployees = departmentFilter
        ? employees.filter(e => String(e.departmentId ?? e.department_id) === String(departmentFilter))
        : employees;

      const reviewsMap = {};
      const skillsMap = {};

      for (const emp of filteredEmployees) {
        try {
          const attendanceResult = await window.electron.getAttendanceHistory(emp.id, startDate, endDate);
          const timeLoggingResult = await window.electron.getTimeLogs(emp.id, startDate, endDate);
          const reviewResult = await window.electron.getManagerReview(emp.id);
          const skillsResult = await window.electron.getEmployeeSkills(emp.id);
          const salaryIncrementResult = await window.electron.getLastSalaryIncrement(emp.id);


          const attendanceData = attendanceResult.data || [];
          const timeLoggingData = timeLoggingResult.data || [];
          const reviewData = reviewResult?.data || null;

          // Ensure skills data is an array and has proper structure
          let skillsData = [];
          if (skillsResult && Array.isArray(skillsResult.data) && skillsResult.data.length > 0) {
            skillsData = skillsResult.data;
          }

          // Store reviews and skills data
          if (reviewData) {
            reviewsMap[emp.id] = reviewData;
          }
          if (skillsData && skillsData.length > 0) {
            skillsMap[emp.id] = skillsData;
          }

          const kpis = calculateKPIs(attendanceData, timeLoggingData, reviewData, skillsData, emp.startTime || '09:00');
          const deptName = departments.find(d => d.id === emp.departmentId)?.name || 'N/A';

          // Extract salary increment data if available
          const salaryIncrement = salaryIncrementResult?.data || null;

          metrics.push({
            id: emp.id,
            name: emp.fullName,
            fullName: emp.fullName,      // SkillAssessmentForm reads this for the title
            departmentId: emp.departmentId, // forms may need this
            email: emp.email,
            department: deptName,
            lastIncrementDate: salaryIncrement?.incrementDate || null,
            lastIncrementAmount: salaryIncrement?.incrementAmount || null,
            ...kpis
          });
        } catch (error) {
          console.error(`Failed to calculate metrics for employee ${emp.id}:`, error);
          const deptName = departments.find(d => d.id === emp.departmentId)?.name || 'N/A';
          metrics.push({
            id: emp.id,
            name: emp.fullName,
            fullName: emp.fullName,
            departmentId: emp.departmentId,
            email: emp.email,
            department: deptName,
            attendanceRate: 0,
            punctualityScore: 0,
            consistencyScore: 0,
            latenessImpact: 0,
            managerRating: 0,
            avgSkillRating: 0,
            overallScore: 0,
            lastIncrementDate: null,
            lastIncrementAmount: null
          });
        }
      }

      setManagerReviews(reviewsMap);
      setEmployeeSkillsMap(skillsMap);

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
      const day = cur.getDay(); // 0 = Sun, 6 = Sat
      if (day !== 0 && day !== 6) count++;
      cur.setDate(cur.getDate() + 1);
    }
    return count;
  };

  // Parse a time string in either HH:MM, HH:MM:SS, or ISO format (2026-05-20T08:00:00.000Z)
  // Returns total minutes since midnight, or null on failure
  const parseTimeToMinutes = (timeStr) => {
    if (!timeStr || typeof timeStr !== 'string') return null;

    // Handle ISO format like "2026-05-20T08:00:00.000Z"
    if (timeStr.includes('T') && timeStr.includes('Z')) {
      const d = new Date(timeStr);
      if (isNaN(d)) return null;
      return d.getUTCHours() * 60 + d.getUTCMinutes();
    }

    // Handle HH:MM or HH:MM:SS
    const parts = timeStr.split(':');
    if (parts.length < 2) return null;
    const hours = parseInt(parts[0], 10);
    const mins = parseInt(parts[1], 10);
    if (isNaN(hours) || isNaN(mins)) return null;
    return hours * 60 + mins;
  };

  const calculateKPIs = (attendanceData, timeLoggingData, review = null, skills = [], employeeStartTime = '09:00') => {
    // Calculate total working days in the date range (excluding weekends)
    const totalWorkingDays = countWorkingDays(startDate, endDate);

    // ATTENDANCE counts any status except "absent" — so an approved leave day
    // doesn't punish the employee's attendance score, only an actual no-show
    // does. PUNCTUALITY still uses the stricter "present" set as its base.
    const attendedDays = (attendanceData || []).filter(a => {
      const status = (a.status || '').toLowerCase();
      return status && status !== 'absent';
    }).length;
    const presentDays = (attendanceData || []).filter(a => {
      const status = (a.status || '').toLowerCase();
      return status === 'present';
    }).length;

    // Attendance rate: attended days (everything except absent) / total working days
    const attendanceRate = totalWorkingDays > 0
      ? Math.min(100, (attendedDays / totalWorkingDays) * 100)
      : 0;

    // Calculate punctuality score based on each employee's expected start time
    // Database column is sign_in_time (snake_case), fall back to signInTime for any transformed data
    const expectedStartTime = parseTimeToMinutes(employeeStartTime) ?? (9 * 60);

    // Punctual = present-status days where sign-in was on time. Previously
    // this counted every on-time sign-in regardless of status, which let
    // half-day / leave rows inflate the numerator above presentDays and
    // produce punctuality scores >100% (e.g. Manisha showing 125%).
    const punctualDays = (attendanceData || []).filter(a => {
      const status = (a.status || '').toLowerCase();
      if (status !== 'present') return false;
      const signInTime = a.sign_in_time || a.signInTime;
      const signInMinutes = parseTimeToMinutes(signInTime);
      if (signInMinutes === null) return false;
      return signInMinutes <= expectedStartTime;
    }).length;
    // Punctuality = punctual days / present days, capped at 100%
    const punctualityScore = presentDays > 0
      ? Math.min(100, (punctualDays / presentDays) * 100)
      : 0;

    // Calculate consistency score (working hours)
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

    // Calculate lateness impact
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
      const totalSkillRating = skills.reduce((sum, skill) => {
        const rating = skill.rating || 0;
        return sum + rating;
      }, 0);
      avgSkillRating = (totalSkillRating / skills.length) * 20;
    }

    // Calculate overall score (weighted average)
    // Weights: Skills 40%, Manager Rating 20%, Attendance 10%, Punctuality 10%,
    // Consistency 10%, Lateness 10%. Total = 100%.
    //
    // Lateness uses an inverted score: (100 - latenessImpact). When there are
    // no time logs we contribute 0 instead of a free 100, so employees with
    // no data score 0.0 overall instead of inheriting an unearned baseline.
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
    if (score >= 80) return '#10b981'; // green
    if (score >= 60) return '#f59e0b'; // yellow
    return '#ef4444'; // red
  };

  const getScoreBadge = (score) => {
    if (score >= 80) return 'badge-success';
    if (score >= 60) return 'badge-warning';
    return 'badge-danger';
  };

  // Build and download a printable performance review PDF for `emp`. Pulls
  // skill assessments from the cached map we built during calculatePerformanceMetrics
  // (no extra round-trip needed); falls back to an empty list.
  const handleDownloadReviewPdf = async (emp) => {
    try {
      const skillRatings = employeeSkillsMap[emp.id] || [];
      // The map stores raw skill rows with skillId + rating. Look up the
      // human-readable skill name from the predefined list.
      let skillNames = {};
      try {
        const list = await window.electron.getSkillList();
        if (list && list.success && Array.isArray(list.data)) {
          list.data.forEach(s => { skillNames[s.id] = s.name; });
        }
      } catch (_) { /* names are optional, the PDF will fall back to '-' */ }
      const skills = skillRatings.map(s => ({
        name: skillNames[s.skillId] || s.skill_name || '—',
        rating: s.rating
      }));
      const review = managerReviews[emp.id] || null;
      const doc = buildPerformanceReviewDoc({
        employeeName: emp.fullName || emp.name,
        employeeId: emp.id,
        department: emp.department,
        role: emp.role || 'Employee',
        periodFrom: startDate,
        periodTo: endDate,
        attendanceRate: emp.attendanceRate,
        punctualityScore: emp.punctualityScore,
        consistencyScore: emp.consistencyScore,
        latenessImpact: emp.latenessImpact,
        managerRating: emp.managerRating,
        skills,
        overallScore: emp.overallScore,
        managerName: user?.fullName || 'Reviewer',
        managerComments: review?.comments || ''
      });
      const safeName = (emp.fullName || 'employee').replace(/[^a-z0-9_\-]/gi, '_');
      await generatePdf(doc, `Performance_Review_${safeName}_${startDate}_to_${endDate}.pdf`);
    } catch (e) {
      console.error('[REVIEW PDF] generation failed:', e);
      window.toast.error('Could not generate PDF: ' + e.message);
    }
  };

  // Hard refresh: re-fetch employees + departments AND recompute all KPIs.
  // Used as the post-save callback and as a manual button in the header so
  // users have an obvious "I saved data, why doesn't this update?" escape
  // hatch when state ever falls out of sync.
  const refreshAll = async () => {
    await loadEmployeesAndDepartments();
    // calculatePerformanceMetrics depends on `employees` state; small
    // setTimeout lets React commit the new employees before recompute reads.
    setTimeout(() => { calculatePerformanceMetrics(); }, 50);
  };

  return (
    <div className="manager-container">
      <div className="manager-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Performance Review</h2>
        <button
          onClick={refreshAll}
          disabled={loading}
          style={{ padding: '6px 12px', fontSize: '12px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: loading ? 'wait' : 'pointer' }}
          title="Reload employees, departments, reviews and skills"
        >
          {loading ? '⏳ Loading…' : '🔄 Refresh'}
        </button>
      </div>

      <div className="form-section">
        <h3>Filters & Date Range</h3>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
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
          <div className="form-group">
            <label>Department</label>
            <select
              value={departmentFilter}
              onChange={(e) => {
                setDepartmentFilter(e.target.value);
                // Clear the employee pick when department changes so the
                // dropdown doesn't keep a now-out-of-scope selection.
                setEmployeeFilter('');
              }}
            >
              <option value="">All Departments</option>
              {departments.map(dept => (
                <option key={dept.id} value={dept.id}>{dept.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Employee</label>
            <select
              value={employeeFilter}
              onChange={(e) => setEmployeeFilter(e.target.value)}
            >
              <option value="">All Employees</option>
              {employees
                .filter(e => !departmentFilter || String(e.departmentId ?? e.department_id) === String(departmentFilter))
                .map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.fullName || emp.full_name}</option>
                ))}
            </select>
          </div>
        </div>
      </div>

      <div className="form-section">
        <h3>Performance Metrics</h3>
        {loading && <p>Calculating metrics...</p>}
        {!loading && performanceData.length === 0 && <p>No employees to display</p>}

        {!loading && performanceData.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>Attendance (%)</th>
                  <th>Punctuality (%)</th>
                  <th>Consistency (%)</th>
                  <th>Manager Rating</th>
                  <th>Avg Skill Rating</th>
                  <th>Overall Score</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {performanceData
                  .filter(emp => !employeeFilter || emp.id === employeeFilter)
                  .map(emp => (
                  <tr key={emp.id}>
                    <td>
                      <div>
                        <strong>{emp.name}</strong>
                        <br />
                        <small style={{ color: 'var(--text-3)' }}>{emp.email}</small>
                      </div>
                    </td>
                    <td>{emp.department}</td>
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
                    <td>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          onClick={() => {
                            setSelectedEmployee(emp);
                            setShowReviewForm(true);
                          }}
                          style={{
                            padding: '4px 8px',
                            fontSize: '12px',
                            backgroundColor: '#3b82f6',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer'
                          }}
                        >
                          Review
                        </button>
                        <button
                          onClick={() => {
                            setSelectedEmployee(emp);
                            setShowSkillForm(true);
                          }}
                          style={{
                            padding: '4px 8px',
                            fontSize: '12px',
                            backgroundColor: '#10b981',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer'
                          }}
                        >
                          Skills
                        </button>
                        <button
                          onClick={() => handleDownloadReviewPdf(emp)}
                          title="Download performance review as PDF"
                          style={{
                            padding: '4px 8px',
                            fontSize: '12px',
                            backgroundColor: '#1e3a8a',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer'
                          }}
                        >
                          📄 PDF
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedEmployee && (
        <>
          <ManagerReviewForm
            employee={selectedEmployee}
            isOpen={showReviewForm}
            onClose={() => setShowReviewForm(false)}
            onSave={refreshAll}
          />
          <SkillAssessmentForm
            employee={selectedEmployee}
            isOpen={showSkillForm}
            onClose={() => setShowSkillForm(false)}
            onSave={refreshAll}
          />
        </>
      )}
    </div>
  );
}

export default AdminPerformanceReview;
