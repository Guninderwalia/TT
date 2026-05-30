import React, { useState, useEffect } from 'react';

function SkillAssessmentForm({ employee, isOpen, onClose, onSave }) {
  // Predefined skills as fallback
  const DEFAULT_SKILLS = [
    { id: 'communication', name: 'Communication', category: 'soft' },
    { id: 'problem-solving', name: 'Problem Solving', category: 'soft' },
    { id: 'teamwork', name: 'Teamwork', category: 'soft' },
    { id: 'leadership', name: 'Leadership', category: 'soft' },
    { id: 'time-management', name: 'Time Management', category: 'soft' },
    { id: 'attention-to-detail', name: 'Attention to Detail', category: 'soft' },
    { id: 'adaptability', name: 'Adaptability', category: 'soft' },
    { id: 'technical-expertise', name: 'Technical Expertise', category: 'technical' }
  ];

  const [skills, setSkills] = useState(DEFAULT_SKILLS);
  const [assessments, setAssessments] = useState({});
  const [hoverRatings, setHoverRatings] = useState({});
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen && employee) {
      loadSkills();
    }
  }, [isOpen, employee]);

  const loadSkills = async () => {
    try {
      const skillsResult = await window.electron.getSkillsList();
      const employeeSkillsResult = await window.electron.getEmployeeSkills(employee.id);

      // Use returned skills or fallback to default
      if (skillsResult.success && skillsResult.data && skillsResult.data.length > 0) {
        setSkills(skillsResult.data);
      } else {
        setSkills(DEFAULT_SKILLS);
      }

      if (employeeSkillsResult.success) {
        const skillsMap = {};
        (employeeSkillsResult.data || []).forEach(skill => {
          skillsMap[skill.skillId] = skill.rating;
        });
        setAssessments(skillsMap);
      }
    } catch (error) {
      console.error('Error loading skills:', error);
      // Use default skills on error
      setSkills(DEFAULT_SKILLS);
    }
  };

  const handleRatingClick = (skillId, rating) => {
    setAssessments(prev => {
      const updated = {
        ...prev,
        [skillId]: rating
      };
      return updated;
    });
  };

  const handleSave = async () => {
    // Hard guard: previous version silently called assessSkill(undefined, ...)
    // which the backend happily wrote to a phantom employeeId, so the data
    // never showed up against the actual employee on the dashboard. Surface
    // this clearly instead of pretending it succeeded.
    if (!employee || !employee.id) {
      window.toast.error('Cannot save: no employee selected. Please close this dialog and click "Skills" on a specific employee row.');
      return;
    }

    // Count how many ratings the user actually set. If none, abort — the
    // previous code would still flash "Skills assessed successfully" even
    // when the assessments map was empty.
    const ratingEntries = Object.entries(assessments).filter(([, r]) => r > 0);
    if (ratingEntries.length === 0) {
      window.toast.warning('Please rate at least one skill (click a star) before saving.');
      return;
    }

    setIsLoading(true);
    try {
      const savedSkills = [];
      const failedSkills = [];
      for (const [skillId, rating] of ratingEntries) {
        const result = await window.electron.assessSkill(employee.id, skillId, rating);
        if (result && result.success) {
          savedSkills.push(result.data);
        } else {
          failedSkills.push({ skillId, error: (result && (result.message || result.error)) || 'Unknown error' });
        }
      }

      // Be honest about partial successes / total failures.
      if (failedSkills.length === 0) {
        window.toast.success(`Saved ${savedSkills.length} skill rating${savedSkills.length === 1 ? '' : 's'} for ${employee.fullName || employee.name || 'employee'}.`);
      } else if (savedSkills.length === 0) {
        window.toast.error(`All ${failedSkills.length} saves failed.\n\nFirst error: ${failedSkills[0].error}`);
      } else {
        window.toast.error(`Saved ${savedSkills.length} of ${ratingEntries.length}.\nFailures:\n` + failedSkills.map(f => `  - ${f.skillId}: ${f.error}`).join('\n'));
      }

      onSave && onSave(savedSkills);
      onClose();
    } catch (error) {
      console.error('Error saving skills:', error);
      window.toast.error('Error saving skills: ' + (error.message || error));
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  // Group skills by category
  const softSkills = skills.filter(s => s.category === 'soft');
  const technicalSkills = skills.filter(s => s.category === 'technical');

  const SkillRatingRow = ({ skill }) => {
    const currentRating = assessments[skill.id] || 0;
    const hoverRating = hoverRatings[skill.id] || 0;
    // Show hover as a preview only — don't let it pretend to be a real rating.
    // The colours below make the two states obviously different.
    const isHovering = hoverRating > 0;
    const displayRating = isHovering ? hoverRating : currentRating;

    return (
    <div key={skill.id} style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '12px 0',
      borderBottom: '1px solid var(--border)'
    }}>
      <div>
        <p style={{ margin: '0 0 4px 0', fontWeight: '500' }}>{skill.name}</p>
        <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-3)' }}>
          {skill.category === 'soft' ? 'Soft Skill' : 'Technical Skill'}
          {currentRating > 0 && (
            <span style={{ marginLeft: '8px', color: '#10b981' }}>
              ✓ rated {currentRating}/5
            </span>
          )}
        </p>
      </div>
      <div
        style={{ display: 'flex', gap: '6px', fontSize: '20px' }}
        onMouseLeave={() => setHoverRatings(prev => ({ ...prev, [skill.id]: 0 }))}
      >
        {[1, 2, 3, 4, 5].map(star => {
          const isFilled = star <= displayRating;
          // Three states for clarity:
          //   solid gold  = actual saved/clicked rating
          //   pale amber  = hover preview (not yet committed)
          //   light grey  = empty
          const color = isFilled
            ? (isHovering ? '#fcd34d' : '#fbbf24')
            : '#d1d5db';
          return (
            <span
              key={star}
              // Use onMouseDown — onClick can fail to fire if the mouse moves
              // even a pixel between down and up on small targets like stars.
              onMouseDown={(e) => { e.preventDefault(); handleRatingClick(skill.id, star); }}
              onMouseEnter={() => setHoverRatings(prev => ({ ...prev, [skill.id]: star }))}
              style={{
                cursor: 'pointer',
                color,
                opacity: isHovering && isFilled ? 0.7 : 1,
                transition: 'color 0.15s, opacity 0.15s',
                userSelect: 'none'
              }}
              title={`Click to set ${star}-star rating`}
            >
              ★
            </span>
          );
        })}
      </div>
    </div>
    );
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 1000,
      overflowY: 'auto'
    }}>
      <div style={{
        backgroundColor: 'var(--bg-1)',
        borderRadius: '8px',
        padding: '30px',
        maxWidth: '600px',
        width: '90%',
        boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)',
        margin: '20px 0'
      }}>
        <h2 style={{ marginTop: 0 }}>Skill Assessment - {employee?.fullName || employee?.name || employee?.full_name || '(no employee)'}</h2>
        <p style={{ color: 'var(--text-3)', marginBottom: '20px' }}>
          Rate the employee's proficiency in each skill (1-5 stars)
        </p>

        {skills.length === 0 ? (
          <p style={{ color: 'var(--text-3)', textAlign: 'center', padding: '20px' }}>
            Loading skills...
          </p>
        ) : (
          <>
            {softSkills.length > 0 && (
              <div style={{ marginBottom: '30px' }}>
                <h3 style={{ marginTop: 0, marginBottom: '15px', fontSize: '14px', color: 'var(--text-3)', fontWeight: '600' }}>
                  SOFT SKILLS
                </h3>
                {softSkills.map(skill => (
                  <SkillRatingRow key={skill.id} skill={skill} />
                ))}
              </div>
            )}

            {technicalSkills.length > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <h3 style={{ marginTop: 0, marginBottom: '15px', fontSize: '14px', color: 'var(--text-3)', fontWeight: '600' }}>
                  TECHNICAL SKILLS
                </h3>
                {technicalSkills.map(skill => (
                  <SkillRatingRow key={skill.id} skill={skill} />
                ))}
              </div>
            )}
          </>
        )}

        <div style={{
          display: 'flex',
          gap: '10px',
          justifyContent: 'flex-end',
          paddingTop: '20px',
          borderTop: '1px solid var(--border)'
        }}>
          <button
            onClick={onClose}
            disabled={isLoading}
            style={{
              padding: '10px 20px',
              backgroundColor: 'var(--bg-2)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: '500'
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isLoading}
            style={{
              padding: '10px 20px',
              backgroundColor: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: '500',
              opacity: isLoading ? 0.6 : 1
            }}
          >
            {isLoading ? 'Saving...' : 'Save Assessments'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default SkillAssessmentForm;
