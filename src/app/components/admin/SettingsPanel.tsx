import { useState, useEffect, useRef } from 'react';
import {
  X, User, KeyRound, Bell, BellOff, Eye, EyeOff,
  CheckCircle2, Camera, Pencil,
} from 'lucide-react';
import { changeOwnPassword, PasswordError } from '../../lib/db';

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
  const [displayName, setDisplayName]   = useState(() => localStorage.getItem('360_display_name') ?? 'Admin User');
  const [editingName,  setEditingName]  = useState(false);
  const [nameInput,    setNameInput]    = useState(displayName);
  const [nameSaved,    setNameSaved]    = useState(false);

  /* Avatar: either uploaded data-url or null (show initials) */
  const [avatarUrl,    setAvatarUrl]    = useState<string | null>(() => localStorage.getItem('360_avatar') ?? null);
  const fileRef = useRef<HTMLInputElement>(null);

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
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const handleSaveName = () => {
    if (!nameInput.trim()) return;
    const trimmed = nameInput.trim();
    setDisplayName(trimmed);
    localStorage.setItem('360_display_name', trimmed);
    setEditingName(false);
    setNameSaved(true);
    setTimeout(() => setNameSaved(false), 2500);
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const url = ev.target?.result as string;
      setAvatarUrl(url);
      localStorage.setItem('360_avatar', url);
    };
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
  const initials = displayName.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full z-50 w-full sm:w-[520px] bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-250">

        {/* ── Panel header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-gradient-to-r from-[#0d9488]/8 to-transparent flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#0d9488]/15 flex items-center justify-center">
              <Pencil className="w-4 h-4 text-[#0d9488]" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground leading-tight">Settings</h2>
              <p className="text-xs text-muted-foreground">Manage your profile and preferences</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-7">

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
                  className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                  title="Change photo"
                >
                  <Camera className="w-5 h-5 text-white" />
                </button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-foreground leading-tight truncate">{displayName}</p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">admin@360logistics.com</p>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="mt-1.5 text-xs text-primary hover:text-primary/80 font-medium flex items-center gap-1 transition-colors"
                >
                  <Camera className="w-3 h-3" /> Change photo
                </button>
              </div>
            </div>

            {/* Display name */}
            <Field label="Display Name">
              {editingName ? (
                <div className="flex gap-2">
                  <input
                    autoFocus
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setEditingName(false); }}
                    className={inputCls()}
                    placeholder="Your display name"
                  />
                  <button
                    onClick={handleSaveName}
                    className="flex-shrink-0 px-3.5 py-2.5 bg-primary text-white text-xs font-medium rounded-xl hover:bg-primary/90 transition-colors"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => { setEditingName(false); setNameInput(displayName); }}
                    className="flex-shrink-0 px-3 py-2.5 border border-border text-xs text-muted-foreground rounded-xl hover:bg-accent transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-3.5 py-2.5 bg-[#f9fafb] border border-border rounded-xl text-sm text-foreground">
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
              {nameSaved && (
                <p className="flex items-center gap-1 text-xs text-green-600 mt-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Name updated
                </p>
              )}
            </Field>
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
                    className={`${inputCls(!!passError && !curPass)} pr-10`}
                  />
                  <button type="button" onClick={() => setShowCur((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
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
                    className={`${inputCls(!!passError)} pr-10`}
                  />
                  <button type="button" onClick={() => setShowNew((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
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
                    className={`${inputCls(!!passError && confPass !== newPass)} pr-10`}
                  />
                  <button type="button" onClick={() => setShowConf((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
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
              className={`flex items-center justify-between py-3 px-4 rounded-xl border transition-colors ${notifEnabled ? 'bg-[#f0fdf9] border-[#99f6e4]' : 'bg-[#f9fafb] border-border'}`}
            >
              <div className="flex items-center gap-3">
                {notifEnabled
                  ? <Bell className="w-4 h-4 text-[#0d9488]" />
                  : <BellOff className="w-4 h-4 text-muted-foreground" />
                }
                <div>
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
          <p className="text-[11px] text-muted-foreground text-center">
            Settings are saved locally.
          </p>
        </div>
      </div>
    </>
  );
}
