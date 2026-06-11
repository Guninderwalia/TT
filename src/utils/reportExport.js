// Pulse v5.4 — client-side report exports (CSV / Excel / PDF).
//
// Generic helpers that take a header row + 2D data rows and produce a download.
// xlsx and pdfmake are imported lazily so they don't bloat the main bundle.

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// headers: string[]   rows: (string|number)[][]
export function exportToCsv(headers, rows, filename) {
  const lines = [headers.map(csvEscape).join(',')];
  for (const r of rows) lines.push(r.map(csvEscape).join(','));
  // Prepend BOM so Excel opens UTF-8 correctly.
  downloadBlob(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), filename);
}

export async function exportToXlsx(headers, rows, filename, sheetName = 'Sheet1') {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  // Auto-ish column widths from content length.
  ws['!cols'] = headers.map((h, i) => {
    const maxLen = Math.max(String(h).length, ...rows.map(r => String(r[i] ?? '').length));
    return { wch: Math.min(40, Math.max(8, maxLen + 2)) };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}

export async function exportTableToPdf(title, headers, rows, filename) {
  const { generatePdf } = await import('./pdf/pdfGenerator');
  const body = [
    headers.map(h => ({ text: String(h), bold: true, color: '#ffffff', fillColor: '#1f2937' })),
    ...rows.map(r => r.map(c => ({ text: String(c ?? ''), color: '#1f2937' })))
  ];
  const doc = {
    pageOrientation: headers.length > 6 ? 'landscape' : 'portrait',
    pageMargins: [24, 32, 24, 28],
    content: [
      { text: title, fontSize: 16, bold: true, margin: [0, 0, 0, 4] },
      { text: `Task Tango Pulse · generated ${new Date().toLocaleString()}`, fontSize: 9, color: '#6b7280', margin: [0, 0, 0, 12] },
      { table: { headerRows: 1, widths: headers.map(() => 'auto'), body }, layout: 'lightHorizontalLines' }
    ],
    defaultStyle: { fontSize: 9 }
  };
  await generatePdf(doc, filename);
}
