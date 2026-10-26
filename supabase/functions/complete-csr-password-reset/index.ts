// @ts-nocheck — this file runs on Deno (npm: imports, the Deno global), which the
// project's TypeScript check (src/ only) doesn't cover.
//
// REQ-006 — complete-csr-password-reset
// Called by the logged-out /reset-password page with { token, newPassword }.
// Runs server-side with the service-role key, which Supabase injects into every
// Edge Function as SUPABASE_SERVICE_ROLE_KEY — it never reaches the browser.
// The rules live in logic.ts; this file only connects them to Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2.98.0';
import { completeReset, MAX_BODY_BYTES } from './logic.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Browser origins allowed to call this function, e.g.
//   https://360logisticsph.site,http://localhost:5173
const allowedOrigins = (Deno.env.get('RESET_ALLOWED_ORIGINS') ?? '')
  .split(',').map((o) => o.trim()).filter(Boolean);

function headers(origin: string | null): Headers {
  const h = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' });
  if (origin && allowedOrigins.includes(origin)) {
    h.set('Access-Control-Allow-Origin', origin);
    h.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    h.set('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info');
  }
  return h;
}

const reply = (status: number, body: unknown, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: headers(origin) });

const deps = {
  async claim(tokenHash: string) {
    const { data, error } = await admin.rpc('claim_csr_password_reset', { p_token_hash: tokenHash });
    if (error) throw new Error('claim_failed');
    const row = Array.isArray(data) ? data[0] : null;
    return row ? { requestId: row.request_id, userId: row.target_user_id } : null;
  },
  async passwordMatches(requestId: string, tokenHash: string, password: string) {
    const { data, error } = await admin.rpc('csr_password_reset_password_matches', {
      p_request_id: requestId, p_token_hash: tokenHash, p_password: password,
    });
    if (error || typeof data !== 'boolean') throw new Error('reuse_check_failed');
    return data;
  },
  async setPassword(userId: string, password: string) {
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (!error) return { ok: true };
    const status = Number(error.status ?? 0);
    return { ok: false, definitive: status >= 400 && status < 500, code: error.code };
  },
  async release(requestId: string, tokenHash: string) {
    const { error } = await admin.rpc('release_csr_password_reset_claim', { p_request_id: requestId, p_token_hash: tokenHash });
    if (error) throw new Error('release_failed');
  },
  async finish(requestId: string, tokenHash: string) {
    const { error } = await admin.rpc('finish_csr_password_reset', { p_request_id: requestId, p_token_hash: tokenHash });
    if (error) throw new Error('finish_failed');
  },
  // Only fixed event names / Auth error codes — never the body, token or password.
  log(event: string, detail?: string) {
    console.error(JSON.stringify({ fn: 'complete-csr-password-reset', event, detail: detail ?? null }));
  },
};

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(origin) });
  if (req.method !== 'POST') return reply(405, { error: 'invalid_request' }, origin);

  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return reply(400, { error: 'invalid_request' }, origin);
    body = JSON.parse(text);
  } catch {
    return reply(400, { error: 'invalid_request' }, origin);
  }

  try {
    const result = await completeReset(body, deps);
    return reply(result.status, result.body, origin);
  } catch {
    deps.log('unexpected_error');
    return reply(500, { error: 'reset_failed' }, origin);
  }
});
