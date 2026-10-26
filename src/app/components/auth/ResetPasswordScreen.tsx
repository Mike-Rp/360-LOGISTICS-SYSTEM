import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import imgLogo from 'figma:asset/5e73e3c08e898d68c86717993c6e7442d03e9ac4.png';
import { completeCsrPasswordReset } from '../../lib/db';
import { clearResetTokenFromHistory, resetLoginHref } from '../../lib/resetLoginNavigation';
import { clearResetPasswordFeedback, resetPasswordFeedback, validateResetPassword, type ResetPasswordFeedback } from '../../lib/resetPasswordFeedback';

export default function ResetPasswordScreen() {
  const token = new URLSearchParams(window.location.search).get('token');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<ResetPasswordFeedback | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || done || !token) return;
    const validationError = validateResetPassword(password, confirmation);
    if (validationError) { setError(validationError); return; }
    setBusy(true);
    setError(null);
    try {
      await completeCsrPasswordReset(token, password);
      setDone(true);
      setPassword('');
      setConfirmation('');
      window.history.replaceState(window.history.state, '', '/reset-password');
    } catch (reason) {
      setError(resetPasswordFeedback(reason instanceof Error ? reason.message : 'reset_failed'));
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
                <input id="new-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="Enter your new password" value={password}
                  onChange={(event) => { setPassword(event.target.value); setError((previous) => clearResetPasswordFeedback(previous, 'new')); }}
                  aria-invalid={error?.field === 'new' || undefined} aria-describedby={error?.field === 'new' ? 'new-password-error' : undefined}
                  className={`min-h-12 w-full rounded-xl border pl-3 pr-10 text-base placeholder:text-sm placeholder:text-muted-foreground sm:pl-4 sm:pr-12 sm:placeholder:text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${error?.field === 'new' ? 'border-red-500 bg-red-50/40' : ''}`} />
                <button type="button" onClick={() => setShowPassword((shown) => !shown)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-1 top-1 grid h-10 w-10 place-items-center rounded-lg focus-visible:outline-2 focus-visible:outline-primary">{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button>
              </div>
              {error?.field === 'new' && <p id="new-password-error" role="alert" className="mt-1.5 text-sm text-red-700">{error.message}</p>}
            </div>
            <div>
              <label htmlFor="confirm-password" className="mb-1 block text-sm font-medium">Confirm Password</label>
              <div className="relative">
                <input id="confirm-password" type={showConfirmation ? 'text' : 'password'} autoComplete="new-password" placeholder="Re-enter your new password" value={confirmation}
                  onChange={(event) => { setConfirmation(event.target.value); setError((previous) => clearResetPasswordFeedback(previous, 'confirm')); }}
                  aria-invalid={error?.field === 'confirm' || undefined} aria-describedby={error?.field === 'confirm' ? 'confirm-password-error' : undefined}
                  className={`min-h-12 w-full rounded-xl border pl-3 pr-10 text-base placeholder:text-sm placeholder:text-muted-foreground sm:pl-4 sm:pr-12 sm:placeholder:text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${error?.field === 'confirm' ? 'border-red-500 bg-red-50/40' : ''}`} />
                <button type="button" onClick={() => setShowConfirmation((shown) => !shown)} aria-label={showConfirmation ? 'Hide password' : 'Show password'} className="absolute right-1 top-1 grid h-10 w-10 place-items-center rounded-lg focus-visible:outline-2 focus-visible:outline-primary">{showConfirmation ? <EyeOff size={19} /> : <Eye size={19} />}</button>
              </div>
              {error?.field === 'confirm' && <p id="confirm-password-error" role="alert" className="mt-1.5 text-sm text-red-700">{error.message}</p>}
            </div>
            {error?.field === 'general' && <p role="alert" className="text-sm text-red-700">{error.message}</p>}
            <button type="submit" disabled={busy} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 font-semibold text-white disabled:opacity-50">{busy ? <><Loader2 size={18} className="animate-spin" /> Saving…</> : 'Save New Password'}</button>
          </form>}
      </>}
      <a href={resetLoginHref} onClick={clearResetTokenFromHistory} className="mt-5 block text-center text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary">Back to Login</a>
    </section>
  </main>;
}
