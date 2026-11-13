import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X, KeyRound, Bell, Eye, EyeOff, MoreHorizontal,
  CheckCircle2, Pencil, ChevronDown, Camera, Trash2, Phone,
} from 'lucide-react';
import {
  changeOwnPassword, PasswordError,
  updateOwnDisplayName, uploadOwnAvatar, removeOwnAvatar, setOwnPhone,
} from '../../lib/db';
import { subscriberProblem } from '../../lib/philippineMobile';
import MobileNumberField from './MobileNumberField';
import ConfirmPasswordDialog from './ConfirmPasswordDialog';
import { playNotificationSound } from '../../lib/notificationSound';
import { useModalFocus } from './useModalFocus';
import { useModalBodyLock } from './useModalBodyLock';
import { useFloatingPanelPresence } from './useFloatingPanelPresence';
import type { StaffSession } from '../../lib/db';
import { PERSON_NAME_PATTERN, PERSON_NAME_MAX_LENGTH } from '../../lib/personName';
import AccountRoleBadge from './AccountRoleBadge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { passwordUpdateError, validatePasswordForm, type PasswordFormError } from '../../lib/passwordFormError';

/* Mirrors update_own_display_name()'s server-side rule exactly. */
const NAME_PATTERN = PERSON_NAME_PATTERN;
const NAME_CHARACTERS_ERROR = 'Enter a valid name — letters, spaces, apostrophes, hyphens and periods only.';
const liveNameProblem = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length > PERSON_NAME_MAX_LENGTH) return `Name can be at most ${PERSON_NAME_MAX_LENGTH} characters.`;
  return NAME_PATTERN.test(trimmed) ? '' : NAME_CHARACTERS_ERROR;
};
const livePhonePrefixProblem = (digits: string) => digits && !digits.startsWith('9')
  ? 'Mobile number must start with 9 (e.g. 9XX XXX XXXX).' : '';

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
  const { mounted, visible } = useFloatingPanelPresence(open);
  const [openSection, setOpenSection] = useState<'contact' | 'security' | 'notifications' | null>(null);
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
  useModalBodyLock(open);

  /* ── Password state ── */
  const [curPass,     setCurPass]     = useState('');
  const [newPass,     setNewPass]     = useState('');
  const [confPass,    setConfPass]    = useState('');
  const [showCur,     setShowCur]     = useState(false);
  const [showNew,     setShowNew]     = useState(false);
  const [showConf,    setShowConf]    = useState(false);
  const [passError,   setPassError]   = useState<PasswordFormError | null>(null);
  const [passSaved,   setPassSaved]   = useState(false);
  const [passBusy,    setPassBusy]    = useState(false);

  /* ── REQ-012: own name / avatar ── */
  const [editingName, setEditingName] = useState(false);
  const [nameInput,   setNameInput]   = useState(profile?.name ?? '');
  const [nameBusy,    setNameBusy]    = useState(false);
  const [nameError,   setNameError]   = useState('');
  const [avatarBusy,  setAvatarBusy]  = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameChanged = !!nameInput.trim() && nameInput.trim() !== (profile?.name ?? '').trim();

  useEffect(() => { if (!editingName) setNameInput(profile?.name ?? ''); }, [profile?.name, editingName]);

  /* ── REQ-018: the OPM's own number — what drivers are shown on "Forgot your PIN?" ──
     Stored as 09XXXXXXXXX; the field holds the 10 digits after +63. Only the OPM gets this section. */
  const isOpm = profile?.role === 'opm';
  const savedPhone = profile?.phone ? profile.phone.slice(1) : '';
  const [phoneInput,   setPhoneInput]   = useState(savedPhone);
  const [savedPhoneInput, setSavedPhoneInput] = useState(savedPhone);
  const [phoneError,   setPhoneError]   = useState('');
  const [phoneSaved,   setPhoneSaved]   = useState(false);
  const [confirmPhone, setConfirmPhone] = useState(false);
  const [phoneBusy, setPhoneBusy] = useState(false);
  const phoneSavingRef = useRef(false);
  const profileIdRef = useRef(profile?.id);
  profileIdRef.current = profile?.id;
  const phoneChanged = phoneInput !== savedPhoneInput;
  useEffect(() => {
    setSavedPhoneInput(savedPhone);
    setPhoneInput(savedPhone);
    setPhoneError('');
    setPhoneSaved(false);
    setConfirmPhone(false);
  }, [savedPhone, open, profile?.id]);

  /* The number can never be emptied: drivers must always have someone to call. */
  const phoneProblem = () => !phoneInput ? 'Enter the mobile number drivers should call.' : subscriberProblem(phoneInput);
  const requestSavePhone = () => {
    if (!isOpm || phoneSavingRef.current || confirmPhone || !phoneChanged) return;
    setPhoneSaved(false);
    const problem = phoneProblem();
    if (problem) { setPhoneError(problem); return; }
    setConfirmPhone(true);
  };
  const handleConfirmPhone = async () => {
    if (phoneSavingRef.current || !isOpm) return;
    const problem = phoneProblem();
    if (!phoneChanged || problem) {
      setPhoneError(problem);
      setConfirmPhone(false);
      return;
    }
    phoneSavingRef.current = true;
    setPhoneBusy(true);
    const accountId = profile?.id;
    try {
      const result = await setOwnPhone(`0${phoneInput}`);
      if (profileIdRef.current !== accountId) return;
      if (!result.phone) throw new Error('phone_required');
      const confirmed = result.phone.slice(1);
      setSavedPhoneInput(confirmed);
      setPhoneInput(confirmed);
      setPhoneError('');
      onProfileUpdated({ phone: result.phone });
      setConfirmPhone(false);
      setPhoneSaved(true);
      setTimeout(() => setPhoneSaved(false), 4000);
    } finally {
      phoneSavingRef.current = false;
      setPhoneBusy(false);
    }
  };
  const phoneErrorText = (err: unknown): string => {
    const m = err instanceof Error ? err.message : '';
    if (m.includes('phone_required'))  return 'Enter the mobile number drivers should call.';
    if (m.includes('invalid_phone'))   return 'Enter a valid Philippine mobile number.';
    if (m.includes('reauth_required')) return 'Please enter your password again.';
    if (m.includes('not_authorized'))  return 'Only the Operation Manager can change this number.';
    return 'Could not save the number. Check your connection and try again.';
  };

  useEffect(() => {
    if (open) {
      setEditingName(false);
      setProfileMenuOpen(false);
      setNameError('');
      setAvatarError('');
    }
  }, [open, profile?.id]);

  const handleSaveName = async () => {
    if (nameBusy || !nameChanged) return;
    setNameError('');
    const trimmed = nameInput.trim();
    if (!trimmed) { setNameError('Name is required.'); return; }
    // Same rule update_own_display_name() enforces server-side — catches it before
    // a round trip, but the server is the real gate (never trust this check alone).
    if (!NAME_PATTERN.test(trimmed)) {
      setNameError(NAME_CHARACTERS_ERROR);
      return;
    }
    if (trimmed.length > PERSON_NAME_MAX_LENGTH) {
      setNameError(`Name can be at most ${PERSON_NAME_MAX_LENGTH} characters.`);
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
        ? NAME_CHARACTERS_ERROR
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


  const handleSavePassword = async () => {
    if (passBusy) return;
    setPassError(null);
    setPassSaved(false);
    const validationError = validatePasswordForm(curPass, newPass, confPass);
    if (validationError) { setPassError(validationError); return; }

    /* Real change: the account is a Supabase Auth login, so this updates the actual password
       (the old one stops working at the login screen straight away). */
    setPassBusy(true);
    try {
      await changeOwnPassword(curPass, newPass);
      setCurPass(''); setNewPass(''); setConfPass('');
      setPassError(null);
      setPassSaved(true);
      setTimeout(() => setPassSaved(false), 3000);
    } catch (e) {
      console.error('[changeOwnPassword] error:', e);
      const code = e instanceof PasswordError ? e.code : 'network';
      setPassError(passwordUpdateError(code));
    } finally {
      setPassBusy(false);
    }
  };

  /* Initials avatar */
  const initials = (profile?.name ?? '').split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);

  if (!mounted) return null;

  return createPortal(
    <div className={`fixed inset-0 z-[60] isolate ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open || undefined}>
      {/* Backdrop */}
      <div
        className={`absolute inset-0 z-0 bg-black/40 transition-opacity motion-reduce:transition-none sm:transition-none ${visible ? 'opacity-100 duration-[225ms]' : 'opacity-0 duration-200 sm:opacity-100'}`}
        aria-hidden="true"
      />

      {/* Centred modal — the wrapper ignores clicks so they fall through to the backdrop */}
      <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:p-6">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className={`pointer-events-auto flex max-h-[calc(100dvh-max(1.5rem,env(safe-area-inset-top))-max(1.5rem,env(safe-area-inset-bottom)))] w-full min-w-0 flex-col overflow-hidden rounded-[20px] bg-white shadow-2xl transition-[opacity,transform] ease-out motion-reduce:transition-none sm:max-h-[min(85dvh,720px)] sm:max-w-[720px] sm:rounded-2xl sm:transform-none sm:opacity-100 sm:transition-none ${visible ? 'translate-y-0 opacity-100 duration-[225ms]' : 'translate-y-2 opacity-0 duration-200'}`}
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
        <div className="min-h-0 min-w-0 overflow-y-auto overscroll-contain px-4 py-5 sm:px-8 sm:py-7">

          {/* ── Profile ── */}
          <section className="pb-6">
            <div className="flex min-w-0 items-start gap-3 sm:items-center sm:gap-5">
              <div className="shrink-0">
                <div className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-[18px] border border-green-700/30 bg-[#03624c] shadow-sm min-[390px]:h-24 min-[390px]:w-24 sm:h-28 sm:w-28">
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
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="min-w-0 break-words text-xl font-semibold leading-tight text-foreground sm:text-[26px]">{profile?.name || 'Account'}</p>
                  <AccountRoleBadge role={profile?.role ?? null} />
                </div>
                <p className="mt-1 break-all text-sm text-slate-600 sm:text-base">{profile?.email ?? 'Email unavailable'}</p>
              </div>
              <DropdownMenu open={profileMenuOpen} onOpenChange={setProfileMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <button type="button" aria-label="Profile actions" disabled={avatarBusy || nameBusy}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-green-50 hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60">
                    <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="z-[70] min-w-44">
                  <DropdownMenuItem onSelect={() => { setEditingName(true); setNameInput(profile?.name ?? ''); setNameError(''); }}>
                    <Pencil aria-hidden="true" />Edit Display Name
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>
                    <Camera aria-hidden="true" />{profile?.avatarPath ? 'Change Photo' : 'Add Photo'}
                  </DropdownMenuItem>
                  {profile?.avatarPath && <DropdownMenuItem onSelect={handleRemoveAvatar} variant="destructive">
                    <Trash2 aria-hidden="true" />Remove Photo
                  </DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {avatarError && <p className="mt-2 text-sm text-red-600" role="alert">{avatarError}</p>}
            {editingName && (
              <div className="mt-5 max-w-sm space-y-3">
                <Field label="Display Name" htmlFor="settings-display-name">
                  <input id="settings-display-name" value={nameInput}
                    onChange={(e) => { setNameInput(e.target.value); setNameError(liveNameProblem(e.target.value)); }}
                    aria-invalid={!!nameError} aria-describedby={nameError ? 'settings-display-name-error' : undefined}
                    className={inputCls(!!nameError)} autoFocus />
                </Field>
                {nameError && <p id="settings-display-name-error" className="text-sm text-red-600" role="alert">{nameError}</p>}
                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" disabled={nameBusy}
                    onClick={() => { setEditingName(false); setNameInput(profile?.name ?? ''); setNameError(''); }}
                    className="min-h-10 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60">Cancel</button>
                  <button type="button" onClick={handleSaveName} disabled={nameBusy || !nameChanged || !!liveNameProblem(nameInput)}
                    className="min-h-10 rounded-lg bg-primary px-3 text-sm font-medium text-white hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60">
                    {nameBusy ? 'Saving…' : 'Save Changes'}
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* ── Contact number (OPM only) ── */}
          {isOpm && <section className="border-t border-border">
            <button type="button" aria-expanded={openSection === 'contact'} aria-controls="settings-contact-content" onClick={() => setOpenSection(openSection === 'contact' ? null : 'contact')}
              className={`flex w-full items-center gap-3 rounded-lg px-2 py-4 text-left transition-colors hover:bg-green-50/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary motion-reduce:transition-none ${openSection === 'contact' ? 'bg-green-50/40' : ''}`}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-green-50 text-green-800"><Phone className="h-5 w-5" aria-hidden="true" /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-foreground">Contact number</span><span className="mt-1 block text-sm text-muted-foreground">The number drivers call when they forget their PIN.</span></span>
              <ChevronDown className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${openSection === 'contact' ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
            {openSection === 'contact' && <div id="settings-contact-content" className="space-y-3 px-2 pb-5 pt-2 sm:px-4">
              <Field label="Mobile number" htmlFor="settings-contact-phone">
                <MobileNumberField id="settings-contact-phone" value={phoneInput} error={phoneError}
                  ariaLabel="Your mobile number, ten digits after +63"
                  onChange={(digits) => { setPhoneInput(digits); setPhoneSaved(false); }} onError={setPhoneError}
                  validateOnChange={livePhonePrefixProblem} disabled={phoneBusy || confirmPhone}
                  onBlur={() => { if (phoneInput ? subscriberProblem(phoneInput) : savedPhoneInput) setPhoneError(phoneProblem()); }} />
              </Field>
              <p className="text-xs text-muted-foreground">
                Drivers see this number on the login screen under &ldquo;Forgot your PIN?&rdquo;. While a CSR is covering your leave, they see the number you set for that coverage instead.
                Drivers always need someone to call, so once saved this number can be changed but not removed.
              </p>
              {phoneSaved && <p role="status" className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="w-3.5 h-3.5" /> Contact number saved</p>}
              <div className="flex flex-wrap gap-2 sm:justify-end">
                {phoneChanged && <button type="button" onClick={() => { setPhoneInput(savedPhoneInput); setPhoneError(''); setPhoneSaved(false); }} disabled={phoneBusy || confirmPhone}
                  className="min-h-11 flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-primary sm:flex-none">
                  Revert
                </button>}
                <button type="button" onClick={requestSavePhone} disabled={!phoneChanged || !!phoneProblem() || phoneBusy || confirmPhone}
                  className="min-h-11 flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-primary sm:flex-none">
                  Save Number
                </button>
              </div>
            </div>}
          </section>}

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
                    onChange={(e) => { setCurPass(e.target.value); setPassError((error) => error?.field === 'current' ? null : error); }}
                    placeholder="Enter current password"
                    aria-invalid={passError?.field === 'current' || undefined}
                    aria-describedby={passError?.field === 'current' ? 'settings-current-password-error' : undefined}
                    className={`${inputCls(passError?.field === 'current')} pr-12`}
                  />
                  <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setShowCur((v) => !v)} aria-label={showCur ? 'Hide password' : 'Show password'}
                    className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary">
                    {showCur ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {passError?.field === 'current' && <p id="settings-current-password-error" role="alert" className="text-sm text-red-600">{passError.message}</p>}
              </Field>
              <Field label="New Password" htmlFor="settings-new-password">
                <div className="relative">
                  <input
                    id="settings-new-password"
                    type={showNew ? 'text' : 'password'}
                    value={newPass}
                    onChange={(e) => { setNewPass(e.target.value); setPassError((error) => error?.field === 'new' ? null : error); }}
                    placeholder="Enter new password"
                    aria-invalid={passError?.field === 'new' || undefined}
                    aria-describedby={passError?.field === 'new' ? 'settings-new-password-error' : undefined}
                    className={`${inputCls(passError?.field === 'new')} pr-12`}
                  />
                  <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setShowNew((v) => !v)} aria-label={showNew ? 'Hide password' : 'Show password'}
                    className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary">
                    {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {passError?.field === 'new' && <p id="settings-new-password-error" role="alert" className="text-sm text-red-600">{passError.message}</p>}
              </Field>
              <Field label="Confirm New Password" htmlFor="settings-confirm-password">
                <div className="relative">
                  <input
                    id="settings-confirm-password"
                    type={showConf ? 'text' : 'password'}
                    value={confPass}
                    onChange={(e) => { setConfPass(e.target.value); setPassError((error) => error?.field === 'confirm' ? null : error); }}
                    placeholder="Confirm new password"
                    aria-invalid={passError?.field === 'confirm' || undefined}
                    aria-describedby={passError?.field === 'confirm' ? 'settings-confirm-password-error' : undefined}
                    className={`${inputCls(passError?.field === 'confirm')} pr-12`}
                  />
                  <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setShowConf((v) => !v)} aria-label={showConf ? 'Hide password' : 'Show password'}
                    className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary">
                    {showConf ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {passError?.field === 'confirm' && <p id="settings-confirm-password-error" role="alert" className="text-sm text-red-600">{passError.message}</p>}
              </Field>
              {passError?.field === 'general' && <p role="alert" className="text-sm text-red-600">{passError.message}</p>}
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

      {confirmPhone && (
        <ConfirmPasswordDialog
          tone="primary"
          title="Change the number drivers call?"
          message={<>Drivers who forgot their PIN will be shown <span className="font-medium text-foreground">0{phoneInput.slice(0, 3)} {phoneInput.slice(3, 6)} {phoneInput.slice(6)}</span> to call.</>}
          confirmLabel="Save Number"
          busyLabel="Saving…"
          onConfirm={handleConfirmPhone}
          onCancel={() => setConfirmPhone(false)}
          errorText={phoneErrorText}
        />
      )}
    </div>,
    document.body,
  );
}
