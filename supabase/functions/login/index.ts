// @ts-nocheck — this file runs on Deno (npm: imports, the Deno global), which the
// project's TypeScript check (src/ only) doesn't cover.
//
// login — the sign-in path for staff AND drivers, with an account lockout:
// 5 failed attempts lock the account for 5 minutes (see the logic.ts header and
// supabase/migrations/20261031000000_login_lockout.sql).
// Called by the logged-out login screen with { email, password }; on success it
// returns the Auth session, which the browser installs with auth.setSession().
// The service-role key (injected by Supabase) is used only for the lockout RPCs;
// the password check itself uses the public anon key, exactly as the browser did.
import { createClient } from 'npm:@supabase/supabase-js@2.98.0';
import { login, MAX_BODY_BYTES } from './logic.ts';

const url = Deno.env.get('SUPABASE_URL');
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const authClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Browser origins allowed to call this function — shares the password-reset
// function's secret unless LOGIN_ALLOWED_ORIGINS is set.
const allowedOrigins = (Deno.env.get('LOGIN_ALLOWED_ORIGINS') ?? Deno.env.get('RESET_ALLOWED_ORIGINS') ?? '')
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
  async lockSeconds(email: string) {
    const { data, error } = await admin.rpc('login_lock_seconds', { p_email: email });
    if (error || typeof data !== 'number') throw new Error('lock_check_failed');
    return data;
  },
  async signIn(email: string, password: string) {
    const { data, error } = await authClient.auth.signInWithPassword({ email, password });
    if (!error && data.session) {
      return { ok: true, session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token } };
    }
    const status = Number(error?.status ?? 0);
    if (status === 429) return { ok: false, kind: 'rate_limited' };
    if (status >= 500 || !error) return { ok: false, kind: 'error' };
    if (status === 400 || status === 401 || error.code === 'invalid_credentials') return { ok: false, kind: 'invalid' };
    return { ok: false, kind: 'error' };
  },
  async recordFailure(email: string) {
    const { data, error } = await admin.rpc('record_login_failure', { p_email: email });
    if (error || typeof data !== 'number') throw new Error('record_failure_failed');
    return data;
  },
  async recordSuccess(email: string) {
    const { error } = await admin.rpc('record_login_success', { p_email: email });
    if (error) throw new Error('record_success_failed');
  },
  // Only fixed event names — never the body, email or password.
  log(event: string, detail?: string) {
    console.error(JSON.stringify({ fn: 'login', event, detail: detail ?? null }));
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
    const result = await login(body, deps);
    return reply(result.status, result.body, origin);
  } catch {
    deps.log('unexpected_error');
    return reply(500, { error: 'server' }, origin);
  }
});
