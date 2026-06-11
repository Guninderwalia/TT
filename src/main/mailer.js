// Pulse v5.4 — transactional email via Resend.
//
// Sends notification emails (leave decisions, new requests for approvers,
// payroll paid, etc.) alongside the existing in-app notifications.
//
// Config (Fly secrets):
//   RESEND_API_KEY   — required; without it every send is a silent no-op.
//   EMAIL_FROM       — the From header, e.g. "Task Tango Pulse <noreply@tasktango.co>".
//                      NOTE: Resend only delivers to arbitrary recipients once a
//                      domain is verified at resend.com/domains. Until then it
//                      can only email the Resend account owner, and sends to
//                      others return 403 (handled gracefully here).
//
// Every send is best-effort: failures are logged, never thrown, so email
// problems can't break a leave approval or any other user action.

const DEFAULT_FROM = 'Task Tango Pulse <onboarding@resend.dev>';

function isConfigured() {
  return !!process.env.RESEND_API_KEY;
}

// Wrap body content in a simple branded HTML shell.
function shell(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#0b1220;padding:24px;font-family:Segoe UI,Arial,sans-serif">
    <table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#111a2e;border-radius:12px;overflow:hidden">
      <tr><td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:18px 24px;color:#fff;font-size:18px;font-weight:700">✨ Task Tango Pulse</td></tr>
      <tr><td style="padding:24px;color:#e5e7eb;font-size:14px;line-height:1.6">
        <h2 style="margin:0 0 12px;color:#fff;font-size:17px">${title}</h2>
        ${bodyHtml}
        <p style="margin:22px 0 0;color:#94a3b8;font-size:12px">You're receiving this because you have an account on Task Tango Pulse.
        Open the app: <a href="https://tasktango.fly.dev" style="color:#a5b4fc">tasktango.fly.dev</a></p>
      </td></tr>
    </table></body></html>`;
}

// Low-level send. Returns { sent, id?, skipped?, error? }.
async function sendEmail({ to, subject, html }) {
  try {
    if (!isConfigured()) return { sent: false, skipped: 'no RESEND_API_KEY' };
    if (!to) return { sent: false, skipped: 'no recipient' };
    const from = process.env.EMAIL_FROM || DEFAULT_FROM;
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from, to: Array.isArray(to) ? to : [to], subject, html })
    });
    if (!resp.ok) {
      let detail = '';
      try { detail = (await resp.json())?.message || ''; } catch (_) {}
      console.warn(`[MAIL] send failed (${resp.status}) to ${to}: ${detail}`);
      return { sent: false, error: detail || `HTTP ${resp.status}` };
    }
    const data = await resp.json().catch(() => ({}));
    console.log(`[MAIL] ✓ "${subject}" → ${to} (id=${data.id || '?'})`);
    return { sent: true, id: data.id };
  } catch (e) {
    console.warn('[MAIL] send error:', e.message);
    return { sent: false, error: e.message };
  }
}

// Helper used by handlers: look up a user's email + name, then send.
async function emailUser(db, userId, subject, title, bodyHtml) {
  try {
    if (!isConfigured() || !userId) return;
    const u = await db.get('SELECT email, full_name FROM users WHERE id = ?', [userId]);
    if (!u || !u.email) return;
    const greeting = u.full_name ? `<p>Hi ${u.full_name.split(' ')[0]},</p>` : '';
    await sendEmail({ to: u.email, subject, html: shell(title, greeting + bodyHtml) });
  } catch (e) {
    console.warn('[MAIL] emailUser error:', e.message);
  }
}

module.exports = { sendEmail, emailUser, shell, isConfigured };
