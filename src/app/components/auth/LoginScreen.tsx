import { useState, useRef, useEffect } from 'react';
import imgLogo from 'figma:asset/5e73e3c08e898d68c86717993c6e7442d03e9ac4.png';
import { Eye, EyeOff, AlertCircle, Phone, KeySquare, Loader2, X } from 'lucide-react';
import { signInStaff, signInDriver, LoginError } from '../../lib/db';
import type { StaffSession } from '../../lib/db';

interface Props {
  onAdminLogin:  (session: StaffSession) => void | Promise<void>;
  onDriverLogin: (info: { id: string; name: string }) => void;
}

/* Dispatch hotline shown in the "Forgot your PIN?" dialog. Drivers cannot reset their own
   PIN — only an admin can regenerate it from the Accounts page — so this number is the
   whole recovery path. CHANGE IT HERE if dispatch ever moves to a different line.
   `DISPATCH_TEL` is what the phone dials; `DISPATCH_DISPLAY` is what the driver reads. */
const DISPATCH_TEL     = '09384033610';
const DISPATCH_DISPLAY = '0938 403 3610';

const ErrorBanner = ({ icon: Icon, title, sub }: { icon: React.ElementType; title: string; sub: string }) => (
  <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-2xl">
    <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
      <Icon className="w-4 h-4 text-red-600" />
    </div>
    <div>
      <p className="text-base font-semibold text-red-700">{title}</p>
      <p className="text-sm text-red-500 mt-0.5 leading-snug">{sub}</p>
    </div>
  </div>
);

