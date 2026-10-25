import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X, KeyRound, Bell, Eye, EyeOff, UserRound,
  CheckCircle2, Pencil, ChevronDown, Camera, Trash2,
} from 'lucide-react';
import {
  changeOwnPassword, PasswordError,
  updateOwnDisplayName, uploadOwnAvatar, removeOwnAvatar,
} from '../../lib/db';
import { playNotificationSound } from '../../lib/notificationSound';
import { useModalFocus } from './useModalFocus';
import type { StaffSession } from '../../lib/db';
import AccountRoleBadge from './AccountRoleBadge';

/* Mirrors update_own_display_name()'s server-side rule exactly. */
const NAME_PATTERN = /^[A-Za-z][A-Za-z\s'.-]*$/;

/* ── Field row ── */
const Field = ({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) => (
  <div className="space-y-1.5">
    <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">{label}</label>
    {children}
  </div>
);

const inputCls = (err?: boolean) =>
  `w-full px-3.5 py-2.5 bg-[#f9fafb] border rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all ${err ? 'border-red-400 bg-red-50/40' : 'border-border'}`;

interface Props {
  open: boolean;
  onClose: () => void;
  profile: StaffSession | null;
  avatarUrl: string;
  onProfileUpdated: (update: Partial<StaffSession>, freshAvatarUrl?: string) => void;
  notifEnabled: boolean;
  setNotifEnabled: (v: boolean) => void;
  soundEnabled: boolean;
  setSoundEnabled: (v: boolean) => void;
}

export default function SettingsPanel({ open, onClose, profile, avatarUrl, onProfileUpdated, notifEnabled, setNotifEnabled, soundEnabled, setSoundEnabled }: Props) {
  const [openSection, setOpenSection] = useState<'security' | 'notifications' | null>(null);
  /* ── Persist notifications preference ── */
  useEffect(() => {
    localStorage.setItem('360_notif_enabled', String(notifEnabled));
  }, [notifEnabled]);

  useEffect(() => {
    if (open) setOpenSection(null);
  }, [open, profile?.id]);

  /* Focus moves into the modal on open, Tab stays inside, returns to the opener on close */
  const modalRef = useRef<HTMLDivElement>(null);
  useModalFocus(open, modalRef);

  /* ── Password state ── */
  const [curPass,     setCurPass]     = useState('');
  const [newPass,     setNewPass]     = useState('');
  const [confPass,    setConfPass]    = useState('');
  const [showCur,     setShowCur]     = useState(false);
  const [showNew,     setShowNew]     = useState(false);
  const [showConf,    setShowConf]    = useState(false);
  const [passError,   setPassError]   = useState('');
  const [passSaved,   setPassSaved]   = useState(false);
  const [passBusy,    setPassBusy]    = useState(false);

  /* ── REQ-012: own name / avatar ── */
  const [editingName, setEditingName] = useState(false);
  const [nameInput,   setNameInput]   = useState(profile?.name ?? '');
  const [nameBusy,    setNameBusy]    = useState(false);
  const [nameError,   setNameError]   = useState('');
  const [avatarBusy,  setAvatarBusy]  = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!editingName) setNameInput(profile?.name ?? ''); }, [profile?.name, editingName]);

  const handleSaveName = async () => {
    setNameError('');
    const trimmed = nameInput.trim();
    if (!trimmed) { setNameError('Name is required.'); return; }
    // Same rule update_own_display_name() enforces server-side — catches it before
    // a round trip, but the server is the real gate (never trust this check alone).
    if (!NAME_PATTERN.test(trimmed)) {
      setNameError('Enter a valid name — letters, spaces, apostrophes, hyphens and periods only.');
      return;
    }
    setNameBusy(true);
    try {
      const result = await updateOwnDisplayName(trimmed);
      onProfileUpdated(result);
      setEditingName(false);
    } catch (e) {
      console.error('[updateOwnDisplayName] error:', e);
      const message = e instanceof Error ? e.message : '';
      setNameError(message.includes('invalid_name')
        ? 'Enter a valid name — letters, spaces, apostrophes, hyphens and periods only.'
        : 'Could not update your name. Check your connection and try again.');
    } finally {
      setNameBusy(false);
    }
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !profile) return;
    setAvatarError('');
    // accept="image/*" on the input is only a browser hint — drag-and-drop or
    // "All Files" bypasses it. The real gate is the server (RLS now checks the
    // upload's actual recorded mimetype), but check here too for a fast, clear
    // message instead of a round trip just to get rejected.
    if (!file.type.startsWith('image/')) {
      setAvatarError('Please choose an image file (JPG, PNG, etc.).');
      return;
    }
    setAvatarBusy(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const { avatarUrl: freshUrl, ...profileUpdate } = await uploadOwnAvatar(profile.id, reader.result as string);
        onProfileUpdated(profileUpdate, freshUrl);
      } catch (err) {
        console.error('[uploadOwnAvatar] error:', err);
        setAvatarError('Could not upload your photo. Check your connection and try again.');
      } finally {
        setAvatarBusy(false);
      }
    };
    reader.onerror = () => { setAvatarError('Could not read that file.'); setAvatarBusy(false); };
    reader.readAsDataURL(file);
  };

  const handleRemoveAvatar = async () => {
    if (!profile?.avatarPath) return;
    setAvatarError('');
    setAvatarBusy(true);
    try {
      const result = await removeOwnAvatar(profile.avatarPath);
      onProfileUpdated(result, '');
    } catch (err) {
      console.error('[removeOwnAvatar] error:', err);
      setAvatarError('Could not remove your photo. Check your connection and try again.');
    } finally {
      setAvatarBusy(false);
    }
  };

  /* ── Close on Esc ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  /* ── Body scroll lock ── */
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  const handleSavePassword = async () => {
    setPassError('');
    if (passBusy) return;
    if (!curPass) { setPassError('Enter your current password.'); return; }
    if (newPass.length < 8) { setPassError('New password must be at least 8 characters.'); return; }
    if (newPass !== confPass) { setPassError('New passwords do not match.'); return; }

    /* Real change: the account is a Supabase Auth login, so this updates the actual password
       (the old one stops working at the login screen straight away). */
    setPassBusy(true);
    try {
      await changeOwnPassword(curPass, newPass);
      setCurPass(''); setNewPass(''); setConfPass('');
      setPassSaved(true);
      setTimeout(() => setPassSaved(false), 3000);
    } catch (e) {
      console.error('[changeOwnPassword] error:', e);
      const code = e instanceof PasswordError ? e.code : 'network';
      setPassError(
        code === 'wrong_current'  ? 'Your current password is incorrect.' :
        code === 'same_password'  ? 'The new password must be different from your current one.' :
        code === 'weak_password'  ? 'That password is too weak. Try a longer or less common one.' :
        code === 'not_signed_in'  ? 'Your session has expired. Please sign in again.' :
                                    'Could not update the password. Check your connection and try again.'
      );
    } finally {
      setPassBusy(false);
    }
  };

  /* Initials avatar */
  const initials = (profile?.name ?? '').split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] isolate">
      {/* Backdrop */}
      <div
        className="absolute inset-0 z-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Centred modal — the wrapper ignores clicks so they fall through to the backdrop */}
      <div className="absolute inset-0 z-10 flex items-end justify-center pointer-events-none sm:items-center sm:p-6">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="pointer-events-auto flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-h-[min(85dvh,720px)] sm:max-w-[720px] sm:rounded-2xl"
      >

        {/* ── Panel header ── */}
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-white px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="w-8 h-8 flex-shrink-0 rounded-lg bg-[#0d9488]/15 flex items-center justify-center">
              <Pencil className="w-4 h-4 text-[#0d9488]" />
            </div>
            <div className="min-w-0">
              <h2 id="settings-title" className="text-base font-semibold text-foreground leading-tight">Settings</h2>
              <p className="text-xs text-muted-foreground">Manage your account settings</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* One scroll area keeps the header accessible on small screens. */}
        <div className="min-h-0 min-w-0 overflow-y-auto overscroll-contain px-4 py-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:px-8 sm:py-7">

          {/* ── Profile ── */}
          <section className="pb-6">
            <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
              <div className="flex-shrink-0">
                <div className="relative flex h-[104px] w-[104px] items-center justify-center overflow-hidden rounded-[18px] border border-green-700/30 bg-[#03624c] shadow-sm sm:h-[116px] sm:w-[116px]">
                  {avatarUrl
                    ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                    : <span className="text-3xl font-bold tracking-wide text-white">{initials}</span>}
                  {avatarBusy && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <span className="text-xs font-medium text-white">Saving…</span>
                    </div>
                  )}
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={() => fileInputRef.current?.click()} disabled={avatarBusy}
                    className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60">
                    <Camera className="w-3.5 h-3.5" /> {profile?.avatarPath ? 'Change photo' : 'Add photo'}
                  </button>
                  {profile?.avatarPath && (
                    <button type="button" onClick={handleRemoveAvatar} disabled={avatarBusy}
                      className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60">
                      <Trash2 className="w-3.5 h-3.5" /> Remove
                    </button>
                  )}
                </div>
                {avatarError && <p className="mt-1.5 text-xs text-red-500">{avatarError}</p>}
              </div>
              <div className="min-w-0 flex-1">
                {editingName ? (
                  <div className="max-w-xs space-y-2">
                    <input
                      value={nameInput}
                      onChange={(e) => { setNameInput(e.target.value); setNameError(''); }}
                      placeholder="Your name"
                      className={inputCls(!!nameError)}
                      autoFocus
                    />
                    {nameError && <p className="text-xs text-red-500">{nameError}</p>}
                    <div className="flex gap-2">
                      <button type="button" onClick={handleSaveName} disabled={nameBusy}
                        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60">
                        {nameBusy ? 'Saving…' : 'Save'}
                      </button>
                      <button type="button" disabled={nameBusy}
                        onClick={() => { setEditingName(false); setNameInput(profile?.name ?? ''); setNameError(''); }}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/40">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="min-w-0 break-words text-2xl font-semibold leading-tight text-foreground sm:text-[28px]">{profile?.name || 'Account'}</p>
                    <AccountRoleBadge role={profile?.role ?? null} />
                    <button type="button" onClick={() => setEditingName(true)} aria-label="Edit name"
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                <p className="mt-2 break-all text-sm text-slate-600 sm:text-base">{profile?.email ?? 'Email unavailable'}</p>
                <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><UserRound className="h-3.5 w-3.5 text-green-800" aria-hidden="true" />Account profile</p>
              </div>
            </div>
          </section>

          {/* ── Password ── */}
          <section className="border-t border-border">
            <button type="button" aria-expanded={openSection === 'security'} aria-controls="settings-security-content" onClick={() => setOpenSection(openSection === 'security' ? null : 'security')}
              className={`flex w-full items-center gap-3 rounded-lg px-2 py-4 text-left transition-colors hover:bg-green-50/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary motion-reduce:transition-none ${openSection === 'security' ? 'bg-green-50/40' : ''}`}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-green-50 text-green-800"><KeyRound className="h-5 w-5" aria-hidden="true" /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-foreground">Security</span><span className="mt-1 block text-sm text-muted-foreground">Manage your password and account security.</span></span>
              <ChevronDown className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${openSection === 'security' ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
            {openSection === 'security' && <div id="settings-security-content" className="space-y-3 px-2 pb-5 pt-2 sm:px-4">
              <Field label="Current Password" htmlFor="settings-current-password">
                <div className="relative">
                  <input
                    id="settings-current-password"
                    type={showCur ? 'text' : 'password'}
                    value={curPass}
                    onChange={(e) => { setCurPass(e.target.value); setPassError(''); }}
                    placeholder="Enter current password"
                    className={`${inputCls(!!passError && !curPass)} pr-12`}
                  />
                  <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setShowCur((v) => !v)} aria-label={showCur ? 'Hide password' : 'Show password'}
                    className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary">
                    {showCur ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </Field>
              <Field label="New Password" htmlFor="settings-new-password">
                <div className="relative">
                  <input
                    id="settings-new-password"
                    type={showNew ? 'text' : 'password'}
                    value={newPass}
                    onChange={(e) => { setNewPass(e.target.value); setPassError(''); }}
                    placeholder="Enter new password"
                    className={`${inputCls(!!passError)} pr-12`}
                  />
                  <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setShowNew((v) => !v)} aria-label={showNew ? 'Hide password' : 'Show password'}
                    className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary">
                    {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </Field>
              <Field label="Confirm New Password" htmlFor="settings-confirm-password">
                <div className="relative">
                  <input
                    id="settings-confirm-password"
                    type={showConf ? 'text' : 'password'}
                    value={confPass}
                    onChange={(e) => { setConfPass(e.target.value); setPassError(''); }}
                    placeholder="Confirm new password"
                    className={`${inputCls(!!passError && confPass !== newPass)} pr-12`}
                  />
                  <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setShowConf((v) => !v)} aria-label={showConf ? 'Hide password' : 'Show password'}
                    className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary">
                    {showConf ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </Field>
              {passError && <p className="text-xs text-red-500">{passError}</p>}
              {passSaved && (
                <p className="flex items-center gap-1 text-xs text-green-600">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Password updated successfully
                </p>
              )}
              <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">Use at least 8 characters.</p>
                <button
                  onClick={handleSavePassword}
                  disabled={passBusy}
                  className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-primary sm:w-auto"
                >
                  <KeyRound className="w-4 h-4" /> {passBusy ? 'Updating…' : 'Update Password'}
                </button>
              </div>
            </div>}
          </section>

          {/* ── Notifications ── */}
          <section className="border-y border-border">
            <button type="button" aria-expanded={openSection === 'notifications'} aria-controls="settings-notifications-content" onClick={() => setOpenSection(openSection === 'notifications' ? null : 'notifications')}
              className={`flex w-full items-center gap-3 rounded-lg px-2 py-4 text-left transition-colors hover:bg-green-50/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary motion-reduce:transition-none ${openSection === 'notifications' ? 'bg-green-50/40' : ''}`}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-green-50 text-green-800"><Bell className="h-5 w-5" aria-hidden="true" /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-foreground">Notifications</span><span className="mt-1 block text-sm text-muted-foreground">Manage pop-up and sound notifications.</span></span>
              <ChevronDown className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${openSection === 'notifications' ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
            {openSection === 'notifications' && <div id="settings-notifications-content" className="px-2 pb-5 sm:px-4">
            <div className="flex items-center justify-between gap-3 border-b border-border py-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pop-up Notifications</p>
                <p className="mt-1 text-sm text-foreground">Show an on-screen pop-up when a new important notification arrives.</p>
              </div>
              <button type="button" aria-label="Pop-up Notifications"
                onClick={() => setNotifEnabled(!notifEnabled)}
                role="switch"
                aria-checked={notifEnabled}
                className="relative flex h-11 w-12 flex-shrink-0 items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <span className={`absolute inset-x-0 top-1/2 h-7 -translate-y-1/2 rounded-full transition-colors ${notifEnabled ? 'bg-green-700' : 'bg-gray-300'}`} />
                <span className={`absolute left-1 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow transition-transform duration-200 ${notifEnabled ? 'translate-x-5' : ''}`} />
              </button>
            </div>
            <div className="pt-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notification Sound</p>
                  <p className="mt-1 text-sm text-foreground">Play a sound when a new notification arrives.</p>
                </div>
                <button type="button" role="switch" aria-label="Notification Sound" aria-checked={soundEnabled}
                  onClick={() => setSoundEnabled(!soundEnabled)}
                  className="relative flex h-11 w-12 flex-shrink-0 items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                  <span className={`absolute inset-x-0 top-1/2 h-7 -translate-y-1/2 rounded-full transition-colors ${soundEnabled ? 'bg-green-700' : 'bg-gray-300'}`} />
                  <span className={`absolute left-1 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow transition-transform ${soundEnabled ? 'translate-x-5' : ''}`} />
                </button>
              </div>
              <button type="button" onClick={() => { void playNotificationSound(true); }}
                className="mt-4 min-h-10 rounded-lg border border-border bg-white px-3 text-xs font-medium text-foreground hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                Test Sound
              </button>
            </div>
            </div>}
          </section>

        </div>
      </div>
      </div>
    </div>,
    document.body,
  );
}
