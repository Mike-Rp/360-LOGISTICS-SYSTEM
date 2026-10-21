import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X, User, KeyRound, Bell, BellOff, Eye, EyeOff,
  CheckCircle2, Camera, Pencil,
} from 'lucide-react';
import { changeOwnPassword, PasswordError } from '../../lib/db';
import { useModalFocus } from './useModalFocus';

/* ── Section separator ── */
const Divider = ({ label }: { label: string }) => (
  <div className="flex items-center gap-3 mb-4">
    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest whitespace-nowrap">{label}</span>
    <div className="flex-1 h-px bg-border" />
  </div>
);

/* ── Field row ── */
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-1.5">
    <label className="text-xs font-medium text-muted-foreground">{label}</label>
    {children}
  </div>
);

const inputCls = (err?: boolean) =>
  `w-full px-3.5 py-2.5 bg-[#f9fafb] border rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all ${err ? 'border-red-400 bg-red-50/40' : 'border-border'}`;

interface Props {
  open: boolean;
  onClose: () => void;
  notifEnabled: boolean;
  setNotifEnabled: (v: boolean) => void;
}

export default function SettingsPanel({ open, onClose, notifEnabled, setNotifEnabled }: Props) {
  /* ── Persist notifications preference ── */
  useEffect(() => {
    localStorage.setItem('360_notif_enabled', String(notifEnabled));
  }, [notifEnabled]);

  /* ── Profile state (persisted in localStorage) ── */
  const [savedProfile, setSavedProfile] = useState(() => ({
    name: localStorage.getItem('360_display_name') ?? 'Admin User',
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
        name: localStorage.getItem('360_display_name') ?? 'Admin User',
        avatar: localStorage.getItem('360_avatar'),
      };
      setSavedProfile(profile);
      setDisplayName(profile.name);
      setNameInput(profile.name);
      setAvatarUrl(profile.avatar);
      setEditingName(false);
      setPhotoBusy(false);
      clearProfileFeedback();
    }
    return () => {
      photoRequest.current += 1;
      if (savedTimer.current !== null) clearTimeout(savedTimer.current);
    };
  }, [open]);

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
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
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

  const handleSaveName = () => {
    if (!nameInput.trim()) return;
    const trimmed = nameInput.trim();
    setDisplayName(trimmed);
    setNameInput(trimmed);
    setEditingName(false);
  };

  const profileName = editingName ? nameInput.trim() : displayName;
  const profileDirty = profileName !== savedProfile.name || avatarUrl !== savedProfile.avatar;

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
      <div className="absolute inset-0 z-10 flex items-center justify-center p-3 sm:p-6 pointer-events-none">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="pointer-events-auto w-full max-w-[560px] h-[calc(100dvh-24px)] sm:h-auto sm:max-h-[85vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
      >

        {/* ── Panel header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-gradient-to-r from-[#0d9488]/8 to-transparent flex-shrink-0">
          <div className="flex min-w-0 items-center gap-3">
            <div className="w-8 h-8 flex-shrink-0 rounded-lg bg-[#0d9488]/15 flex items-center justify-center">
              <Pencil className="w-4 h-4 text-[#0d9488]" />
            </div>
            <div className="min-w-0">
              <h2 id="settings-title" className="text-base font-semibold text-foreground leading-tight">Settings</h2>
              <p className="text-xs text-muted-foreground">Manage your profile and preferences</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-6 py-5 space-y-7">

          {/* ── Profile ── */}
          <section>
            <Divider label="Profile" />

            {/* Avatar */}
            <div className="flex items-center gap-4 mb-5">
              <div className="relative group flex-shrink-0">
                <div className="w-16 h-16 rounded-full overflow-hidden bg-gradient-to-br from-[#0d9488] to-[#059669] flex items-center justify-center shadow-md">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-white text-lg font-bold tracking-wide">{initials}</span>
                  )}
                </div>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-primary transition-opacity flex items-center justify-center"
                  title="Change photo"
                >
                  <Camera className="w-5 h-5 text-white" />
                </button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-foreground leading-tight truncate">{profileName || savedProfile.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">admin@360logistics.com</p>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="mt-1.5 min-h-9 text-xs text-primary hover:text-primary/80 font-medium flex items-center gap-1 transition-colors focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <Camera className="w-3 h-3" /> Change photo
                </button>
                {avatarUrl && (
                  <button
                    onClick={() => { photoRequest.current += 1; setPhotoBusy(false); clearProfileFeedback(); setAvatarUrl(null); }}
                    className="min-h-9 text-xs text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    Remove photo
                  </button>
                )}
              </div>
            </div>

            {/* Display name */}
            <Field label="Display Name">
              {editingName ? (
                <div className="flex flex-wrap sm:flex-nowrap gap-2">
                  <input
                    autoFocus
                    value={nameInput}
                    onChange={(e) => { clearProfileFeedback(); setNameInput(e.target.value); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') { setEditingName(false); setNameInput(displayName); } }}
                    className={`${inputCls()} min-w-0 flex-1 basis-full sm:basis-auto`}
                    placeholder="Your display name"
                  />
                  <button
                    onClick={handleSaveName}
                    className="flex-shrink-0 px-3.5 py-2.5 bg-primary text-white text-xs font-medium rounded-xl hover:bg-primary/90 transition-colors"
                  >
                    Done
                  </button>
                  <button
                    onClick={() => { setEditingName(false); setNameInput(displayName); }}
                    aria-label="Cancel name edit"
                    className="flex-shrink-0 px-3 py-2.5 border border-border text-xs text-muted-foreground rounded-xl hover:bg-accent transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1 break-words px-3.5 py-2.5 bg-[#f9fafb] border border-border rounded-xl text-sm text-foreground">
                    {displayName}
                  </div>
                  <button
                    onClick={() => { setEditingName(true); setNameInput(displayName); }}
                    className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2.5 border border-border text-xs text-muted-foreground rounded-xl hover:bg-accent hover:text-foreground transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </button>
                </div>
              )}
            </Field>
            {profileError && <p role="alert" className="mt-2 text-xs text-red-500 break-words">{profileError}</p>}
            <button
              onClick={handleSaveProfile}
              disabled={!profileDirty || photoBusy}
              aria-busy={photoBusy}
              className="mt-4 grid min-h-11 w-36 items-center justify-items-center px-4 py-2.5 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span aria-hidden={profileSaved} className={`col-start-1 row-start-1 transition-opacity duration-150 motion-reduce:transition-none ${profileSaved ? 'opacity-0' : 'opacity-100'}`}>Save Changes</span>
              <span aria-hidden={!profileSaved} className={`col-start-1 row-start-1 flex items-center gap-1.5 transition-opacity duration-150 motion-reduce:transition-none ${profileSaved ? 'opacity-100' : 'opacity-0'}`}><CheckCircle2 className="w-4 h-4" /> Saved</span>
            </button>
            <span className="sr-only" role="status">{profileSaved ? 'Profile saved' : ''}</span>
          </section>

          {/* ── Password ── */}
          <section>
            <Divider label="Security" />
            <div className="space-y-3">
              <Field label="Current Password">
                <div className="relative">
                  <input
                    type={showCur ? 'text' : 'password'}
                    value={curPass}
                    onChange={(e) => { setCurPass(e.target.value); setPassError(''); }}
                    placeholder="••••••••"
                    className={`${inputCls(!!passError && !curPass)} pr-12`}
                  />
                  <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setShowCur((v) => !v)} aria-label={showCur ? 'Hide password' : 'Show password'}
                    className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary">
                    {showCur ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </Field>
              <Field label="New Password">
                <div className="relative">
                  <input
                    type={showNew ? 'text' : 'password'}
                    value={newPass}
                    onChange={(e) => { setNewPass(e.target.value); setPassError(''); }}
                    placeholder="Min. 8 characters"
                    className={`${inputCls(!!passError)} pr-12`}
                  />
                  <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setShowNew((v) => !v)} aria-label={showNew ? 'Hide password' : 'Show password'}
                    className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary">
                    {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </Field>
              <Field label="Confirm New Password">
                <div className="relative">
                  <input
                    type={showConf ? 'text' : 'password'}
                    value={confPass}
                    onChange={(e) => { setConfPass(e.target.value); setPassError(''); }}
                    placeholder="Repeat new password"
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
                className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <KeyRound className="w-4 h-4" /> {passBusy ? 'Updating…' : 'Update Password'}
              </button>
            </div>
          </section>

          {/* ── Notifications ── */}
          <section>
            <Divider label="Preferences" />
            <div
              className={`flex items-center justify-between gap-3 py-3 px-4 rounded-xl border transition-colors ${notifEnabled ? 'bg-[#f0fdf9] border-[#99f6e4]' : 'bg-[#f9fafb] border-border'}`}
            >
              <div className="flex min-w-0 items-center gap-3">
                {notifEnabled
                  ? <Bell className="w-4 h-4 flex-shrink-0 text-[#0d9488]" />
                  : <BellOff className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
                }
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">Enable notifications</p>
                  <p className="text-xs text-muted-foreground">
                    {notifEnabled ? 'Driver updates, document alerts' : 'Notifications are muted'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setNotifEnabled(!notifEnabled)}
                role="switch"
                aria-checked={notifEnabled}
                className={`relative w-10 h-6 rounded-full transition-colors duration-200 flex-shrink-0 ${notifEnabled ? 'bg-[#0d9488]' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-[4px] left-0 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${notifEnabled ? 'translate-x-[20px]' : 'translate-x-[4px]'}`} />
              </button>
            </div>
          </section>

        </div>

        {/* ── Footer ── */}
        <div className="px-6 py-4 border-t border-border bg-muted/20 flex-shrink-0">
          <p className="text-[12px] text-muted-foreground text-center">
            Preferences are saved automatically.
          </p>
        </div>
      </div>
      </div>
    </div>,
    document.body,
  );
}
