/**
 * PDF generation — thin wrapper around pdfmake.
 *
 * Templates:
 *   - buildOfferLetterDoc(data) → docDefinition for HR offer letters
 *   - buildSalarySlipDoc(data)  → docDefinition for monthly salary slips
 *   - buildPerformanceReviewDoc(data) → docDefinition for performance reviews
 *
 * Each builder returns a pdfmake docDefinition object. Use generatePdf(doc, fn)
 * to download it. We never call pdfmake at module load — it's lazy-loaded the
 * first time generatePdf() runs, so the ~2 MB lib isn't on the critical path.
 *
 * Why pdfmake (vs jsPDF):
 *   - First-class table support (perfect for salary slips / reviews)
 *   - Built-in fonts (Roboto) — no extra setup
 *   - Document-first API (you describe the doc; it lays it out)
 */

let _pdfMake = null;
let _vfsFonts = null;

async function getPdfMake() {
  if (_pdfMake) return _pdfMake;
  // pdfmake's CJS export needs the VFS attached before .createPdf() works.
  const pdfMakeMod = await import('pdfmake/build/pdfmake');
  const vfsMod     = await import('pdfmake/build/vfs_fonts');
  _pdfMake = pdfMakeMod.default || pdfMakeMod;
  _vfsFonts = vfsMod.default || vfsMod;
  // vfs_fonts ships as `pdfMake.vfs = { ... }` style — pick whichever shape.
  _pdfMake.vfs = _vfsFonts.pdfMake ? _vfsFonts.pdfMake.vfs : (_vfsFonts.vfs || _vfsFonts);
  return _pdfMake;
}

/**
 * Generate a PDF and trigger a download in the browser.
 *   doc      — pdfmake docDefinition
 *   filename — string for the saved file
 */
export async function generatePdf(doc, filename = 'document.pdf') {
  try {
    const pdfMake = await getPdfMake();
    pdfMake.createPdf(doc).download(filename);
    return { success: true };
  } catch (err) {
    console.error('[PDF] generation failed:', err);
    return { success: false, error: err.message };
  }
}

// ============================================================================
// Shared style fragments — every template inherits these.
// ============================================================================

const BRAND = {
  name: 'TaskTango',
  tagline: 'HR & Employee Management',
  primary: '#1e3a8a',
  accent: '#f59e0b',
  muted: '#6b7280',
  text: '#1a202c',
  divider: '#e5e7eb'
};

