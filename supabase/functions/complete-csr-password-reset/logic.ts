// REQ-006 — the decision logic of the complete-csr-password-reset Edge Function.
// Kept free of Deno/npm imports so it can be unit-tested with Node
// (logic.test.cjs). index.ts wires it to Supabase.
//
// Never logs, returns or stores the password or the token. The token is hashed
// (SHA-256) before it is sent anywhere; only the hash reaches the database.

export const MIN_PASSWORD_LENGTH = 6;   // = create_team_member() and the app's UI rule
export const MAX_PASSWORD_BYTES = 72;   // bcrypt ignores anything past 72 bytes
export const TOKEN_PATTERN = /^[0-9a-f]{64}$/;   // create_csr_password_reset_link(): 32 random bytes, hex
export const MAX_BODY_BYTES = 4096;

export type ResetError =
  | 'invalid_request'
  | 'reset_link_invalid_or_expired'
  | 'password_too_short'
  | 'password_too_long'
  | 'weak_password'
  | 'reset_failed';

export interface ResetResult {
  status: number;
  body: { ok: true } | { error: ResetError };
}

/** What Auth said when asked to change the password. `definitive` = Auth refused
 *  the request itself (4xx), so the password certainly did not change. */
export type SetPasswordOutcome = { ok: true } | { ok: false; definitive: boolean; code?: string };

export interface ResetDeps {
  claim(tokenHash: string): Promise<{ requestId: string; userId: string } | null>;
  setPassword(userId: string, password: string): Promise<SetPasswordOutcome>;
  release(requestId: string, tokenHash: string): Promise<void>;
  finish(requestId: string, tokenHash: string): Promise<void>;
  /** Server-side diagnostics. Receives only fixed event names and error codes. */
  log(event: string, detail?: string): void;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function validateRequest(body: unknown):
  { ok: true; token: string; password: string } | { ok: false; error: ResetError } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, error: 'invalid_request' };
  const { token, newPassword } = body as Record<string, unknown>;
  if (typeof token !== 'string' || typeof newPassword !== 'string') return { ok: false, error: 'invalid_request' };
  // A malformed token is reported exactly like an unknown or expired one.
  if (!TOKEN_PATTERN.test(token)) return { ok: false, error: 'reset_link_invalid_or_expired' };
  if (newPassword.trim().length === 0 || newPassword.length < MIN_PASSWORD_LENGTH) return { ok: false, error: 'password_too_short' };
  if (new TextEncoder().encode(newPassword).length > MAX_PASSWORD_BYTES) return { ok: false, error: 'password_too_long' };
  return { ok: true, token, password: newPassword };
}

export async function completeReset(body: unknown, deps: ResetDeps): Promise<ResetResult> {
  const input = validateRequest(body);
  if (!input.ok) return { status: 400, body: { error: input.error } };

  const tokenHash = await sha256Hex(input.token);

  // 1. One-time claim — atomic in the database; a replay or a parallel request gets null.
  const claimed = await deps.claim(tokenHash);
  if (!claimed) return { status: 400, body: { error: 'reset_link_invalid_or_expired' } };

  // 2. The password change itself, through the Auth Admin API.
  let outcome: SetPasswordOutcome;
  try {
    outcome = await deps.setPassword(claimed.userId, input.password);
  } catch {
    outcome = { ok: false, definitive: false };
  }

  if (!outcome.ok) {
    if (outcome.definitive) {
      // Auth refused it (e.g. its own strength rules): nothing changed, so the
      // CSR may try another password with the same link.
      try { await deps.release(claimed.requestId, tokenHash); } catch { deps.log('release_failed'); }
      deps.log('password_rejected_by_auth', outcome.code);
      return { status: 400, body: { error: outcome.code === 'weak_password' ? 'weak_password' : 'invalid_request' } };
    }
    // Unknown result (network/5xx): the link stays used. OPM copies a new one.
    deps.log('password_update_failed', outcome.code);
    return { status: 502, body: { error: 'reset_failed' } };
  }

  // 3. Mark the request completed. The password already changed, so report
  //    success even if this bookkeeping fails twice — the claimed link can't be
  //    used again either way, and the request lapses at its 45-minute expiry.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { await deps.finish(claimed.requestId, tokenHash); return { status: 200, body: { ok: true } }; }
    catch { deps.log('finish_failed', String(attempt)); }
  }
  return { status: 200, body: { ok: true } };
}
