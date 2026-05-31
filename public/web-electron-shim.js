/**
 * Web Electron Shim
 *
 * Polyfills window.electron when running in a regular browser. Every call is
 * forwarded over HTTP to /api/invoke on the TaskTango backend (default
 * localhost:3002). The shim's API surface MUST mirror src/main/preload.js
 * one-for-one — every renderer component assumes the same method names and
 * argument shapes. If a method is missing here, the renderer throws
 * "undefined is not a function" and any Promise.all the call sits inside
 * rejects, which tanks unrelated tiles (e.g. the dashboard counters).
 *
 * When adding a new method to preload.js: add the matching entry here too.
 */
(function () {
  'use strict';

  // If window.electron already exists, we're inside Electron - do nothing
  if (typeof window.electron !== 'undefined') {
    console.log('[WEB-SHIM] Electron API already present, skipping shim');
    return;
  }

  // Bump this whenever the shim's API surface changes so the version printed
  // in DevTools tells us at a glance whether a stale copy is cached.
  const SHIM_VERSION = '2.1.0';
  console.log('[WEB-SHIM v' + SHIM_VERSION + '] Browser detected, installing web shim for window.electron');

  // Reads the currently cached user (set on auth:login). Used as a fallback so
  // signIn/signOut still work even if a caller forgot to pass user.id.
  function cachedUserId() {
    try {
      const direct = localStorage.getItem('tasktango_user_id');
      if (direct) return direct;
      const raw = localStorage.getItem('tasktango_user');
      if (raw) return (JSON.parse(raw) || {}).id || null;
    } catch (_) { /* ignore */ }
    return null;
  }

  // API endpoint (the Electron app's HTTP server).
  // When the page is served from the same host as the API (the normal LAN
  // deployment), use a relative URL so cross-machine browsers reach the
  // correct server. Only fall back to localhost for file:// or other edge
  // cases — and let TASKTANGO_API_URL override either way.
  function defaultApiUrl() {
    if (window.TASKTANGO_API_URL) return window.TASKTANGO_API_URL;
    if (window.location && window.location.protocol.startsWith('http')) {
      return window.location.origin + '/api/invoke';
    }
    return 'http://localhost:3002/api/invoke';
  }
  const API_URL = defaultApiUrl();
  console.log('[WEB-SHIM] API URL =', API_URL);

  /**
   * Calls the backend through the HTTP API.
   * @param {string} channel - The IPC channel name (e.g., 'auth:login')
   * @param {Object} args - The arguments to pass to the handler
   * @returns {Promise<Object>} The handler's response
   */
  async function invoke(channel, args) {
    try {
      const userId = localStorage.getItem('tasktango_user_id') || '';

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId
        },
        body: JSON.stringify({ channel, args: args || {} }),
        credentials: 'include'
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        console.error(`[WEB-SHIM] HTTP ${response.status} for ${channel}:`, errorText);

        // Try to parse as JSON, fall back to raw text
        try {
          return JSON.parse(errorText);
        } catch {
          return { success: false, message: `HTTP ${response.status}: ${errorText}` };
        }
      }

      const data = await response.json();

      // Persist user ID on login so subsequent requests are authenticated
      if (channel === 'auth:login' && data.success && data.user && data.user.id) {
        localStorage.setItem('tasktango_user_id', data.user.id);
        localStorage.setItem('tasktango_user', JSON.stringify(data.user));
      }

      // Clear user data on logout
      if (channel === 'auth:logout') {
        localStorage.removeItem('tasktango_user_id');
        localStorage.removeItem('tasktango_user');
      }

      return data;
    } catch (error) {
      console.error(`[WEB-SHIM] Network error calling ${channel}:`, error);
      return {
        success: false,
        message: 'Cannot reach the TaskTango backend. Make sure the desktop app is running on port 3002.'
      };
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // API surface — mirror of src/main/preload.js
  // ──────────────────────────────────────────────────────────────────────────
  const electron = {
    // Auth
    login: (email, password, clientInfo) => {
      // Auto-fill clientInfo with the browser UA + best-effort device label so
      // the user's session list has useful labels. IP is captured server-side.
      const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || null;
      const info = { userAgent: ua, ...(clientInfo || {}) };
      return invoke('auth:login', { email, password, clientInfo: info });
    },
    changePassword: (oldPassword, newPassword, confirmPassword) =>
      invoke('auth:changePassword', { oldPassword, newPassword, confirmPassword }),
    changePasswordFirstLogin: (newPassword, confirmPassword) =>
      invoke('auth:changePasswordFirstLogin', { newPassword, confirmPassword }),
    validatePassword: (password) => invoke('auth:validatePassword', { password }),
    logout: () => {
      localStorage.removeItem('tasktango_user_id');
      localStorage.removeItem('tasktango_user');
      return invoke('auth:logout');
    },
    // In web mode, the backend's in-memory session is shared across clients,
    // so we cache the user in localStorage and restore from there on reload.
    getCurrentUser: () => {
      const cached = localStorage.getItem('tasktango_user');
      if (cached) {
        try {
          return Promise.resolve(JSON.parse(cached));
        } catch (e) {
          return Promise.resolve(null);
        }
      }
      return Promise.resolve(null);
    },
    createUser: (username, fullName, roleId, departmentId, isLead) =>
      invoke('auth:createUser', { username, fullName, roleId, departmentId, isLead }),
    resetUserPassword: (userId) => invoke('auth:resetUserPassword', { userId }),
    getPasswordRules: () => invoke('auth:getPasswordRules'),

    // Attendance — preload passes userId so the handler can attribute
    // sign-in/out to the right person; the shim used to omit it which made
    // the buttons silently no-op in web mode. The localStorage fallback also
    // covers the case where a browser still has an older cached shim that
    // calls signIn() with no args — we read the user id from the cached
    // session instead of returning "userId required".
    signIn: (userId) => invoke('attendance:signIn', { userId: userId || cachedUserId() }),
    signOut: (userId) => invoke('attendance:signOut', { userId: userId || cachedUserId() }),
    isTodayNonWorking: () => invoke('attendance:isTodayNonWorking'),
    getAttendanceHistory: (userId, startDate, endDate) =>
      invoke('attendance:getHistory', { userId, startDate, endDate }),
    getAttendanceByDate: (date, departmentId) =>
      invoke('attendance:getByDate', { date, departmentId }),
    // Per-day Present/Absent/Leave/Half-day counts over a date range — powers
    // the Admin 30-day trend chart and the Lead weekly stacked bar. Without
    // this in the shim, the dashboard's Promise.all threw TypeError and every
    // stat tile stayed at 0 in web mode.
    getAttendanceRangeSummary: (startDate, endDate, departmentId) =>
      invoke('attendance:getRangeSummary', { startDate, endDate, departmentId }),
    createAttendance: (id, userId, date, signInTime, signOutTime, status, notes) =>
      invoke('attendance:create', { id, userId, date, signInTime, signOutTime, status, notes }),
    updateAttendanceStatus: (attendanceId, status, notes, signInTime, signOutTime) =>
      invoke('attendance:updateStatus', { attendanceId, status, notes, signInTime, signOutTime }),
    markHalfDay: (attendanceId) => invoke('attendance:markHalfDay', { attendanceId }),

    // Payroll
    getPayrollData: (userId, month, year) =>
      invoke('payroll:getData', { userId, month, year }),
    processMonthlyPayroll: (month, year) =>
      invoke('payroll:processMonthly', { month, year }),
    addExpense: (payrollId, category, amount, description) =>
      invoke('payroll:addExpense', { payrollId, category, amount, description }),
    getPayrollHistory: (userId) => invoke('payroll:getHistory', { userId }),

    // Leave — note the half-day opts that preload added; the shim now forwards
    // them so half-day leave requests submitted from the web behave the same.
    requestLeave: (leaveTypeId, startDate, endDate, reason, userId, opts = {}) =>
      invoke('leave:request', {
        leaveTypeId, startDate, endDate, reason, userId,
        isHalfDay: opts.isHalfDay === true,
        halfDaySession: opts.halfDaySession || null
      }),
    getLeaveBalance: (userId) => invoke('leave:getBalance', { userId }),
    getLeaveRequests: (userId) => invoke('leave:getRequests', { userId }),
    // Rollover-policy admin surface
    listLeaveTypesWithPolicy: () => invoke('leave:listLeaveTypes'),
    updateLeaveTypePolicy: (params) => invoke('leave:updateLeaveTypePolicy', params),
    getLeaveRolloverHistory: (userId) => invoke('leave:getRolloverHistory', { userId }),
    approveLeaveRequest: (requestId, notes, currentUserId) =>
      invoke('leave:approveRequest', { requestId, notes, currentUserId }),
    rejectLeaveRequest: (requestId, reason, currentUserId) =>
      invoke('leave:rejectRequest', { requestId, reason, currentUserId }),
    cancelLeaveRequest: (requestId, userId, reason) =>
      invoke('leave:cancelRequest', { requestId, userId, reason }),
    // Critical for the Lead/Admin dashboards: this was previously missing and
    // its absence rejected the dashboard's Promise.all, which then left every
    // counter tile stuck at 0 in web mode.
    getUpcomingLeaves: (departmentId) =>
      invoke('leave:getUpcoming', { departmentId }),
    setLeaveBalanceManual: (userId, leaveTypeId, remaining, currentUserId) =>
      invoke('leave:setBalanceManual', { userId, leaveTypeId, remaining, currentUserId }),
    getDepartmentLeaveRequests: (departmentId, leadId) =>
      invoke('leave:getDepartmentRequests', { departmentId, leadId }),
    getAssignedLeaveRequests: (approverId) =>
      invoke('leave:getAssignedRequests', { approverId }),
    calculateLeaveAllocation: (joiningDate, year) =>
      invoke('leave:calculateAllocation', { joiningDate, year }),
    getEmployeeAllocation: (userId) =>
      invoke('leave:getEmployeeAllocation', { userId }),

    // Application-menu role notifier. In Electron this triggers a native menu
    // rebuild; in the browser there is no native menu, so it's a no-op. Must
    // still exist — components call it unconditionally on role change.
    notifyUserRole: (_roleClass) => Promise.resolve({ success: true }),

    // Notification centre
    listNotifications: (userId, opts) => invoke('notification:list', { userId, ...(opts || {}) }),
    unreadNotifications: (userId) => invoke('notification:unreadCount', { userId }),
    markNotificationRead: (id, userId) => invoke('notification:markRead', { id, userId }),
    markAllNotificationsRead: (userId) => invoke('notification:markAllRead', { userId }),

    // Upcoming birthdays + anniversaries (v1.4)
    getUpcomingCelebrations: (opts = {}) => invoke('employee:getUpcomingCelebrations', opts),

    // Settings + DB backup
    listSettings: () => invoke('settings:list'),
    getSetting: (key) => invoke('settings:get', { key }),
    setSetting: (key, value) => invoke('settings:set', { key, value }),
    downloadDbBackup: () => invoke('settings:downloadBackup'),
    // v4.5 — admin nuke for testing data; pass 'WIPE' to confirm.
    wipeTestData:     (confirm) => invoke('admin:wipeTestData', { confirm }),

    // Holidays
    getHolidaysList: () => invoke('holiday:getList', {}),
    getHolidaysByMonth: (year, month) =>
      invoke('holiday:getByMonth', { year, month }),
    createHoliday: (date, name, description) =>
      invoke('holiday:create', { date, name, description }),
    updateHoliday: (id, date, name, description) =>
      invoke('holiday:update', { id, date, name, description }),
    deleteHoliday: (id) => invoke('holiday:delete', { id }),

    // Employees — currentUserId is appended so audit logs attribute the
    // change to the admin who made it.
    getEmployees: () => invoke('employee:getAll'),
    getEmployeeById: (id) => invoke('employee:getById', { id }),
    getDepartmentEmployees: (departmentId) =>
      invoke('employee:getByDepartment', { departmentId }),
    createEmployee: (data, currentUserId) =>
      invoke('employee:create', { ...(data || {}), currentUserId }),
    updateEmployee: (id, data, currentUserId) =>
      invoke('employee:update', { id, ...(data || {}), currentUserId }),
    deleteEmployee: (id, currentUserId) =>
      invoke('employee:delete', { id, currentUserId }),
    // Offboarding flow (v3): captures exit metadata, auto-cancels future leaves.
    offboardEmployee: (id, lastWorkingDay, exitReason, exitNotes, checklist, currentUserId) =>
      invoke('employee:offboard', { id, lastWorkingDay, exitReason, exitNotes, checklist, currentUserId }),
    reactivateEmployee: (id, currentUserId) =>
      invoke('employee:reactivate', { id, currentUserId }),
    getOffboardedEmployees: () => invoke('employee:listOffboarded'),
    importEmployees: (csvData) => invoke('employee:import', { csvData }),
    updateBankingDetails: (userId, details) =>
      invoke('employee:updateBankingDetails', { userId, ...(details || {}) }),
    bulkCreateEmployees: (employees) => invoke('employee:bulkCreate', { employees }),
    getLastSalaryIncrement: (userId) => invoke('employee:getLastSalaryIncrement', { userId }),

    // Employee document attachments (contracts, IDs, offer letters)
    uploadEmployeeDocument: (params) => invoke('document:upload', params),
    listEmployeeDocuments: (userId, callerId) => invoke('document:list', { userId, callerId }),
    downloadEmployeeDocument: (documentId, callerId) =>
      invoke('document:download', { documentId, callerId }),
    deleteEmployeeDocument: (documentId, callerId) =>
      invoke('document:delete', { documentId, callerId }),

    // Chat (employee-to-employee direct messages)
    chatListContacts:      (userId)                          => invoke('chat:listContacts', { userId }),
    chatListConversations: (userId)                          => invoke('chat:listConversations', { userId }),
    chatStartConversation: (userId, otherUserId)             => invoke('chat:startConversation', { userId, otherUserId }),
    chatGetMessages:       (userId, conversationId, since)   => invoke('chat:getMessages', { userId, conversationId, since }),
    // v3.4: accepts an optional `attachment` payload { name, size, mime, base64 }.
    chatSendMessage:       (userId, conversationId, content, attachment) => invoke('chat:sendMessage', { userId, conversationId, content, attachment }),
    chatMarkRead:          (userId, conversationId)          => invoke('chat:markRead', { userId, conversationId }),
    chatGetUnreadCount:    (userId)                          => invoke('chat:getUnreadCount', { userId }),
    // v3.4 attachment fetch + open. Pass the absolute attachment_path stored
    // on the chat_messages row; the handler enforces a path-jail so only
    // files under userData/chat-attachments/ are reachable.
    chatGetPresence:       (userIds) => invoke('chat:getPresence', { userIds }),
    // v4.6 — broadcast a single message to many recipients in one shot
    chatBroadcast:         (userId, recipients, content, attachment) =>
      invoke('chat:broadcast', { userId, recipients, content, attachment }),
    // v4.6 — session management
    listMySessions:        ()             => invoke('auth:listMySessions'),
    revokeSession:         (sessionId)    => invoke('auth:revokeSession', { sessionId }),
    revokeAllOtherSessions:()             => invoke('auth:revokeAllOtherSessions'),
    completeOnboarding:    ()             => invoke('auth:completeOnboarding'),
    chatReadAttachment:    (attachmentPath) => invoke('chat:readAttachment', attachmentPath),
    chatOpenAttachment:    (attachmentPath) => invoke('chat:openAttachment', attachmentPath),
    // v4.0 voice/video call signalling. The actual media negotiation happens
    // in the browser via RTCPeerConnection — this only carries SDP/ICE packets.
    callSignal: (fromUserId, toUserId, type, payload, conversationId) =>
      invoke('call:signal', { fromUserId, toUserId, type, payload, conversationId }),
    chatStreamUrl: (userId, baseUrl) => {
      // Web mode: SSE goes back to the same host that served the page
      const base = baseUrl
        || (window.TASKTANGO_API_URL ? window.TASKTANGO_API_URL.replace(/\/api\/invoke\/?$/, '') : null)
        || (window.location && window.location.protocol.startsWith('http') ? window.location.origin : 'http://localhost:3002');
      return `${base.replace(/\/$/, '')}/api/chat/stream?userId=${encodeURIComponent(userId)}`;
    },

    // Excel Import/Export
    downloadExcelTemplate: () => invoke('excel:generateTemplate'),
    parseExcelFile: (fileBuffer) => invoke('excel:parseFile', { fileBuffer }),
    validateExcelData: (employees, departments) =>
      invoke('excel:validateData', { employees, departments }),
    exportEmployees: () => invoke('excel:exportEmployees'),

    // Departments
    getDepartments: () => invoke('department:getAll'),
    createDepartment: (name, description) =>
      invoke('department:create', { name, description }),
    updateDepartment: (id, name, description) =>
      invoke('department:update', { id, name, description }),
    assignDepartmentLead: (departmentId, userId) =>
      invoke('department:assignLead', { departmentId, userId }),
    deleteDepartment: (id) => invoke('department:delete', { id }),

    // Audit
    getAuditLogs: (filters) => invoke('audit:getLogs', filters),
    logAction: (action, entityType, entityId, oldValue, newValue, userId) =>
      invoke('audit:logAction', { action, entityType, entityId, oldValue, newValue, userId }),
    clearAuditLogs: (filtered, filters) =>
      invoke('audit:clearLogs', { filtered, filters }),

    // Deposits
    getAllDeposits: () => invoke('deposit:getAll'),
    getDepositById: (id) => invoke('deposit:getById', { id }),
    createDeposit: (userId, depositAmount, deductionStartMonth, deductionEndMonth, currentUserId) =>
      invoke('deposit:create', { userId, depositAmount, deductionStartMonth, deductionEndMonth, currentUserId }),
    updateDeposit: (id, depositAmount, status, deductionStartMonth, deductionEndMonth, currentUserId) =>
      invoke('deposit:update', { id, depositAmount, status, deductionStartMonth, deductionEndMonth, currentUserId }),
    deleteDeposit: (id, currentUserId) =>
      invoke('deposit:delete', { id, currentUserId }),

    // System
    getAppVersion: () => invoke('system:getVersion'),
    getSystemInfo: () => invoke('system:getInfo'),
    openFilePicker: () => invoke('system:openFilePicker'),

    // Time Logging
    createTimeLog: (userId, date, startTime, breakStartTime, breakEndTime, endTime) =>
      invoke('timelogging:createTimeLog', { userId, date, startTime, breakStartTime, breakEndTime, endTime }),
    getTimeLogs: (userId, startDate, endDate) =>
      invoke('timelogging:getTimeLogs', { userId, startDate, endDate }),
    updateTimeLog: (logId, data) =>
      invoke('timelogging:updateTimeLog', { logId, ...(data || {}) }),
    deleteTimeLog: (logId) =>
      invoke('timelogging:deleteTimeLog', { logId }),
    getUserTimeLogs: (userId, month, year) =>
      invoke('timelogging:getUserTimeLogs', { userId, month, year }),
    // v4.1: per-employee "right now" view powering the lead live-status widget.
    getTeamToday: (departmentId) =>
      invoke('timelogging:getTeamToday', { departmentId }),

    // Events
    getEvents: (userId, date) =>
      invoke('event:getByDate', { userId, date }),
    createEvent: (userId, date, time, activityType, notes) =>
      invoke('event:create', { userId, date, time, activityType, notes }),
    updateEvent: (eventId, time, activityType, notes) =>
      invoke('event:update', { eventId, time, activityType, notes }),
    deleteEvent: (eventId) =>
      invoke('event:delete', { eventId }),
    getEventsByRange: (userId, startDate, endDate) =>
      invoke('event:getByRange', { userId, startDate, endDate }),

    // Manager Reviews
    getManagerReview: (employeeId) => invoke('review:getLatestByEmployee', { employeeId }),
    createManagerReview: (employeeId, rating, comments) =>
      invoke('review:create', { employeeId, rating, comments }),
    updateManagerReview: (reviewId, rating, comments) =>
      invoke('review:update', { reviewId, rating, comments }),
    getAllReviews: () => invoke('review:getAll', {}),

    // Skill Assessments
    getEmployeeSkills: (employeeId) => invoke('skill:getByEmployee', { employeeId }),
    assessSkill: (employeeId, skillId, rating) =>
      invoke('skill:assess', { employeeId, skillId, rating }),
    getSkillsList: () => invoke('skill:getList', {}),

    // Debug
    debugGetStoreData: () => invoke('debug:getStoreData'),

    // Mark as web shim so components can detect environment if needed
    __isWebShim: true
  };

  // Provide a minimal ipcRenderer fallback for code that uses it directly
  const ipcRenderer = {
    invoke: (channel, args) => {
      // Special case: getCurrentUser should use localStorage in web mode
      if (channel === 'auth:getCurrentUser') {
        const cached = localStorage.getItem('tasktango_user');
        if (cached) {
          try {
            return Promise.resolve(JSON.parse(cached));
          } catch (e) {
            return Promise.resolve(null);
          }
        }
        return Promise.resolve(null);
      }
      return invoke(channel, args);
    },
    send: () => {}, // No-op in web mode
    on: () => {},
    removeListener: () => {},
    removeAllListeners: () => {}
  };

  // Expose on window so the rest of the app finds it
  window.electron = electron;
  window.ipcRenderer = ipcRenderer;
  window.__preloadStarted = true;

  console.log('[WEB-SHIM v' + SHIM_VERSION + '] ✓ window.electron installed (routes to', API_URL, ')');
})();
