// Pulse v2 — "Ask Pulse" AI assistant, backed by Google Gemini (free tier).
//
// The API key is read from the GEMINI_API_KEY env var (set as a Fly secret:
//   fly secrets set GEMINI_API_KEY=...   — never committed to the repo).
// If the key is missing, the handler returns a friendly "not configured"
// message instead of throwing, so the rest of the app is unaffected until the
// key is added.
//
// Conversation history is persisted per user in pulse_conversations so a
// refresh doesn't lose context. We cap the history we send to Gemini to keep
// requests small and within free-tier limits.

const MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_TURNS_SENT = 16;     // how many recent messages to include as context
const MAX_STORED = 50;         // trim stored history to this many messages
const MAX_INPUT_CHARS = 4000;

const SYSTEM_PROMPT =
  "You are Ask Pulse, the friendly built-in assistant inside Task Tango Pulse, " +
  "an HR and employee-management app used by a financial-services team. " +
  "Help employees, leads, and admins with questions about using the app " +
  "(attendance, sign in/out, breaks, leave requests, payroll, performance " +
  "reviews, documents) and general workplace/productivity questions. " +
  "Be concise, warm, and practical. Use short paragraphs or bullet points. " +
  "You do NOT have live access to the company's database, so never invent " +
  "specific figures, names, salaries, or records — if asked for personal data, " +
  "tell the user where in the app to find it. Do not give legal, tax, or " +
  "medical advice; suggest they consult a qualified professional or their HR/MD. " +
  "If you are unsure, say so.";

function getApiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
}

async function loadThread(db, userId) {
  try {
    const row = await db.get('SELECT messages_json FROM pulse_conversations WHERE user_id = ?', [userId]);
    if (!row) return [];
    const arr = JSON.parse(row.messages_json || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

async function saveThread(db, userId, messages) {
  const trimmed = messages.slice(-MAX_STORED);
  await db.run(
    `INSERT INTO pulse_conversations (user_id, messages_json, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id) DO UPDATE SET messages_json = excluded.messages_json, updated_at = CURRENT_TIMESTAMP`,
    [userId, JSON.stringify(trimmed)]
  );
  return trimmed;
}

// Call Gemini's generateContent endpoint with the recent conversation.
async function callGemini(apiKey, history) {
  const recent = history.slice(-MAX_TURNS_SENT);
  const contents = recent.map(m => ({
    role: m.role === 'model' ? 'model' : 'user',
    parts: [{ text: String(m.text || '') }]
  }));

  const body = {
    systemInstruction: { role: 'system', parts: [{ text: SYSTEM_PROMPT }] },
    contents,
    generationConfig: { temperature: 0.6, maxOutputTokens: 800 }
  };

  const url = `${API_BASE}/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    let detail = '';
    try { const j = await resp.json(); detail = j?.error?.message || ''; } catch (_) {}
    if (resp.status === 429) throw new Error('Ask Pulse is busy right now (rate limit) — please try again in a moment.');
    if (resp.status === 400 && /API key/i.test(detail)) throw new Error('The Gemini API key looks invalid. Please check the GEMINI_API_KEY secret.');
    throw new Error(detail || `Gemini request failed (HTTP ${resp.status})`);
  }

  const data = await resp.json();
  const cand = data?.candidates?.[0];
  const text = cand?.content?.parts?.map(p => p.text).filter(Boolean).join('\n').trim();
  if (!text) {
    if (cand?.finishReason === 'SAFETY') return "I can't help with that one. Try rephrasing, or ask me something else about Task Tango Pulse.";
    return "Sorry — I couldn't come up with a reply just now. Please try again.";
  }
  return text;
}

function register(ipcMain, db) {
  // Is the assistant configured + available?
  ipcMain.handle('ai:pulseStatus', async () => {
    return { success: true, data: { configured: !!getApiKey(), model: MODEL } };
  });

  // Fetch the user's stored conversation.
  ipcMain.handle('ai:getPulseThread', async (event, { userId } = {}) => {
    try {
      const uid = userId || event?.sender?.id;
      if (!uid) return { success: false, message: 'Not authenticated' };
      return { success: true, data: { messages: await loadThread(db, uid), configured: !!getApiKey() } };
    } catch (error) {
      return { success: false, message: error.message };
    }
  });

  // Clear the conversation.
  ipcMain.handle('ai:resetPulseThread', async (event, { userId } = {}) => {
    try {
      const uid = userId || event?.sender?.id;
      if (!uid) return { success: false, message: 'Not authenticated' };
      await db.run('DELETE FROM pulse_conversations WHERE user_id = ?', [uid]);
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  });

  // Ask a question.
  ipcMain.handle('ai:askPulse', async (event, { userId, message } = {}) => {
    try {
      const uid = userId || event?.sender?.id;
      if (!uid) return { success: false, message: 'Not authenticated' };
      const text = String(message || '').trim();
      if (!text) return { success: false, message: 'Message is empty' };
      if (text.length > MAX_INPUT_CHARS) return { success: false, message: `Message too long (max ${MAX_INPUT_CHARS} characters)` };

      const apiKey = getApiKey();
      if (!apiKey) {
        return {
          success: false,
          notConfigured: true,
          message: 'Ask Pulse isn\'t connected yet. An admin needs to set the GEMINI_API_KEY secret. Get a free key at https://aistudio.google.com/apikey'
        };
      }

      const history = await loadThread(db, uid);
      history.push({ role: 'user', text, at: new Date().toISOString() });

      const reply = await callGemini(apiKey, history);
      history.push({ role: 'model', text: reply, at: new Date().toISOString() });

      const saved = await saveThread(db, uid, history);
      return { success: true, data: { reply, messages: saved } };
    } catch (error) {
      console.error('[AI] askPulse error:', error);
      return { success: false, message: error.message || 'Ask Pulse failed' };
    }
  });
}

module.exports = { register };
