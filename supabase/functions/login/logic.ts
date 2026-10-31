// @ts-nocheck — runs on Deno; typed and tested via logic.test.cjs.
// Login lockout — the decision logic of the `login` Edge Function.
// Kept free of Deno/npm imports so Node can unit-test it (logic.test.cjs);
// index.ts wires it to Supabase. The 5-failure / 5-minute rule itself lives in
// the database (record_login_failure) so the count is atomic.
//
// Never logs, returns or stores the password.

export const MAX_BODY_BYTES = 2048;
export const MAX_EMAIL_LENGTH = 320;
export const MAX_PASSWORD_LENGTH = 200;

export type LoginErrorCode = 'invalid_request' | 'invalid_credentials' | 'locked' | 'rate_limited' | 'server';

export interface LoginResult {
  status: number;
  body:
    | { session: { access_token: string; refresh_token: string } }
    | { error: LoginErrorCode; retryAfterSeconds?: number };
}

export type SignInOutcome =
  | { ok: true; session: { access_token: string; refresh_token: string } }
  | { ok: false; kind: 'invalid' | 'rate_limited' | 'error' };

export interface LoginDeps {
  /** Seconds left on the account's lock; 0 = not locked. Throws if it cannot be read. */
  lockSeconds(email: string): Promise<number>;
  signIn(email: string, password: string): Promise<SignInOutcome>;
  /** Counts the failure; returns the lock's remaining seconds (0 = not locked yet). */
  recordFailure(email: string): Promise<number>;
  recordSuccess(email: string): Promise<void>;
  /** Server-side diagnostics. Receives only fixed event names. */
  log(event: string, detail?: string): void;
}

export function validateRequest(body: unknown):
  { ok: true; email: string; password: string } | { ok: false } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false };
  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== 'string' || typeof password !== 'string') return { ok: false };
  const normalized = email.trim().toLowerCase();
  if (normalized.length < 3 || normalized.length > MAX_EMAIL_LENGTH) return { ok: false };
  if (password.length === 0 || password.length > MAX_PASSWORD_LENGTH) return { ok: false };
  return { ok: true, email: normalized, password };
}

const locked = (seconds: number): LoginResult =>
  ({ status: 429, body: { error: 'locked', retryAfterSeconds: Math.max(1, Math.ceil(seconds)) } });

export async function login(body: unknown, deps: LoginDeps): Promise<LoginResult> {
  const request = validateRequest(body);
  if (!request.ok) return { status: 400, body: { error: 'invalid_request' } };
  const { email, password } = request;

  // While locked, even the right password is refused. If the lock cannot be
  // checked, refuse too — failing open would switch the protection off.
  let remaining: number;
  try { remaining = await deps.lockSeconds(email); }
  catch { deps.log('lock_check_failed'); return { status: 500, body: { error: 'server' } }; }
  if (remaining > 0) return locked(remaining);

  const outcome = await deps.signIn(email, password);

  if (outcome.ok) {
    // Clearing the counter must never fail a login that already succeeded.
    try { await deps.recordSuccess(email); } catch { deps.log('record_success_failed'); }
    return { status: 200, body: { session: outcome.session } };
  }
  if (outcome.kind === 'rate_limited') return { status: 429, body: { error: 'rate_limited' } };
  if (outcome.kind === 'error') { deps.log('sign_in_error'); return { status: 502, body: { error: 'server' } }; }

  try {
    remaining = await deps.recordFailure(email);
  } catch {
    deps.log('record_failure_failed');
    return { status: 401, body: { error: 'invalid_credentials' } };
  }
  return remaining > 0 ? locked(remaining) : { status: 401, body: { error: 'invalid_credentials' } };
}
