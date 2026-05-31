import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * ChatWidget
 *
 * A floating chat panel anchored to the bottom-right of the dashboard. Tabs
 * between two views:
 *   - Conversations list  (recent chats, with unread badges)
 *   - New chat            (employee directory to start a fresh DM)
 *
 * Real-time delivery uses SSE: as soon as the widget mounts, it opens an
 * EventSource to /api/chat/stream and listens for 'message:new' and
 * 'conversation:new' events. There's also a polling safety-net in case the
 * stream drops momentarily (e.g. laptop sleeping).
 *
 * Used by every dashboard. Pass the signed-in user and a callback for the
 * total unread count so the sidebar can show a badge.
 */
// Curated set of ~80 popular emojis grouped by category for the picker.
// Static — no external library, so it adds zero kB.
const EMOJI_SET = [
  '😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😍','🥰','😘',
  '😎','🤩','😏','😌','😴','😮','😯','😲','🥺','😢','😭','😤','😠','😡','🤬','🤯',
  '😳','🥵','🥶','😱','😨','😰','🤔','🤨','😐','🙄','😬','🤥','😋','🤤','🤐','🤫',
  '👍','👎','👏','🙌','🙏','👋','✌️','🤝','💪','🤞','🤟','👌','🫶','🫡','✅','❌',
  '❤️','💔','💯','🔥','✨','🎉','🎊','🎂','🌟','⭐','💡','💬','💭','📌','📎','🚀'
];