function formatCurrency(value, currency = '₹') {
  if (value == null || isNaN(Number(value))) return '-';
  const n = Number(value);
  return `${currency}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(d) {
  if (!d) return '-';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return String(d);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

function header(title) {
  return [
    {
      columns: [
        { text: BRAND.name, style: 'brand' },
        { text: title, style: 'docTitle', alignment: 'right' }
      ],
      margin: [0, 0, 0, 4]
    },
    {
      text: BRAND.tagline,
      style: 'tagline',
      margin: [0, 0, 0, 12]
    },
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1.5, lineColor: BRAND.primary }], margin: [0, 0, 0, 16] }
  ];
}

const sharedStyles = {
  brand:     { fontSize: 18, bold: true, color: BRAND.primary },
  tagline:   { fontSize: 9,  italics: true, color: BRAND.muted },
  docTitle:  { fontSize: 16, bold: true, color: BRAND.text },
  h2:        { fontSize: 13, bold: true, color: BRAND.primary, margin: [0, 14, 0, 6] },
  label:     { fontSize: 10, color: BRAND.muted },
  value:     { fontSize: 11, color: BRAND.text, bold: false },
  bigValue:  { fontSize: 13, color: BRAND.text, bold: true },
  body:      { fontSize: 11, color: BRAND.text, lineHeight: 1.4 },
  tableHead: { fontSize: 10, bold: true, color: '#ffffff', fillColor: BRAND.primary, margin: [4, 6, 4, 6] },
  tableCell: { fontSize: 10, color: BRAND.text, margin: [4, 6, 4, 6] },
  totalRow:  { fontSize: 11, bold: true, color: BRAND.text, fillColor: '#fef3c7', margin: [4, 6, 4, 6] },
  footerTxt: { fontSize: 8, italics: true, color: BRAND.muted, alignment: 'center' }
};

function footer(currentPage, pageCount) {
  return {
    text: `${BRAND.name} — generated ${formatDate(new Date())}   ·   page ${currentPage} of ${pageCount}`,
    style: 'footerTxt',
    margin: [40, 0, 40, 20]
  };
}

// ============================================================================
// 1) OFFER LETTER
// ============================================================================

/**
 * data shape:
 *   {
 *     candidateName, candidateAddress,
 *     position, department,
 *     startDate, employmentType,
 *     baseSalary, currency='₹',
 *     workingHours, location,
 *     hrName, hrTitle, hrEmail,
 *     companyName='TaskTango Financial Services'
 *   }
 */
export function buildOfferLetterDoc(data = {}) {
  const company = data.companyName || 'TaskTango Financial Services';
  const today   = formatDate(new Date());
  return {
    pageSize: 'A4',
    pageMargins: [40, 50, 40, 50],
    info: { title: `Offer Letter — ${data.candidateName || 'Candidate'}`, author: BRAND.name },
    content: [
      ...header('Offer Letter'),
      { text: today, style: 'label', alignment: 'right', margin: [0, 0, 0, 16] },
      { text: data.candidateName || 'Candidate', style: 'bigValue' },
      data.candidateAddress ? { text: data.candidateAddress, style: 'body', margin: [0, 0, 0, 16] } : { text: '', margin: [0, 0, 0, 16] },
      { text: 'Dear ' + (data.candidateName || 'Candidate') + ',', style: 'body', margin: [0, 0, 0, 10] },
      {
        text: `On behalf of ${company}, we are delighted to offer you the position of ${data.position || '__________'} ` +
              `in the ${data.department || '__________'} department, starting on ${formatDate(data.startDate)}.`,
        style: 'body',
        margin: [0, 0, 0, 12]
      },
      { text: 'Key Terms', style: 'h2' },
      {
        table: {
          widths: ['35%', '65%'],
          body: [
            [{ text: 'Position', style: 'tableCell' },        { text: data.position || '-', style: 'tableCell' }],
            [{ text: 'Department', style: 'tableCell' },      { text: data.department || '-', style: 'tableCell' }],
            [{ text: 'Employment Type', style: 'tableCell' }, { text: data.employmentType || 'Permanent', style: 'tableCell' }],
            [{ text: 'Start Date', style: 'tableCell' },      { text: formatDate(data.startDate), style: 'tableCell' }],
            [{ text: 'Working Hours', style: 'tableCell' },   { text: data.workingHours || '09:00 — 18:00, Mon–Fri', style: 'tableCell' }],
            [{ text: 'Location', style: 'tableCell' },        { text: data.location || 'Office', style: 'tableCell' }],
            [{ text: 'Annual CTC', style: 'tableCell' },      { text: formatCurrency(data.baseSalary, data.currency), style: 'tableCell' }]
          ]
        },
        layout: {
          fillColor: (row) => row % 2 === 0 ? '#f9fafb' : null,
          hLineColor: () => BRAND.divider,
          vLineColor: () => BRAND.divider
        },
        margin: [0, 0, 0, 16]
      },
      { text: 'Confidentiality & Conduct', style: 'h2' },
      {
        text: `You agree to keep all proprietary information of ${company} strictly confidential and to comply with the ` +
              `Company\'s code of conduct, leave policy, and attendance guidelines as communicated separately.`,
        style: 'body',
        margin: [0, 0, 0, 12]
      },
      { text: 'Acceptance', style: 'h2' },
      {
        text: 'Please confirm your acceptance by signing below and returning a copy of this letter. We look forward to ' +
              'welcoming you to the team.',
        style: 'body',
        margin: [0, 0, 0, 24]
      },
      {
        columns: [
          {
            stack: [
              { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 180, y2: 0, lineWidth: 0.7, lineColor: BRAND.text }], margin: [0, 0, 0, 4] },
              { text: data.hrName || 'HR Manager', style: 'value' },
              { text: data.hrTitle || 'Human Resources', style: 'label' },
              { text: data.hrEmail || '', style: 'label' }
            ]
          },
          {
            stack: [
              { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 180, y2: 0, lineWidth: 0.7, lineColor: BRAND.text }], margin: [0, 0, 0, 4] },
              { text: 'Candidate signature', style: 'label' },
              { text: 'Date: ____________________', style: 'label', margin: [0, 16, 0, 0] }
            ]
          }
        ]
      }
    ],
    styles: sharedStyles,
    footer
  };
}

