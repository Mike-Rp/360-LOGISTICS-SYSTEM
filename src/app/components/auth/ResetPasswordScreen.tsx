import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import imgLogo from 'figma:asset/5e73e3c08e898d68c86717993c6e7442d03e9ac4.png';
import { completeCsrPasswordReset } from '../../lib/db';

const feedback: Record<string, string> = {
  reset_link_invalid_or_expired: 'This reset link is invalid or has expired. Ask your OPM administrator for a new reset link.',
  password_too_short: 'Password is too short.',
  password_too_long: 'Password is too long.',
  weak_password: 'Choose a stronger password.',
  invalid_request: 'This reset link is invalid or incomplete.',
  reset_failed: 'Password could not be changed. Please try again or request a new link.',
};

export default function ResetPasswordScreen() {
  const token = new URLSearchParams(window.location.search).get('token');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || done || !token) return;
    if (!password) { setError('Enter a new password.'); return; }
    if (password.length < 6) { setError('Password is too short.'); return; }
    if (new TextEncoder().encode(password).length > 72) { setError('Password is too long.'); return; }
    if (password !== confirmation) { setError('Passwords do not match.'); return; }
    setBusy(true);
    setError('');
    try {
      await completeCsrPasswordReset(token, password);
      setDone(true);
      setPassword('');
      setConfirmation('');
      window.history.replaceState(window.history.state, '', '/reset-password');
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : 'reset_failed';
      setError(feedback[code] ?? feedback.reset_failed);
    } finally {
      setBusy(false);
    }
  };

  return <main className="min-h-dvh bg-gradient-to-br from-green-50 to-blue-50 px-4 py-8 flex items-center justify-center">
    <section className="w-full max-w-md rounded-2xl bg-white p-6 sm:p-8 shadow-xl" aria-labelledby="reset-title">
      <img src={imgLogo} alt="360 Logistics" className="mx-auto mb-6 h-16 w-auto max-w-full object-contain" />
      {done ? <>
        <h1 id="reset-title" className="text-2xl font-semibold text-center">Password successfully changed</h1>
        <p className="mt-3 text-center text-sm text-muted-foreground">You can now sign in using your new password.</p>
      </> : <>
        <h1 id="reset-title" className="text-2xl font-semibold text-center">Create New Password</h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">Enter a new password for your CSR account.</p>
        {!token ? <p role="alert" className="mt-6 text-sm text-red-700">This reset link is invalid or incomplete.</p> :
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="new-password" className="mb-1 block text-sm font-medium">New Password</label>
              <div className="relative">
                <input id="new-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="min-h-12 w-full rounded-xl border px-4 pr-12 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
                <button type="button" onClick={() => setShowPassword((shown) => !shown)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-1 top-1 grid h-10 w-10 place-items-center rounded-lg focus-visible:outline-2 focus-visible:outline-primary">{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button>
              </div>
            </div>
            <div>
              <label htmlFor="confirm-password" className="mb-1 block text-sm font-medium">Confirm Password</label>
              <div className="relative">
                <input id="confirm-password" type={showConfirmation ? 'text' : 'password'} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="min-h-12 w-full rounded-xl border px-4 pr-12 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
                <button type="button" onClick={() => setShowConfirmation((shown) => !shown)} aria-label={showConfirmation ? 'Hide password' : 'Show password'} className="absolute right-1 top-1 grid h-10 w-10 place-items-center rounded-lg focus-visible:outline-2 focus-visible:outline-primary">{showConfirmation ? <EyeOff size={19} /> : <Eye size={19} />}</button>
              </div>
            </div>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <button type="submit" disabled={busy} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 font-semibold text-white disabled:opacity-50">{busy ? <><Loader2 size={18} className="animate-spin" /> Saving…</> : 'Save New Password'}</button>
          </form>}
      </>}
      <a href="/login?account=staff" className="mt-5 block text-center text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary">Back to Login</a>
    </section>
  </main>;
}