function ChatWidget({ user, onUnreadChange, mode = 'floating' }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('conversations'); // 'conversations' | 'new'
  const [conversations, setConversations] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [activeConv, setActiveConv] = useState(null); // { conversationId, other }
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [unread, setUnread] = useState(0);
  const [search, setSearch] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  // v4.5 — Presence map keyed by userId: { status: 'working'|'on-break'|...|'offline', isOnline: bool }
  const [presence, setPresence] = useState({});
  // Pending attachment selected from disk but not yet sent.
  // Shape: { name, size, mime, base64 } where base64 is the file body without
  // the "data:...;base64," prefix.
  const [pendingAttachment, setPendingAttachment] = useState(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  // ─────────────────────────── Call state (v4.0) ───────────────────────────
  // Lifecycle:
  //   'idle'       — no call in progress
  //   'outgoing'   — we placed a call, waiting for them to pick up
  //   'incoming'   — they're calling us, accept/reject modal showing
  //   'connecting' — answer sent, ICE negotiating
  //   'in-call'    — media flowing both ways
  const [callState, setCallState] = useState('idle');
  // Peer of the active / pending call: { id, name, picture, conversationId, video }
  const [callPeer, setCallPeer] = useState(null);
  // SDP offer payload received from the caller; held until we accept.
  const [incomingOffer, setIncomingOffer] = useState(null);
  // Whether the local user is muted / camera-off during an in-call.
  const [callMuted, setCallMuted] = useState(false);
  const [callCameraOff, setCallCameraOff] = useState(false);
  // Whether the active call was started as audio-only (no local video sent).
  const [callIsVideo, setCallIsVideo] = useState(true);
  // v4.5 — Minimised call: shrinks the in-call view to a small floating
  // window so the user can interact with the rest of the app during a call.
  const [callMinimized, setCallMinimized] = useState(false);
  // Stream refs (the React-render <video> elements just point at these).
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  // v4.4.2: stash the remote stream so we can re-attach it once the in-call
  // view actually mounts. Without this, pc.ontrack fires before the <video>
  // element exists, attachStream silently no-ops against a null ref, and
  // calls go one-way (caller sees/hears callee but not vice versa).
  const remoteStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  // ICE candidates that arrive before we've finished setting the remote
  // description get parked here and applied once setRemoteDescription resolves.
  const pendingIceRef = useRef([]);
  // SSE closure-stable refs (the listener captures these once at mount).
  const callStateRef = useRef('idle');
  const callPeerRef = useRef(null);
  useEffect(() => { callStateRef.current = callState; }, [callState]);
  useEffect(() => { callPeerRef.current = callPeer; }, [callPeer]);
  // Lazy cache of inlined image data URLs for messages with attachments. Keyed
  // by attachment_path so a single image is fetched at most once per session.
  const [attachmentBlobs, setAttachmentBlobs] = useState({}); // { path: dataURL }
  const threadRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const lastSeenRef = useRef(null);  // ISO timestamp of newest message we've shown
  // Track open state so the SSE handler (whose closure may be stale) can
  // decide whether to fire a desktop notification.
  const openRef = useRef(false);
  const activeConvRef = useRef(null);
  useEffect(() => { openRef.current = open; }, [open]);
  useEffect(() => { activeConvRef.current = activeConv; }, [activeConv]);

  // Coalesce the typical id fields so we work with all auth flows.
  const myId = user?.id || user?.user_id || user?.userId || user?.uid;

  // ─────────────────────── WebRTC voice/video calling ───────────────────────
  // Google's public STUN servers. Enough for office-LAN and most home
  // connections. For tighter NAT scenarios a TURN server would need to be
  // added here — left as a future enhancement so we don't take on a monthly
  // bill or self-hosted infra today.
  const ICE_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // ─────────────────────────── Audio cues (v4.1) ───────────────────────────
  // Synthesised tones via Web Audio API — no audio files in the bundle.
  // We keep a single AudioContext per session so repeated tones don't spawn
  // dozens of contexts (Chromium caps them).
  const audioContextRef = useRef(null);
  // Stop-fn returned by startRingPattern; called to interrupt the loop.
  const ringStopRef = useRef(null);

  const getAudioContext = () => {
    if (!audioContextRef.current) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        audioContextRef.current = new AC();
      } catch (_) { return null; }
    }
    // Browser autoplay policy may suspend the context until a user gesture.
    // resume() is a no-op when already running.
    if (audioContextRef.current.state === 'suspended') {
      try { audioContextRef.current.resume(); } catch (_) {}
    }
    return audioContextRef.current;
  };

  // Play a single sine tone. Used for the chat-message beep and as the
  // building block of the ring pattern.
  const playTone = ({ frequency = 880, durationMs = 150, volume = 0.18, type = 'sine' }) => {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = frequency;
      // Tiny attack + release envelope so the tone doesn't click.
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(volume, now + 0.02);
      gain.gain.setValueAtTime(volume, now + (durationMs / 1000) - 0.04);
      gain.gain.linearRampToValueAtTime(0, now + (durationMs / 1000));
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + (durationMs / 1000) + 0.02);
    } catch (_) { /* device unavailable */ }
  };

  // Short two-tone chirp for "new chat message arrived".
  const playMessageBeep = () => {
    playTone({ frequency: 880, durationMs: 110, volume: 0.18 });
    setTimeout(() => playTone({ frequency: 1320, durationMs: 110, volume: 0.18 }), 130);
  };

  // Looping ring pattern. Returns a stop-fn so the caller can cancel it
  // when the call is accepted / rejected / cancelled.
  const startRingPattern = ({ incoming = false } = {}) => {
    if (ringStopRef.current) return; // already ringing
    let stopped = false;
    const beat = incoming ? 2400 : 3000; // ms between rings
    const ring = () => {
      if (stopped) return;
      // Classic "ring ring" — two short bursts close together, then pause.
      playTone({ frequency: incoming ? 480 : 440, durationMs: 380, volume: 0.16 });
      setTimeout(() => playTone({ frequency: incoming ? 620 : 480, durationMs: 380, volume: 0.16 }), 460);
      if (!stopped) setTimeout(ring, beat);
    };
    ring();
    ringStopRef.current = () => { stopped = true; ringStopRef.current = null; };
  };
  const stopRingPattern = () => { if (ringStopRef.current) ringStopRef.current(); };

  // Drive ring tones off callState so they always reflect the source of truth.
  useEffect(() => {
    if (callState === 'incoming') startRingPattern({ incoming: true });
    else if (callState === 'outgoing') startRingPattern({ incoming: false });
    else stopRingPattern();
    return () => stopRingPattern();
  }, [callState]);

  // Friendly guard for the "navigator.mediaDevices is undefined" failure
  // mode. This happens when the renderer is loaded over a non-secure origin
  // (any plain http:// that isn't localhost), which the browser locks down.
  // Surface a clear message instead of the cryptic TypeError that was
  // showing up in the toast before.
  const ensureMediaSupport = () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      window.toast?.error?.(
        'Voice/video calls need a secure context. Open TaskTango from the desktop app or via http://localhost — calling over http://<lan-ip> in a browser is blocked by your browser\'s security policy.'
      );
      return false;
    }
    return true;
  };

  // Attach a MediaStream to a <video> element via its ref. We assign srcObject
  // rather than .src so the browser uses the live stream object instead of
  // trying to interpret it as a URL.
  const attachStream = (ref, stream) => {
    if (ref?.current) {
      ref.current.srcObject = stream || null;
    }
  };

  // Tear down whatever's running and reset state. Called by every "call
  // finished" path (hangup, reject, error, peer disconnect).
  const teardownCall = () => {
    try { if (peerConnectionRef.current) peerConnectionRef.current.close(); } catch (_) {}
    peerConnectionRef.current = null;
    if (localStreamRef.current) {
      try { localStreamRef.current.getTracks().forEach(t => t.stop()); } catch (_) {}
    }
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    attachStream(localVideoRef, null);
    attachStream(remoteVideoRef, null);
    pendingIceRef.current = [];
    setCallState('idle');
    setCallPeer(null);
    setIncomingOffer(null);
    setCallMuted(false);
    setCallCameraOff(false);
    setCallIsVideo(true);
  };

  // v4.4.2: when the in-call view actually mounts (after callState flips to
  // 'in-call' or 'connecting'), re-attach the stashed streams. Without this,
  // pc.ontrack runs before the <video> element exists, attachStream no-ops
  // against the null ref, and the user sees a black screen / hears nothing
  // from the other side — calls go one-way.
  useEffect(() => {
    if (callState === 'in-call' || callState === 'connecting') {
      if (remoteStreamRef.current && remoteVideoRef.current && !remoteVideoRef.current.srcObject) {
        attachStream(remoteVideoRef, remoteStreamRef.current);
      }
      if (localStreamRef.current && localVideoRef.current && !localVideoRef.current.srcObject) {
        attachStream(localVideoRef, localStreamRef.current);
      }
    }
  }, [callState, callIsVideo]);

  // Build a fresh RTCPeerConnection wired to the SSE signal relay. Returns
  // the pc so the caller can chain createOffer/createAnswer on it.
  const buildPeerConnection = (peer, conversationId) => {
    const pc = new RTCPeerConnection(ICE_CONFIG);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        // Stringify because RTCIceCandidate is a class instance — IPC clones
        // strip class identity, but the JSON form round-trips perfectly.
        window.electron.callSignal(myId, peer.id, 'ice', e.candidate.toJSON ? e.candidate.toJSON() : e.candidate, conversationId)
          .catch(err => console.warn('[CALL] ice signal failed:', err));
      }
    };

    pc.ontrack = (e) => {
      const [remoteStream] = e.streams;
      // Save the stream first — the <video> element doesn't exist yet
      // because the in-call UI hasn't rendered. The useEffect below
      // re-attaches once callState flips to 'in-call' and the element mounts.
      remoteStreamRef.current = remoteStream;
      attachStream(remoteVideoRef, remoteStream); // also try now in case ref is already alive
      // Receiving tracks means we're past the negotiation phase.
      setCallState('in-call');
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') setCallState('in-call');
      else if (s === 'failed' || s === 'disconnected' || s === 'closed') {
        // Peer dropped — clean up locally; no need to send hangup back.
        teardownCall();
      }
    };

    return pc;
  };

  // Place a call. `video` = true → audio + video; false → audio only.
  const startCall = async (otherUser, video = true) => {
    if (callStateRef.current !== 'idle') return;
    if (!activeConv?.conversationId || !otherUser?.id) return;
    if (!ensureMediaSupport()) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
      localStreamRef.current = stream;
      attachStream(localVideoRef, stream);

      const peer = {
        id: otherUser.id,
        name: otherUser.fullName || otherUser.full_name || 'Unknown',
        picture: otherUser.profilePicturePath || otherUser.profile_picture_path || null,
        conversationId: activeConv.conversationId
      };
      setCallPeer(peer);
      setCallIsVideo(video);
      setCallState('outgoing');

      const pc = buildPeerConnection(peer, activeConv.conversationId);
      stream.getTracks().forEach(t => pc.addTrack(t, stream));
      peerConnectionRef.current = pc;

      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: video });
      await pc.setLocalDescription(offer);

      // Explicitly serialize the SDP as a plain {type, sdp} object before
      // sending. RTCSessionDescription is a Web platform object — Electron's
      // structured-clone over IPC can strip its prototype and lose the type
      // field, which then trips "Failed to parse SessionDescription" on the
      // receiver's setRemoteDescription. Same fix applied to acceptCall.
      const offerSdp = { type: offer.type, sdp: offer.sdp };
      await window.electron.callSignal(myId, peer.id, 'offer', { sdp: offerSdp, video }, activeConv.conversationId);
    } catch (err) {
      window.toast?.error?.('Could not start call: ' + (err?.message || err));
      teardownCall();
    }
  };

  // Accept the currently-ringing incoming call.
  const acceptCall = async () => {
    const peer = callPeerRef.current;
    const offerPayload = incomingOffer;
    if (!peer || !offerPayload) return;
    if (!ensureMediaSupport()) {
      // Browser blocked media — tell the caller we can't pick up.
      try { await window.electron.callSignal(myId, peer.id, 'reject', null, peer.conversationId); } catch (_) {}
      teardownCall();
      return;
    }
    try {
      const video = offerPayload.video !== false;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
      localStreamRef.current = stream;
      attachStream(localVideoRef, stream);
      setCallIsVideo(video);
      setCallState('connecting');

      const pc = buildPeerConnection(peer, peer.conversationId);
      stream.getTracks().forEach(t => pc.addTrack(t, stream));
      peerConnectionRef.current = pc;

      await pc.setRemoteDescription(offerPayload.sdp);
      // Flush any ICE candidates that arrived before the offer was applied.
      for (const c of pendingIceRef.current) {
        try { await pc.addIceCandidate(c); } catch (_) {}
      }
      pendingIceRef.current = [];

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      // Same explicit serialization as startCall — the answer is also an
      // RTCSessionDescription and would otherwise lose its type field over IPC.
      const answerSdp = { type: answer.type, sdp: answer.sdp };
      await window.electron.callSignal(myId, peer.id, 'answer', { sdp: answerSdp }, peer.conversationId);
      setIncomingOffer(null);
    } catch (err) {
      window.toast?.error?.('Could not accept call: ' + (err?.message || err));
      // Tell the caller we couldn't pick up so their UI clears.
      if (peer) {
        try { await window.electron.callSignal(myId, peer.id, 'reject', null, peer.conversationId); } catch (_) {}
      }
      teardownCall();
    }
  };

  // Decline an incoming call before answering.
  const rejectCall = async () => {
    const peer = callPeerRef.current;
    if (peer) {
      try { await window.electron.callSignal(myId, peer.id, 'reject', null, peer.conversationId); } catch (_) {}
    }
    teardownCall();
  };

  // Hang up an active or outgoing call. If we never connected, mark missed
  // so the chat-history marker reads "📞 Missed call".
  const endCall = async () => {
    const peer = callPeerRef.current;
    const wasOutgoingRing = callStateRef.current === 'outgoing';
    if (peer) {
      try {
        await window.electron.callSignal(
          myId, peer.id, 'hangup',
          { missed: wasOutgoingRing },
          peer.conversationId
        );
      } catch (_) {}
    }
    teardownCall();
  };

  // Toggle microphone / camera on the existing local stream. We don't recreate
  // the peer connection; just enable/disable the relevant track so the remote
  // sees a black frame / silence instantly.
  const toggleMute = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !callMuted;
    stream.getAudioTracks().forEach(t => { t.enabled = !next; });
    setCallMuted(next);
  };
  const toggleCamera = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !callCameraOff;
    stream.getVideoTracks().forEach(t => { t.enabled = !next; });
    setCallCameraOff(next);
  };

  // SSE message handlers for the call:* events. Stable closures via the
  // *Ref bookkeeping at the top of the component.
  const handleIncomingOffer = (payload) => {
    if (callStateRef.current !== 'idle') {
      // Already on a call — auto-reject the new one so the caller's UI clears.
      window.electron.callSignal(myId, payload.fromUserId, 'reject', null, payload.conversationId).catch(() => {});
      return;
    }
    setCallPeer({
      id: payload.fromUserId,
      name: payload.senderName,
      picture: payload.senderPicture,
      conversationId: payload.conversationId
    });
    setIncomingOffer(payload.payload);
    setCallIsVideo(payload.payload?.video !== false);
    setCallState('incoming');
  };
  const handleIncomingAnswer = async (payload) => {
    const pc = peerConnectionRef.current;
    if (!pc || !payload.payload?.sdp) return;
    try {
      await pc.setRemoteDescription(payload.payload.sdp);
      // Flush parked ICE.
      for (const c of pendingIceRef.current) {
        try { await pc.addIceCandidate(c); } catch (_) {}
      }
      pendingIceRef.current = [];
      setCallState('connecting');
    } catch (e) { console.warn('[CALL] setRemoteDescription(answer) failed:', e); }
  };
  const handleIncomingIce = async (payload) => {
    const pc = peerConnectionRef.current;
    if (!payload.payload) return;
    if (!pc || !pc.remoteDescription) {
      // Park it — we'll add it once setRemoteDescription resolves.
      pendingIceRef.current.push(payload.payload);
      return;
    }
    try { await pc.addIceCandidate(payload.payload); }
    catch (e) { console.warn('[CALL] addIceCandidate failed:', e); }
  };
  const handleRemoteHangup = () => { teardownCall(); };

  // Fire an HTML5 desktop notification. Works in Electron's renderer; the
  // user is prompted once for permission. We skip the popup when the chat
  // panel is already open AND the window is focused — in that case the
  // unread badge + appended message is enough signal.
  const fireDesktopNotification = (payload) => {
    try {
      if (typeof window === 'undefined' || !('Notification' in window)) return;
      if (openRef.current && document.hasFocus()) return;
      const fire = () => {
        try {
          const n = new Notification(`💬 ${payload.senderName || 'New message'}`, {
            body: payload.content || (payload.attachmentName ? `📎 ${payload.attachmentName}` : ''),
            tag: payload.conversationId,
            silent: false
          });
          n.onclick = () => {
            try { window.focus(); } catch (_) {}
            // Re-open chat panel + select the conversation that pinged us.
            setOpen(true);
            const conv = conversations.find(c => c.conversationId === payload.conversationId);
            if (conv) handleOpenConversation(conv);
            n.close();
          };
        } catch (_) { /* notification creation can throw if permission denied */ }
      };
      if (Notification.permission === 'granted') fire();
      else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(p => { if (p === 'granted') fire(); });
      }
    } catch (_) { /* never break chat on notification failure */ }
  };

  // Insert text at the current cursor position in the input. Falls back to
  // appending if the ref isn't ready or the element doesn't expose selection.
  const insertAtCursor = (text) => {
    const el = inputRef.current;
    if (!el || typeof el.selectionStart !== 'number') {
      setDraft(prev => prev + text);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = draft.slice(0, start) + text + draft.slice(end);
    setDraft(next);
    setTimeout(() => {
      try {
        el.focus();
        const pos = start + text.length;
        el.setSelectionRange(pos, pos);
      } catch (_) {}
    }, 0);
  };

  // Read a file from disk into base64 (no data URL prefix) so it can be
  // shipped over IPC to the main process for storage.
  const fileToBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      } catch (e) { reject(e); }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const MAX = 10 * 1024 * 1024; // 10 MB
    if (file.size > MAX) {
      window.toast?.error?.('File too large (max 10 MB)');
      return;
    }
    try {
      setUploadingAttachment(true);
      const base64 = await fileToBase64(file);
      setPendingAttachment({
        name: file.name,
        size: file.size,
        mime: file.type || 'application/octet-stream',
        base64
      });
    } catch (err) {
      window.toast?.error?.('Could not read file: ' + (err.message || err));
    } finally {
      setUploadingAttachment(false);
    }
  };

  const clearPendingAttachment = () => setPendingAttachment(null);

  // Format a byte size as KB/MB so attachment chips read cleanly.
  const fmtBytes = (n) => {
    if (n == null) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  };

  // Lazy-load image attachment bytes via IPC and cache as data URL. Non-image
  // attachments aren't loaded — they're shown as a download chip.
  const ensureAttachmentBlob = async (msg) => {
    if (!msg?.attachmentPath || attachmentBlobs[msg.attachmentPath]) return;
    if (!(msg.attachmentMime || '').startsWith('image/')) return;
    try {
      const r = await window.electron.chatReadAttachment(msg.attachmentPath);
      if (r?.success && r.data?.base64) {
        const dataUrl = `data:${msg.attachmentMime};base64,${r.data.base64}`;
        setAttachmentBlobs(prev => ({ ...prev, [msg.attachmentPath]: dataUrl }));
      }
    } catch (_) { /* leave missing — chip falls back to link */ }
  };

  const openAttachment = async (msg) => {
    if (!msg?.attachmentPath) return;
    try {
      // v4.4.2: always go via fetch-bytes + browser-download instead of
      // chat:openAttachment (which uses shell.openPath, a no-op on the
      // server-mode stub). Works identically on desktop and web — clicking
      // a non-image attachment downloads the file via a temporary <a>.
      const r = await window.electron.chatReadAttachment(msg.attachmentPath);
      if (!r?.success || !r.data?.base64) {
        window.toast?.error?.('Could not read file: ' + (r?.message || 'unknown error'));
        return;
      }
      const binary = atob(r.data.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: msg.attachmentMime || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = msg.attachmentName || 'attachment';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      window.toast?.error?.('Could not open file: ' + (err?.message || err));
    }
  };

  const refreshUnread = async () => {
    try {
      const r = await window.electron.chatGetUnreadCount(myId);
      if (r?.success) {
        setUnread(r.data?.count || 0);
        if (onUnreadChange) onUnreadChange(r.data?.count || 0);
      }
    } catch (_) { /* ignore */ }
  };

  const refreshConversations = async () => {
    try {
      const r = await window.electron.chatListConversations(myId);
      if (r?.success) setConversations(r.data || []);
    } catch (_) { /* ignore */ }
  };

  const refreshContacts = async () => {
    try {
      const r = await window.electron.chatListContacts(myId);
      if (r?.success) setContacts(r.data || []);
    } catch (_) { /* ignore */ }
  };

  const loadMessages = async (conversationId) => {
    try {
      const r = await window.electron.chatGetMessages(myId, conversationId);
      if (r?.success) {
        setMessages(r.data || []);
        const last = r.data?.length ? r.data[r.data.length - 1].sentAt : null;
        lastSeenRef.current = last;
        // Mark conversation read so the unread badge clears
        await window.electron.chatMarkRead(myId, conversationId);
        refreshUnread();
        refreshConversations();
        // Scroll to bottom on next tick
        setTimeout(() => {
          if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
        }, 50);
      }
    } catch (_) { /* ignore */ }
  };

  // v4.5 — Presence polling. Refresh every 30s for everyone currently
  // visible (conversation peers + contacts + active thread). The dot
  // shown next to each avatar reads from this map. Refreshes also fire
  // on every SSE message:new event (the existing handler triggers a
  // conversation refresh) — adding presence in the same window keeps
  // dots fresh without extra round-trips.
  useEffect(() => {
    if (!myId) return;
    const tick = async () => {
      try {
        const ids = new Set();
        for (const c of conversations) {
          if (c?.other?.id) ids.add(c.other.id);
        }
        for (const c of contacts) {
          if (c?.id) ids.add(c.id);
        }
        if (activeConv?.other?.id) ids.add(activeConv.other.id);
        if (callPeer?.id) ids.add(callPeer.id);
        const list = Array.from(ids);
        if (list.length === 0) return;
        const r = await window.electron.chatGetPresence(list);
        if (r?.success && Array.isArray(r.data)) {
          const next = {};
          for (const row of r.data) next[row.userId] = row;
          setPresence(next);
        }
      } catch (_) { /* ignore — presence is best-effort */ }
    };
    tick();
    const t = setInterval(tick, 30000);
    return () => clearInterval(t);
  }, [myId, conversations, contacts, activeConv?.other?.id, callPeer?.id]);

  // Initial load + periodic safety-net poll for unread (handles SSE reconnect gaps)
  useEffect(() => {
    if (!myId) return;
    refreshConversations();
    refreshUnread();
    const poll = setInterval(refreshUnread, 30000);
    return () => clearInterval(poll);
    // eslint-disable-next-line
  }, [myId]);

  // SSE subscription — open when the widget is mounted (regardless of panel
  // open/closed) so unread counts stay live in the sidebar.
  useEffect(() => {
    if (!myId) return;
    const url = window.electron.chatStreamUrl(myId);
    let es;
    try {
      es = new EventSource(url, { withCredentials: false });
    } catch (e) {
      console.warn('[chat] EventSource not supported / URL invalid:', e);
      return;
    }
    const onMessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        const conv = activeConvRef.current;
        // If the active conversation matches, append the message to the open thread.
        if (conv && payload.conversationId === conv.conversationId) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === payload.id)) return prev;
            return [...prev, payload];
          });
          // Auto-mark as read since the window is open and visible to the user
          window.electron.chatMarkRead(myId, conv.conversationId).then(refreshUnread);
          setTimeout(() => {
            if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
          }, 30);
        } else if (payload.senderId !== myId) {
          // Message from someone else, not in the open thread → desktop notify
          // and chirp. Skip own messages echoed back via SSE (multi-tab
          // support broadcasts to the sender too).
          fireDesktopNotification(payload);
          // Skip the beep when a call is ringing or in-progress so the audio
          // cues don't overlap.
          if (callStateRef.current === 'idle') playMessageBeep();
        }
        // Always refresh the conversation list + unread counter
        refreshConversations();
        refreshUnread();
      } catch (err) { /* malformed event, ignore */ }
    };
    const onConv = () => { refreshConversations(); };
    // Call signal routing. Each call:* SSE event maps to a renderer-side
    // WebRTC step. We intentionally parse the JSON here (rather than in each
    // handler) so a malformed event doesn't crash the listener.
    const onCallOffer = (e) => {
      try { handleIncomingOffer(JSON.parse(e.data)); } catch (_) {}
    };
    const onCallAnswer = (e) => {
      try { handleIncomingAnswer(JSON.parse(e.data)); } catch (_) {}
    };
    const onCallIce = (e) => {
      try { handleIncomingIce(JSON.parse(e.data)); } catch (_) {}
    };
    const onCallHangup = (e) => {
      try { JSON.parse(e.data); } catch (_) {}
      handleRemoteHangup();
    };
    const onCallReject = (e) => {
      try { JSON.parse(e.data); } catch (_) {}
      // Caller side: they declined. Tear down with a small toast.
      if (callStateRef.current === 'outgoing') {
        window.toast?.info?.(`${callPeerRef.current?.name || 'Recipient'} declined the call`);
      }
      handleRemoteHangup();
    };
    es.addEventListener('message:new', onMessage);
    es.addEventListener('conversation:new', onConv);
    es.addEventListener('call:offer',  onCallOffer);
    es.addEventListener('call:answer', onCallAnswer);
    es.addEventListener('call:ice',    onCallIce);
    es.addEventListener('call:hangup', onCallHangup);
    es.addEventListener('call:reject', onCallReject);
    es.onerror = () => { /* browser will auto-reconnect */ };
    return () => {
      try { es.close(); } catch (_) {}
    };
    // eslint-disable-next-line
  }, [myId, activeConv?.conversationId]);

  const handleOpenConversation = async (conv) => {
    setActiveConv({
      conversationId: conv.conversationId,
      other: conv.other
    });
    setMessages([]);
    setView('conversations');
    loadMessages(conv.conversationId);
  };

  const handleStartNewChat = async (contact) => {
    try {
      const r = await window.electron.chatStartConversation(myId, contact.id);
      if (r?.success) {
        const convId = r.data.conversationId;
        setActiveConv({
          conversationId: convId,
          other: {
            id: contact.id,
            fullName: contact.fullName,
            profilePicturePath: contact.profilePicturePath,
            departmentName: contact.departmentName,
            roleName: contact.roleName
          }
        });
        setMessages([]);
        setView('conversations');
        loadMessages(convId);
        refreshConversations();
      }
    } catch (e) {
      console.error('[chat] could not start conversation:', e);
    }
  };

  const handleSend = async (e) => {
    if (e) e.preventDefault();
    const text = draft.trim();
    // A send is valid if there's either a text body or a pending attachment.
    if ((!text && !pendingAttachment) || !activeConv || sending) return;
    setSending(true);
    setEmojiOpen(false);
    try {
      const r = await window.electron.chatSendMessage(
        myId,
        activeConv.conversationId,
        text,
        pendingAttachment || null
      );
      if (r?.success) {
        setDraft('');
        setPendingAttachment(null);
        // Append optimistically (SSE will deduplicate by id)
        setMessages((prev) => prev.some((m) => m.id === r.data.id) ? prev : [...prev, r.data]);
        refreshConversations();
        setTimeout(() => {
          if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
        }, 30);
      } else {
        window.toast?.error?.('Failed to send: ' + (r?.message || 'Unknown error'));
      }
    } catch (err) {
      window.toast?.error?.('Send failed: ' + err.message);
    } finally {
      setSending(false);
    }
  };

  const filteredContacts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) =>
      c.fullName?.toLowerCase().includes(q) ||
      c.departmentName?.toLowerCase().includes(q) ||
      c.roleName?.toLowerCase().includes(q)
    );
  }, [contacts, search]);

  const fmtTime = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const today = new Date();
    const sameDay = d.getFullYear() === today.getFullYear()
                 && d.getMonth() === today.getMonth()
                 && d.getDate() === today.getDate();
    if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString([], { day: '2-digit', month: 'short' }) + ' ' +
           d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // v4.5 — small presence dot positioned bottom-right of the wrapper.
  // Colours match the team-status palette in DashboardCharts.
  const PRESENCE_COLORS = {
    working:    '#10b981', // green — signed in, working
    'on-break': '#f59e0b', // amber — break in progress
    idle:       '#facc15', // yellow — app open, not yet stamped sign-in
    'signed-off': '#3b82f6', // blue — done for the day
    absent:     '#ef4444', // red — marked absent
    'on-leave': '#a78bfa', // purple — on leave
    offline:    '#64748b'  // grey — app closed + no attendance
  };
  const PRESENCE_LABEL = {
    working:    'Working',
    'on-break': 'On break',
    idle:       'Online',
    'signed-off': 'Signed off',
    absent:     'Absent',
    'on-leave': 'On leave',
    offline:    'Offline'
  };
  const PresenceDot = ({ userId, size = 10 }) => {
    if (!userId) return null;
    const p = presence[userId];
    if (!p) return null; // unknown — render nothing rather than misleading grey
    const color = PRESENCE_COLORS[p.status] || PRESENCE_COLORS.offline;
    return (
      <span
        title={PRESENCE_LABEL[p.status] || p.status}
        style={{
          position: 'absolute', bottom: -1, right: -1,
          width: size, height: size, borderRadius: '50%',
          background: color, border: '2px solid var(--bg-2, #1f2937)',
          pointerEvents: 'none'
        }}
      />
    );
  };

  const Avatar = ({ src, name, size = 36, userId = null }) => (
    <div style={{
      position: 'relative', flexShrink: 0,
      width: size, height: size
    }}>
      <div style={{
        width: size, height: size, borderRadius: '50%',
        background: '#f59e0b', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 700, fontSize: size * 0.4, overflow: 'hidden'
      }}>
        {src
          ? <img src={src} alt={name || '?'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : (name || '?').charAt(0).toUpperCase()}
      </div>
      {/* v4.5 — presence dot overlay; auto-sizes with the avatar. */}
      <PresenceDot userId={userId} size={Math.max(8, Math.round(size * 0.28))} />
    </div>
  );

  if (!myId) return null;

  const isHeader = mode === 'header';

  // Launcher styles differ per mode: header = transparent inline icon matching
  // NotificationBell; floating = bottom-right FAB.
  const launcherStyle = isHeader
    ? {
        background: 'transparent',
        border: 0,
        cursor: 'pointer',
        padding: '6px 10px',
        borderRadius: '50%',
        fontSize: '22px',
        position: 'relative',
        lineHeight: 1,
        color: 'inherit'
      }
    : {
        position: 'fixed',
        right: '20px',
        bottom: '20px',
        width: '56px',
        height: '56px',
        borderRadius: '50%',
        background: '#3b82f6',
        color: '#fff',
        border: 'none',
        boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
        cursor: 'pointer',
        fontSize: '24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9998
      };

  // Badge sits slightly different on the inline icon vs the FAB.
  const badgeStyle = isHeader
    ? {
        position: 'absolute',
        top: '0px', right: '0px',
        minWidth: '18px', height: '18px',
        padding: '0 5px',
        background: '#dc2626',
        color: '#ffffff',
        borderRadius: '9px',
        fontSize: '11px',
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '2px solid var(--bg, #0f1f2e)'
      }
    : {
        position: 'absolute',
        top: '-4px',
        right: '-4px',
        background: '#ef4444',
        color: '#fff',
        borderRadius: '12px',
        minWidth: '22px',
        height: '22px',
        fontSize: '11px',
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 6px',
        border: '2px solid #1f2937'
      };

  // Panel anchor: header drops down from the top-right under the dashboard
  // header bar; floating slides up from above the FAB.
  const panelStyle = isHeader
    ? {
        position: 'fixed',
        top: '76px',
        right: '20px',
        width: 'min(680px, 92vw)',
        height: 'min(560px, 80vh)',
        background: 'var(--bg-2, #1f2937)',
        color: 'var(--text, #f3f4f6)',
        borderRadius: '12px',
        boxShadow: '0 18px 50px rgba(0,0,0,0.45)',
        border: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 9999,
        overflow: 'hidden'
      }
    : {
        position: 'fixed',
        right: '20px',
        bottom: '88px',
        width: 'min(680px, 92vw)',
        height: 'min(560px, 80vh)',
        background: 'var(--bg-2, #1f2937)',
        color: 'var(--text, #f3f4f6)',
        borderRadius: '12px',
        boxShadow: '0 18px 50px rgba(0,0,0,0.45)',
        border: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 9999,
        overflow: 'hidden'
      };

  // Open the panel and, if there's an unread thread, jump straight into it
  // instead of dumping the user on a bare conversation list.
  const handleLauncherClick = async () => {
    const willOpen = !open;
    setOpen(willOpen);
    if (willOpen) {
      const fresh = await window.electron.chatListConversations(myId);
      const list = fresh?.success ? (fresh.data || []) : conversations;
      setConversations(list);
      refreshContacts();
      // Pick the most recently-active conversation that has unread messages.
      const unreadConvs = list
        .filter(c => (c.unreadCount || 0) > 0)
        .sort((a, b) => String(b.lastMessageAt || '').localeCompare(String(a.lastMessageAt || '')));
      if (unreadConvs.length > 0) {
        handleOpenConversation(unreadConvs[0]);
      }
    }
  };

  return (
    <>
      {/* Pulse keyframe injected once via a <style> tag so we can drive the
          animation from inline style without adding a global CSS rule. */}
      <style>{`
        @keyframes tt-chat-pulse {
          0%   { transform: scale(1);   box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.55); }
          70%  { transform: scale(1.08); box-shadow: 0 0 0 8px rgba(220, 38, 38, 0); }
          100% { transform: scale(1);   box-shadow: 0 0 0 0 rgba(220, 38, 38, 0); }
        }
      `}</style>
      {/* Launcher button — inline (header mode) or floating FAB (default) */}
      <button
        onClick={handleLauncherClick}
        title={unread > 0 ? `${unread} unread message${unread === 1 ? '' : 's'}` : 'Chat'}
        aria-label={`Chat (${unread} unread)`}
        style={launcherStyle}
      >
        💬
        {unread > 0 && (
          <span style={{ ...badgeStyle, animation: 'tt-chat-pulse 1.5s ease-in-out infinite' }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div style={panelStyle}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)'
          }}>
            <strong style={{ fontSize: '15px' }}>💬 Chat</strong>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={() => { setView('conversations'); }}
                style={{
                  padding: '4px 10px', fontSize: '12px', cursor: 'pointer',
                  borderRadius: '6px', border: '1px solid rgba(255,255,255,0.08)',
                  background: view === 'conversations' ? 'rgba(59,130,246,0.18)' : 'transparent',
                  color: 'inherit'
                }}
              >
                Recent
              </button>
              <button
                onClick={() => { setView('new'); refreshContacts(); }}
                style={{
                  padding: '4px 10px', fontSize: '12px', cursor: 'pointer',
                  borderRadius: '6px', border: '1px solid rgba(255,255,255,0.08)',
                  background: view === 'new' ? 'rgba(59,130,246,0.18)' : 'transparent',
                  color: 'inherit'
                }}
              >
                New Chat
              </button>
              <button
                onClick={() => setOpen(false)}
                style={{
                  padding: '4px 10px', fontSize: '12px', cursor: 'pointer',
                  borderRadius: '6px', border: '1px solid rgba(255,255,255,0.08)',
                  background: 'transparent', color: 'inherit'
                }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* Body — left list + right thread */}
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            {/* Left list */}
            <div style={{
              width: '240px',
              borderRight: '1px solid rgba(255,255,255,0.06)',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0
            }}>
              {view === 'new' && (
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search people..."
                  style={{
                    margin: '8px',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    border: '1px solid rgba(255,255,255,0.08)',
                    background: 'rgba(0,0,0,0.25)',
                    color: 'inherit',
                    fontSize: '13px'
                  }}
                />
              )}
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {view === 'conversations' ? (
                  conversations.length === 0 ? (
                    <p style={{ padding: '14px', fontSize: '12px', color: 'var(--text-2, #94a3b8)' }}>
                      No conversations yet. Tap <em>New Chat</em> to start one.
                    </p>
                  ) : conversations.map((conv) => (
                    <div
                      key={conv.conversationId}
                      onClick={() => handleOpenConversation(conv)}
                      style={{
                        padding: '10px 12px',
                        display: 'flex',
                        gap: '10px',
                        alignItems: 'center',
                        borderBottom: '1px solid rgba(255,255,255,0.04)',
                        cursor: 'pointer',
                        background: activeConv?.conversationId === conv.conversationId
                          ? 'rgba(59,130,246,0.12)' : 'transparent'
                      }}
                    >
                      <Avatar src={conv.other?.profilePicturePath} name={conv.other?.fullName} userId={conv.other?.id} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                        }}>
                          <div style={{ fontWeight: 600, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {conv.other?.fullName || 'Unknown'}
                          </div>
                          {conv.unreadCount > 0 && (
                            <span style={{
                              background: '#ef4444', color: '#fff',
                              borderRadius: '10px', padding: '0 6px',
                              fontSize: '10px', fontWeight: 700,
                              minWidth: '18px', textAlign: 'center'
                            }}>{conv.unreadCount}</span>
                          )}
                        </div>
                        <div style={{
                          fontSize: '11px', color: 'var(--text-2, #94a3b8)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                        }}>
                          {conv.lastMessage || <em>No messages yet</em>}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  filteredContacts.map((c) => (
                    <div
                      key={c.id}
                      onClick={() => handleStartNewChat(c)}
                      style={{
                        padding: '10px 12px',
                        display: 'flex',
                        gap: '10px',
                        alignItems: 'center',
                        borderBottom: '1px solid rgba(255,255,255,0.04)',
                        cursor: 'pointer'
                      }}
                    >
                      <Avatar src={c.profilePicturePath} name={c.fullName} userId={c.id} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.fullName}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-2, #94a3b8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.roleName}{c.departmentName ? ` · ${c.departmentName}` : ''}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Right thread */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              {!activeConv ? (
                <div style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--text-2, #94a3b8)', fontSize: '13px', textAlign: 'center', padding: '20px'
                }}>
                  Pick a conversation on the left, or start a new chat.
                </div>
              ) : (
                <>
                  {/* Thread header */}
                  <div style={{
                    padding: '10px 14px',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex', gap: '10px', alignItems: 'center'
                  }}>
                    <Avatar src={activeConv.other?.profilePicturePath} name={activeConv.other?.fullName} size={32} userId={activeConv.other?.id} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '14px' }}>{activeConv.other?.fullName}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-2, #94a3b8)' }}>
                        {activeConv.other?.roleName}{activeConv.other?.departmentName ? ` · ${activeConv.other.departmentName}` : ''}
                      </div>
                    </div>
                    {/* Call buttons — only visible when no call is in progress. */}
                    {callState === 'idle' && activeConv.other?.id && (
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={() => startCall(activeConv.other, false)}
                          title={`Audio call ${activeConv.other.fullName}`}
                          style={{
                            background: 'transparent', border: 0, cursor: 'pointer',
                            color: 'inherit', fontSize: '18px', padding: '6px 8px',
                            borderRadius: '6px'
                          }}
                        >📞</button>
                        <button
                          type="button"
                          onClick={() => startCall(activeConv.other, true)}
                          title={`Video call ${activeConv.other.fullName}`}
                          style={{
                            background: 'transparent', border: 0, cursor: 'pointer',
                            color: 'inherit', fontSize: '18px', padding: '6px 8px',
                            borderRadius: '6px'
                          }}
                        >🎥</button>
                      </div>
                    )}
                  </div>
                  {/* Messages */}
                  <div ref={threadRef} style={{
                    flex: 1, overflowY: 'auto', padding: '12px 14px',
                    display: 'flex', flexDirection: 'column', gap: '6px'
                  }}>
                    {messages.length === 0 ? (
                      <p style={{ color: 'var(--text-2, #94a3b8)', fontSize: '12px', fontStyle: 'italic', textAlign: 'center' }}>
                        No messages yet — say hi 👋
                      </p>
                    ) : messages.map((m) => {
                      const mine = m.senderId === myId;
                      const hasAttachment = !!m.attachmentPath;
                      const isImage = hasAttachment && (m.attachmentMime || '').startsWith('image/');
                      if (isImage) ensureAttachmentBlob(m);
                      const imgSrc = isImage ? attachmentBlobs[m.attachmentPath] : null;
                      return (
                        <div key={m.id} style={{
                          display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start'
                        }}>
                          <div style={{
                            maxWidth: '72%',
                            padding: '7px 11px',
                            borderRadius: '12px',
                            background: mine ? '#3b82f6' : 'rgba(255,255,255,0.07)',
                            color: mine ? '#fff' : 'var(--text, #f3f4f6)',
                            fontSize: '13px',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word'
                          }}>
                            {hasAttachment && (
                              isImage ? (
                                imgSrc ? (
                                  <img
                                    src={imgSrc}
                                    alt={m.attachmentName || 'image'}
                                    style={{ maxWidth: '100%', maxHeight: '240px', borderRadius: '8px', display: 'block', marginBottom: m.content ? '6px' : 0, cursor: 'pointer' }}
                                    onClick={() => openAttachment(m)}
                                    title="Click to open in default viewer"
                                  />
                                ) : (
                                  <div style={{ fontSize: '11px', opacity: 0.8, marginBottom: m.content ? '6px' : 0 }}>Loading image…</div>
                                )
                              ) : (
                                <div
                                  onClick={() => openAttachment(m)}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: '8px',
                                    padding: '6px 8px', borderRadius: '6px',
                                    background: mine ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)',
                                    cursor: 'pointer', marginBottom: m.content ? '6px' : 0,
                                    fontSize: '12px'
                                  }}
                                  title={`Open ${m.attachmentName || 'file'}`}
                                >
                                  <span>📎</span>
                                  <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    <div style={{ fontWeight: 600 }}>{m.attachmentName || 'attachment'}</div>
                                    {m.attachmentSize > 0 && <div style={{ opacity: 0.75, fontSize: '11px' }}>{fmtBytes(m.attachmentSize)}</div>}
                                  </div>
                                </div>
                              )
                            )}
                            {m.content && <div>{m.content}</div>}
                            <div style={{
                              fontSize: '10px',
                              opacity: 0.7,
                              marginTop: '3px',
                              textAlign: 'right'
                            }}>
                              {fmtTime(m.sentAt)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* Composer */}
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', position: 'relative' }}>
                    {pendingAttachment && (
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '6px 10px', margin: '6px 8px 0',
                        borderRadius: '6px',
                        background: 'rgba(59,130,246,0.18)',
                        fontSize: '12px'
                      }}>
                        <span>📎</span>
                        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <strong>{pendingAttachment.name}</strong>
                          <span style={{ opacity: 0.7, marginLeft: '8px' }}>{fmtBytes(pendingAttachment.size)}</span>
                        </div>
                        <button
                          type="button"
                          onClick={clearPendingAttachment}
                          style={{ background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', padding: '2px 6px', fontSize: '14px' }}
                          title="Remove attachment"
                        >✕</button>
                      </div>
                    )}
                    {emojiOpen && (
                      <div style={{
                        position: 'absolute',
                        bottom: 'calc(100% + 4px)',
                        right: '8px',
                        width: '260px',
                        maxHeight: '180px',
                        overflowY: 'auto',
                        background: 'var(--bg-2, #1f2937)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '8px',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                        padding: '8px',
                        display: 'grid',
                        gridTemplateColumns: 'repeat(8, 1fr)',
                        gap: '2px',
                        zIndex: 10
                      }}>
                        {EMOJI_SET.map((emo) => (
                          <button
                            key={emo}
                            type="button"
                            onClick={() => { insertAtCursor(emo); }}
                            style={{
                              background: 'transparent', border: 0, cursor: 'pointer',
                              fontSize: '18px', padding: '4px', borderRadius: '4px',
                              lineHeight: 1
                            }}
                            title={emo}
                          >{emo}</button>
                        ))}
                      </div>
                    )}
                    <form onSubmit={handleSend} style={{
                      padding: '8px',
                      display: 'flex',
                      gap: '6px',
                      alignItems: 'center'
                    }}>
                      <input
                        ref={fileInputRef}
                        type="file"
                        onChange={handleFileSelect}
                        style={{ display: 'none' }}
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadingAttachment || sending || !!pendingAttachment}
                        title={pendingAttachment ? 'Remove the current attachment to add another' : 'Attach file (max 10 MB)'}
                        style={{
                          background: 'transparent', border: 0, cursor: (uploadingAttachment || sending || !!pendingAttachment) ? 'not-allowed' : 'pointer',
                          color: 'inherit', fontSize: '18px', padding: '6px 8px',
                          opacity: (uploadingAttachment || sending || !!pendingAttachment) ? 0.4 : 1
                        }}
                      >📎</button>
                      <button
                        type="button"
                        onClick={() => setEmojiOpen(v => !v)}
                        disabled={sending}
                        title="Insert emoji"
                        style={{
                          background: emojiOpen ? 'rgba(59,130,246,0.18)' : 'transparent',
                          border: 0, cursor: 'pointer', color: 'inherit',
                          fontSize: '18px', padding: '6px 8px', borderRadius: '6px'
                        }}
                      >😊</button>
                      <input
                        ref={inputRef}
                        type="text"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onFocus={() => setEmojiOpen(false)}
                        placeholder={pendingAttachment ? 'Add a caption (optional)…' : 'Type a message…'}
                        maxLength={4000}
                        disabled={sending}
                        style={{
                          flex: 1,
                          padding: '8px 12px',
                          borderRadius: '8px',
                          border: '1px solid rgba(255,255,255,0.08)',
                          background: 'rgba(0,0,0,0.25)',
                          color: 'inherit',
                          fontSize: '13px'
                        }}
                      />
                      <button
                        type="submit"
                        disabled={(!draft.trim() && !pendingAttachment) || sending || uploadingAttachment}
                        style={{
                          padding: '8px 14px',
                          background: '#3b82f6',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '8px',
                          cursor: ((draft.trim() || pendingAttachment) && !sending) ? 'pointer' : 'not-allowed',
                          opacity: ((draft.trim() || pendingAttachment) && !sending) ? 1 : 0.55,
                          fontWeight: 600
                        }}
                      >
                        {sending ? '...' : 'Send'}
                      </button>
                    </form>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ───────────────────────────  CALL OVERLAY  ─────────────────────────── */}
      {/* Renders independent of the chat panel — an incoming call must surface
          even when the chat icon is closed and the user is somewhere else in
          the dashboard. z-index sits above modals (10000) so a ring-tone
          interrupts whatever's on screen. */}
      {callState !== 'idle' && callPeer && (callState === 'incoming' || callState === 'outgoing' ? (
        // Ringing dialog — compact, centred.
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 10000
          }}
        >
          <div style={{
            background: 'var(--bg-2, #1f2937)',
            color: 'var(--text, #f3f4f6)',
            borderRadius: '14px',
            padding: '28px 32px',
            width: 'min(360px, 92vw)',
            textAlign: 'center',
            boxShadow: '0 24px 60px rgba(0,0,0,0.55)',
            border: '1px solid rgba(255,255,255,0.08)'
          }}>
            <Avatar src={callPeer.picture} name={callPeer.name} size={84} userId={callPeer.id} />
            <div style={{ fontSize: '18px', fontWeight: 700, marginTop: '14px' }}>
              {callPeer.name}
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-2, #94a3b8)', marginTop: '4px' }}>
              {callState === 'outgoing'
                ? `Calling${callIsVideo ? ' (video)' : ' (audio)'}…`
                : `Incoming ${callIsVideo ? 'video' : 'audio'} call…`}
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '22px' }}>
              {callState === 'incoming' && (
                <>
                  <button
                    type="button"
                    onClick={rejectCall}
                    style={{
                      background: '#ef4444', color: '#fff', border: 0,
                      padding: '10px 18px', borderRadius: '999px',
                      fontSize: '14px', fontWeight: 600, cursor: 'pointer'
                    }}
                  >✕ Decline</button>
                  <button
                    type="button"
                    onClick={acceptCall}
                    style={{
                      background: '#10b981', color: '#fff', border: 0,
                      padding: '10px 18px', borderRadius: '999px',
                      fontSize: '14px', fontWeight: 600, cursor: 'pointer'
                    }}
                  >✓ Accept</button>
                </>
              )}
              {callState === 'outgoing' && (
                <button
                  type="button"
                  onClick={endCall}
                  style={{
                    background: '#ef4444', color: '#fff', border: 0,
                    padding: '10px 22px', borderRadius: '999px',
                    fontSize: '14px', fontWeight: 600, cursor: 'pointer'
                  }}
                >Cancel call</button>
              )}
            </div>
          </div>
        </div>
      ) : (
        // In-call window — full-screen when expanded, small floating window
        // in the corner when minimized (v4.5). The same <video> refs feed
        // both layouts so the live stream doesn't blink during transitions.
        <div
          style={callMinimized ? {
            position: 'fixed',
            bottom: 16, right: 16,
            width: 320, height: 220,
            background: '#000', borderRadius: 12,
            display: 'flex', flexDirection: 'column',
            zIndex: 10000, overflow: 'hidden',
            boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
            border: '1px solid rgba(255,255,255,0.15)'
          } : {
            position: 'fixed', inset: 0,
            background: '#000',
            display: 'flex', flexDirection: 'column',
            zIndex: 10000
          }}
        >
          {/* Remote video — fills the screen. Falls back to avatar when video
              is off / not yet flowing. */}
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#000' }}
            />
            {!callIsVideo && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex',
                flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                color: '#fff', textAlign: 'center'
              }}>
                <Avatar src={callPeer.picture} name={callPeer.name} size={120} userId={callPeer.id} />
                <div style={{ marginTop: '16px', fontSize: '20px', fontWeight: 600 }}>{callPeer.name}</div>
                <div style={{ opacity: 0.7, marginTop: '4px' }}>Audio call</div>
              </div>
            )}
            {/* Peer name + connection status badge */}
            <div style={{
              position: 'absolute', top: '14px', left: '14px',
              background: 'rgba(0,0,0,0.55)', color: '#fff',
              padding: '6px 12px', borderRadius: '8px',
              fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px'
            }}>
              <Avatar src={callPeer.picture} name={callPeer.name} size={22} userId={callPeer.id} />
              <span style={{ fontWeight: 600 }}>{callPeer.name}</span>
              <span style={{ opacity: 0.65, fontSize: '11px' }}>
                {callState === 'connecting' ? '· connecting' : '· connected'}
              </span>
            </div>
            {/* Local picture-in-picture (video calls only). Hidden when
                the call window is minimized — there's not enough room for
                a meaningful preview. */}
            {callIsVideo && !callMinimized && (
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                style={{
                  position: 'absolute', bottom: '90px', right: '20px',
                  width: '160px', height: '120px',
                  borderRadius: '10px', objectFit: 'cover',
                  border: '2px solid rgba(255,255,255,0.2)',
                  background: '#111',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)'
                }}
              />
            )}
          </div>

          {/* Control bar — compact when minimized to fit the 320×220 PiP. */}
          <div style={{
            background: 'rgba(0,0,0,0.85)',
            padding: callMinimized ? '6px' : '14px',
            display: 'flex', gap: callMinimized ? '6px' : '14px', justifyContent: 'center',
            borderTop: '1px solid rgba(255,255,255,0.08)'
          }}>
            {(() => {
              const sz = callMinimized ? 32 : 52;
              const fs = callMinimized ? 14 : 20;
              const btnStyle = (bg) => ({
                background: bg, color: '#fff', border: 0,
                width: sz, height: sz, borderRadius: '50%',
                fontSize: fs, cursor: 'pointer'
              });
              return (
                <>
                  <button type="button" onClick={toggleMute} title={callMuted ? 'Unmute' : 'Mute'}
                    style={btnStyle(callMuted ? '#ef4444' : 'rgba(255,255,255,0.12)')}>
                    {callMuted ? '🔇' : '🎙️'}
                  </button>
                  {callIsVideo && (
                    <button type="button" onClick={toggleCamera} title={callCameraOff ? 'Turn camera on' : 'Turn camera off'}
                      style={btnStyle(callCameraOff ? '#ef4444' : 'rgba(255,255,255,0.12)')}>
                      {callCameraOff ? '🚫' : '📹'}
                    </button>
                  )}
                  {/* v4.5 — Minimize / expand button. Lets the user keep the
                      call up while doing other things in the app. */}
                  <button type="button" onClick={() => setCallMinimized(v => !v)}
                    title={callMinimized ? 'Expand call' : 'Minimize call'}
                    style={btnStyle('rgba(255,255,255,0.12)')}>
                    {callMinimized ? '⛶' : '➖'}
                  </button>
                  <button type="button" onClick={endCall} title="End call"
                    style={btnStyle('#ef4444')}>📞</button>
                </>
              );
            })()}
          </div>
        </div>
      ))}
    </>
  );
}

export default ChatWidget;