// ============================================================================
// 2) SALARY SLIP
// ============================================================================

/**
 * data shape:
 *   {
 *     employeeName, employeeId, designation, department, joiningDate,
 *     month, year,                              (e.g. 'May', 2026)
 *     baseSalary, currency='₹',
 *     earnings: [{ label, amount }],            (Basic / HRA / Allowances)
 *     deductions: [{ label, amount }],          (PF / TDS / Loan)
 *     workingDays, paidDays, leavesTaken, lopDays,
 *     bankName, accountNumber
 *   }
 */
export function buildSalarySlipDoc(data = {}) {
  const earnings   = Array.isArray(data.earnings)   ? data.earnings   : [];
  const deductions = Array.isArray(data.deductions) ? data.deductions : [];
  const totalEarnings = earnings.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const totalDeductions = deductions.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const netPay = totalEarnings - totalDeductions;
  const currency = data.currency || '₹';
  return {
    pageSize: 'A4',
    pageMargins: [40, 50, 40, 50],
    info: { title: `Salary Slip — ${data.employeeName || 'Employee'}`, author: BRAND.name },
    content: [
      ...header(`Salary Slip — ${data.month || ''} ${data.year || ''}`),
      // Employee summary block
      {
        columns: [
          {
            stack: [
              { text: 'Employee', style: 'label' },
              { text: data.employeeName || '-', style: 'bigValue' },
              { text: data.designation || '-', style: 'label' },
              { text: data.department  || '-', style: 'label' }
            ]
          },
          {
            stack: [
              { text: 'Employee ID',  style: 'label' }, { text: data.employeeId || '-', style: 'value' },
              { text: 'Joining Date', style: 'label', margin: [0, 6, 0, 0] }, { text: formatDate(data.joiningDate), style: 'value' },
              { text: 'Bank',         style: 'label', margin: [0, 6, 0, 0] }, { text: data.bankName || '-', style: 'value' },
              { text: 'A/C Number',   style: 'label', margin: [0, 6, 0, 0] }, { text: data.accountNumber || '-', style: 'value' }
            ]
          }
        ],
        margin: [0, 0, 0, 18]
      },
      // Working days summary
      { text: 'Attendance Summary', style: 'h2' },
      {
        table: {
          widths: ['25%', '25%', '25%', '25%'],
          body: [
            [
              { text: 'Working Days', style: 'tableHead' },
              { text: 'Paid Days',    style: 'tableHead' },
              { text: 'Leaves Taken', style: 'tableHead' },
              { text: 'LOP Days',     style: 'tableHead' }
            ],
            [
              { text: String(data.workingDays  ?? '-'), style: 'tableCell', alignment: 'center' },
              { text: String(data.paidDays     ?? '-'), style: 'tableCell', alignment: 'center' },
              { text: String(data.leavesTaken  ?? '-'), style: 'tableCell', alignment: 'center' },
              { text: String(data.lopDays      ?? '-'), style: 'tableCell', alignment: 'center' }
            ]
          ]
        },
        layout: { hLineColor: () => BRAND.divider, vLineColor: () => BRAND.divider },
        margin: [0, 0, 0, 18]
      },
      // Earnings & Deductions side by side
      {
        columns: [
          {
            width: '48%',
            stack: [
              { text: 'Earnings', style: 'h2', margin: [0, 0, 0, 6] },
              {
                table: {
                  widths: ['*', 'auto'],
                  body: [
                    [{ text: 'Component', style: 'tableHead' }, { text: 'Amount', style: 'tableHead', alignment: 'right' }],
                    ...earnings.map(r => [
                      { text: r.label, style: 'tableCell' },
                      { text: formatCurrency(r.amount, currency), style: 'tableCell', alignment: 'right' }
                    ]),
                    [{ text: 'Total Earnings', style: 'totalRow' }, { text: formatCurrency(totalEarnings, currency), style: 'totalRow', alignment: 'right' }]
                  ]
                },
                layout: { hLineColor: () => BRAND.divider, vLineColor: () => BRAND.divider }
              }
            ]
          },
          { width: '4%', text: '' },
          {
            width: '48%',
            stack: [
              { text: 'Deductions', style: 'h2', margin: [0, 0, 0, 6] },
              {
                table: {
                  widths: ['*', 'auto'],
                  body: [
                    [{ text: 'Component', style: 'tableHead' }, { text: 'Amount', style: 'tableHead', alignment: 'right' }],
                    ...deductions.map(r => [
                      { text: r.label, style: 'tableCell' },
                      { text: formatCurrency(r.amount, currency), style: 'tableCell', alignment: 'right' }
                    ]),
                    [{ text: 'Total Deductions', style: 'totalRow' }, { text: formatCurrency(totalDeductions, currency), style: 'totalRow', alignment: 'right' }]
                  ]
                },
                layout: { hLineColor: () => BRAND.divider, vLineColor: () => BRAND.divider }
              }
            ]
          }
        ],
        margin: [0, 0, 0, 18]
      },
      // Net pay highlight
      {
        table: {
          widths: ['*', 'auto'],
          body: [
            [
              { text: 'Net Pay', fontSize: 14, bold: true, color: '#ffffff', fillColor: BRAND.primary, margin: [12, 10, 12, 10] },
              { text: formatCurrency(netPay, currency), fontSize: 16, bold: true, color: '#ffffff', fillColor: BRAND.primary, alignment: 'right', margin: [12, 10, 12, 10] }
            ]
          ]
        },
        layout: 'noBorders'
      },
      {
        text: 'This is a system-generated payslip and does not require a signature.',
        style: 'footerTxt',
        margin: [0, 16, 0, 0]
      }
    ],
    styles: sharedStyles,
    footer
  };
}

