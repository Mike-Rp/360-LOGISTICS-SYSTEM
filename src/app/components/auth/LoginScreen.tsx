import { useState, useRef } from 'react';
import imgLogo from 'figma:asset/5e73e3c08e898d68c86717993c6e7442d03e9ac4.png';
import { Eye, EyeOff, AlertCircle, Phone, KeySquare, Loader2 } from 'lucide-react';
import { signInStaff, signInDriver, LoginError } from '../../lib/db';
import type { StaffSession } from '../../lib/db';

interface Props {
  onAdminLogin:  (session: StaffSession) => void | Promise<void>;
  onDriverLogin: (info: { id: string; name: string }) => void;
}

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
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'linear-gradient(153deg, #f0fdf4 0%, #eff6ff 50%, #ffffff 100%)' }}
    >
      <div className="w-full max-w-[420px]">
        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
          <div className="px-7 sm:px-9 pt-9 pb-7 space-y-7">

            {/* Logo */}
            <div className="flex flex-col items-center gap-3">
              <img src={imgLogo} alt="360 Logistics" className="h-16 object-contain" />
              <p className="text-base text-muted-foreground text-center">
                Trucking Operations &amp; Delivery Tracking
              </p>
            </div>

            {/* ══ DRIVER LOGIN ══ */}
            {view === 'driver' && (
              <div className="space-y-5">

                <div className="space-y-2.5">
                  <label className="text-base font-semibold text-foreground block">Mobile Number</label>
                  <div className={`flex items-center rounded-2xl border overflow-hidden focus-within:ring-2 focus-within:ring-primary/30 transition-all ${
                    driverError?.type === 'mobile' || driverError?.type === 'mobile_and_pin' ? 'border-red-400 bg-red-50' : 'border-[#e5e7eb] bg-[#f9fafb]'
                  }`}>
                    {/* Country prefix badge */}
                    <span className="px-4 py-4 bg-gray-100 border-r border-[#e5e7eb] text-base font-bold text-foreground select-none whitespace-nowrap flex-shrink-0">
                      +63
                    </span>
                    {/* 10-digit input starting with 9 */}
                    <input
                      type="tel"
                      inputMode="numeric"
                      value={mobile}
                      onChange={(e) => handleMobile(e.target.value)}
                      placeholder="9XX XXX XXXX"
                      maxLength={10}
                      onKeyDown={(e) => e.key === 'Enter' && handleDriverLogin()}
                      className="flex-1 px-4 py-4 bg-transparent text-base text-foreground placeholder:text-muted-foreground focus:outline-none tracking-wider"
                    />
                    {/* Character counter */}
                    <span className={`px-4 text-sm font-semibold tabular-nums flex-shrink-0 ${
                      mobile.length === 10 ? 'text-green-600' : 'text-muted-foreground'
                    }`}>
                      {mobile.length}/10
                    </span>
                  </div>
                </div>

                {(driverError?.type === 'mobile' || driverError?.type === 'mobile_and_pin') && (
                  <ErrorBanner icon={Phone} title="Mobile Number Not Found" sub={driverError.msg} />
                )}

                <div className="space-y-2.5">
                  <label className="text-base font-semibold text-foreground block">4-Digit PIN</label>
                  <div className="flex justify-center gap-4">
                    {pin.map((digit, i) => (
                      <input
                        key={i} ref={pinRefs[i]}
                        type="password" inputMode="numeric" maxLength={1} value={digit}
                        onChange={(e) => handlePin(i, e.target.value)}
                        onKeyDown={(e) => handlePinKey(i, e)}
                        className={`w-[64px] h-[60px] text-center text-2xl font-bold border-0 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all ${
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

                {/* Static "Forgot PIN" — no self-service, call dispatch */}
                <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
                  <Phone className="w-4 h-4 flex-shrink-0" />
                  <span>Forgot your PIN? Call dispatch to reset it.</span>
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
                    placeholder="Enter email"
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

          {/* Footer toggle */}
          <div className="border-t border-[#e5e7eb] px-7 sm:px-9 py-5">
            {view === 'driver' ? (
              <button
                onClick={() => { setView('admin'); setAdminError(''); setEmail(''); setPassword(''); }}
                className="w-full py-3 bg-[#2290fa] text-white rounded-2xl hover:bg-blue-600 transition-colors shadow-md font-semibold text-base"
              >
                Admin Login
              </button>
            ) : (
              <button
                onClick={() => { setView('driver'); setDriverError(null); }}
                className="w-full py-3 bg-[#2290fa] text-white rounded-2xl hover:bg-blue-600 transition-colors shadow-md font-semibold text-base"
              >
                ← Back
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
