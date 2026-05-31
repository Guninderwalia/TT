import React, { useEffect, useState } from 'react';

/**
 * PwaInstallBanner
 *
 * Shows a small dismissible "Install TaskTango" bar when the browser fires
 * `beforeinstallprompt` (Android Chrome / Edge / Samsung Internet).
 *
 * iOS Safari does NOT fire that event — it has no install API at all.
 * Apple users have to do it manually:  Share button → Add to Home Screen.
 * For them we show a one-liner explaining the steps the FIRST time we
 * detect iOS Safari and the app isn't already installed (standalone mode).
 *
 * Dismissals are remembered in localStorage so we don't nag.
 *
 * Skip entirely if:
 *   - The app is already installed (display-mode: standalone)
 *   - The user dismissed the banner already (tt-pwa-dismissed flag)
 *   - Running inside the Electron desktop app (window.electron without web shim)
 */
function PwaInstallBanner() {
  const [installEvent, setInstallEvent] = useState(null); // captured beforeinstallprompt
  const [showIosTip, setShowIosTip]   = useState(false);
  const [dismissed, setDismissed]     = useState(() => {
    try { return localStorage.getItem('tt-pwa-dismissed') === '1'; } catch { return false; }
  });

  useEffect(() => {
    if (dismissed) return;

    // Already installed → standalone mode → never show.
    const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
    if (isStandalone) return;

    // Inside the desktop Electron app → don't show.
    if (window.electron && !window.__isWebShim) return;

    // ── Android / Chrome / Edge ── catch the event the browser fires
    // when the PWA is installable. We hijack it so the chip is on our
    // schedule, not the browser's.
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setInstallEvent(e);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    // ── iOS Safari ── no install event ever. Show a manual tip instead.
    const ua = (navigator.userAgent || '').toLowerCase();
    const isIos = /iphone|ipad|ipod/.test(ua);
    const isSafari = /safari/.test(ua) && !/chrome|crios|fxios|edgios/.test(ua);
    if (isIos && isSafari) setShowIosTip(true);

    // After install, the browser fires `appinstalled`. Tidy up.
    const onAppInstalled = () => {
      setInstallEvent(null);
      setShowIosTip(false);
      try { localStorage.setItem('tt-pwa-installed', '1'); } catch {}
    };
    window.addEventListener('appinstalled', onAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, [dismissed]);

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem('tt-pwa-dismissed', '1'); } catch {}
  };

  const install = async () => {
    if (!installEvent) return;
    try {
      installEvent.prompt();
      await installEvent.userChoice;
    } catch (_) { /* user cancelled */ }
    setInstallEvent(null);
  };

  if (dismissed) return null;
  if (!installEvent && !showIosTip) return null;

  // ── Style ─ small chip docked above the version badge (which sits at
  // bottom-right). Keep it narrow enough to never overlap real content.
  const wrapStyle = {
    position: 'fixed',
    left: '50%', transform: 'translateX(-50%)',
    bottom: 12,
    background: 'linear-gradient(135deg, #0ea5e9 0%, #1e3a8a 100%)',
    color: '#ffffff',
    borderRadius: 12,
    padding: '10px 14px',
    boxShadow: '0 8px 26px rgba(0,0,0,0.45)',
    border: '1px solid rgba(255,255,255,0.18)',
    display: 'flex', alignItems: 'center', gap: 12,
    zIndex: 9998,
    maxWidth: '92vw',
    fontSize: 13
  };
  const btn = {
    background: '#ffffff', color: '#1e3a8a',
    border: 'none', borderRadius: 8, fontWeight: 700,
    padding: '6px 14px', cursor: 'pointer', fontSize: 13
  };
  const ghost = {
    background: 'transparent', color: 'rgba(255,255,255,0.85)',
    border: 'none', cursor: 'pointer', fontSize: 13, padding: '6px 8px'
  };

  if (showIosTip) {
    return (
      <div style={wrapStyle}>
        <span style={{ fontSize: 22 }}>📱</span>
        <span>
          <strong>Install TaskTango</strong> — tap the&nbsp;
          <span style={{ fontFamily: 'sans-serif' }}>⬆️</span> Share button below,
          then <strong>Add to Home Screen</strong>.
        </span>
        <button onClick={dismiss} style={ghost} title="Hide for good">✕</button>
      </div>
    );
  }

  return (
    <div style={wrapStyle}>
      <span style={{ fontSize: 22 }}>📲</span>
      <span><strong>Install TaskTango</strong> on your phone — opens like an app, no browser bar.</span>
      <button onClick={install} style={btn}>Install</button>
      <button onClick={dismiss} style={ghost} title="Hide for good">✕</button>
    </div>
  );
}

export default PwaInstallBanner;
