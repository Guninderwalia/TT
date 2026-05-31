import React, { useState, useCallback } from 'react';

/**
 * OnboardingWizard
 *
 * Shown once to a brand-new employee right after they change their
 * temp password. Four short steps:
 *
 *   1. Welcome             — set expectations, show what's next
 *   2. Confirm profile     — phone, DOB, address (optional)
 *   3. Banking details     — bank account + IFSC (optional, can skip)
 *   4. Profile photo       — square JPG/PNG (optional)
 *   ✓ Done                 — flips users.onboarding_completed = 1
 *
 * The user can skip any step except Welcome; the goal is to nudge them
 * toward a complete profile, not block them from working.
 *
 * Props:
 *   user      → logged-in user record (must contain `id`)
 *   onDone()  → called after the user dismisses the final step
 */
function OnboardingWizard({ user, onDone }) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Editable profile data — pre-filled from what we already know about the user.
  const [phone, setPhone] = useState(user?.phone || '');
  const [dob, setDob] = useState(user?.date_of_birth || user?.dateOfBirth || '');
  const [address, setAddress] = useState(user?.address || '');
  const [bankAccount, setBankAccount] = useState(user?.bank_account_number || user?.bankAccountNumber || '');
  const [ifsc, setIfsc] = useState(user?.ifsc_code || user?.ifscCode || '');
  const [photoBase64, setPhotoBase64] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);

  const myId = user?.id;

  const totalSteps = 4;

  const next = () => setStep(s => Math.min(s + 1, totalSteps));
  const back = () => setStep(s => Math.max(s - 1, 0));

  // Save the profile edits made in steps 2-4 in one call (best-effort — any
  // field that's blank is sent as-is so existing values aren't overwritten).
  const saveProfile = useCallback(async () => {
    if (!myId) return { success: false };
    try {
      const data = {
        phone: phone || undefined,
        dateOfBirth: dob || undefined,
        address: address || undefined
      };
      if (window.electron?.updateEmployee) {
        await window.electron.updateEmployee(myId, data, myId);
      }
      if (bankAccount || ifsc) {
        if (window.electron?.updateBankingDetails) {
          await window.electron.updateBankingDetails(myId, {
            bankAccountNumber: bankAccount || undefined,
            ifscCode: ifsc || undefined
          });
        }
      }
      // Photo upload — only if the user picked a file.
      if (photoBase64 && window.electron?.uploadProfilePicture) {
        try {
          await window.electron.uploadProfilePicture(myId, photoBase64);
        } catch (_) { /* photo failure shouldn't block onboarding completion */ }
      }
      return { success: true };
    } catch (e) {
      console.error('[ONBOARDING] save failed:', e);
      return { success: false, message: e.message };
    }
  }, [myId, phone, dob, address, bankAccount, ifsc, photoBase64]);

  const finish = async () => {
    setSaving(true);
    setError('');
    try {
      const r = await saveProfile();
      if (!r.success) {
        setError(r.message || 'Could not save changes');
        setSaving(false);
        return;
      }
      try {
        if (window.electron?.completeOnboarding) {
          await window.electron.completeOnboarding();
        }
      } catch (_) {}
      window.toast?.success?.('Welcome aboard — your profile is set up.');
      onDone?.();
    } catch (e) {
      setError(e.message || 'Could not complete onboarding');
    } finally {
      setSaving(false);
    }
  };

  const skipFinish = async () => {
    // Skip filling anything — just mark complete and exit so we don't nag
    // them tomorrow.
    setSaving(true);
    try {
      if (window.electron?.completeOnboarding) {
        await window.electron.completeOnboarding();
      }
      onDone?.();
    } finally { setSaving(false); }
  };

  // ---- File picker for the photo step ---------------------------------------
  const onPickPhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError('Photo must be under 2 MB.');
      return;
    }
    setError('');
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = String(ev.target?.result || '');
      setPhotoPreview(dataUrl);
      // Strip the data URL prefix — handlers expect raw base64.
      const base64 = dataUrl.replace(/^data:.+;base64,/, '');
      setPhotoBase64(base64);
    };
    reader.readAsDataURL(file);
  };

  // ---- styles ----------------------------------------------------------------
  const overlay = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center'
  };
  const card = {
    width: 'min(560px, 95vw)', maxHeight: '92vh', overflowY: 'auto',
    background: 'linear-gradient(180deg, #1e3a8a 0%, #1f2937 100%)',
    color: '#f3f4f6', borderRadius: 14,
    padding: '28px 30px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    border: '1px solid rgba(255,255,255,0.1)'
  };
  const titleStyle = { margin: '0 0 6px', fontSize: 22 };
  const subtitleStyle = { margin: '0 0 20px', fontSize: 13.5, color: '#cbd5e1' };
  const stepperBar = (active) => ({
    flex: 1, height: 4, borderRadius: 2,
    background: active ? '#3b82f6' : 'rgba(255,255,255,0.12)'
  });
  const labelStyle = { fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#9ca3af', fontWeight: 700, marginTop: 12, display: 'block' };
  const inputStyle = {
    width: '100%', marginTop: 6, padding: '9px 12px',
    background: 'rgba(0,0,0,0.3)', color: '#f3f4f6',
    border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8,
    fontSize: 14, fontFamily: 'inherit'
  };
  const skipBtn = {
    background: 'transparent', color: '#9ca3af',
    border: 'none', cursor: 'pointer', fontSize: 13,
    textDecoration: 'underline'
  };

  return (
    <div className="modal-overlay" style={overlay}>
      <div style={card}>
        {/* Step pips */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
          {Array.from({ length: totalSteps + 1 }).map((_, i) => (
            <div key={i} style={stepperBar(i <= step)} />
          ))}
        </div>

        {step === 0 && (
          <>
            <h2 style={titleStyle}>👋 Welcome to TaskTango</h2>
            <p style={subtitleStyle}>
              We'll spend the next two minutes setting up your profile so HR has what they
              need and your dashboard looks good from day one. You can skip any step and
              come back to it later — but doing it now saves chasing emails next week.
            </p>
            <div style={{
              background: 'rgba(255,255,255,0.06)', borderRadius: 8,
              padding: '14px 16px', fontSize: 13.5
            }}>
              <strong>What's next:</strong>
              <ol style={{ margin: '8px 0 0 18px', padding: 0 }}>
                <li>Confirm your phone, date of birth, and address</li>
                <li>Enter your bank details for payroll</li>
                <li>Upload a profile photo so your teammates know who you are</li>
              </ol>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h2 style={titleStyle}>📋 About you</h2>
            <p style={subtitleStyle}>Used by HR for compliance, payroll, and the team birthday list.</p>
            <label style={labelStyle}>Phone number</label>
            <input style={inputStyle} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 98765 43210" />
            <label style={labelStyle}>Date of birth</label>
            <input style={inputStyle} type="date" value={dob} onChange={e => setDob(e.target.value)} />
            <label style={labelStyle}>Address</label>
            <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }}
              value={address} onChange={e => setAddress(e.target.value)}
              placeholder="Flat / Street / City / PIN"
            />
          </>
        )}

        {step === 2 && (
          <>
            <h2 style={titleStyle}>🏦 Banking for payroll</h2>
            <p style={subtitleStyle}>
              Your salary lands here. Double-check before saving — payroll runs on what you enter.
              You can also fill this in later from your profile page.
            </p>
            <label style={labelStyle}>Bank account number</label>
            <input style={inputStyle} value={bankAccount}
              onChange={e => setBankAccount(e.target.value.replace(/\D/g, ''))}
              placeholder="e.g. 1234567890123456" />
            <label style={labelStyle}>IFSC code</label>
            <input style={inputStyle} value={ifsc}
              onChange={e => setIfsc(e.target.value.toUpperCase())}
              placeholder="e.g. HDFC0001234" maxLength={11} />
          </>
        )}

        {step === 3 && (
          <>
            <h2 style={titleStyle}>📸 Profile photo</h2>
            <p style={subtitleStyle}>
              Square JPG or PNG, under 2 MB. This appears on your dashboard, the org chart, and chat.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 8 }}>
              <div style={{
                width: 90, height: 90, borderRadius: '50%', overflow: 'hidden',
                background: '#f59e0b', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 36, fontWeight: 700, flexShrink: 0,
                border: '3px solid rgba(255,255,255,0.15)'
              }}>
                {photoPreview ? (
                  <img src={photoPreview} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  (user?.fullName || user?.full_name || '?').charAt(0).toUpperCase()
                )}
              </div>
              <div>
                <label style={{
                  display: 'inline-block', cursor: 'pointer',
                  background: '#3b82f6', color: '#fff',
                  padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600
                }}>
                  📁 Choose a photo
                  <input type="file" accept="image/jpeg,image/png,image/jpg" onChange={onPickPhoto} style={{ display: 'none' }} />
                </label>
                {photoPreview && (
                  <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 6 }}>
                    Ready to upload when you click Finish.
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h2 style={titleStyle}>🎉 All set</h2>
            <p style={subtitleStyle}>
              You're ready to go. Hit Finish and we'll save anything you entered.
            </p>
            <div style={{
              background: 'rgba(255,255,255,0.06)', borderRadius: 8,
              padding: '14px 16px', fontSize: 13.5, lineHeight: 1.7
            }}>
              <strong>Quick reminders:</strong>
              <ul style={{ margin: '8px 0 0 18px', padding: 0 }}>
                <li>Sign in every morning using the green chip at the top-right</li>
                <li>Request leave from <em>Leave Requests</em> in the sidebar</li>
                <li>Open the Help button (sidebar) to read your role's training guide</li>
              </ul>
            </div>
          </>
        )}

        {error && (
          <div style={{
            marginTop: 14, padding: '8px 12px',
            background: 'rgba(239,68,68,0.15)',
            border: '1px solid rgba(239,68,68,0.4)',
            borderRadius: 6, color: '#fecaca', fontSize: 12.5
          }}>
            {error}
          </div>
        )}

        <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
          {step > 0 && (
            <button onClick={back} disabled={saving} className="btn btn-secondary" style={{ padding: '8px 14px' }}>
              ← Back
            </button>
          )}
          <button onClick={skipFinish} disabled={saving} style={skipBtn}>
            Skip for now
          </button>
          <div style={{ flex: 1 }} />
          {step < totalSteps ? (
            <button onClick={next} disabled={saving} className="btn btn-primary" style={{ padding: '8px 16px' }}>
              Continue →
            </button>
          ) : (
            <button onClick={finish} disabled={saving} className="btn btn-primary" style={{ padding: '8px 18px' }}>
              {saving ? 'Saving…' : '✓ Finish'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default OnboardingWizard;