export default function LoginScreen({ onAdminLogin, onDriverLogin }: Props) {
  const [view, setView] = useState<'driver' | 'admin'>('driver');

  /* ── Driver form ── */
  const [mobile,        setMobile]        = useState('');
  const [pin,           setPin]           = useState(['', '', '', '']);
  /* 'mobile_and_pin' marks BOTH fields — used when the number itself is not registered,
   so neither the number nor whatever PIN was typed can be the right one. */
  const [driverError,   setDriverError]   = useState<{ type: 'mobile' | 'pin' | 'mobile_and_pin' | 'general'; msg: string } | null>(null);
  const [driverLoading, setDriverLoading] = useState(false);
  const mobileStartsWrong = mobile.length > 0 && !mobile.startsWith('9');
  const mobileHasError = mobileStartsWrong || driverError?.type === 'mobile' || driverError?.type === 'mobile_and_pin';
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
  const [adminLoading, setAdminLoading] = useState(false);

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
    const fullPin = pin.join('');

    // mobile is the 10-digit local number (e.g. "9123456789")
    if (mobile.length !== 10) {
      setDriverError({ type: 'mobile', msg: 'Please enter a valid 10-digit mobile number.' });
      return;
    }
    if (!mobile.startsWith('9')) {
      setDriverError({ type: 'mobile', msg: 'Mobile number must start with 9 (e.g. 9XX XXX XXXX).' });
      return;
    }
    if (fullPin.length < 4) {
      setDriverError({ type: 'pin', msg: 'Please enter your 4-digit PIN.' });
      return;
    }

    setDriverLoading(true);
    setDriverError(null);

    /* Supabase Auth itself answers only "valid" or "invalid". When it rejects an attempt,
       signInDriver additionally asks the database whether the number is registered, so the
       two cases can be told apart:
         unknown_mobile      -> number not registered   -> flag BOTH fields
         invalid_credentials -> number exists, PIN wrong -> flag the PIN field only
       If that lookup cannot run it stays invalid_credentials, and the PIN message is shown
       rather than wrongly claiming the number is unregistered.
       There is no offline fallback any more: driver data is private until you are signed in. */
    try {
      const driver = await signInDriver(mobile, fullPin);
      onDriverLogin(driver);
    } catch (e) {
      console.error('[signInDriver] error:', e);
      const code = e instanceof LoginError ? e.code : 'network';
      if (code === 'unknown_mobile')      setDriverError({ type: 'mobile_and_pin', msg: 'This mobile number is not registered.' });
      else if (code === 'invalid_credentials') setDriverError({ type: 'pin', msg: 'Incorrect PIN. Contact your admin if you forgot your PIN.' });
      else if (code === 'no_access')      setDriverError({ type: 'general', msg: 'This is not a driver account. Use Admin Login instead.' });
      else                                setDriverError({ type: 'general', msg: 'Unable to reach the server. Check your internet connection.' });
    } finally {
      setDriverLoading(false);
    }
  };

  const handleAdminLogin = async () => {
    setAdminError('');
    const inputEmail = email.trim().toLowerCase();
    const inputPass  = password.trim();
    if (!inputEmail || !inputPass) { setAdminError('Please enter your email and password.'); return; }

    setAdminLoading(true);
    try {
      /* Admin, Operation Manager, CSR and Viewer are all Supabase Auth users now — one call.
         Which role you get comes from your row in the `profiles` table, not from this code. */
      const session = await signInStaff(inputEmail, inputPass);
      await onAdminLogin(session);
    } catch (e) {
      console.error('[signInStaff] error:', e);
      const code = e instanceof LoginError ? e.code : 'network';
      if (code === 'invalid_credentials') setAdminError('Invalid email or password.');
      else if (code === 'no_access')      setAdminError('This account does not have access to the admin portal. Contact the Operation Manager.');
      else                                setAdminError('Unable to reach the server. Check your internet connection.');
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
              <p className="text-base text-muted-foreground text-center">
                Welcome Back, Please enter your details
              </p>
            </div>

            {/* ══ DRIVER / ADMIN SEGMENTED TOGGLE ══
                Replaces the old blue "Admin Login" / "← Back" footer buttons. The click
                handlers carry over the exact same state resets those buttons did, so
                switching tabs still clears the other form's fields and errors. */}
            <div className="flex p-1.5 bg-[#f3f4f6] rounded-2xl">
              <button
                type="button"
                onClick={() => { setView('driver'); setDriverError(null); }}
                className={`flex-1 py-3 rounded-xl text-base transition-all duration-200 ${
                  view === 'driver'
                    ? 'bg-white shadow-sm font-bold text-foreground'
                    : 'font-semibold text-gray-500 hover:text-foreground'
                }`}
              >
                Driver
              </button>
              <button
                type="button"
                onClick={() => { setView('admin'); setAdminError(''); setEmail(''); setPassword(''); }}
                className={`flex-1 py-3 rounded-xl text-base transition-all duration-200 ${
                  view === 'admin'
                    ? 'bg-white shadow-sm font-bold text-foreground'
                    : 'font-semibold text-gray-500 hover:text-foreground'
                }`}
              >
                Admin
              </button>
            </div>

            {/* ══ DRIVER LOGIN ══ */}
            {view === 'driver' && (
              <div className="space-y-5">

                <div className="space-y-2.5">
                  <label className="text-base font-semibold text-foreground block">Mobile Number</label>
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
                      aria-describedby={mobileStartsWrong ? 'driver-mobile-start-help' : undefined}
                      placeholder="9XX XXX XXXX"
                      maxLength={10}
                      onKeyDown={(e) => e.key === 'Enter' && handleDriverLogin()}
                      className="min-w-0 flex-1 px-2 sm:px-4 py-4 bg-transparent text-sm sm:text-base text-foreground placeholder:text-muted-foreground focus:outline-none tracking-wider"
                    />
                    {/* Character counter */}
                    <span className={`shrink-0 px-2 sm:px-4 text-xs sm:text-sm font-semibold tabular-nums ${
                      mobileStartsWrong ? 'text-red-600' : mobile.length === 10 ? 'text-green-600' : 'text-muted-foreground'
                    }`}>
                      {mobile.length}/10
                    </span>
                    </div>
                    <p id="driver-mobile-start-help" aria-live="polite" className="mt-1 min-h-4 text-xs leading-4 text-red-600 break-words">
                      {mobileStartsWrong ? 'Mobile number must start with 9' : ''}
                    </p>
                  </div>
                </div>

                {!mobileStartsWrong && (driverError?.type === 'mobile' || driverError?.type === 'mobile_and_pin') && (
                  <ErrorBanner icon={Phone} title="Mobile Number Not Found" sub={driverError.msg} />
                )}

                <div className="space-y-2.5">
                  <label className="text-base font-semibold text-foreground block">4-Digit PIN</label>
                  <div className="flex w-full max-w-full justify-center gap-2 sm:gap-4">
                    {pin.map((digit, i) => (
                      <input
                        key={i} ref={pinRefs[i]}
                        type="password" inputMode="numeric" maxLength={1} value={digit}
                        onChange={(e) => handlePin(i, e.target.value)}
                        onKeyDown={(e) => handlePinKey(i, e)}
                        className={`min-w-0 w-full max-w-[64px] flex-1 h-[60px] text-center text-2xl font-bold border-0 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all ${
                          driverError?.type === 'pin' || driverError?.type === 'mobile_and_pin'
                            ? 'bg-red-100 ring-2 ring-red-300'
                            : digit ? 'bg-primary/20 text-primary' : 'bg-[#e5e7eb]'
                        }`}
                      />
                    ))}
                  </div>
                </div>

                {driverError?.type === 'pin' && (
                  <ErrorBanner icon={KeySquare} title="Incorrect PIN" sub={driverError.msg} />
                )}
                {driverError?.type === 'general' && (
                  <div className="flex items-center gap-2 text-red-600 text-sm">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" /> {driverError.msg}
                  </div>
                )}

                <button
                  onClick={handleDriverLogin}
                  disabled={driverLoading}
                  className="w-full py-5 bg-[#10b981] text-white rounded-2xl hover:bg-[#059669] transition-colors shadow-lg font-bold text-xl disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {driverLoading ? <><Loader2 className="w-5 h-5 animate-spin" /> Verifying…</> : 'Log In'}
                </button>

                {/* "Reset PIN" opens an informational dialog only — there is no self-service
                    reset in this system, so the link must not imply one. */}
                <div className="text-center text-sm text-gray-500">
                  Forgot your PIN?{' '}
                  <button
                    type="button"
                    onClick={() => setShowPinHelp(true)}
                    className="text-[#10b981] font-semibold underline underline-offset-2 hover:text-[#059669] transition-colors"
                  >
                    Reset PIN
                  </button>
                </div>
              </div>
            )}

            {/* ══ ADMIN LOGIN ══ */}
            {view === 'admin' && (
              <div className="space-y-5">

                <div className="space-y-2">
                  <label className="text-base font-semibold text-foreground block">Company Email</label>
                  <input
                    type="email" value={email}
                    onChange={(e) => { setEmail(e.target.value); setAdminError(''); }}
                    placeholder="e.g. 360logistics@email.ph"
                    onKeyDown={(e) => e.key === 'Enter' && handleAdminLogin()}
                    className="w-full px-4 py-4 text-base bg-[#f9fafb] border border-[#e5e7eb] rounded-2xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-base font-semibold text-foreground block">Password</label>
                  <div className="relative">
                    <input
                      type={showPass ? 'text' : 'password'} value={password}
                      onChange={(e) => { setPassword(e.target.value); setAdminError(''); }}
                      placeholder="Enter password"
                      onKeyDown={(e) => e.key === 'Enter' && handleAdminLogin()}
                      className="w-full px-4 py-4 text-base bg-[#f9fafb] border border-[#e5e7eb] rounded-2xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all pr-12"
                    />
                    <button
                      type="button" onClick={() => setShowPass(!showPass)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showPass ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                {adminError && (
                  <div className="flex items-center gap-2 text-red-600 text-sm">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" /> <span>{adminError}</span>
                  </div>
                )}

                <button
                  onClick={handleAdminLogin} disabled={adminLoading}
                  className="w-full py-5 bg-[#10b981] text-white rounded-2xl hover:bg-[#059669] transition-colors shadow-lg font-bold text-xl disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {adminLoading ? <><Loader2 className="w-5 h-5 animate-spin" /> Signing in…</> : 'Log In'}
                </button>
              </div>
            )}
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
              aria-label="Close"
              className="absolute right-4 top-4 p-1.5 rounded-lg text-muted-foreground hover:bg-gray-100 hover:text-foreground transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-14 h-14 rounded-full bg-[#10b981]/10 flex items-center justify-center mx-auto mb-4">
              <Phone className="w-7 h-7 text-[#10b981]" />
            </div>

            <h3 id="pin-help-title" className="text-xl font-bold text-foreground">
              Forgot your PIN?
            </h3>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              Your PIN can only be reset by dispatch. Give them a call and they&apos;ll
              regenerate it for you.
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
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
