const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// ----------------------------------------------------------------------------
// Date/time helpers shared by the parser. xlsx returns Date OBJECTS for cells
// formatted as dates, but those objects are constructed using UTC midnight —
// which means `.toISOString().split('T')[0]` on a runtime east of UTC silently
// shifts the date one day back. Use LOCAL date components instead.
// ----------------------------------------------------------------------------
function pad2(n) { return String(n).padStart(2, '0'); }

// Excel encodes dates as days since 30 Dec 1899 (the famous "Lotus 1-2-3"
// epoch). Convert a serial number to a JS Date in LOCAL time so getFullYear /
// getMonth / getDate read what the human entered in Excel.
function excelSerialToDate(serial) {
  if (typeof serial !== 'number' || !isFinite(serial)) return null;
  // 25569 = days between 1 Jan 1970 and 30 Dec 1899; * 86400 = seconds
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  // Roll back the UTC→local offset so getDate() returns the cell day.
  return new Date(d.getTime() + d.getTimezoneOffset() * 60 * 1000);
}

function excelDateToISO(value) {
  if (value === null || value === undefined || value === '') return null;
  // 1. Already a Date instance (xlsx default with cellDates:true)
  if (value instanceof Date && !isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }
  // 2. Excel serial number (defensive fallback if cellDates ever misses)
  if (typeof value === 'number') {
    const d = excelSerialToDate(value);
    if (d) return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  // 3. String — try several common shapes
  const s = String(value).trim();
  // Already ISO YYYY-MM-DD?
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  // DD/MM/YYYY or DD-MM-YYYY (UK style) — covers 15/06/2024
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${pad2(m[2])}-${pad2(m[1])}`;
  // Fall through to Date parse as a last resort
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  return null;
}

function excelTimeToHHMM(value) {
  if (value === null || value === undefined || value === '') return null;
  // Date object — read the LOCAL hours/minutes
  if (value instanceof Date && !isNaN(value.getTime())) {
    return `${pad2(value.getHours())}:${pad2(value.getMinutes())}`;
  }
  // Excel encodes time-only cells as a fraction of one day:
  //   07:00 → 0.291666…   12:00 → 0.5   15:30 → 0.6458…
  // A datetime serial like 45458.2916 (15 Jun 2024 07:00) also works because
  // we only care about the fractional part.
  if (typeof value === 'number' && isFinite(value)) {
    const fractional = value - Math.floor(value);
    const totalMinutes = Math.round(fractional * 24 * 60);
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = totalMinutes % 60;
    return `${pad2(h)}:${pad2(m)}`;
  }
  const s = String(value).trim();
  // HH:MM(:SS)? — keep just the first two segments
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (m) return `${pad2(m[1])}:${pad2(m[2])}`;
  // "9:00 AM" / "06:00 PM"
  const am = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (am) {
    let h = parseInt(am[1], 10);
    const min = parseInt(am[2], 10);
    const meridiem = am[3].toUpperCase();
    if (meridiem === 'PM' && h < 12) h += 12;
    if (meridiem === 'AM' && h === 12) h = 0;
    return `${pad2(h)}:${pad2(min)}`;
  }
  return null;
}

/**
 * Creates an Excel template file with all required columns and example data
 * @returns {Uint8Array} Buffer containing the Excel file data
 */
function generateEmployeeTemplate() {
  // Define columns - comprehensive employee data
  const headers = [
    'Full Name',
    'Email',
    'Phone',
    'Username',
    'Department',
    'Role',
    'Date of Birth',
    'Joining Date',
    'Employment Type',
    'Base Salary',
    'Start Time',
    'End Time',
    'Probation Status',
    'Probation End Date',
    'Last Increment Date',
    'Last Increment Amount',
    'Bank Name',
    'Account Name',
    'Bank Account Number',
    'IFSC Code',
    'Is Team Lead'
  ];

  // Create example data with all fields
  const exampleData = [
    [
      'John Doe',
      'john.doe@company.co.uk',
      '+44 20 7946 0958',
      'john_doe',
      'Engineering',
      'Employee',
      '1990-05-15',
      '2023-01-15',
      'Permanent',
      '50000',
      '09:00',
      '18:00',
      'No',
      '',
      '2024-03-01',
      '5000',
      'State Bank of India',
      'John Doe',
      '1234567890123456',
      'SBIN0001234',
      'No'
    ]
  ];

  // Create workbook and worksheet
  const ws = XLSX.utils.aoa_to_sheet([headers, ...exampleData]);

  // Set column widths for all fields
  ws['!cols'] = [
    { wch: 20 }, // Full Name
    { wch: 30 }, // Email
    { wch: 18 }, // Phone
    { wch: 15 }, // Username
    { wch: 18 }, // Department
    { wch: 12 }, // Role
    { wch: 14 }, // Date of Birth (YYYY-MM-DD)
    { wch: 14 }, // Joining Date (YYYY-MM-DD)
    { wch: 15 }, // Employment Type
    { wch: 15 }, // Base Salary
    { wch: 12 }, // Start Time (HH:MM)
    { wch: 12 }, // End Time (HH:MM)
    { wch: 15 }, // Probation Status
    { wch: 16 }, // Probation End Date (YYYY-MM-DD)
    { wch: 16 }, // Last Increment Date (YYYY-MM-DD)
    { wch: 18 }, // Last Increment Amount
    { wch: 25 }, // Bank Name
    { wch: 20 }, // Account Name
    { wch: 20 }, // Bank Account Number
    { wch: 15 }, // IFSC Code
    { wch: 15 }  // Is Team Lead
  ];

  // Add data validation for multiple columns
  ws.dataValidations = ws.dataValidations || [];

  // Employment Type dropdown (column I: Permanent, Temporary, Contract, Intern)
  ws.dataValidations.push({
    type: 'list',
    formula1: '"Permanent,Temporary,Contract,Intern"',
    sqref: 'I2:I1000'
  });

  // Probation Status dropdown (column M: Yes/No)
  ws.dataValidations.push({
    type: 'list',
    formula1: '"Yes,No"',
    sqref: 'M2:M1000'
  });

  // Is Team Lead dropdown (column U: Yes/No)
  ws.dataValidations.push({
    type: 'list',
    formula1: '"Yes,No"',
    sqref: 'U2:U1000'
  });

  // Create workbook
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Employees');

  // Write to buffer
  return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
}

/**
 * Parses an Excel file and returns employee data
 * @param {Buffer} fileBuffer Buffer containing Excel file
 * @returns {Array} Array of parsed employee objects with validation results
 */
function parseEmployeeExcel(fileBuffer) {
  try {
    // Read workbook. `cellDates: true` is CRITICAL — without it, Excel's
    // date/time cells come through as serial numbers (45458 for 15 Jun 2024,
    // 0.2916... for 07:00) which our helpers can't parse and which fall
    // back to "today" / "09:00" defaults. With cellDates on, xlsx hands us
    // proper JS Date objects we can read via getFullYear / getHours.
    const wb = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];

    // Convert to array of objects
    const rows = XLSX.utils.sheet_to_json(ws);

    // Define required fields
    const requiredFields = ['Full Name', 'Email', 'Department'];
    const fieldMapping = {
      'Full Name': 'fullName',
      'Email': 'email',
      'Phone': 'phone',
      'Username': 'username',
      'Department': 'department',
      'Role': 'role',
      'Date of Birth': 'dateOfBirth',
      'Joining Date': 'joiningDate',
      'Employment Type': 'employmentType',
      'Base Salary': 'baseSalary',
      'Start Time': 'startTime',
      'End Time': 'endTime',
      'Probation Status': 'isProbation',
      'Probation End Date': 'probationEndDate',
      'Last Increment Date': 'lastIncrementDate',
      'Last Increment Amount': 'lastIncrementAmount',
      'Bank Name': 'bankName',
      'Account Name': 'accountName',
      'Bank Account Number': 'bankAccountNumber',
      'IFSC Code': 'ifscCode',
      'Is Team Lead': 'isTeamLead'
    };

    const parsed = [];
    const errors = [];

    rows.forEach((row, rowIndex) => {
      // Skip empty rows
      if (!row['Full Name'] && !row['Email'] && !row['Department']) {
        return;
      }

      const employee = {};
      const rowErrors = [];

      // Validate and map fields
      Object.entries(fieldMapping).forEach(([excelField, jsField]) => {
        const value = row[excelField];

        // Check required fields
        if (requiredFields.includes(excelField)) {
          if (!value || (typeof value === 'string' && !value.trim())) {
            rowErrors.push(`${excelField} is required`);
            return;
          }
        }

        // Map and process fields
        if (value !== undefined && value !== null && value !== '') {
          if (jsField === 'baseSalary') {
            const numVal = parseFloat(value);
            if (isNaN(numVal)) {
              rowErrors.push(`${excelField} must be a valid number`);
            } else {
              employee[jsField] = numVal;
            }
          } else if (jsField === 'isTeamLead') {
            const strVal = String(value).toLowerCase().trim();
            if (!['yes', 'no', 'true', 'false', ''].includes(strVal)) {
              rowErrors.push(`${excelField} must be Yes or No`);
            } else {
              employee[jsField] = ['yes', 'true'].includes(strVal);
            }
          } else if (jsField === 'email') {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(value)) {
              rowErrors.push(`${excelField} must be a valid email address`);
            } else {
              employee[jsField] = String(value).trim();
            }
          } else if (jsField === 'isProbation') {
            // Probation Status is Yes/No → boolean. Treat blank / "No" / false as false.
            const strVal = String(value).toLowerCase().trim();
            employee[jsField] = ['yes', 'true', '1'].includes(strVal);
          } else if (['dateOfBirth', 'joiningDate', 'probationEndDate', 'lastIncrementDate'].includes(jsField)) {
            // Excel sometimes hands us a Date object, sometimes a string. Normalize
            // to YYYY-MM-DD using LOCAL date parts so a "06/06/2022" cell does NOT
            // shift to 5 June when the runtime is east of UTC.
            employee[jsField] = excelDateToISO(value);
          } else if (['startTime', 'endTime'].includes(jsField)) {
            // Time cells can be Date objects (Excel stores times as fractions of a
            // day) or HH:MM / HH:MM:SS strings. Normalize to HH:MM.
            employee[jsField] = excelTimeToHHMM(value);
          } else if (jsField === 'lastIncrementAmount') {
            const numVal = parseFloat(value);
            employee[jsField] = isNaN(numVal) ? null : numVal;
          } else {
            employee[jsField] = String(value).trim();
          }
        }
      });

      // Add row to results
      if (rowErrors.length === 0) {
        parsed.push({
          rowIndex: rowIndex + 2, // +2 because 0-indexed and header row
          data: employee,
          error: null
        });
      } else {
        errors.push({
          rowIndex: rowIndex + 2,
          errors: rowErrors
        });
      }
    });

    return {
      success: errors.length === 0,
      data: parsed,
      errors,
      totalRows: rows.length,
      validRows: parsed.length,
      invalidRows: errors.length
    };
  } catch (error) {
    return {
      success: false,
      data: [],
      errors: [{ general: error.message }],
      totalRows: 0,
      validRows: 0,
      invalidRows: 0
    };
  }
}

/**
 * Validates parsed employee data against database constraints
 * @param {Array} employees Array of employee objects to validate
 * @param {Array} departments Array of department objects from database
 * @returns {Object} Validation result with errors
 */
function validateEmployeeData(employees, departments) {
  const errors = [];
  const departmentMap = new Map(departments.map(d => [d.name, d.id]));

  employees.forEach((emp) => {
    const empErrors = [];

    // Check if department exists
    if (emp.data.department && !departmentMap.has(emp.data.department)) {
      empErrors.push(`Department "${emp.data.department}" does not exist`);
    }

    // Validate email format
    if (emp.data.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(emp.data.email)) {
        empErrors.push('Invalid email format');
      }
    }

    if (empErrors.length > 0) {
      errors.push({
        rowIndex: emp.rowIndex,
        errors: empErrors
      });
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
    mapping: Object.fromEntries(departmentMap)
  };
}

/**
 * Exports employees to Excel format
 * @param {Array} employees Array of employee objects from database
 * @param {Array} departments Array of department objects from database
 * @returns {Uint8Array} Buffer containing the Excel file data
 */
function exportEmployeeData(employees, departments) {
  // Create department map for looking up names
  const departmentMap = new Map(departments.map(d => [d.id, d.name]));

  // Define headers - comprehensive employee data matching the template
  const headers = [
    'Full Name',
    'Email',
    'Phone',
    'Username',
    'Department',
    'Role',
    'Date of Birth',
    'Joining Date',
    'Employment Type',
    'Base Salary',
    'Start Time',
    'End Time',
    'Probation Status',
    'Probation End Date',
    'Last Increment Date',
    'Last Increment Amount',
    'Bank Name',
    'Account Name',
    'Bank Account Number',
    'IFSC Code',
    'Is Team Lead'
  ];

  // Helper function to format date (YYYY-MM-DD format)
  const formatDate = (date) => {
    if (!date) return '';
    if (typeof date === 'string') {
      // If it's already a date string in YYYY-MM-DD format, return as-is
      if (/^\d{4}-\d{2}-\d{2}/.test(date)) {
        return date.split('T')[0]; // Remove time portion if present
      }
    }
    // Try to parse and format
    const d = new Date(date);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
    return '';
  };

  // Helper function to format time (HH:MM format)
  const formatTime = (time) => {
    if (!time) return '';
    if (typeof time === 'string') {
      // Already in HH:MM or HH:MM:SS format
      if (/^\d{1,2}:\d{2}/.test(time)) {
        return time.substring(0, 5); // Return HH:MM
      }
    }
    return '';
  };

  // Convert employees to Excel rows with all fields
  const rows = employees.map(emp => [
    emp.fullName || '',
    emp.email || '',
    emp.phone || '',
    emp.username || '',
    departmentMap.get(emp.departmentId) || '',
    emp.role || 'Employee',
    formatDate(emp.dateOfBirth || emp.date_of_birth),
    formatDate(emp.joiningDate || emp.start_date),
    emp.employmentType || emp.employment_type || 'Permanent',
    emp.baseSalary || emp.base_salary || 0,
    formatTime(emp.startTime || emp.start_time),
    formatTime(emp.endTime || emp.end_time),
    (emp.isProbation || emp.is_probation) ? 'Yes' : 'No',
    formatDate(emp.probationEndDate || emp.probation_end_date),
    formatDate(emp.lastIncrementDate || emp.last_increment_date),
    emp.lastIncrementAmount || emp.last_increment_amount || '',
    emp.bankName || '',
    emp.accountName || '',
    emp.bankAccountNumber || '',
    emp.ifscCode || '',
    emp.isLead ? 'Yes' : 'No'
  ]);

  // Create worksheet
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

  // Set column widths matching the template
  ws['!cols'] = [
    { wch: 20 }, // Full Name
    { wch: 30 }, // Email
    { wch: 18 }, // Phone
    { wch: 15 }, // Username
    { wch: 18 }, // Department
    { wch: 12 }, // Role
    { wch: 14 }, // Date of Birth
    { wch: 14 }, // Joining Date
    { wch: 15 }, // Employment Type
    { wch: 15 }, // Base Salary
    { wch: 12 }, // Start Time
    { wch: 12 }, // End Time
    { wch: 15 }, // Probation Status
    { wch: 16 }, // Probation End Date
    { wch: 16 }, // Last Increment Date
    { wch: 18 }, // Last Increment Amount
    { wch: 25 }, // Bank Name
    { wch: 20 }, // Account Name
    { wch: 20 }, // Bank Account Number
    { wch: 15 }, // IFSC Code
    { wch: 15 }  // Is Team Lead
  ];

  // Add data validation for dropdowns
  ws.dataValidations = ws.dataValidations || [];

  // Employment Type (column I)
  ws.dataValidations.push({
    type: 'list',
    formula1: '"Permanent,Temporary,Contract,Intern"',
    sqref: `I2:I${rows.length + 1}`
  });

  // Probation Status (column M)
  ws.dataValidations.push({
    type: 'list',
    formula1: '"Yes,No"',
    sqref: `M2:M${rows.length + 1}`
  });

  // Is Team Lead (column U)
  ws.dataValidations.push({
    type: 'list',
    formula1: '"Yes,No"',
    sqref: `U2:U${rows.length + 1}`
  });

  // Create workbook
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Employees');

  // Write to buffer
  return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
}

module.exports = {
  generateEmployeeTemplate,
  parseEmployeeExcel,
  validateEmployeeData,
  exportEmployeeData
};
