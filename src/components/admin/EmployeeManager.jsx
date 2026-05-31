import React, { useState, useEffect } from 'react';
import Avatar from '../common/Avatar';
import EmployeeDocuments from '../common/EmployeeDocuments';
import ProbationDepositPanel from '../common/ProbationDepositPanel';
import ConfirmModal from '../common/ConfirmModal';
import OffboardEmployeeModal from '../modals/OffboardEmployeeModal';
import { buildOfferLetterDoc, generatePdf } from '../../utils/pdf/pdfGenerator';

function EmployeeManager({ user = null }) {
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  // Editable leave-balance overrides for the employee currently being edited.
  // Loaded when an employee row is opened for edit; saved one-by-one via the
  // "Save" button next to each leave type.
  const [editingBalances, setEditingBalances] = useState([]);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [balanceOverrideInput, setBalanceOverrideInput] = useState({}); // { [leave_type_id]: '<input value>' }
  const [creating, setCreating] = useState(false);
  const [selectedDepartmentFilter, setSelectedDepartmentFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState(null);    // column name being sorted
  const [sortDir, setSortDir] = useState('asc');   // 'asc' | 'desc'
  // When set, ConfirmModal renders. Holds { title, message, confirmLabel, tone, onConfirm }.
  // Replaces every `window.confirm(...)` call — Electron silently returns null
  // from window.confirm so destructive admin actions were never triggering.
  const [confirmDialog, setConfirmDialog] = useState(null);
  // Offboarding state
  const [viewMode, setViewMode] = useState('active'); // 'active' | 'offboarded'
  const [offboardedEmployees, setOffboardedEmployees] = useState([]);
  const [offboardingEmp, setOffboardingEmp] = useState(null);    // employee being offboarded → opens modal

  // Determine user role and permissions (case-insensitive)
  const userRole = user?.role_name?.toLowerCase();
  // Accept all the role-name variants the rest of the app recognises as admin.
  // The seed in src/db/init.js creates the roles table with name="Admin" (short
  // form), while older / migrated installs may have "Administrator". Both
  // must grant full admin access here, otherwise the dashboard routes the user
  // as admin but this screen silently downgrades them to view-only.
  const isAdmin = user && (
    userRole === 'admin' ||
    userRole === 'administrator' ||
    userRole === 'md' ||
    userRole === 'managing director' ||
    user.role_name === 'Admin' ||
    user.role_name === 'Administrator' ||
    user.role_name === 'MD'
  );
  // A user is treated as a team lead if their role_name is "Lead" OR they're
  // flagged as a department lead in the DB (is_department_lead = 1). The DB
  // flag is the source of truth because users can be department leads even if
  // their underlying role_name is still "User".
  const isDeptLeadFlag = user && (
    user.is_department_lead === 1 ||
    user.is_department_lead === true ||
    user.isLead === true
  );
  const isTeamLead = user && (userRole === 'lead' || user.role_name === 'Lead' || isDeptLeadFlag);
  const isManager = user && (userRole === 'manager' || user.role_name === 'Manager');
  const isEmployee = user && (userRole === 'user' || user.role_name === 'User');
  const userDepartmentId = user?.departmentId || user?.department_id;
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phone: '',
    username: '',
    departmentId: '',
    role: 'Employee',
    baseSalary: '',
    isLead: false,
    joiningDate: '',
    bankAccountNumber: '',
    bankName: '',
    accountName: '',
    ifscCode: '',
    isActive: true,
    probationCompleted: true,
    // When still on probation: the date probation ends.
    probationEndDate: '',
    startTime: '09:00',
    endTime: '18:00',
    // Stored as a data URL so it round-trips through the DB's
    // profile_picture_path TEXT column without any filesystem juggling.
    profilePicturePath: '',
    // Date of birth — feeds the Birthday widget on the dashboards.
    dateOfBirth: '',
    // Last salary increment — surfaced on the performance review screen.
    // Saving the form upserts a salary_increments row when both are set.
    lastIncrementDate: '',
    lastIncrementAmount: ''
  });
  const fileInputRef = React.useRef(null);

  useEffect(() => {
    loadEmployees();
    loadDepartments();
  }, []);

  const loadEmployees = async () => {
    try {
      const result = await window.electron.getEmployees();
      if (result.success) {
        setEmployees(result.data);
      }
    } catch (error) {
      console.error('Failed to load employees:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadOffboarded = async () => {
    try {
      const result = await window.electron.getOffboardedEmployees();
      if (result?.success) {
        setOffboardedEmployees(result.data || []);
      }
    } catch (error) {
      console.error('Failed to load offboarded employees:', error);
    }
  };

  const handleOpenOffboard = (emp) => setOffboardingEmp(emp);
  const handleCloseOffboard = () => setOffboardingEmp(null);
  const handleOffboardSuccess = async (message) => {
    setOffboardingEmp(null);
    window.toast?.success?.(message);
    await loadEmployees();
    if (viewMode === 'offboarded') await loadOffboarded();
  };

  const handleReactivate = (emp) => {
    setConfirmDialog({
      title: 'Reactivate employee?',
      message: `"${emp.full_name}" will be set back to active. Any leave requests that were auto-cancelled during offboarding will NOT be restored.`,
      confirmLabel: 'Reactivate',
      tone: 'primary',
      onConfirm: () => doReactivate(emp)
    });
  };
  const doReactivate = async (emp) => {
    try {
      const result = await window.electron.reactivateEmployee(emp.id, user?.id);
      if (result?.success) {
        window.toast?.success?.(`${emp.full_name} reactivated.`);
        await loadOffboarded();
        await loadEmployees();
      } else {
        window.toast?.error?.('Failed to reactivate: ' + (result?.message || 'Unknown error'));
      }
    } catch (error) {
      console.error('Reactivate error:', error);
      window.toast?.error?.('Failed to reactivate: ' + error.message);
    }
  };

  const handleViewModeToggle = async () => {
    const next = viewMode === 'active' ? 'offboarded' : 'active';
    setViewMode(next);
    if (next === 'offboarded') await loadOffboarded();
  };

  const loadDepartments = async () => {
    try {
      const result = await window.electron.getDepartments();
      if (result.success) {
        setDepartments(result.data);
      }
    } catch (error) {
      console.error('Failed to load departments:', error);
    }
  };

  // Load the employee's leave balances so the admin can edit them in the
  // override section. Called when an employee row is opened for edit.
  const loadEditingBalances = async (empId) => {
    if (!empId) return;
    try {
      setBalancesLoading(true);
      const result = await window.electron.getLeaveBalance(empId);
      const list = (result && result.success && Array.isArray(result.data)) ? result.data : [];
      setEditingBalances(list);
      // Pre-fill the input fields with the current remaining value
      const initial = {};
      list.forEach(b => { initial[b.leave_type_id] = String(b.remaining ?? ''); });
      setBalanceOverrideInput(initial);
    } catch (e) {
      console.error('Failed to load leave balances:', e);
      setEditingBalances([]);
      setBalanceOverrideInput({});
    } finally {
      setBalancesLoading(false);
    }
  };

  const handleSaveBalanceOverride = async (leaveTypeId) => {
    if (!editingId) return;
    const raw = balanceOverrideInput[leaveTypeId];
    const trimmed = raw == null ? '' : String(raw).trim();
    if (trimmed === '') {
      window.toast.warning('Enter a number, or use the Reset button to clear the override.');
      return;
    }
    const val = parseFloat(trimmed);
    if (!Number.isFinite(val) || val < 0) {
      window.toast.warning('Please enter a non-negative number.');
      return;
    }
    try {
      const result = await window.electron.setLeaveBalanceManual(editingId, leaveTypeId, val, user?.id);
      if (result.success) {
        window.toast.success(result.message || 'Leave balance updated.');
        await loadEditingBalances(editingId);
      } else {
        window.toast.error('Could not update balance: ' + (result.message || result.error || 'Unknown error'));
      }
    } catch (e) {
      window.toast.error('Failed to update balance: ' + e.message);
    }
  };

  const handleResetBalanceOverride = (leaveTypeId) => {
    if (!editingId) return;
    setConfirmDialog({
      title: 'Clear manual override?',
      message: 'The system will go back to auto-calculating the leave balance from joining date + entitlement.',
      confirmLabel: 'Clear override',
      tone: 'primary',
      onConfirm: () => doResetBalanceOverride(leaveTypeId)
    });
  };

  const doResetBalanceOverride = async (leaveTypeId) => {
    try {
      const result = await window.electron.setLeaveBalanceManual(editingId, leaveTypeId, null, user?.id);
      if (result.success) {
        window.toast.success(result.message || 'Override cleared.');
        await loadEditingBalances(editingId);
      } else {
        window.toast.error('Could not reset: ' + (result.message || result.error || 'Unknown error'));
      }
    } catch (e) {
      window.toast.error('Failed to reset: ' + e.message);
    }
  };

  const handleOpenEditForm = (employee) => {
    setEditingId(employee.id);
    // Load this employee's leave balances for the override section
    loadEditingBalances(employee.id);

    // Format joining date properly - ensure it's in YYYY-MM-DD format.
    //
    // IMPORTANT: do NOT round-trip through `.toISOString()`. That converts to
    // UTC, so in any timezone west of UTC a local midnight Date jumps back
    // a day (e.g. "2022-06-06" becomes "2022-06-05" when stored). Use the
    // local date parts instead so the picker shows what the DB has.
    const toLocalYMD = (val) => {
      if (!val) return '';
      if (typeof val === 'string' && val.match(/^\d{4}-\d{2}-\d{2}/)) {
        return val.split('T')[0]; // already in the right shape — keep as-is
      }
      const d = new Date(val);
      if (isNaN(d.getTime())) return '';
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const joiningDate = toLocalYMD(employee.joiningDate);


    setFormData({
      fullName: employee.fullName || '',
      email: employee.email || '',
      phone: employee.phone || '',
      username: employee.username || '',
      departmentId: employee.departmentId || '',
      role: employee.role || 'Employee',
      baseSalary: employee.baseSalary || '',
      isLead: employee.isLead || false,
      joiningDate: joiningDate,
      bankAccountNumber: employee.bankAccountNumber || '',
      bankName: employee.bankName || '',
      accountName: employee.accountName || '',
      ifscCode: employee.ifscCode || '',
      isActive: employee.status === 'active',
      // The DB stores is_probation (1 = currently on probation, 0 = completed).
      // Backend exposes it as is_probation (snake) AND isProbation (boolean via
      // withCamelAliases). The previous version read employee.probationCompleted
      // which the backend NEVER returns — so it was always undefined, and
      // `undefined !== false` was true. That made the box re-tick itself every
      // time the modal opened, regardless of what was saved. Now we derive
      // probationCompleted as the inverse of is_probation, which is what the
      // backend actually persists.
      probationCompleted: !(employee.is_probation === 1 || employee.isProbation === true),
      probationEndDate: (employee.probationEndDate || employee.probation_end_date || '').toString().split('T')[0] || '',
      startTime: employee.startTime || '09:00',
      endTime: employee.endTime || '18:00',
      profilePicturePath: employee.profile_picture_path || employee.profilePicturePath || '',
      dateOfBirth: (employee.date_of_birth || employee.dateOfBirth || '').split('T')[0] || '',
      lastIncrementDate: (employee.lastIncrementDate || '').toString().split('T')[0] || '',
      lastIncrementAmount: employee.lastIncrementAmount != null ? String(employee.lastIncrementAmount) : ''
    });
    // For employees opened from the list (getAll), salary increment isn't
    // included — fetch the latest separately so the form pre-fills correctly.
    if (employee.id && !employee.lastIncrementDate) {
      window.electron.getLastSalaryIncrement(employee.id).then(res => {
        if (res?.success && res.data) {
          setFormData(prev => ({
            ...prev,
            lastIncrementDate: (res.data.incrementDate || '').toString().split('T')[0] || '',
            lastIncrementAmount: res.data.incrementAmount != null ? String(res.data.incrementAmount) : ''
          }));
        }
      }).catch(() => { /* non-fatal */ });
    }
    setShowForm(true);
  };

  const resetForm = () => {
    setEditingId(null);
    setFormData({
      fullName: '',
      email: '',
      phone: '',
      joiningDate: '',
      username: '',
      departmentId: '',
      role: 'Employee',
      baseSalary: '',
      isLead: false,
      bankAccountNumber: '',
      bankName: '',
      accountName: '',
      ifscCode: '',
      isActive: true,
      probationCompleted: true,
      probationEndDate: '',
      startTime: '09:00',
      endTime: '18:00',
      profilePicturePath: '',
      dateOfBirth: '',
      lastIncrementDate: '',
      lastIncrementAmount: ''
    });
    setShowForm(false);
  };

  // Pick an image, resize it to a small square via canvas, and store it as a
  // data URL on the form. Doing the resize in-browser keeps the DB rows
  // sensibly small (~10-20KB per picture instead of multi-MB originals).
  const handlePickProfilePicture = (file) => {
    if (!file) return;
    if (!file.type || !file.type.startsWith('image/')) {
      window.toast.warning('Please choose an image file (jpg / png / gif / webp).');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        try {
          const SIZE = 200;
          const canvas = document.createElement('canvas');
          canvas.width = SIZE;
          canvas.height = SIZE;
          const ctx = canvas.getContext('2d');
          // Square-crop: take the largest centred square from the original
          const side = Math.min(img.width, img.height);
          const sx = (img.width - side) / 2;
          const sy = (img.height - side) / 2;
          ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
          setFormData(fd => ({ ...fd, profilePicturePath: dataUrl }));
        } catch (err) {
          window.toast.error('Could not process the image: ' + err.message);
        }
      };
      img.onerror = () => window.toast.error('Could not read the selected image.');
      img.src = e.target.result;
    };
    reader.onerror = () => window.toast.error('Could not read the selected file.');
    reader.readAsDataURL(file);
  };

  const getDepartmentName = (deptId) => {
    const dept = departments.find(d => d.id === deptId);
    return dept ? dept.name : 'Unknown';
  };

  // Mask salary - show first two characters as asterisks
  const maskSalary = (salary) => {
    if (!salary) return '₹0';
    const salaryStr = salary.toString();
    if (salaryStr.length <= 2) {
      return '₹' + '*'.repeat(salaryStr.length);
    }
    return '₹**' + salaryStr.substring(2);
  };

  // Re-shape an offboarded row (returned by employee:listOffboarded in snake_case
   // with extra exit fields) into the camelCase shape the active table expects.
  const normalizeOffboarded = (row) => ({
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    departmentId: row.department_id,
    role: row.role_name || 'Employee',
    status: 'inactive',
    isLead: false,
    profile_picture_path: row.profile_picture_path,
    last_working_day: row.last_working_day,
    exit_reason: row.exit_reason,
    exit_notes: row.exit_notes,
    last_login_at: null
  });

  const getFilteredEmployees = () => {
    // Past Employees view uses a dedicated data source loaded on toggle.
    if (viewMode === 'offboarded') {
      let rows = offboardedEmployees.map(normalizeOffboarded);
      const q = (searchQuery || '').trim().toLowerCase();
      if (q) {
        rows = rows.filter(emp => {
          const hs = [emp.fullName, emp.email, emp.phone, emp.role, emp.exit_reason].filter(Boolean).join(' ').toLowerCase();
          return hs.includes(q);
        });
      }
      return rows;
    }

    let filtered = employees;

    // Regular employees (not admin, not lead, not manager) only see their
    // own record. Admins see everyone, leads/managers see their department.
    if (!isAdmin && !isTeamLead && !isManager && user?.id) {
      filtered = filtered.filter(emp => emp.id === user.id);
      return filtered;
    }

    // For Team Leads/Managers, only show their department.
    // Skip this filter for admins — the seed flags Administrator as a
    // department lead too, which would otherwise hide everyone outside the
    // admin's own department (e.g. Sarah in NCFS).
    if (!isAdmin && (isTeamLead || isManager) && userDepartmentId) {
      filtered = filtered.filter(emp => emp.departmentId === userDepartmentId);
    }

    // Apply manual department filter (only for admins)
    if (isAdmin && selectedDepartmentFilter !== 'all') {
      filtered = filtered.filter(emp => emp.departmentId === selectedDepartmentFilter);
    }

    // Apply free-text search (name / email / phone / role / department)
    const q = (searchQuery || '').trim().toLowerCase();
    if (q) {
      filtered = filtered.filter(emp => {
        const haystack = [
          emp.fullName, emp.email, emp.phone, emp.role,
          getDepartmentName(emp.departmentId), emp.username
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(q);
      });
    }

    // Column sort
    if (sortKey) {
      const dir = sortDir === 'desc' ? -1 : 1;
      const get = (e) => {
        switch (sortKey) {
          case 'name':       return (e.fullName || '').toLowerCase();
          case 'email':      return (e.email || '').toLowerCase();
          case 'phone':      return (e.phone || '');
          case 'department': return (getDepartmentName(e.departmentId) || '').toLowerCase();
          case 'role':       return (e.role || '').toLowerCase();
          case 'status':     return (e.status || '');
          default:           return '';
        }
      };
      filtered = [...filtered].sort((a, b) => {
        const av = get(a), bv = get(b);
        if (av < bv) return -1 * dir;
        if (av > bv) return  1 * dir;
        return 0;
      });
    }

    return filtered;
  };

  const handleSortClick = (key) => {
    if (sortKey === key) {
      // Cycle asc → desc → off
      if (sortDir === 'asc')  setSortDir('desc');
      else { setSortKey(null); setSortDir('asc'); }
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortIndicator = (key) =>
    sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  const handleSaveEmployee = async (e) => {
    e.preventDefault();

    if (!formData.fullName.trim()) {
      window.toast.warning('Full name is required');
      return;
    }
    if (!formData.email.trim()) {
      window.toast.warning('Email is required');
      return;
    }
    if (!formData.departmentId) {
      window.toast.warning('Please select a department');
      return;
    }

    setCreating(true);
    try {
      const employeeData = {
        fullName: formData.fullName,
        email: formData.email,
        phone: formData.phone,
        username: formData.username || formData.fullName.toLowerCase().replace(/\s+/g, '_'),
        departmentId: formData.departmentId,
        role: formData.role,
        baseSalary: formData.baseSalary ? parseFloat(formData.baseSalary) : 0,
        isLead: formData.isLead,
        joiningDate: formData.joiningDate, // ADD THIS FIELD
        bankAccountNumber: formData.bankAccountNumber,
        bankName: formData.bankName,
        accountName: formData.accountName,
        ifscCode: formData.ifscCode,
        probationCompleted: formData.probationCompleted,
        // Empty string clears the column; non-empty writes through.
        probationEndDate: formData.probationEndDate || '',
        status: formData.isActive ? 'active' : 'inactive',
        startTime: formData.startTime,
        endTime: formData.endTime,
        // Data URL or empty string — userTableFields in employeeHandlers.js
        // already maps profilePicturePath → profile_picture_path.
        profilePicturePath: formData.profilePicturePath || '',
        // Drives the Birthday widget — never used in attendance / payroll math.
        dateOfBirth: formData.dateOfBirth || null,
        // Salary increment — backend only inserts a new row when BOTH are set
        // and at least one differs from the most-recent stored increment.
        lastIncrementDate: formData.lastIncrementDate || '',
        lastIncrementAmount: formData.lastIncrementAmount === '' ? '' : formData.lastIncrementAmount
      };


      let result;
      if (editingId) {
        result = await window.electron.updateEmployee(editingId, employeeData, user?.id);
      } else {
        result = await window.electron.createEmployee(employeeData, user?.id);
      }

      if (result.success) {

        let leadAssignmentMessage = '';

        // If this employee is marked as team lead, assign them to the department
        if (formData.isLead && formData.departmentId) {
          const empId = result.data.id || editingId;

          const assignResult = await window.electron.assignDepartmentLead(formData.departmentId, empId);


          if (assignResult.success) {
            leadAssignmentMessage = '\n✓ Team lead assigned to department';
          } else {
            console.error('[EMP] ✗ Team lead assignment failed:', assignResult.error);
            leadAssignmentMessage = '\n✗ Team lead assignment failed: ' + assignResult.error;
          }
        }

        resetForm();

        // Long delay to ensure database writes complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Force reload
        await loadEmployees();
        await loadDepartments();

        // Verify the lead was assigned by checking departments
        const verifyDepts = await window.electron.getDepartments();
        if (verifyDepts.success) {
          const assignedDept = verifyDepts.data.find(d => d.id === formData.departmentId);
          if (assignedDept && assignedDept.lead_name) {
          } else {
            console.warn('[EMP] ⚠ ISSUE: Department still has no lead after assignment');
          }
        }

        window.toast.success(editingId ? 'Employee updated successfully!' + leadAssignmentMessage : 'Employee created successfully!' + leadAssignmentMessage + '\n\nGo to Department Management to see the team lead assignment.');
      } else {
        window.toast.error('Error: ' + (result.message || result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error saving employee:', error);
      window.toast.error('Error: ' + error.message);
    } finally {
      setCreating(false);
    }
  };

  // Build and download an offer letter PDF from the current form data. Used
  // by the "Download Offer Letter" button in the edit modal.
  const handleGenerateOfferLetter = async () => {
    try {
      const dept = departments.find(d => d.id === formData.departmentId);
      const doc = buildOfferLetterDoc({
        candidateName: formData.fullName,
        position: formData.role || 'Employee',
        department: dept ? dept.name : '',
        startDate: formData.joiningDate,
        employmentType: formData.probationCompleted ? 'Permanent' : 'On Probation',
        baseSalary: formData.baseSalary,
        workingHours: `${formData.startTime || '09:00'} — ${formData.endTime || '18:00'}, Mon–Fri`,
        hrName: user?.fullName || 'HR Manager',
        hrEmail: user?.email || ''
      });
      const safeName = (formData.fullName || 'candidate').replace(/[^a-z0-9_\-]/gi, '_');
      const result = await generatePdf(doc, `Offer_Letter_${safeName}.pdf`);
      if (result.success) {
        window.toast.success('Offer letter generated.');
      } else {
        window.toast.error('Could not generate: ' + (result.error || 'Unknown error'));
      }
    } catch (e) {
      console.error('[OFFER PDF] generation failed:', e);
      window.toast.error('Could not generate offer letter: ' + e.message);
    }
  };

  const handleDeleteEmployee = (empId, empName) => {
    setConfirmDialog({
      title: 'Delete employee?',
      message: `"${empName}" will be removed from the system. This action cannot be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
      onConfirm: () => doDeleteEmployee(empId, empName)
    });
  };

  const doDeleteEmployee = async (empId, empName) => {
    try {
      const result = await window.electron.deleteEmployee(empId, user?.id);
      if (result.success) {
        window.toast.success('Employee deleted successfully!');
        await loadEmployees();
      } else {
        window.toast.error('Error deleting employee: ' + (result.message || result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error deleting employee:', error);
      window.toast.error('Error deleting employee: ' + error.message);
    }
  };

  const handleResetPassword = (empId, empName) => {
    setConfirmDialog({
      title: 'Reset password?',
      message: `${empName} will be required to set a new password on next login.`,
      confirmLabel: 'Reset password',
      tone: 'primary',
      onConfirm: () => doResetPassword(empId, empName)
    });
  };

  const doResetPassword = async (empId, empName) => {
    try {
      const result = await window.electron.resetUserPassword(empId);
      if (result.success) {
        window.toast.success(`Password reset for ${empName}. They will need to set a new password on next login.`);
      } else {
        window.toast.error('Error resetting password: ' + (result.message || result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error resetting password:', error);
      window.toast.error('Error resetting password: ' + error.message);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const result = await window.electron.downloadExcelTemplate();
      if (result.success) {
        // Convert buffer to blob
        const blob = new Blob([result.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'Employee_Template.xlsx';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      } else {
        window.toast.error('Error downloading template: ' + (result.message || result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error downloading template:', error);
      window.toast.error('Error: ' + error.message);
    }
  };

  const handleExportEmployees = async () => {
    try {
      if (employees.length === 0) {
        window.toast.warning('No employees to export');
        return;
      }

      const result = await window.electron.exportEmployees();
      if (result.success) {
        // v4.4.1: the backend returns the .xlsx body as a base64 string so
        // the binary survives JSON-over-HTTP on the web build. Decode it
        // back to a typed array before wrapping in the download Blob —
        // otherwise the Blob ends up containing the literal base64 text and
        // Excel rejects the file as corrupt.
        const binary = atob(result.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const timestamp = new Date().toISOString().split('T')[0];
        link.download = `Employees_${timestamp}.xlsx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      } else {
        window.toast.error('Error exporting employees: ' + (result.message || result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error exporting employees:', error);
      window.toast.error('Error: ' + error.message);
    }
  };

  const handleUploadEmployees = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      window.toast.warning('Please upload an Excel file (.xlsx or .xls)');
      return;
    }

    setUploadingFile(true);
    setUploadProgress('Reading file...');

    try {
      // Read file
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          // v4.4.1: ship the file as a base64 string so it survives
          // JSON-over-HTTP on the web build. Electron mode accepts the same
          // base64 (the handler decodes it back to a Buffer).
          const arrayBuffer = e.target.result;
          const bytes = new Uint8Array(arrayBuffer);
          let binary = '';
          // Chunked to avoid `Maximum call stack size exceeded` for ~MB files
          // that String.fromCharCode(...bytes) would hit when spread.
          const CHUNK = 0x8000;
          for (let i = 0; i < bytes.length; i += CHUNK) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
          }
          const fileBuffer = btoa(binary);

          // Parse Excel file
          setUploadProgress('Parsing Excel file...');
          const parseResult = await window.electron.parseExcelFile(fileBuffer);

          if (!parseResult.success) {
            const errorMsg = parseResult.data.errors.length > 0
              ? parseResult.data.errors.map(err => `Row ${err.rowIndex}: ${err.errors.join(', ')}`).join('\n')
              : 'Failed to parse Excel file';
            window.toast.error('Invalid Excel file:\n\n' + errorMsg);
            setUploadingFile(false);
            setUploadProgress(null);
            return;
          }

          // Validate against database
          setUploadProgress('Validating data against database...');
          const validationResult = await window.electron.validateExcelData(
            parseResult.data.data,
            departments
          );

          if (!validationResult.success) {
            const errorMsg = validationResult.data.errors.length > 0
              ? validationResult.data.errors.map(err => `Row ${err.rowIndex}: ${err.errors.join(', ')}`).join('\n')
              : 'Data validation failed';
            window.toast.error('Data validation errors:\n\n' + errorMsg);
            setUploadingFile(false);
            setUploadProgress(null);
            return;
          }

          // Confirm import via the modal, then continue with bulk create.
          // We can't synchronously block here the way window.confirm did, so
          // park the parsed rows in the modal's onConfirm callback. The user
          // either confirms (we run doBulkImport) or cancels (we clean up).
          const employeeList = parseResult.data.data
            .slice(0, 5)
            .map((emp, idx) => `${idx + 1}. ${emp.data.fullName} (${emp.data.email})`)
            .join('\n');
          const moreCount = parseResult.data.validRows > 5
            ? `\n... and ${parseResult.data.validRows - 5} more`
            : '';
          const confirmMsg = `Ready to import ${parseResult.data.validRows} employee(s):\n\n${employeeList}${moreCount}`;
          // Pause the spinner while the modal is open — the user might take
          // a while to read the list before clicking Confirm.
          setUploadProgress(null);
          setConfirmDialog({
            title: 'Import employees from Excel?',
            message: confirmMsg,
            confirmLabel: 'Import',
            tone: 'primary',
            onConfirm: () => doBulkImport(parseResult.data.data),
            onCancel: () => { setUploadingFile(false); }
          });
        } catch (error) {
          console.error('Error during import:', error);
          window.toast.error('Error: ' + error.message);
          setUploadingFile(false);
          setUploadProgress(null);
        }
      };
      reader.readAsArrayBuffer(file);
    } catch (error) {
      console.error('Error handling file:', error);
      window.toast.error('Error: ' + error.message);
      setUploadingFile(false);
      setUploadProgress(null);
    }
  };

  // Bulk-import follow-up — runs ONLY after the admin confirms the modal.
  // Kept at component scope so the modal's onConfirm callback can reach it.
  const doBulkImport = async (rows) => {
    setUploadProgress('Creating employees in database...');
    try {
      const createResult = await window.electron.bulkCreateEmployees(
        rows.map(emp => emp.data)
      );
      if (createResult.success) {
        window.toast.success(`✓ Successfully imported ${createResult.summary.created} employee(s)!`);
        await loadEmployees();
        if (fileInputRef.current) fileInputRef.current.value = '';
      } else {
        const errorDetails = createResult.data.failed.length > 0
          ? createResult.data.failed.map(f => `${f.employee.fullName}: ${f.error}`).join('\n')
          : 'Unknown error';
        window.toast.error(`Import completed with errors:\n\n${errorDetails}`);
        await loadEmployees();
      }
    } catch (error) {
      console.error('Error during bulk import:', error);
      window.toast.error('Error: ' + error.message);
    } finally {
      setUploadingFile(false);
      setUploadProgress(null);
    }
  };

  if (loading) return <div className="loading">Loading employees...</div>;

  return (
    <div className="manager-container">
      <div className="manager-header">
        <h2>Employee Directory {isTeamLead || isManager ? '(Your Department)' : ''}</h2>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Free-text search box — filters across name/email/phone/role/department.
              Visible to everyone (admin / lead / manager) — leads still only see
              their own department, but can find someone within it quickly. */}
          <input
            type="text"
            placeholder="🔍 Search…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              background: 'var(--bg-3)',
              color: 'var(--text)',
              fontSize: '14px',
              minWidth: '200px'
            }}
          />
          {isAdmin && viewMode === 'active' && (
            <select
              value={selectedDepartmentFilter}
              onChange={(e) => setSelectedDepartmentFilter(e.target.value)}
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                background: 'var(--bg-3)',
                color: 'var(--text)',
                fontSize: '14px',
                cursor: 'pointer'
              }}
            >
              <option value="all">All Departments</option>
              {departments.map(dept => (
                <option key={dept.id} value={dept.id}>
                  {dept.name}
                </option>
              ))}
            </select>
          )}
          {isAdmin && (
            <button
              className="btn btn-secondary"
              onClick={handleViewModeToggle}
              style={{ padding: '8px 14px', fontSize: '14px' }}
              title={viewMode === 'active'
                ? 'View employees who have been offboarded'
                : 'Return to active employees'}
            >
              {viewMode === 'active'
                ? `👥 Past Employees${offboardedEmployees.length > 0 ? ` (${offboardedEmployees.length})` : ''}`
                : '← Active Employees'}
            </button>
          )}
          {isAdmin && (
            <>
              <button
                className="btn btn-secondary"
                onClick={handleExportEmployees}
                style={{ padding: '8px 14px', fontSize: '14px' }}
              >
                💾 Export Employees
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingFile}
                style={{ padding: '8px 14px', fontSize: '14px' }}
              >
                {uploadingFile ? '⏳ Uploading...' : '📤 Upload Employees'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleUploadEmployees}
                style={{ display: 'none' }}
                disabled={uploadingFile}
              />
            </>
          )}
          {isAdmin && (
            <button className="btn btn-primary" onClick={() => setShowForm(true)}>
              + Add Employee
            </button>
          )}
        </div>
      </div>

      {uploadProgress && (
        <div style={{
          margin: '15px 0',
          padding: '12px 16px',
          backgroundColor: 'var(--bg-3)',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          color: 'var(--text-2)',
          fontSize: '14px'
        }}>
          ⏳ {uploadProgress}
        </div>
      )}

      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('name')}      title="Sort by name">Name{sortIndicator('name')}</th>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('email')}     title="Sort by email">Email{sortIndicator('email')}</th>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('phone')}     title="Sort by phone">Phone{sortIndicator('phone')}</th>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('department')} title="Sort by department">Department{sortIndicator('department')}</th>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('role')}      title="Sort by role">Role{sortIndicator('role')}</th>
              {/* Salary column intentionally removed — salary is now only
                  visible inside the Edit Employee modal. */}
              <th>Team Lead</th>
              {isAdmin && <th title="Last login">Last Login</th>}
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('status')}    title="Sort by status">Status{sortIndicator('status')}</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {getFilteredEmployees().map(emp => (
              <tr key={emp.id}>
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
                    <Avatar
                      src={emp.profile_picture_path || emp.profilePicturePath}
                      name={emp.fullName}
                      size={32}
                    />
                    <strong>{emp.fullName}</strong>
                  </span>
                </td>
                <td>{emp.email}</td>
                <td>{emp.phone || '-'}</td>
                <td>{getDepartmentName(emp.departmentId)}</td>
                <td>{emp.role}</td>
                <td>
                  {emp.isLead ? (
                    <span className="badge" style={{backgroundColor: '#f59e0b', color: 'white'}}>👔 Team Lead</span>
                  ) : (
                    <span style={{color: 'var(--text-2)'}}>-</span>
                  )}
                </td>
                {isAdmin && (
                  <td style={{ fontSize: '12px', color: 'var(--text-2)' }}>
                    {emp.last_login_at
                      ? new Date(emp.last_login_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                      : <span style={{ color: '#f59e0b' }}>Never</span>}
                  </td>
                )}
                <td>
                  <span className={`badge badge-${emp.status === 'active' ? 'success' : 'danger'}`}>
                    {emp.status}
                  </span>
                </td>
                <td style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {isAdmin ? (
                    viewMode === 'offboarded' ? (
                      <>
                        <button
                          className="btn btn-secondary"
                          onClick={() => handleReactivate({ id: emp.id, full_name: emp.fullName })}
                          style={{padding: '6px 12px', fontSize: '12px'}}
                          title={`Reactivate ${emp.fullName} — sets status back to active`}
                        >
                          ↩️ Reactivate
                        </button>
                        {emp.last_working_day && (
                          <span style={{ fontSize: '11px', color: 'var(--text-3)', alignSelf: 'center' }} title={emp.exit_notes || ''}>
                            {emp.exit_reason || '—'} · {emp.last_working_day}
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <button
                          className="btn btn-secondary"
                          onClick={() => handleOpenEditForm(emp)}
                          style={{padding: '6px 12px', fontSize: '12px'}}
                        >
                          ✏️ Edit
                        </button>
                        <button
                          className="btn"
                          onClick={() => handleResetPassword(emp.id, emp.fullName)}
                          style={{padding: '6px 12px', fontSize: '12px', background: '#f59e0b', color: 'white', border: 'none', borderRadius: '4px'}}
                          title="Reset password (user will set new password on next login)"
                        >
                          🔐 Reset PWD
                        </button>
                        <button
                          className="btn"
                          onClick={() => handleOpenOffboard(emp)}
                          style={{padding: '6px 12px', fontSize: '12px', background: '#a78bfa', color: 'white', border: 'none', borderRadius: '4px'}}
                          title="Offboard — capture exit details and mark inactive"
                        >
                          👋 Offboard
                        </button>
                        <button
                          className="btn btn-danger"
                          onClick={() => handleDeleteEmployee(emp.id, emp.fullName)}
                          style={{padding: '6px 12px', fontSize: '12px'}}
                        >
                          🗑️ Delete
                        </button>
                      </>
                    )
                  ) : (
                    <span style={{ color: 'var(--text-3)', fontSize: '12px' }}>View Only</span>
                  )}
                </td>
              </tr>
            ))}
            {viewMode === 'active' && employees.length === 0 && (
              <tr>
                <td colSpan="11" style={{ textAlign: 'center', padding: '30px' }}>
                  No employees found. Click "+ Add Employee" to get started.
                </td>
              </tr>
            )}
            {viewMode === 'offboarded' && offboardedEmployees.length === 0 && (
              <tr>
                <td colSpan="11" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-2)' }}>
                  No past employees yet — offboarded employees will appear here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && isAdmin && (
        <div className="modal-overlay" onClick={() => !creating && resetForm()}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>{editingId ? 'Edit Employee' : 'Add New Employee'}</h3>
            <form onSubmit={handleSaveEmployee}>
              {/* Profile picture — circular preview + Choose / Remove buttons.
                  Picture is square-cropped + resized to 200×200 in-browser
                  before saving so the DB row stays small. */}
              <div
                className="form-group"
                style={{ display: 'flex', alignItems: 'center', gap: '14px' }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer?.files?.[0];
                  if (file) handlePickProfilePicture(file);
                }}
              >
                <div style={{
                  width: 72, height: 72, borderRadius: '50%', overflow: 'hidden',
                  background: '#f59e0b', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '26px', fontWeight: 700, flexShrink: 0,
                  border: '2px dashed rgba(255,255,255,0.25)',
                  title: 'Drop an image here'
                }}>
                  {formData.profilePicturePath ? (
                    <img
                      src={formData.profilePicturePath}
                      alt="Profile preview"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    (formData.fullName || '?').charAt(0).toUpperCase()
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', marginBottom: '4px' }}>Profile Picture</label>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <label
                      className="btn btn-secondary btn-sm"
                      style={{ cursor: 'pointer', padding: '6px 12px', fontSize: '12px' }}
                    >
                      {formData.profilePicturePath ? 'Replace…' : 'Choose Image…'}
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        disabled={creating}
                        onChange={e => handlePickProfilePicture(e.target.files && e.target.files[0])}
                      />
                    </label>
                    {formData.profilePicturePath && (
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        style={{ padding: '6px 12px', fontSize: '12px' }}
                        onClick={() => setFormData({ ...formData, profilePicturePath: '' })}
                        disabled={creating}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <p style={{ margin: '4px 0 0', fontSize: '11px', color: 'var(--text-2)' }}>
                    Optional. Drag an image onto the avatar or click Choose. Auto-resized to a 200×200 square — original is not stored.
                  </p>
                </div>
              </div>

              <div className="form-group" title="The employee's full legal name. Shown everywhere — dashboards, attendance grids, payroll register, audit log.">
                <label>Full Name *</label>
                <input
                  type="text"
                  placeholder="John Doe"
                  value={formData.fullName}
                  onChange={e => setFormData({...formData, fullName: e.target.value})}
                  disabled={creating}
                  required
                  title="The employee's full legal name."
                />
              </div>
              <div className="form-group" title="Used for login and any future notification emails. Must be unique across the company.">
                <label>Email *</label>
                <input
                  type="email"
                  placeholder="john@company.co.uk"
                  value={formData.email}
                  onChange={e => setFormData({...formData, email: e.target.value})}
                  disabled={creating}
                  required
                  title="Used for login. Must be unique."
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="form-group" title="Optional. For internal contact only — not used for login or notifications.">
                  <label>Phone Number</label>
                  <input
                    type="tel"
                    placeholder="+44 20 7946 0958"
                    value={formData.phone}
                    onChange={e => setFormData({...formData, phone: e.target.value})}
                    disabled={creating}
                    title="Optional. For internal contact only."
                  />
                </div>
                <div className="form-group" title="Annual base salary in INR. Drives payroll calculations. Hidden from non-admins in listings.">
                  <label>Base Salary</label>
                  <input
                    type="number"
                    placeholder="50000"
                    value={formData.baseSalary}
                    onChange={e => setFormData({...formData, baseSalary: e.target.value})}
                    disabled={creating}
                    title="Annual base salary. Drives payroll."
                  />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="form-group" title="The team this employee belongs to. Drives the lead-approval routing and attendance views.">
                  <label>Department *</label>
                  <select
                    value={formData.departmentId}
                    onChange={e => setFormData({...formData, departmentId: e.target.value})}
                    disabled={creating || departments.length === 0}
                    required
                    title="Drives lead-approval routing and team views."
                  >
                    <option value="">Select Department</option>
                    {departments.map(dept => (
                      <option key={dept.id} value={dept.id}>
                        {dept.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group" title="Determines which dashboard the user lands on after login: Admin/MD/Manager → Admin; Lead → Lead; User/Employee → Employee.">
                  <label>Role</label>
                  <select
                    value={formData.role}
                    onChange={e => setFormData({...formData, role: e.target.value})}
                    disabled={creating}
                  >
                    <option value="Employee">Employee</option>
                    <option value="Lead">Team Lead</option>
                    <option value="Manager">Manager</option>
                    <option value="Admin">Admin</option>
                    <option value="MD">Managing Director</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="form-group" title="The date this employee started. Drives tenure display and prorated leave allocation.">
                  <label>Joining Date *</label>
                  <input
                    type="date"
                    value={formData.joiningDate}
                    onChange={e => setFormData({...formData, joiningDate: e.target.value})}
                    disabled={creating}
                    required
                    title="The date this employee started. Drives tenure display and prorated leave allocation."
                  />
                </div>
                <div className="form-group" title="Date of birth — feeds the Birthday widget on the dashboards. Not used for any pay or attendance math.">
                  <label>Date of Birth</label>
                  <input
                    type="date"
                    value={formData.dateOfBirth}
                    onChange={e => setFormData({...formData, dateOfBirth: e.target.value})}
                    disabled={creating}
                    title="Optional. Drives the Birthday widget on dashboards."
                  />
                </div>
                <div className="form-group" title="Indian bank routing code. Optional unless you need to pay them through payroll.">
                  <label>IFSC Code</label>
                  <input
                    type="text"
                    placeholder="SBIN0001234"
                    value={formData.ifscCode}
                    onChange={e => setFormData({...formData, ifscCode: e.target.value})}
                    disabled={creating}
                  />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="form-group" title="The employee's expected daily start time. Drives the Punctuality score on performance reviews.">
                  <label>Start Time</label>
                  <input
                    type="time"
                    value={formData.startTime}
                    onChange={e => setFormData({...formData, startTime: e.target.value})}
                    disabled={creating}
                    title="Expected start time. Drives Punctuality scoring."
                  />
                </div>
                <div className="form-group" title="The employee's expected daily end time. Used for early-departure detection.">
                  <label>End Time</label>
                  <input
                    type="time"
                    value={formData.endTime}
                    onChange={e => setFormData({...formData, endTime: e.target.value})}
                    disabled={creating}
                    title="Expected end time. Used for early-departure detection."
                  />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="form-group" title="Bank name as it appears on the cheque book. Optional unless payroll is going through TaskTango.">
                  <label>Bank Name</label>
                  <input
                    type="text"
                    placeholder="State Bank of India"
                    value={formData.bankName}
                    onChange={e => setFormData({...formData, bankName: e.target.value})}
                    disabled={creating}
                    title="Bank name. Used for payroll."
                  />
                </div>
                <div className="form-group" title="The account holder's name as it appears on the bank record. Usually the same as Full Name unless they bank jointly.">
                  <label>Account Name</label>
                  <input
                    type="text"
                    placeholder="John Doe"
                    value={formData.accountName}
                    onChange={e => setFormData({...formData, accountName: e.target.value})}
                    disabled={creating}
                    title="Account holder name as on the bank record."
                  />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="form-group" title="The bank account number salary will be paid into. Masked in displays — never shown in full to non-admins.">
                  <label>Bank Account Number</label>
                  <input
                    type="text"
                    placeholder="1234567890123456"
                    value={formData.bankAccountNumber}
                    onChange={e => setFormData({...formData, bankAccountNumber: e.target.value})}
                    disabled={creating}
                    title="Bank account number. Masked in displays."
                  />
                </div>
                <div className="form-group" title="Indian bank routing code. Required for payroll transfers; ignored if you process pay externally.">
                  <label>IFSC Code</label>
                  <input
                    type="text"
                    placeholder="SBIN0001234"
                    value={formData.ifscCode}
                    onChange={e => setFormData({...formData, ifscCode: e.target.value.toUpperCase()})}
                    disabled={creating}
                  />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '8px' }} title="Tick if this person leads the chosen Department. They'll see the Lead Dashboard after login and receive leave-approval requests from their team.">
                  <input
                    type="checkbox"
                    id="isLead"
                    checked={formData.isLead}
                    onChange={e => setFormData({...formData, isLead: e.target.checked})}
                    disabled={creating || !formData.departmentId}
                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    title="Tick if this person leads the chosen Department."
                  />
                  <label htmlFor="isLead" style={{ margin: 0, cursor: 'pointer', fontWeight: '500' }}>
                    👔 Team Lead
                  </label>
                </div>
                <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '8px' }} title="Active employees can log in and appear in lists. Inactive employees are hidden from most views but their historical data is preserved.">
                  <input
                    type="checkbox"
                    id="isActive"
                    checked={formData.isActive}
                    onChange={e => setFormData({...formData, isActive: e.target.checked})}
                    disabled={creating}
                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    title="Active = can log in. Inactive = hidden but history kept."
                  />
                  <label htmlFor="isActive" style={{ margin: 0, cursor: 'pointer', fontWeight: '500' }}>
                    {formData.isActive ? '✅ Active' : '❌ Inactive'}
                  </label>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div
                  className="form-group"
                  style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                  title="On probation = no paid leave accrues, and any leave taken is recorded as unpaid. Tick when probation is finished so the employee starts earning paid leave."
                >
                  <input
                    type="checkbox"
                    id="probationCompleted"
                    checked={formData.probationCompleted}
                    onChange={e => setFormData({...formData, probationCompleted: e.target.checked})}
                    disabled={creating}
                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                  />
                  <label htmlFor="probationCompleted" style={{ margin: 0, cursor: 'pointer', fontWeight: '500' }}>
                    {formData.probationCompleted ? '✅ Probation Completed' : '⏳ On Probation'}
                  </label>
                </div>
                {/* Probation End Date — only relevant when still on probation,
                    but we always show it so admins can see / clear the value. */}
                <div className="form-group" title="The date this employee's probation ends. Leave blank if they're already permanent.">
                  <label>Probation End Date</label>
                  <input
                    type="date"
                    value={formData.probationEndDate}
                    onChange={e => setFormData({ ...formData, probationEndDate: e.target.value })}
                    disabled={creating}
                  />
                </div>
              </div>
              {/* Last salary increment — pre-filled from salary_increments,
                  saving with a NEW combination inserts a new history row. */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="form-group" title="Date of the most recent salary raise. Saving a different date or amount adds a new row to the salary history (existing history is preserved).">
                  <label>Last Increment Date</label>
                  <input
                    type="date"
                    value={formData.lastIncrementDate}
                    onChange={e => setFormData({ ...formData, lastIncrementDate: e.target.value })}
                    disabled={creating}
                  />
                </div>
                <div className="form-group" title="Increment amount (in the currency of base salary). Shown on the performance-review screen.">
                  <label>Last Increment Amount</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="e.g. 5000"
                    value={formData.lastIncrementAmount}
                    onChange={e => setFormData({ ...formData, lastIncrementAmount: e.target.value })}
                    disabled={creating}
                  />
                </div>
              </div>
              {/* Manual leave-balance override — only on edit (existing
                  employee). Lets admin set "Remaining" days for each leave
                  type, superseding the auto-calculation. */}
              {editingId && (
                <div style={{
                  marginTop: '12px',
                  padding: '14px 16px',
                  borderRadius: '8px',
                  background: 'rgba(30, 64, 175, 0.08)',
                  border: '1px solid rgba(30, 64, 175, 0.2)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <strong style={{ color: 'var(--text)' }}>🌴 Leave Balance Override</strong>
                    <span style={{ fontSize: '11px', color: 'var(--text-2)' }}>
                      Set a custom "Remaining" — supersedes the auto allocation
                    </span>
                  </div>
                  {balancesLoading ? (
                    <p style={{ color: 'var(--text-2)', margin: 0 }}>Loading balances…</p>
                  ) : editingBalances.length === 0 ? (
                    <p style={{ color: 'var(--text-2)', margin: 0 }}>No leave types found.</p>
                  ) : (
                    <table className="table" style={{ marginBottom: 0 }}>
                      <thead>
                        <tr>
                          <th>Leave Type</th>
                          <th style={{ width: '90px' }}>Used</th>
                          <th style={{ width: '110px' }}>Current</th>
                          <th style={{ width: '140px' }}>New Remaining</th>
                          <th style={{ width: '180px' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {editingBalances.map(b => (
                          <tr key={b.leave_type_id}>
                            <td>
                              {b.leave_type_name}
                              {b.manual_override && (
                                <span style={{
                                  marginLeft: 6, fontSize: '10px', padding: '1px 6px', borderRadius: 8,
                                  background: '#fef3c7', color: '#78350f', fontWeight: 700
                                }}>
                                  MANUAL
                                </span>
                              )}
                            </td>
                            <td>{b.used}</td>
                            <td>{b.remaining}</td>
                            <td>
                              <input
                                type="number"
                                step="0.5"
                                min="0"
                                value={balanceOverrideInput[b.leave_type_id] ?? ''}
                                onChange={e => setBalanceOverrideInput({
                                  ...balanceOverrideInput,
                                  [b.leave_type_id]: e.target.value
                                })}
                                style={{ width: '100%', padding: '5px 8px', borderRadius: '4px' }}
                              />
                            </td>
                            <td style={{ display: 'flex', gap: '6px' }}>
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                onClick={() => handleSaveBalanceOverride(b.leave_type_id)}
                                style={{ padding: '4px 10px', fontSize: '11px' }}
                                title="Save this remaining value as a manual override"
                              >
                                Save
                              </button>
                              {b.manual_override && (
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => handleResetBalanceOverride(b.leave_type_id)}
                                  style={{ padding: '4px 10px', fontSize: '11px' }}
                                  title="Clear the override and let the system auto-calculate again"
                                >
                                  Reset
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* v4.7.5 — Probation deposit panel with admin Release button.
                  Only shown when editing — newly-created employees will have
                  their deposit auto-created by the backend and visible after
                  the form reopens. */}
              {editingId && (
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: '20px', paddingTop: '10px' }}>
                  <ProbationDepositPanel
                    userId={editingId}
                    canManage={true}
                    currentUserId={user?.id}
                  />
                </div>
              )}

              {/* Document attachments — only available when editing an existing
                  employee (we need a user_id to link the file rows to). */}
              {editingId && (
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: '20px', paddingTop: '10px' }}>
                  <EmployeeDocuments
                    userId={editingId}
                    callerId={user?.id}
                    canManage={true}
                  />
                </div>
              )}

              {/* HR documents — generate an offer letter PDF from the form
                  state. Only meaningful when editing an existing employee,
                  but the form has full data either way so we don't hide it
                  on create — just disable until the required bits are set. */}
              {editingId && (
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: '20px', paddingTop: '10px' }}>
                  <h3 style={{ margin: '0 0 10px 0' }}>📄 HR Documents</h3>
                  <p style={{ margin: '0 0 12px 0', color: 'var(--text-2)', fontSize: '13px' }}>
                    Generate a printable offer letter for this employee based on the form values above.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => handleGenerateOfferLetter()}
                    disabled={!formData.fullName || !formData.joiningDate}
                    title={!formData.fullName || !formData.joiningDate ? 'Full Name and Joining Date are required' : 'Download offer letter PDF'}
                  >
                    📄 Download Offer Letter (PDF)
                  </button>
                </div>
              )}

              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => resetForm()} disabled={creating}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={creating || departments.length === 0}>
                  {creating ? (editingId ? 'Updating...' : 'Creating...') : (editingId ? 'Update Employee' : 'Create Employee')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation modal — replaces every former window.confirm call.
          Receives {title, message, confirmLabel, tone, onConfirm, onCancel}. */}
      {confirmDialog && (
        <ConfirmModal
          isOpen={true}
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          tone={confirmDialog.tone}
          onConfirm={confirmDialog.onConfirm}
          onClose={() => {
            if (typeof confirmDialog.onCancel === 'function') confirmDialog.onCancel();
            setConfirmDialog(null);
          }}
        />
      )}

      {/* Offboarding modal — opens when handleOpenOffboard sets offboardingEmp. */}
      {offboardingEmp && (
        <OffboardEmployeeModal
          employee={offboardingEmp}
          currentUserId={user?.id}
          onSuccess={handleOffboardSuccess}
          onCancel={handleCloseOffboard}
        />
      )}
    </div>
  );
}

export default EmployeeManager;
