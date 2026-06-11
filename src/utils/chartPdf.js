// Pulse v2 (item 3/charts) — export a dashboard chart to a PDF that keeps the
// app's dark theme, instead of the old print path that rendered everything on
// a white background.
//
// Chart.js draws on a <canvas> with a TRANSPARENT background, so exporting it
// directly (or printing) shows up as white. Here we composite the chart onto a
// dark canvas first, then drop that image into a dark-backgrounded pdfmake page.

const DARK_BG = '#0b1220';

// Find the chart <canvas> inside a container and return a dark-composited PNG
// data URL (or null if there's no canvas / it's empty).
function chartCanvasToDarkPng(containerEl) {
  if (!containerEl) return null;
  const src = containerEl.querySelector('canvas');
  if (!src || !src.width || !src.height) return null;

  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext('2d');
  ctx.fillStyle = DARK_BG;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, 0, 0);
  return out.toDataURL('image/png', 1.0);
}

// Export a single chart card to a dark-themed PDF.
export async function exportChartElementToPdf(containerEl, title = 'Chart') {
  try {
    const dataUrl = chartCanvasToDarkPng(containerEl);
    if (!dataUrl) {
      window.toast?.warning?.('Nothing to export yet — the chart has no data.');
      return;
    }
    const { generatePdf } = await import('./pdf/pdfGenerator');
    const stamp = new Date().toLocaleString();
    const doc = {
      pageOrientation: 'landscape',
      pageMargins: [28, 36, 28, 36],
      // Dark page background so the export matches the dashboard, not a white sheet.
      background: (currentPage, pageSize) => ([{
        canvas: [{ type: 'rect', x: 0, y: 0, w: pageSize.width, h: pageSize.height, color: DARK_BG }]
      }]),
      content: [
        { text: title, color: '#ffffff', fontSize: 18, bold: true, margin: [0, 0, 0, 4] },
        { text: `Task Tango Pulse · exported ${stamp}`, color: '#94a3b8', fontSize: 9, margin: [0, 0, 0, 14] },
        { image: dataUrl, fit: [760, 420], alignment: 'center' }
      ],
      defaultStyle: { color: '#e5e7eb' }
    };
    const safe = String(title).replace(/[^a-z0-9]+/gi, '_').slice(0, 60);
    await generatePdf(doc, `TaskTango_${safe}.pdf`);
  } catch (e) {
    window.toast?.error?.('Could not export chart: ' + e.message);
  }
}
