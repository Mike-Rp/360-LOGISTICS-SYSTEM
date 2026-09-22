import { useState, useEffect } from 'react';
import { KeyRound, AlertTriangle } from 'lucide-react';
import { verifyOwnPassword, AssignmentActionError } from '../../lib/db';

/* Failed password attempts are counted per browser tab and survive closing/reopening
   the dialog. Supabase Auth also rate-limits sign-ins on its own servers. */
const MAX_FAILS   = 3;
const COOLDOWN_MS = 30_000;
let fails       = 0;
let lockedUntil = 0;

/* Confirmation dialog for account actions (archive driver, new PIN, archive truck).
   With `requirePassword`, the signed-in admin re-enters their own password first; it is
   checked by Supabase Auth (verifyOwnPassword) and never stored, logged or compared here.
   `onConfirm` runs only after that succeeds; if it throws, `errorText` turns the error
   into the message shown in the dialog. */
export default function ConfirmPasswordDialog({
  title, message, confirmLabel, busyLabel = 'Working…', tone = 'danger', requirePassword = true,
  onConfirm, onCancel, errorText, blockedReason,
}: {
  /* When set, the action can't run at all: shown as a notice, confirm disabled, no password asked */
  blockedReason?: string;
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  tone?: 'danger' | 'primary';
  requirePassword?: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  errorText: (err: unknown) => string;
}) {
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [busy,     setBusy]     = useState(false);
  const [now,      setNow]      = useState(Date.now());

  /* Tick once a second so the cooldown counts down */
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const lockedFor = requirePassword ? Math.max(0, Math.ceil((lockedUntil - now) / 1000)) : 0;

  const handleConfirm = async () => {
    if (busy || blockedReason || lockedFor > 0 || (requirePassword && !password)) return;
    setBusy(true);
    setError('');
    const typed = password;
    setPassword('');                     // don't keep the password in state any longer than needed
    try {
      if (requirePassword) {
        try {
          await verifyOwnPassword(typed);
        } catch (err) {
          if (err instanceof AssignmentActionError && err.code === 'wrong_password') {
            fails += 1;
            if (fails >= MAX_FAILS) {
              fails = 0;
              lockedUntil = Date.now() + COOLDOWN_MS;
              setNow(Date.now());
              setError(`Too many failed attempts. Try again in ${COOLDOWN_MS / 1000} seconds.`);
            } else {
              const left = MAX_FAILS - fails;
              setError(`Incorrect password. ${left} attempt${left === 1 ? '' : 's'} left.`);
            }
            return;
          }
          throw err;
        }
        fails = 0;
      }
      await onConfirm();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const danger = tone === 'danger';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { if (!busy) onCancel(); }} />
      <form
        onSubmit={(e) => { e.preventDefault(); void handleConfirm(); }}
        className="relative bg-white rounded-2xl border border-border shadow-2xl p-5 w-full max-w-[360px] animate-in fade-in zoom-in-95 duration-200">
        <div className={`w-11 h-11 rounded-full flex items-center justify-center mx-auto mb-3 border ${
          danger ? 'bg-red-50 border-red-100' : 'bg-[#1DBF73]/10 border-[#1DBF73]/25'}`}>
          {requirePassword
            ? <KeyRound className={`w-5 h-5 ${danger ? 'text-red-600' : 'text-[#1DBF73]'}`} />
            : <AlertTriangle className={`w-5 h-5 ${danger ? 'text-red-600' : 'text-[#1DBF73]'}`} />}
        </div>
        <p className="text-base font-semibold text-foreground text-center">{title}</p>
        <div className="text-sm text-muted-foreground text-center mt-1.5 break-words">{message}</div>

        {blockedReason && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 mt-4">
            <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800 break-words">{blockedReason}</p>
          </div>
        )}

        {requirePassword && !blockedReason && (
          <>
            <label className="block text-xs font-medium text-foreground mt-4 mb-1.5">Your account password</label>
            <input type="password" autoFocus autoComplete="current-password" value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              disabled={busy || lockedFor > 0}
              placeholder="Password"
              className={`w-full px-3.5 py-2.5 rounded-[10px] border text-sm focus:outline-none focus:ring-2 focus:ring-[#1DBF73]/25 focus:border-[#1DBF73] disabled:opacity-60 ${
                error ? 'border-red-400 bg-red-50' : 'border-border bg-white'}`} />
          </>
        )}

        {(error || lockedFor > 0) && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-2 break-words">
            {lockedFor > 0 ? `Too many failed attempts. Try again in ${lockedFor}s.` : error}
          </p>
        )}

        <div className="flex flex-col-reverse sm:flex-row gap-2 mt-4">
          <button type="button" disabled={busy} onClick={onCancel}
            className="flex-1 py-2.5 border border-border rounded-xl text-sm hover:bg-accent transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button type="submit" disabled={busy || !!blockedReason || lockedFor > 0 || (requirePassword && !password)}
            className={`flex-1 py-2.5 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              danger ? 'bg-red-500 hover:bg-red-600' : 'bg-[#1DBF73] hover:bg-[#19a865]'}`}>
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
