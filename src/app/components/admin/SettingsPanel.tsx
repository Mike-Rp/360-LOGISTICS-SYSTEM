import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X, KeyRound, Bell, Eye, EyeOff,
  CheckCircle2, Camera, Pencil, MoreHorizontal, ChevronDown, Trash2,
} from 'lucide-react';
import { changeOwnPassword, PasswordError } from '../../lib/db';
import { playNotificationSound } from '../../lib/notificationSound';
import { useModalFocus } from './useModalFocus';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '../ui/dropdown-menu';

/* ── Section separator ── */
const Divider = ({ label }: { label: string }) => (
  <div className="flex items-center gap-3 mb-4">
    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest whitespace-nowrap">{label}</span>
    <div className="flex-1 h-px bg-border" />
  </div>
);

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
  accountName?: string;
  accountEmail: string | null;
  onProfileSaved: (name: string) => void;
  notifEnabled: boolean;
  setNotifEnabled: (v: boolean) => void;
  soundEnabled: boolean;
  setSoundEnabled: (v: boolean) => void;
}

export default function SettingsPanel({ open, onClose, accountName, accountEmail, onProfileSaved, notifEnabled, setNotifEnabled, soundEnabled, setSoundEnabled }: Props) {
  const [openSection, setOpenSection] = useState<'security' | 'notifications' | null>(null);
  /* ── Persist notifications preference ── */
  useEffect(() => {
    localStorage.setItem('360_notif_enabled', String(notifEnabled));
  }, [notifEnabled]);

  /* ── Profile state (persisted in localStorage) ── */
  const [savedProfile, setSavedProfile] = useState(() => ({
    name: localStorage.getItem('360_display_name') ?? accountName ?? '',
    avatar: localStorage.getItem('360_avatar'),
  }));
  const [displayName, setDisplayName]   = useState(savedProfile.name);
  const [editingName,  setEditingName]  = useState(false);
  const [nameInput,    setNameInput]    = useState(displayName);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const photoRequest = useRef(0);

  /* Avatar: either uploaded data-url or null (show initials) */
  const [avatarUrl,    setAvatarUrl]    = useState<string | null>(savedProfile.avatar);
  const fileRef = useRef<HTMLInputElement>(null);

  const clearProfileFeedback = () => {
    if (savedTimer.current !== null) clearTimeout(savedTimer.current);
    savedTimer.current = null;
    setProfileSaved(false);
    setProfileError('');
  };

  /* Reopening starts from the persisted profile; closing discards unsaved drafts. */
  useEffect(() => {
    if (open) {
      const profile = {
        name: localStorage.getItem('360_display_name') ?? accountName ?? '',
        avatar: localStorage.getItem('360_avatar'),
      };
      setSavedProfile(profile);
      setDisplayName(profile.name);
      setNameInput(profile.name);
      setAvatarUrl(profile.avatar);
      setEditingName(false);
      setPhotoBusy(false);
      setOpenSection(null);
      clearProfileFeedback();
    }
    return () => {
      photoRequest.current += 1;
      if (savedTimer.current !== null) clearTimeout(savedTimer.current);
    };
  }, [open, accountEmail]);

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

  const profileName = editingName ? nameInput.trim() : displayName;
  const profileDirty = profileName !== savedProfile.name || avatarUrl !== savedProfile.avatar;
  const photoDirty = avatarUrl !== savedProfile.avatar;
  const cancelNameEdit = () => {
    setNameInput(savedProfile.name);
    setEditingName(false);
    clearProfileFeedback();
  };

  const handleSaveProfile = () => {
    if (!profileDirty || photoBusy) return;
    clearProfileFeedback();
    if (!profileName) { setProfileError('Enter a display name.'); return; }
    const written: { key: string; value: string | null }[] = [];
    try {
      /* Write the photo first, since a large image can exceed browser storage capacity. */
      const changes = [
        ...(avatarUrl !== savedProfile.avatar ? [{ key: '360_avatar', value: avatarUrl }] : []),
        ...(profileName !== savedProfile.name ? [{ key: '360_display_name', value: profileName }] : []),
      ];
      for (const change of changes) {
        const previous = localStorage.getItem(change.key);
        if (change.value === null) localStorage.removeItem(change.key);
        else localStorage.setItem(change.key, change.value);
        written.push({ key: change.key, value: previous });
      }
    } catch {
      for (const previous of written.reverse()) {
        try {
          if (previous.value === null) localStorage.removeItem(previous.key);
          else localStorage.setItem(previous.key, previous.value);
        } catch { /* Keep the draft available for another save attempt. */ }
      }
      setProfileError('Could not save your profile. Check browser storage or try a smaller photo.');
      return;
    }
    setSavedProfile({ name: profileName, avatar: avatarUrl });
    onProfileSaved(profileName);
    setDisplayName(profileName);
    setNameInput(profileName);
    setEditingName(false);
    setProfileSaved(true);
    savedTimer.current = setTimeout(() => {
      setProfileSaved(false);
      savedTimer.current = null;
    }, 1800);
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    clearProfileFeedback();
    const request = ++photoRequest.current;
    setPhotoBusy(false);
    if (!file.type.startsWith('image/')) { setProfileError('Select an image file.'); return; }
    if (file.size > 5 * 1024 * 1024) { setProfileError('Choose an image smaller than 5 MB.'); return; }
    setPhotoBusy(true);
    const fail = () => {
      if (request !== photoRequest.current) return;
      setPhotoBusy(false);
      setProfileError('This image could not be opened. Choose another photo.');
    };
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (request !== photoRequest.current) return;
      const url = ev.target?.result as string;
      const image = new Image();
      image.onload = () => {
        if (request !== photoRequest.current) return;
        if (!image.naturalWidth || !image.naturalHeight) { fail(); return; }
        setAvatarUrl(url);
        setPhotoBusy(false);
      };
      image.onerror = fail;
      image.src = url;
    };
    reader.onerror = fail;
    reader.readAsDataURL(file);
  };

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
  const initials = (profileName || savedProfile.name).split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] isolate">
      {/* Backdrop */}
      <div
        className="absolute inset-0 z-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Centred modal — the wrapper ignores clicks so they fall through to the backdrop */}
      <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none sm:p-6">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="pointer-events-auto flex h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-2xl sm:h-[min(85dvh,720px)] sm:max-w-[760px] sm:rounded-2xl"
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
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:px-8 sm:py-7">

          {/* ── Profile ── */}
          <section>
            <Divider label="Profile" />

            <div className="relative mb-5 flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-white p-5 pr-16 sm:flex-row sm:items-center sm:gap-6 sm:p-6 sm:pr-16">
              <div className="flex-shrink-0">
                <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-[18px] border border-green-900/10 bg-[#03624c] shadow-sm sm:h-32 sm:w-32">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="Profile" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-3xl font-bold tracking-wide text-white">{initials}</span>
                  )}
                </div>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
              </div>
              <div className="min-w-0">
                <p className="break-words text-2xl font-semibold leading-tight text-foreground sm:text-3xl">{displayName || savedProfile.name || 'Account'}</p>
                <p className="mt-2 break-all text-base text-muted-foreground">{accountEmail ?? 'Email unavailable'}</p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" aria-label="Profile actions" className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-lg border border-border text-foreground transition-colors hover:border-green-700/40 hover:bg-green-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                    <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="z-[70] min-w-44 rounded-lg bg-white p-1 shadow-lg">
                  <DropdownMenuItem onSelect={() => fileRef.current?.click()}><Camera aria-hidden="true" />Change Photo</DropdownMenuItem>
                  <DropdownMenuItem disabled={!avatarUrl} onSelect={() => { photoRequest.current += 1; setPhotoBusy(false); clearProfileFeedback(); setAvatarUrl(null); }}><Trash2 aria-hidden="true" />Remove Photo</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => { clearProfileFeedback(); setNameInput(displayName); setEditingName(true); }}><Pencil aria-hidden="true" />Edit Display Name</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {editingName && <div className="rounded-xl border border-green-700/20 bg-green-50/30 p-4 sm:p-5">
              <Field label="Display Name" htmlFor="settings-display-name">
                <div className="mt-2">
                  <input
                    id="settings-display-name"
                    autoFocus
                    value={nameInput}
                    onChange={(e) => { clearProfileFeedback(); setNameInput(e.target.value); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveProfile(); }}
                    className={inputCls()}
                    placeholder="Your display name"
                  />
                </div>
              </Field>
              <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={cancelNameEdit} className="min-h-11 rounded-xl border border-border px-4 text-sm font-medium text-foreground hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-primary">Cancel</button>
                <button type="button" onClick={handleSaveProfile} disabled={!profileDirty || photoBusy} className="min-h-11 rounded-xl bg-primary px-4 text-sm font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">Save Changes</button>
              </div>
            </div>}
            {profileError && <p role="alert" className="mt-2 text-xs text-red-500 break-words">{profileError}</p>}
            {!editingName && photoDirty && <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => { setAvatarUrl(savedProfile.avatar); clearProfileFeedback(); }} className="min-h-11 rounded-xl border border-border px-4 text-sm font-medium text-foreground hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-primary">Cancel</button>
              <button type="button" onClick={handleSaveProfile} disabled={photoBusy} className="min-h-11 rounded-xl bg-primary px-4 text-sm font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">Save Changes</button>
            </div>}
            {profileSaved && <p role="status" className="mt-3 flex items-center gap-1.5 text-sm text-green-700"><CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Profile saved</p>}
          </section>

          {/* ── Password ── */}
          <section className={`mt-5 overflow-hidden rounded-xl border bg-white transition-colors motion-reduce:transition-none ${openSection === 'security' ? 'border-green-700/40' : 'border-border'}`}>
            <button type="button" aria-expanded={openSection === 'security'} aria-controls="settings-security-content" onClick={() => setOpenSection(openSection === 'security' ? null : 'security')}
              className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-green-50/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary sm:px-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-green-50 text-green-800"><KeyRound className="h-5 w-5" aria-hidden="true" /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold uppercase tracking-wide text-foreground">Security</span><span className="mt-1 block text-sm text-muted-foreground">Manage your password and account security.</span></span>
              <ChevronDown className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${openSection === 'security' ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
            {openSection === 'security' && <div id="settings-security-content" className="space-y-3 border-t border-border px-4 py-5 sm:px-5">
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
              <button
                onClick={handleSavePassword}
                disabled={passBusy}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-primary sm:w-auto"
              >
                <KeyRound className="w-4 h-4" /> {passBusy ? 'Updating…' : 'Update Password'}
              </button>
            </div>}
          </section>

          {/* ── Notifications ── */}
          <section className={`mt-3 overflow-hidden rounded-xl border bg-white transition-colors motion-reduce:transition-none ${openSection === 'notifications' ? 'border-green-700/40' : 'border-border'}`}>
            <button type="button" aria-expanded={openSection === 'notifications'} aria-controls="settings-notifications-content" onClick={() => setOpenSection(openSection === 'notifications' ? null : 'notifications')}
              className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-green-50/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary sm:px-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-green-50 text-green-800"><Bell className="h-5 w-5" aria-hidden="true" /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold uppercase tracking-wide text-foreground">Notifications</span><span className="mt-1 block text-sm text-muted-foreground">Manage pop-up and sound notifications.</span></span>
              <ChevronDown className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${openSection === 'notifications' ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
            {openSection === 'notifications' && <div id="settings-notifications-content" className="border-t border-border px-4 pb-5 sm:px-5">
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
