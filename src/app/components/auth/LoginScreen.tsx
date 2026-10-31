import { useState, useRef, useEffect } from 'react';
import imgLogo from 'figma:asset/5e73e3c08e898d68c86717993c6e7442d03e9ac4.png';
import { Eye, EyeOff, AlertCircle, CheckCircle2, Phone, Loader2, X } from 'lucide-react';
import { signInStaff, signInDriver, LoginError, requestCsrPasswordReset } from '../../lib/db';
import type { StaffSession } from '../../lib/db';
import { getLastDriverLanguage, translateDriver } from '../driver/driverI18n';

interface Props {
  onAdminLogin:  (session: StaffSession) => void | Promise<void>;
  onDriverLogin: (info: { id: string; name: string }) => void;
  sessionNotice: 'replaced' | 'signed_out' | null;
  onDismissSessionNotice: () => void;
}

/* Dispatch hotline shown in the "Forgot your PIN?" dialog. Drivers cannot reset their own
   PIN — only an admin can regenerate it from the Accounts page — so this number is the
   whole recovery path. CHANGE IT HERE if dispatch ever moves to a different line.
   `DISPATCH_TEL` is what the phone dials; `DISPATCH_DISPLAY` is what the driver reads. */
const DISPATCH_TEL     = '09384033610';
const DISPATCH_DISPLAY = '0938 403 3610';

