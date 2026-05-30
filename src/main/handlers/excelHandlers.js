/**
 * Excel import handlers — parseFile / validateData.
 *
 * Originally defined inline in main.js, which meant the server-mode entry
 * (src/server/server.js) couldn't load them and uploading employees on the
 * web build silently failed (404 from /api/invoke for excel:parseFile).
 * Extracted here so both Electron main.js and the headless server pick them
 * up via the standard handler-registration pattern.
 *
 * Binary input handling:
 *   The renderer ships the uploaded file as a base64 string so it survives
 *   JSON serialisation over HTTP. We accept ArrayBuffer / Buffer too for
 *   backward compatibility with older renderers running inside Electron.
 */

const excelUtils = require('../../utils/excelUtils');

// Coerce whatever the wire delivered into a Node Buffer the excel lib can read.
function toBuffer(input) {
  if (input == null) return null;
  if (Buffer.isBuffer(input)) return input;
  if (typeof input === 'string') {
    // Base64 — the universal format used by the web shim AND the new renderer.
    return Buffer.from(input, 'base64');
  }
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  if (ArrayBuffer.isView(input)) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  // electron-cloned Buffer shape: { type: 'Buffer', data: [..] }
  if (input.type === 'Buffer' && Array.isArray(input.data)) return Buffer.from(input.data);
  return null;
}

function register(ipcMain) {
  ipcMain.handle('excel:parseFile', async (_event, { fileBuffer } = {}) => {
    try {
      const buf = toBuffer(fileBuffer);
      if (!buf) return { success: false, error: 'Invalid or missing file buffer' };
      console.log(`[EXCEL] Parsing employee file (${buf.length} bytes)...`);
      const parseResult = excelUtils.parseEmployeeExcel(buf);
      console.log(`[EXCEL] ✓ Parsed file: ${parseResult.validRows}/${parseResult.totalRows} valid rows`);
      return { success: true, data: parseResult };
    } catch (error) {
      console.error('[EXCEL] parseFile error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('excel:validateData', async (_event, { employees, departments } = {}) => {
    try {
      const validation = excelUtils.validateEmployeeData(employees, departments);
      console.log(`[EXCEL] ✓ Validation complete: ${validation.isValid ? 'Valid' : 'Invalid'}`);
      return { success: true, data: validation };
    } catch (error) {
      console.error('[EXCEL] validateData error:', error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
