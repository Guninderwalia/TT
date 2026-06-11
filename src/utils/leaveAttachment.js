// Pulse v2 — download a leave request's supporting document.
// The file lives on the server/desktop disk; we fetch it back as base64 via
// the leave:readAttachment IPC handler, rebuild a Blob, and trigger a browser
// download. Shared by the admin + lead approval screens.
export async function downloadLeaveAttachment(req) {
  try {
    const path = req.attachment_path || req.attachmentPath;
    if (!path) return;
    const res = await window.electron.readLeaveAttachment(path);
    if (!res?.success || !res?.data?.base64) {
      window.toast?.error?.('Could not open the document: ' + (res?.message || 'unknown error'));
      return;
    }
    const name = req.attachment_name || req.attachmentName || 'leave-document';
    const mime = req.attachment_mime || req.attachmentMime || 'application/octet-stream';
    // base64 → Blob
    const byteChars = atob(res.data.base64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    window.toast?.error?.('Could not open the document: ' + e.message);
  }
}