export default function LoginScreen({ onAdminLogin, onDriverLogin, sessionNotice, onDismissSessionNotice }: Props) {
  const [view, setView] = useState<'driver' | 'admin'>(() =>
    new URLSearchParams(window.location.search).get('account') === 'staff' ? 'admin' : 'driver');
  const [passwordFlow, setPasswordFlow] = useState<'login' | 'request'>('login');
  const [resetEmail, setResetEmail] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetSubmitted, setResetSubmitted] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const driverLanguage = getLastDriverLanguage();
  const tr = (key: Parameters<typeof translateDriver>[1], params?: Record<string, string | number>) => translateDriver(driverLanguage, key, params);
  const lockMinutes = (e: unknown) => Math.max(1, Math.ceil(((e instanceof LoginError && e.retryAfterSeconds) || 300) / 60));

  /* ── Driver form ── */
  const [mobile,        setMobile]        = useState('');
  const [pin,           setPin]           = useState(['', '', '', '']);
  const [driverError,   setDriverError]   = useState<{ type: 'mobile' | 'pin' | 'general'; msg: string } | null>(null);
  const [driverLoading, setDriverLoading] = useState(false);
  const mobilePrefixInvalid = mobile.length > 0 && !mobile.startsWith('9');
  const mobileError = mobilePrefixInvalid
    ? tr('login.mobilePrefix')
    : driverError?.type === 'mobile' ? driverError.msg : null;
  const mobileHasError = !!mobileError;
  /* "Forgot your PIN?" dialog — purely informational, it starts no reset flow. */
  const [showPinHelp,   setShowPinHelp]   = useState(false);

  const pinRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  /* ── Admin form ── */
  const [email,        setEmail]        = useState('');
  const [password,     setPassword]     = useState('');
  const [showPass,     setShowPass]     = useState(false);
  const [adminError,   setAdminError]   = useState('');
  const [adminFieldError, setAdminFieldError] = useState<{ field: 'email' | 'password'; msg: string } | null>(null);
  const [adminLoading, setAdminLoading] = useState(false);

  const submitResetRequest = async () => {
    if (resetBusy || resetSubmitted) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resetEmail.trim())) { setResetError('Enter a valid email address.'); return; }
    setResetBusy(true);
    setResetError('');
    try {
      if (await requestCsrPasswordReset(resetEmail)) setResetSubmitted(true);
      else setResetError('No active CSR account was found for that email.');
    } catch { setResetError('Could not submit the request. Please try again.'); }
    finally { setResetBusy(false); }
  };

  /* Escape closes the PIN-help dialog. The listener is only attached while the dialog is
     open, and the cleanup removes it — otherwise every render would stack another one. */
  useEffect(() => {
    if (!showPinHelp) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowPinHelp(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showPinHelp]);

  const handleMobile = (v: string) => {
    // digits only, max 10, must start with 9
    const digits = v.replace(/\D/g, '').slice(0, 10);
    setMobile(digits);
    setDriverError(null);
  };

  const handlePin = (i: number, v: string) => {
    const digit = v.replace(/[^0-9]/g, '').slice(-1);
    const next  = [...pin];
    next[i]     = digit;
    setPin(next);
    setDriverError(null);
    if (digit && i < 3) pinRefs[i + 1].current?.focus();
  };

  const handlePinKey = (i: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (pin[i]) {
        const next = [...pin]; next[i] = ''; setPin(next); setDriverError(null);
      } else if (i > 0) {
        pinRefs[i - 1].current?.focus();
        const next = [...pin]; next[i - 1] = ''; setPin(next); setDriverError(null);
      }
    }
  };

  const handleDriverLogin = async () => {
    if (driverLoading) return;
    const fullPin = pin.join('');

    // mobile is the 10-digit local number (e.g. "9123456789")
    if (mobilePrefixInvalid) {
      setDriverError({ type: 'mobile', msg: tr('login.mobilePrefix') });
      return;
    }
    if (!/^9\d{9}$/.test(mobile)) {
      setDriverError({ type: 'mobile', msg: tr('login.invalidMobile') });
      return;
    }
    if (fullPin.length < 4) {
      setDriverError({ type: 'pin', msg: tr('login.enterPin') });
      return;
    }

    setDriverLoading(true);
    setDriverError(null);

    try {
      const driver = await signInDriver(mobile, fullPin);
      onDriverLogin(driver);
    } catch (e) {
      console.error('[signInDriver] error:', e);
      const code = e instanceof LoginError ? e.code : 'network';
      if (code === 'invalid_credentials') setDriverError({ type: 'general', msg: tr('login.wrongPin') });
      else if (code === 'no_access')      setDriverError({ type: 'general', msg: tr('login.notDriver') });
      else if (code === 'server')         setDriverError({ type: 'general', msg: tr('login.server') });
      else if (code === 'rate_limited')   setDriverError({ type: 'general', msg: tr('login.rateLimited') });
      else if (code === 'locked')         setDriverError({ type: 'general', msg: tr('login.locked', { minutes: lockMinutes(e) }) });
      else                                setDriverError({ type: 'general', msg: tr('login.network') });
    } finally {
      setDriverLoading(false);
    }
  };

  const handleAdminLogin = async () => {
    if (adminLoading) return;
    setAdminError('');
    setAdminFieldError(null);
    const inputEmail = email.trim().toLowerCase();
    const inputPass  = password.trim();
    if (!inputEmail) { setAdminFieldError({ field: 'email', msg: 'Enter your email address.' }); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inputEmail)) { setAdminFieldError({ field: 'email', msg: 'Enter a valid email address.' }); return; }
    if (!inputPass) { setAdminFieldError({ field: 'password', msg: 'Enter your password.' }); return; }

    setAdminLoading(true);
    try {
      /* OPM and CSR are both Supabase Auth users — one call.
         Which role you get comes from your row in the `profiles` table, not from this code. */
      const session = await signInStaff(inputEmail, inputPass);
      await onAdminLogin(session);
    } catch (e) {
      console.error('[signInStaff] error:', e);
      const code = e instanceof LoginError ? e.code : 'network';
      if (code === 'invalid_credentials') setAdminError('Incorrect email or password.');
      else if (code === 'no_access')      setAdminError('This account does not have access to the admin portal. Contact the Operation Manager.');
      else if (code === 'server')         setAdminError('Unable to log in right now. Please try again.');
      else if (code === 'rate_limited')   setAdminError('Too many login requests. Please try again shortly.');
      else if (code === 'locked')         setAdminError(`Too many failed attempts. Try again in ${lockMinutes(e)} min.`);
      else                                setAdminError('Unable to connect to the server. Please try again.');
    } finally {
      setAdminLoading(false);
    }
  };

  return (
    <div
      className="relative isolate min-h-screen w-full overflow-hidden flex items-center justify-center p-4 sm:p-6"
      style={{ background: '#f8fbfa url(/login-background.png) center / cover no-repeat' }}
    >
      <div className="relative z-10 w-full max-w-[420px]">
        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
          <div className="px-7 sm:px-9 pt-9 pb-7 space-y-7">

            {/* Logo */}
            <div className="flex flex-col items-center gap-3">
              <img src={imgLogo} alt="360 Logistics" className="h-16 object-contain" />
              {passwordFlow === 'login' && <p className="text-base text-muted-foreground text-center">
                {view === 'driver' ? tr('login.welcome') : 'Welcome Back, Please enter your details'}
              </p>}
            </div>

            {/* ══ DRIVER / ADMIN SEGMENTED TOGGLE ══
                Replaces the old blue "Admin Login" / "← Back" footer buttons. The click
                handlers carry over the exact same state resets those buttons did, so
                switching tabs still clears the other form's fields and errors. */}
            {passwordFlow === 'login' && <div role="group" aria-label="Login account type" className="relative grid grid-cols-2 p-1.5 bg-[#f3f4f6] rounded-2xl">
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute inset-y-1.5 left-1.5 w-[calc(50%_-_6px)] rounded-xl bg-white shadow-sm transition-transform duration-300 ease-out motion-reduce:transition-none ${view === 'admin' ? 'translate-x-full' : 'translate-x-0'}`}
              />
              <button
                type="button"
                aria-pressed={view === 'driver'}
                onClick={() => { setView('driver'); setDriverError(null); }}
                className={`relative z-10 min-w-0 py-3 rounded-xl text-base transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none ${
                  view === 'driver'
                    ? 'font-bold text-foreground'
                    : 'font-semibold text-gray-500 hover:text-foreground'
                }`}
              >
                {view === 'driver' ? tr('login.driver') : 'Driver'}
              </button>
              <button
                type="button"
                aria-pressed={view === 'admin'}
                onClick={() => { setView('admin'); setAdminError(''); setAdminFieldError(null); setEmail(''); setPassword(''); }}
                className={`relative z-10 min-w-0 py-3 rounded-xl text-base transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none ${
                  view === 'admin'
                    ? 'font-bold text-foreground'
                    : 'font-semibold text-gray-500 hover:text-foreground'
                }`}
              >
                Admin
              </button>
            </div>}

            {sessionNotice && <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm leading-5 text-foreground">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
              <span className="min-w-0 flex-1">{view === 'driver'
                ? tr(sessionNotice === 'replaced' ? 'login.sessionReplaced' : 'login.sessionEnded')
                : sessionNotice === 'replaced'
                  ? 'This account was signed in on another device. Please sign in again.'
                  : 'Your session has ended. Please sign in again.'}</span>
              <button type="button" onClick={onDismissSessionNotice} aria-label={view === 'driver' ? tr('login.close') : 'Dismiss notice'} className="rounded p-0.5 text-muted-foreground hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-primary">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>}

            {/* ══ DRIVER LOGIN ══ */}
            {view === 'driver' && passwordFlow === 'login' && (
              <div className="space-y-5">

                <div className="space-y-2.5">
                  <label className="text-base font-semibold text-foreground block">{tr('login.mobile')}</label>
                  <div>
                    <div className={`flex w-full max-w-full min-w-0 items-center rounded-2xl border overflow-hidden focus-within:ring-2 transition-colors duration-150 ${
                      mobileHasError ? 'border-red-500 bg-red-50 focus-within:ring-red-500/30' : 'border-[#e5e7eb] bg-[#f9fafb] focus-within:border-primary focus-within:ring-primary/30'
                    }`}>
                    {/* Country prefix badge */}
                    <span className="shrink-0 px-2 sm:px-4 py-4 bg-gray-100 border-r border-[#e5e7eb] text-base font-bold text-foreground select-none whitespace-nowrap">
                      +63
                    </span>
                    {/* 10-digit input starting with 9 */}
                    <input
                      type="tel"
                      inputMode="numeric"
                      autoComplete="off"
                      value={mobile}
                      onChange={(e) => handleMobile(e.target.value)}
                      aria-invalid={mobileHasError || undefined}
                      aria-describedby={mobileHasError ? 'driver-mobile-error' : undefined}
                      placeholder="9XX XXX XXXX"
                      maxLength={10}
                      onKeyDown={(e) => e.key === 'Enter' && handleDriverLogin()}
                      className="min-w-0 flex-1 px-2 sm:px-4 py-4 bg-transparent text-sm sm:text-base text-foreground placeholder:text-muted-foreground focus:outline-none tracking-wider"
                    />
                    {/* Character counter */}
                    <span className={`shrink-0 px-2 sm:px-4 text-xs sm:text-sm font-semibold tabular-nums ${
                      mobileHasError ? 'text-red-600' : mobile.length === 10 ? 'text-green-600' : 'text-muted-foreground'
                    }`}>
                      {mobile.length}/10
                    </span>
                    </div>
                    {mobileHasError && <p id="driver-mobile-error" role="alert" className="mt-1 text-sm leading-5 text-red-600 break-words">{mobileError}</p>}
                  </div>
                </div>

                <div className="space-y-2.5">
                  <label className="text-base font-semibold text-foreground block">{tr('login.pin')}</label>
                  <div className="flex w-full max-w-full justify-center gap-2 sm:gap-4">
                    {pin.map((digit, i) => (
                      <input
                        key={i} ref={pinRefs[i]}
                        type="password" inputMode="numeric" maxLength={1} value={digit}
                        onChange={(e) => handlePin(i, e.target.value)}
                        onKeyDown={(e) => handlePinKey(i, e)}
                        aria-label={`PIN digit ${i + 1}`}
                        aria-invalid={driverError?.type === 'pin' || undefined}
                        aria-describedby={driverError?.type === 'pin' ? 'driver-pin-error' : undefined}
                        className={`min-w-0 w-full max-w-[64px] flex-1 h-[60px] text-center text-2xl font-bold border-0 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all ${
                          driverError?.type === 'pin'
                            ? 'bg-red-100 ring-2 ring-red-300'
                            : digit ? 'bg-primary/20 text-primary' : 'bg-[#e5e7eb]'
                        }`}
                      />
                    ))}
                  </div>
                  {driverError?.type === 'pin' && <p id="driver-pin-error" role="alert" className="text-sm leading-5 text-red-600">{driverError.msg}</p>}
                </div>

                {driverError?.type === 'general' && (
                  <div role="alert" className="flex items-start gap-2 text-red-600 text-sm leading-5">
                    <AlertCircle aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" /> <span>{driverError.msg}</span>
                  </div>
                )}

                <button
                  onClick={handleDriverLogin}
                  disabled={driverLoading}
                  className="w-full py-5 bg-[#10b981] text-white rounded-2xl hover:bg-[#059669] transition-colors shadow-lg font-bold text-xl disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {driverLoading ? <><Loader2 className="w-5 h-5 animate-spin" /> {tr('login.verifying')}</> : tr('login.logIn')}
                </button>

                {/* "Reset PIN" opens an informational dialog only — there is no self-service
                    reset in this system, so the link must not imply one. */}
                <div className="text-center text-sm text-gray-500">
                  {tr('login.forgotPin')}{' '}
                  <button
                    type="button"
                    onClick={() => setShowPinHelp(true)}
                    className="text-[#10b981] font-semibold underline underline-offset-2 hover:text-[#059669] transition-colors"
                  >
                    {tr('login.resetPin')}
                  </button>
                </div>
              </div>
            )}

            {/* ══ ADMIN LOGIN ══ */}
            {view === 'admin' && passwordFlow === 'login' && (
              <div className="space-y-5">

                <div className="space-y-2">
                  <label className="text-base font-semibold text-foreground block">Company Email</label>
                  <input
                    type="email" value={email}
                    onChange={(e) => { setEmail(e.target.value); setAdminError(''); setAdminFieldError(null); }}
                    placeholder="e.g. 360logistics@email.ph"
                    onKeyDown={(e) => e.key === 'Enter' && handleAdminLogin()}
                    aria-invalid={adminFieldError?.field === 'email' || undefined}
                    aria-describedby={adminFieldError?.field === 'email' ? 'admin-email-error' : undefined}
                    className={`w-full px-4 py-4 text-base bg-[#f9fafb] border rounded-2xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all ${adminFieldError?.field === 'email' ? 'border-red-500' : 'border-[#e5e7eb]'}`}
                  />
                  {adminFieldError?.field === 'email' && <p id="admin-email-error" role="alert" className="text-sm leading-5 text-red-600">{adminFieldError.msg}</p>}
                </div>

                <div className="space-y-2">
                  <label className="text-base font-semibold text-foreground block">Password</label>
                  <div className="relative">
                    <input
                      type={showPass ? 'text' : 'password'} value={password}
                      onChange={(e) => { setPassword(e.target.value); setAdminError(''); setAdminFieldError(null); }}
                      placeholder="Enter password"
                      onKeyDown={(e) => e.key === 'Enter' && handleAdminLogin()}
                      aria-invalid={adminFieldError?.field === 'password' || undefined}
                      aria-describedby={adminFieldError?.field === 'password' ? 'admin-password-error' : undefined}
                      className={`w-full px-4 py-4 text-base bg-[#f9fafb] border rounded-2xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all pr-12 ${adminFieldError?.field === 'password' ? 'border-red-500' : 'border-[#e5e7eb]'}`}
                    />
                    <button
                      type="button" onClick={() => setShowPass(!showPass)}
                      aria-label={showPass ? 'Hide password' : 'Show password'}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showPass ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                  {adminFieldError?.field === 'password' && <p id="admin-password-error" role="alert" className="text-sm leading-5 text-red-600">{adminFieldError.msg}</p>}
                </div>

                {adminError && (
                  <div role="alert" className="flex items-start gap-2 text-red-600 text-sm leading-5">
                    <AlertCircle aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" /> <span>{adminError}</span>
                  </div>
                )}

                <button
                  onClick={handleAdminLogin} disabled={adminLoading}
                  className="w-full py-5 bg-[#10b981] text-white rounded-2xl hover:bg-[#059669] transition-colors shadow-lg font-bold text-xl disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {adminLoading ? <><Loader2 className="w-5 h-5 animate-spin" /> Signing in…</> : 'Log In'}
                </button>
                <button type="button" onClick={() => { setResetEmail(email); setResetError(''); setResetSubmitted(false); setPasswordFlow('request'); }} className="block mx-auto text-sm text-primary underline underline-offset-2">Forgot password?</button>
              </div>
            )}

            {passwordFlow === 'request' && <div className="space-y-4">
              <h1 className="text-xl font-semibold">Forgot Password</h1>
              {resetSubmitted ? (
                <div role="status" className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm leading-6 text-foreground">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 aria-hidden="true" className="h-5 w-5 shrink-0 text-primary" />
                    <h2 className="text-base font-semibold">Request Submitted</h2>
                  </div>
                  <p className="mt-2">Your request has been processed.</p>
                  <p className="mt-2">Your request is now available for OPM review. After approval, OPM can provide your password reset link.</p>
                </div>
              ) : (
                <form noValidate onSubmit={(event) => { event.preventDefault(); void submitResetRequest(); }} className="space-y-4">
                  <p className="text-sm text-muted-foreground">Enter the email you use to sign in as a CSR.</p>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium" htmlFor="reset-email">Email</label>
                    <input id="reset-email" type="email" autoComplete="email" placeholder="Enter your CSR email"
                      value={resetEmail} disabled={resetBusy} aria-invalid={!!resetError || undefined}
                      aria-describedby={resetError ? 'reset-request-error' : undefined}
                      onChange={(event) => { setResetEmail(event.target.value); if (resetError) setResetError(''); }}
                      className={`w-full rounded-xl border px-4 py-3 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 ${resetError ? 'border-red-500' : 'border-border'}`} />
                  </div>
                  {resetError && <p id="reset-request-error" role="alert" className="flex items-start gap-2 text-sm text-red-600">
                    <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />{resetError}
                  </p>}
                  <button type="submit" disabled={resetBusy}
                    className="flex w-full min-h-12 items-center justify-center gap-2 rounded-xl bg-primary text-white font-semibold hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50">
                    {resetBusy ? <><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />Submitting...</> : 'Submit Request'}
                  </button>
                </form>
              )}
              <button type="button" onClick={() => { setPasswordFlow('login'); setView('admin'); setResetError(''); setResetSubmitted(false); }}
                className="min-h-10 text-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">Back to Login</button>
            </div>}

          </div>

        </div>
      </div>

      {/* ══ "FORGOT YOUR PIN?" DIALOG ══
          Informational only: it starts no reset flow, because none exists. Drivers cannot
          reset their own PIN — an admin regenerates it from the Accounts page — so the
          dispatch number below is the entire recovery path.

          Responsive by construction rather than by breakpoint: the wrapper centres the card
          with a p-4 gutter, and the card is `w-full max-w-sm`. On a phone that means
          full-width minus the gutter; on a laptop it settles at 384px. Same approach the
          admin modals use. */}
      {showPinHelp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pin-help-title"
        >
          {/* Backdrop — click anywhere outside the card to dismiss */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowPinHelp(false)}
          />

          <div className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl p-6 sm:p-7 text-center animate-in fade-in zoom-in-95 duration-200">
            <button
              type="button"
              onClick={() => setShowPinHelp(false)}
              aria-label={tr('login.close')}
              className="absolute right-4 top-4 p-1.5 rounded-lg text-muted-foreground hover:bg-gray-100 hover:text-foreground transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-14 h-14 rounded-full bg-[#10b981]/10 flex items-center justify-center mx-auto mb-4">
              <Phone className="w-7 h-7 text-[#10b981]" />
            </div>

            <h3 id="pin-help-title" className="text-xl font-bold text-foreground">
              {tr('login.forgotPin')}
            </h3>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              {tr('login.pinHelp')}
            </p>

            {/* tel: link — taps to dial on a phone, reads as plain text on a laptop */}
            <a
              href={`tel:${DISPATCH_TEL}`}
              className="mt-5 flex items-center justify-center gap-2 w-full py-4 bg-[#f3f4f6] rounded-2xl text-xl font-bold text-foreground tracking-wide hover:bg-gray-200 transition-colors"
            >
              <Phone className="w-5 h-5 text-[#10b981] flex-shrink-0" />
              {DISPATCH_DISPLAY}
            </a>

            <button
              type="button"
              onClick={() => setShowPinHelp(false)}
              className="mt-3 w-full py-4 bg-[#10b981] text-white rounded-2xl hover:bg-[#059669] transition-colors font-bold text-base"
            >
              {tr('login.gotIt')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
