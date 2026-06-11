import React, { useState, useEffect, useRef } from 'react';

// Pulse v2 (item: Ask Pulse) — floating AI assistant widget.
// A round button bottom-right opens a chat panel backed by Google Gemini
// (ai:askPulse). Conversation is persisted per user, so it survives refreshes.
// If the GEMINI_API_KEY secret isn't set yet, the panel shows a friendly
// "not connected" note instead of failing.
function AskPulse({ user }) {
  const myId = user?.id || user?.user_id || user?.userId || user?.uid;
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]); // { role:'user'|'model', text }
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState(true);
  const threadRef = useRef(null);

  useEffect(() => {
    if (!open || !myId) return;
    (async () => {
      try {
        const res = await window.electron.getPulseThread(myId);
        if (res?.success) {
          setMessages(res.data.messages || []);
          setConfigured(res.data.configured !== false);
        }
      } catch (_) { /* ignore */ }
    })();
  }, [open, myId]);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages, busy]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy || !myId) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text }]);
    setBusy(true);
    try {
      const res = await window.electron.askPulse(myId, text);
      if (res?.success) {
        setMessages(res.data.messages || []);
      } else if (res?.notConfigured) {
        setConfigured(false);
        setMessages(prev => [...prev, { role: 'model', text: res.message }]);
      } else {
        setMessages(prev => [...prev, { role: 'model', text: '⚠️ ' + (res?.message || 'Something went wrong.') }]);
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'model', text: '⚠️ ' + e.message }]);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!myId) return;
    try { await window.electron.resetPulseThread(myId); } catch (_) {}
    setMessages([]);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <>
      {/* Floating launcher */}
      <button
        onClick={() => setOpen(o => !o)}
        title="Ask Pulse — AI assistant"
        style={{
          position: 'fixed', right: 20, bottom: 20, zIndex: 9998,
          width: 56, height: 56, borderRadius: '50%', border: 'none', cursor: 'pointer',
          background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
          color: '#fff', fontSize: 24, boxShadow: '0 6px 20px rgba(99,102,241,0.45)'
        }}
      >
        {open ? '×' : '✨'}
      </button>

      {open && (
        <div style={{
          position: 'fixed', right: 20, bottom: 88, zIndex: 9998,
          width: 360, maxWidth: 'calc(100vw - 40px)', height: 520, maxHeight: 'calc(100vh - 120px)',
          background: 'var(--bg-1, #0f172a)', border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 14, boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden'
        }}>
          {/* Header */}
          <div style={{
            padding: '12px 14px', background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between'
          }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <strong style={{ fontSize: 15 }}>✨ Ask Pulse</strong>
              <span style={{ fontSize: 11, opacity: 0.85 }}>AI assistant · Task Tango Pulse</span>
            </div>
            <button onClick={reset} title="Clear conversation"
              style={{ background: 'rgba(255,255,255,0.18)', border: 0, color: '#fff', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 }}>
              ↺ New
            </button>
          </div>

          {/* Messages */}
          <div ref={threadRef} style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {messages.length === 0 && (
              <div style={{ color: 'var(--text-2, #94a3b8)', fontSize: 13, lineHeight: 1.5 }}>
                <p style={{ marginTop: 0 }}>👋 Hi {user?.fullName ? user.fullName.split(' ')[0] : 'there'}! I'm Pulse. Ask me about using Task Tango Pulse — attendance, leave, payroll, breaks — or anything work-related.</p>
                {!configured && (
                  <p style={{ color: '#f59e0b' }}>
                    ⓘ Ask Pulse isn't connected yet. An admin needs to set the <code>GEMINI_API_KEY</code> secret.
                  </p>
                )}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  maxWidth: '82%', padding: '8px 11px', borderRadius: 12, fontSize: 13.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  background: m.role === 'user' ? '#6366f1' : 'rgba(255,255,255,0.08)',
                  color: m.role === 'user' ? '#fff' : 'var(--text, #e5e7eb)'
                }}>
                  {m.text}
                </div>
              </div>
            ))}
            {busy && (
              <div style={{ alignSelf: 'flex-start', color: 'var(--text-2, #94a3b8)', fontSize: 12, fontStyle: 'italic' }}>
                Pulse is thinking…
              </div>
            )}
          </div>

          {/* Composer */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', padding: 10, display: 'flex', gap: 8 }}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask Pulse anything…"
              rows={1}
              style={{
                flex: 1, resize: 'none', borderRadius: 8, padding: '8px 10px', fontSize: 13,
                background: 'var(--bg-2, #1e293b)', color: 'var(--text, #e5e7eb)', border: '1px solid rgba(255,255,255,0.12)'
              }}
            />
            <button
              onClick={send}
              disabled={busy || !input.trim()}
              style={{
                border: 0, borderRadius: 8, padding: '0 14px', cursor: (busy || !input.trim()) ? 'not-allowed' : 'pointer',
                background: '#6366f1', color: '#fff', fontWeight: 700, opacity: (busy || !input.trim()) ? 0.6 : 1
              }}
            >
              ➤
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default AskPulse;
