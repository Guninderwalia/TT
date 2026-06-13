const { ipcRenderer } = require('electron');

// Mark that preload has started
window.__preloadStarted = true;

console.log('[PRELOAD] Loading preload script...');

// Function to expose electron API
function exposeElectronAPI() {
  const api = {
  // Auth
  login: (email, password, clientInfo) => ipcRenderer.invoke('auth:login', { email, password, clientInfo }),
  changePassword: (oldPassword, newPassword, confirmPassword) =>
    ipcRenderer.invoke('auth:changePassword', { oldPassword, newPassword, confirmPassword }),
  changePasswordFirstLogin: (newPassword, confirmPassword) =>
    ipcRenderer.invoke('auth:changePasswordFirstLogin', { newPassword, confirmPassword }),
  validatePassword: (password) => ipcRenderer.invoke('auth:validatePassword', { password }),
  logout: () => ipcRenderer.invoke('auth:logout'),
  getCurrentUser: () => ipcRenderer.invoke('auth:getCurrentUser'),
  createUser: (username, fullName, roleId, departmentId, isLead) =>
    ipcRenderer.invoke('auth:createUser', { username, fullName, roleId, departmentId, isLead }),
  resetUserPassword: (userId) => ipcRenderer.invoke('auth:resetUserPassword', { userId }),
  getPasswordRules: () => ipcRenderer.invoke('auth:getPasswordRules'),
  // v4.6 — sessions + onboarding
  listMySessions:           () => ipcRenderer.invoke('auth:listMySessions'),
  revokeSession:    (sessionId) => ipcRenderer.invoke('auth:revokeSession', { sessionId }),
  revokeAllOtherSessions:   () => ipcRenderer.invoke('auth:revokeAllOtherSessions'),
  completeOnboarding:       () => ipcRenderer.invoke('auth:completeOnboarding'),

  // Attendance
  signIn: (userId) => ipcRenderer.invoke('attendance:signIn', { userId }),
  signOut: (userId) => ipcRenderer.invoke('attendance:signOut', { userId }),
  isTodayNonWorking: () => ipcRenderer.invoke('attendance:isTodayNonWorking'),
  getAttendanceHistory: (userId, startDate, endDate) =>
    ipcRenderer.invoke('attendance:getHistory', { userId, startDate, endDate }),
  getAttendanceByDate: (date, departmentId) => ipcRenderer.invoke('attendance:getByDate', { date, departmentId }),
  getAttendanceRangeSummary: (startDate, endDate, departmentId) =>
    ipcRenderer.invoke('attendance:getRangeSummary', { startDate, endDate, departmentId }),
  createAttendance: (id, userId, date, signInTime, signOutTime, status, notes) =>
    ipcRenderer.invoke('attendance:create', { id, userId, date, signInTime, signOutTime, status, notes }),
  updateAttendanceStatus: (attendanceId, status, notes, signInTime, signOutTime) =>
    ipcRenderer.invoke('attendance:updateStatus', { attendanceId, status, notes, signInTime, signOutTime }),
  markHalfDay: (attendanceId) => ipcRenderer.invoke('attendance:markHalfDay', { attendanceId }),
  reverseSignOut: (userId, date, currentUserId) =>
    ipcRenderer.invoke('attendance:reverseSignOut', { userId, date, currentUserId }),

  // Ask Pulse AI assistant
  pulseStatus: () => ipcRenderer.invoke('ai:pulseStatus'),
  getPulseThread: (userId) => ipcRenderer.invoke('ai:getPulseThread', { userId }),
  askPulse: (userId, message) => ipcRenderer.invoke('ai:askPulse', { userId, message }),
  resetPulseThread: (userId) => ipcRenderer.invoke('ai:resetPulseThread', { userId }),

  // Payroll
  getPayrollData: (userId, month, year) =>
    ipcRenderer.invoke('payroll:getData', { userId, month, year }),
  processMonthlyPayroll: (month, year) =>
    ipcRenderer.invoke('payroll:processMonthly', { month, year }),
  addExpense: (payrollId, category, amount, description) =>
    ipcRenderer.invoke('payroll:addExpense', { payrollId, category, amount, description }),
  getPayrollHistory: (userId) => ipcRenderer.invoke('payroll:getHistory', { userId }),
  getPayrollPaidStatus: (userId, month, year) =>
    ipcRenderer.invoke('payroll:getPaidStatus', { userId, month, year }),
  setPayrollPaidStatus: (args) => ipcRenderer.invoke('payroll:setPaidStatus', args),

  // Leave
  requestLeave: (leaveTypeId, startDate, endDate, reason, userId, opts = {}) =>
    ipcRenderer.invoke('leave:request', {
      leaveTypeId, startDate, endDate, reason, userId,
      isHalfDay: opts.isHalfDay === true,
      halfDaySession: opts.halfDaySession || null,
      attachment: opts.attachment || null
    }),
  readLeaveAttachment: (attachmentPath) => ipcRenderer.invoke('leave:readAttachment', attachmentPath),
  getLeaveBalance: (userId) => ipcRenderer.invoke('leave:getBalance', { userId }),
  getLeaveRequests: (userId) => ipcRenderer.invoke('leave:getRequests', { userId }),
  // Rollover-policy admin surface
  listLeaveTypesWithPolicy: () => ipcRenderer.invoke('leave:listLeaveTypes'),
  updateLeaveTypePolicy: (params) => ipcRenderer.invoke('leave:updateLeaveTypePolicy', params),
  getLeaveRolloverHistory: (userId) => ipcRenderer.invoke('leave:getRolloverHistory', { userId }),
  approveLeaveRequest: (requestId, notes, currentUserId) =>
    ipcRenderer.invoke('leave:approveRequest', { requestId, notes, currentUserId }),
  rejectLeaveRequest: (requestId, reason, currentUserId) =>
    ipcRenderer.invoke('leave:rejectRequest', { requestId, reason, currentUserId }),
  cancelLeaveRequest: (requestId, userId, reason) =>
    ipcRenderer.invoke('leave:cancelRequest', { requestId, userId, reason }),
  getUpcomingLeaves: (departmentId) =>
    ipcRenderer.invoke('leave:getUpcoming', { departmentId }),
  setLeaveBalanceManual: (userId, leaveTypeId, remaining, currentUserId) =>
    ipcRenderer.invoke('leave:setBalanceManual', { userId, leaveTypeId, remaining, currentUserId }),

  // Tell the main process which role just logged in so the application menu
  // (Help → Training Guide) shows the right guide for them.
  notifyUserRole: (roleClass) => ipcRenderer.send('user:roleChanged', roleClass),

  // Notification centre
  listNotifications:     (userId, opts) => ipcRenderer.invoke('notification:list', { userId, ...opts }),
  unreadNotifications:   (userId) => ipcRenderer.invoke('notification:unreadCount', { userId }),
  markNotificationRead:  (id, userId) => ipcRenderer.invoke('notification:markRead', { id, userId }),
  markAllNotificationsRead: (userId) => ipcRenderer.invoke('notification:markAllRead', { userId }),

  // Upcoming birthdays + anniversaries
  getUpcomingCelebrations: (opts = {}) => ipcRenderer.invoke('employee:getUpcomingCelebrations', opts),

  // Settings + DB backup
  listSettings:        () => ipcRenderer.invoke('settings:list'),
  getSetting:          (key) => ipcRenderer.invoke('settings:get', { key }),
  setSetting:          (key, value) => ipcRenderer.invoke('settings:set', { key, value }),
  downloadDbBackup:    () => ipcRenderer.invoke('settings:downloadBackup'),
  // v4.5 — admin nuke: wipes employee-generated data, keeps admins + lookups.
  wipeTestData:        (confirm) => ipcRenderer.invoke('admin:wipeTestData', { confirm }),
  getDepartmentLeaveRequests: (departmentId, leadId) =>
    ipcRenderer.invoke('leave:getDepartmentRequests', { departmentId, leadId }),
  getAssignedLeaveRequests: (approverId) =>
    ipcRenderer.invoke('leave:getAssignedRequests', { approverId }),
  calculateLeaveAllocation: (joiningDate, year) =>
    ipcRenderer.invoke('leave:calculateAllocation', { joiningDate, year }),
  getEmployeeAllocation: (userId) =>
    ipcRenderer.invoke('leave:getEmployeeAllocation', { userId }),

  // Holidays
  getHolidaysList: () => ipcRenderer.invoke('holiday:getList', {}),
  getHolidaysByMonth: (year, month) =>
    ipcRenderer.invoke('holiday:getByMonth', { year, month }),
  createHoliday: (date, name, description) =>
    ipcRenderer.invoke('holiday:create', { date, name, description }),
  updateHoliday: (id, date, name, description) =>
    ipcRenderer.invoke('holiday:update', { id, date, name, description }),
  deleteHoliday: (id) => ipcRenderer.invoke('holiday:delete', { id }),

  // Employees
  getEmployees: () => ipcRenderer.invoke('employee:getAll'),
  getEmployeeById: (id) => ipcRenderer.invoke('employee:getById', { id }),
  getDepartmentEmployees: (departmentId) =>
    ipcRenderer.invoke('employee:getByDepartment', { departmentId }),
  createEmployee: (data, currentUserId) => ipcRenderer.invoke('employee:create', { ...data, currentUserId }),
  updateEmployee: (id, data, currentUserId) => ipcRenderer.invoke('employee:update', { id, ...data, currentUserId }),
  deleteEmployee: (id, currentUserId) => ipcRenderer.invoke('employee:delete', { id, currentUserId }),
  offboardEmployee: (id, lastWorkingDay, exitReason, exitNotes, checklist, currentUserId) =>
    ipcRenderer.invoke('employee:offboard', { id, lastWorkingDay, exitReason, exitNotes, checklist, currentUserId }),
  reactivateEmployee: (id, currentUserId) =>
    ipcRenderer.invoke('employee:reactivate', { id, currentUserId }),
  getOffboardedEmployees: () => ipcRenderer.invoke('employee:listOffboarded'),
  importEmployees: (csvData) => ipcRenderer.invoke('employee:import', { csvData }),
  updateBankingDetails: (userId, details) =>
    ipcRenderer.invoke('employee:updateBankingDetails', { userId, ...details }),
  bulkCreateEmployees: (employees) => ipcRenderer.invoke('employee:bulkCreate', { employees }),
  getLastSalaryIncrement: (userId) => ipcRenderer.invoke('employee:getLastSalaryIncrement', { userId }),

  // Employee document attachments (contracts, IDs, offer letters)
  uploadEmployeeDocument: (params) => ipcRenderer.invoke('document:upload', params),
  listEmployeeDocuments: (userId, callerId) =>
    ipcRenderer.invoke('document:list', { userId, callerId }),
  downloadEmployeeDocument: (documentId, callerId) =>
    ipcRenderer.invoke('document:download', { documentId, callerId }),
  deleteEmployeeDocument: (documentId, callerId) =>
    ipcRenderer.invoke('document:delete', { documentId, callerId }),

  // Chat (employee-to-employee direct messages)
  chatListContacts:      (userId)                        => ipcRenderer.invoke('chat:listContacts', { userId }),
  chatListConversations: (userId)                        => ipcRenderer.invoke('chat:listConversations', { userId }),
  chatStartConversation: (userId, otherUserId)           => ipcRenderer.invoke('chat:startConversation', { userId, otherUserId }),
  chatGetMessages:       (userId, conversationId, since) => ipcRenderer.invoke('chat:getMessages', { userId, conversationId, since }),
  chatSendMessage:       (userId, conversationId, content, attachment) => ipcRenderer.invoke('chat:sendMessage', { userId, conversationId, content, attachment }),
  chatGetPresence:       (userIds) => ipcRenderer.invoke('chat:getPresence', { userIds }),
  chatBroadcast: (userId, recipients, content, attachment) =>
    ipcRenderer.invoke('chat:broadcast', { userId, recipients, content, attachment }),
  chatReadAttachment:    (attachmentPath) => ipcRenderer.invoke('chat:readAttachment', attachmentPath),
  chatOpenAttachment:    (attachmentPath) => ipcRenderer.invoke('chat:openAttachment', attachmentPath),
  // v4.0 voice/video call signalling — relays SDP / ICE between two
  // conversation participants over the existing SSE channel.
  callSignal: (fromUserId, toUserId, type, payload, conversationId) =>
    ipcRenderer.invoke('call:signal', { fromUserId, toUserId, type, payload, conversationId }),
  chatMarkRead:          (userId, conversationId)        => ipcRenderer.invoke('chat:markRead', { userId, conversationId }),
  chatGetUnreadCount:    (userId)                        => ipcRenderer.invoke('chat:getUnreadCount', { userId }),
  // SSE — pure browser EventSource on the same host the renderer is loaded
  // from. In Electron the embedded server is at localhost:3002; the renderer
  // is loaded via file:// so we need an explicit URL — let the caller pass
  // a baseUrl override (the web shim auto-uses window.location.origin).
  chatStreamUrl:         (userId, baseUrl) => {
    const base = baseUrl || 'http://localhost:3002';
    return `${base.replace(/\/$/, '')}/api/chat/stream?userId=${encodeURIComponent(userId)}`;
  },

  // Excel Import/Export
  downloadExcelTemplate: () => ipcRenderer.invoke('excel:generateTemplate'),
  parseExcelFile: (fileBuffer) => ipcRenderer.invoke('excel:parseFile', { fileBuffer }),
  validateExcelData: (employees, departments) =>
    ipcRenderer.invoke('excel:validateData', { employees, departments }),
  exportEmployees: () => ipcRenderer.invoke('excel:exportEmployees'),

  // Departments
  getDepartments: () => ipcRenderer.invoke('department:getAll'),
  createDepartment: (name, description) =>
    ipcRenderer.invoke('department:create', { name, description }),
  updateDepartment: (id, name, description) =>
    ipcRenderer.invoke('department:update', { id, name, description }),
  assignDepartmentLead: (departmentId, userId) =>
    ipcRenderer.invoke('department:assignLead', { departmentId, userId }),
  deleteDepartment: (id) => ipcRenderer.invoke('department:delete', { id }),

  // Audit
  getAuditLogs: (filters) => ipcRenderer.invoke('audit:getLogs', filters),
  logAction: (action, entityType, entityId, oldValue, newValue, userId) =>
    ipcRenderer.invoke('audit:logAction', { action, entityType, entityId, oldValue, newValue, userId }),
  clearAuditLogs: (filtered, filters) =>
    ipcRenderer.invoke('audit:clearLogs', { filtered, filters }),

  // Deposits
  getAllDeposits: () => ipcRenderer.invoke('deposit:getAll'),
  getDepositById: (id) => ipcRenderer.invoke('deposit:getById', { id }),
  getDepositByUser: (userId) => ipcRenderer.invoke('deposit:getByUser', { userId }),
  createDeposit: (userId, depositAmount, deductionStartMonth, deductionEndMonth, currentUserId) =>
    ipcRenderer.invoke('deposit:create', { userId, depositAmount, deductionStartMonth, deductionEndMonth, currentUserId }),
  updateDeposit: (id, depositAmount, status, deductionStartMonth, deductionEndMonth, currentUserId) =>
    ipcRenderer.invoke('deposit:update', { id, depositAmount, status, deductionStartMonth, deductionEndMonth, currentUserId }),
  releaseDeposit: (id, currentUserId, notes) =>
    ipcRenderer.invoke('deposit:release', { id, currentUserId, notes }),
  deleteDeposit: (id, currentUserId) =>
    ipcRenderer.invoke('deposit:delete', { id, currentUserId }),

  // System
  getAppVersion: () => ipcRenderer.invoke('system:getVersion'),
  getSystemInfo: () => ipcRenderer.invoke('system:getInfo'),
  openFilePicker: () => ipcRenderer.invoke('system:openFilePicker'),

  // Time Logging
  createTimeLog: (userId, date, startTime, breakStartTime, breakEndTime, endTime) =>
    ipcRenderer.invoke('timelogging:createTimeLog', { userId, date, startTime, breakStartTime, breakEndTime, endTime }),
  getTimeLogs: (userId, startDate, endDate) =>
    ipcRenderer.invoke('timelogging:getTimeLogs', { userId, startDate, endDate }),
  updateTimeLog: (logId, data) =>
    ipcRenderer.invoke('timelogging:updateTimeLog', { logId, ...data }),
  deleteTimeLog: (logId) =>
    ipcRenderer.invoke('timelogging:deleteTimeLog', { logId }),
  getUserTimeLogs: (userId, month, year) =>
    ipcRenderer.invoke('timelogging:getUserTimeLogs', { userId, month, year }),
  // v4.1: live "who's on right now" snapshot for the lead dashboard widget.
  getTeamToday: (departmentId) =>
    ipcRenderer.invoke('timelogging:getTeamToday', { departmentId }),

  // Events
  getEvents: (userId, date) =>
    ipcRenderer.invoke('event:getByDate', { userId, date }),
  createEvent: (userId, date, time, activityType, notes) =>
    ipcRenderer.invoke('event:create', { userId, date, time, activityType, notes }),
  updateEvent: (eventId, time, activityType, notes, currentUserId) =>
    ipcRenderer.invoke('event:update', { eventId, time, activityType, notes, currentUserId }),
  deleteEvent: (eventId, currentUserId) =>
    ipcRenderer.invoke('event:delete', { eventId, currentUserId }),
  getEventsByRange: (userId, startDate, endDate) =>
    ipcRenderer.invoke('event:getByRange', { userId, startDate, endDate }),

  // Manager Reviews
  getManagerReview: (employeeId) => ipcRenderer.invoke('review:getLatestByEmployee', { employeeId }),
  createManagerReview: (employeeId, rating, comments) =>
    ipcRenderer.invoke('review:create', { employeeId, rating, comments }),
  updateManagerReview: (reviewId, rating, comments) =>
    ipcRenderer.invoke('review:update', { reviewId, rating, comments }),
  getAllReviews: () => ipcRenderer.invoke('review:getAll', {}),

  // Skill Assessments
  getEmployeeSkills: (employeeId) => ipcRenderer.invoke('skill:getByEmployee', { employeeId }),
  assessSkill: (employeeId, skillId, rating) =>
    ipcRenderer.invoke('skill:assess', { employeeId, skillId, rating }),
  getSkillsList: () => ipcRenderer.invoke('skill:getList', {}),

  // Debug - for diagnosing issues
  debugGetStoreData: () => ipcRenderer.invoke('debug:getStoreData')
  };
  return api;
}

try {
  const { contextBridge } = require('electron');
  console.log('[PRELOAD] Exposing electron API and ipcRenderer via contextBridge...');

  // Expose the electron API object
  const api = exposeElectronAPI();
  console.log('[PRELOAD] API methods count:', Object.keys(api).length);
  console.log('[PRELOAD] Has createDeposit?', typeof api.createDeposit);
  console.log('[PRELOAD] Has getAllDeposits?', typeof api.getAllDeposits);
  contextBridge.exposeInMainWorld('electron', api);
  console.log('[PRELOAD] ✓ window.electron exposed');

  // Also expose ipcRenderer directly as a fallback
  contextBridge.exposeInMainWorld('ipcRenderer', ipcRenderer);
  console.log('[PRELOAD] ✓ window.ipcRenderer exposed');

  ipcRenderer.send('preload-complete', { success: true, methods: ['electron', 'ipcRenderer'] });
} catch (error) {
  console.error('[PRELOAD] ✗ Failed to expose via contextBridge:', error);
  ipcRenderer.send('preload-complete', { success: false, error: error.message });
}

window.addEventListener('DOMContentLoaded', () => {
  console.log('✓ Preload script loaded securely');
});
