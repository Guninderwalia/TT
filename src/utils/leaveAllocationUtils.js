/**
 * Calculate leave allocation based on employee joining date.
 *
 * Rules:
 *   - 25 days per year (Jan-Dec), prorated for mid-year joiners.
 *   - Employees still on probation get 0 — their leave is unpaid.
 *   - Once probation is completed, leave is prorated from the
 *     probationEndDate (so the months on probation don't count).
 *
 * Third argument can either be:
 *   - boolean / 0|1   → treated as "is on probation"
 *   - object          → { isProbation, probationEndDate }
 *
 * For backwards compatibility, omitting it gives the original behaviour.
 */

export const calculateLeaveAllocation = (joiningDate, year = new Date().getFullYear(), probationInfo) => {
  if (!joiningDate) {
    return 0;
  }

  // Normalise the optional probation arg
  let isProbation = false;
  let probationEndDate = null;
  if (probationInfo && typeof probationInfo === 'object') {
    isProbation = probationInfo.isProbation === true || probationInfo.isProbation === 1;
    probationEndDate = probationInfo.probationEndDate || null;
  } else if (probationInfo === true || probationInfo === 1) {
    isProbation = true;
  }

  // While on probation no paid leave accrues — any leave taken in this period
  // is unpaid and isn't deducted from a balance.
  if (isProbation) {
    return 0;
  }

  try {
    // If we know when probation ended and that's still within the requested
    // year, use that as the effective accrual start (so the months spent on
    // probation don't count). Otherwise fall back to the joining date.
    let effectiveStart = new Date(joiningDate);
    if (probationEndDate) {
      const peDate = new Date(probationEndDate);
      if (!isNaN(peDate.getTime()) && peDate > effectiveStart) {
        effectiveStart = peDate;
      }
    }
    const effectiveYear  = effectiveStart.getFullYear();
    const effectiveMonth = effectiveStart.getMonth(); // 0-11

    // If accrual started before the year in question, they get full 25 days
    if (effectiveYear < year) {
      return 25;
    }

    // If accrual starts after the year in question, they get 0 days
    if (effectiveYear > year) {
      return 0;
    }

    // If accrual starts in the same year as requested
    if (effectiveYear === year) {
      // Calculate days from start month to Dec (month 11)
      const monthsRemaining = 12 - effectiveMonth;
      const daysAllocated = (monthsRemaining / 12) * 25;

      // Round to 1 decimal place
      return Math.round(daysAllocated * 10) / 10;
    }

    return 0;
  } catch (error) {
    console.error('Error calculating leave allocation:', error);
    return 0;
  }
};

/**
 * Get leave allocation breakdown for display
 */
export const getLeaveAllocationDisplay = (joiningDate, year = new Date().getFullYear(), probationInfo) => {
  const allocated = calculateLeaveAllocation(joiningDate, year, probationInfo);

  if (!joiningDate) {
    return {
      allocated: 0,
      used: 0,
      remaining: 0,
      message: 'Joining date not set',
      color: '#ef4444'
    };
  }

  // Normalise the probation arg the same way calculateLeaveAllocation does.
  let isProbation = false;
  if (probationInfo && typeof probationInfo === 'object') {
    isProbation = probationInfo.isProbation === true || probationInfo.isProbation === 1;
  } else if (probationInfo === true || probationInfo === 1) {
    isProbation = true;
  }

  // Probationers explicitly get 0 — any leave they take is unpaid.
  if (isProbation) {
    return {
      allocated: 0,
      message: 'On probation — leave taken will be unpaid until probation completes',
      color: '#f59e0b' // Amber
    };
  }

  try {
    const joining = new Date(joiningDate);
    const joiningYear = joining.getFullYear();

    let message = '';
    let color = '#10b981'; // Green by default

    if (joiningYear < year) {
      message = `Full allocation (joined ${joining.getFullYear()})`;
    } else if (joiningYear === year) {
      const monthName = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(joining);
      message = `Prorated: Joined on ${monthName} ${joiningYear}`;
    } else {
      message = 'Joining date is in the future';
      color = '#f59e0b';
    }

    return {
      allocated,
      message,
      color
    };
  } catch (error) {
    return {
      allocated: 0,
      message: 'Invalid joining date',
      color: '#ef4444'
    };
  }
};

/**
 * Format leave allocation for display
 */
export const formatLeaveAllocation = (days) => {
  if (Number.isInteger(days)) {
    return `${days} days`;
  }
  return `${days} days`;
};

/**
 * Calculate if joining date is valid (not in future, reasonable past date)
 */
export const isValidJoiningDate = (joiningDate) => {
  if (!joiningDate) return false;

  try {
    const joining = new Date(joiningDate);
    const today = new Date();

    // Joining date should not be in future
    if (joining > today) {
      return false;
    }

    // Joining date should not be more than 50 years ago (reasonable check)
    const fiftyYearsAgo = new Date();
    fiftyYearsAgo.setFullYear(fiftyYearsAgo.getFullYear() - 50);

    if (joining < fiftyYearsAgo) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
};