// ============================================================================
// 3) PERFORMANCE REVIEW
// ============================================================================

/**
 * data shape:
 *   {
 *     employeeName, employeeId, department, role, periodFrom, periodTo,
 *     attendanceRate, punctualityScore, consistencyScore, latenessImpact,
 *     managerRating,                            (1-5)
 *     skills: [{ name, rating }],               (1-5 each)
 *     overallScore,                             (0-100)
 *     managerName, managerComments
 *   }
 */
export function buildPerformanceReviewDoc(data = {}) {
  const skills = Array.isArray(data.skills) ? data.skills : [];
  const fmtPct = (v) => (v == null || isNaN(v)) ? '-' : Number(v).toFixed(1) + '%';
  const stars  = (rating) => {
    const n = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
    return '★'.repeat(n) + '☆'.repeat(5 - n);
  };
  const scoreColor = (score) => {
    if (score == null) return BRAND.muted;
    if (score >= 80) return '#10b981';
    if (score >= 60) return '#f59e0b';
    return '#ef4444';
  };

  return {
    pageSize: 'A4',
    pageMargins: [40, 50, 40, 50],
    info: { title: `Performance Review — ${data.employeeName || 'Employee'}`, author: BRAND.name },
    content: [
      ...header('Performance Review'),
      // Identity row
      {
        columns: [
          {
            stack: [
              { text: 'Employee', style: 'label' },
              { text: data.employeeName || '-', style: 'bigValue' },
              { text: `${data.role || ''}${data.department ? ' · ' + data.department : ''}`, style: 'label' }
            ]
          },
          {
            stack: [
              { text: 'Review Period', style: 'label' },
              { text: `${formatDate(data.periodFrom)} — ${formatDate(data.periodTo)}`, style: 'value' },
              { text: 'Employee ID', style: 'label', margin: [0, 6, 0, 0] },
              { text: data.employeeId || '-', style: 'value' }
            ]
          }
        ],
        margin: [0, 0, 0, 18]
      },
      // Big overall-score banner
      {
        table: {
          widths: ['*', 'auto'],
          body: [[
            { text: 'Overall Score', fontSize: 14, bold: true, color: '#ffffff', fillColor: scoreColor(data.overallScore), margin: [12, 10, 12, 10] },
            { text: data.overallScore != null ? Number(data.overallScore).toFixed(1) + ' / 100' : '-', fontSize: 18, bold: true, color: '#ffffff', fillColor: scoreColor(data.overallScore), alignment: 'right', margin: [12, 10, 12, 10] }
          ]]
        },
        layout: 'noBorders',
        margin: [0, 0, 0, 18]
      },
      // KPI table
      { text: 'KPIs', style: 'h2' },
      {
        table: {
          widths: ['*', 'auto'],
          body: [
            [{ text: 'Metric', style: 'tableHead' }, { text: 'Score', style: 'tableHead', alignment: 'right' }],
            [{ text: 'Attendance Rate',   style: 'tableCell' }, { text: fmtPct(data.attendanceRate),   style: 'tableCell', alignment: 'right' }],
            [{ text: 'Punctuality Score', style: 'tableCell' }, { text: fmtPct(data.punctualityScore), style: 'tableCell', alignment: 'right' }],
            [{ text: 'Consistency Score', style: 'tableCell' }, { text: fmtPct(data.consistencyScore), style: 'tableCell', alignment: 'right' }],
            [{ text: 'Lateness Impact',   style: 'tableCell' }, { text: fmtPct(data.latenessImpact),   style: 'tableCell', alignment: 'right' }],
            [{ text: 'Manager Rating',    style: 'tableCell' }, { text: stars(data.managerRating),     style: 'tableCell', alignment: 'right' }]
          ]
        },
        layout: {
          fillColor: (row) => row === 0 ? null : (row % 2 === 0 ? '#f9fafb' : null),
          hLineColor: () => BRAND.divider,
          vLineColor: () => BRAND.divider
        },
        margin: [0, 0, 0, 18]
      },
      // Skill ratings
      { text: 'Skill Assessment', style: 'h2' },
      skills.length > 0 ? {
        table: {
          widths: ['*', 'auto'],
          body: [
            [{ text: 'Skill', style: 'tableHead' }, { text: 'Rating', style: 'tableHead', alignment: 'right' }],
            ...skills.map(s => [
              { text: s.name || '-', style: 'tableCell' },
              { text: stars(s.rating), style: 'tableCell', alignment: 'right' }
            ])
          ]
        },
        layout: {
          fillColor: (row) => row === 0 ? null : (row % 2 === 0 ? '#f9fafb' : null),
          hLineColor: () => BRAND.divider,
          vLineColor: () => BRAND.divider
        },
        margin: [0, 0, 0, 18]
      } : { text: 'No skill ratings recorded for this employee yet.', style: 'label', margin: [0, 0, 0, 18] },
      // Comments
      { text: 'Manager Comments', style: 'h2' },
      { text: data.managerComments || '— No comments recorded —', style: 'body', margin: [0, 0, 0, 24] },
      // Signatures
      {
        columns: [
          {
            stack: [
              { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 180, y2: 0, lineWidth: 0.7, lineColor: BRAND.text }], margin: [0, 0, 0, 4] },
              { text: data.managerName || 'Manager', style: 'value' },
              { text: 'Reviewed by', style: 'label' }
            ]
          },
          {
            stack: [
              { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 180, y2: 0, lineWidth: 0.7, lineColor: BRAND.text }], margin: [0, 0, 0, 4] },
              { text: data.employeeName || 'Employee', style: 'value' },
              { text: 'Acknowledged by', style: 'label' }
            ]
          }
        ]
      }
    ],
    styles: sharedStyles,
    footer
  };
}
