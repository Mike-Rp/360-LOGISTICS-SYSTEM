-- ════════════════════════════════════════════════════════════════════════════
-- REQ-006 revision — OPM-approved, one-time "Copy Reset Link" (no recovery email).
--
-- Applies ON TOP of 20261020000002_csr_password_reset_requests.sql (already live).
-- Manual SQL Editor application only. Shared/production project.
--
-- New flow:
--   CSR Forgot Password → request 'pending'
--   → OPM approves → 'approved', valid 45 minutes from approval (unchanged)
--   → OPM clicks Copy Reset Link → create_csr_password_reset_link() returns a
--     fresh random token ONCE; only its SHA-256 is stored; any earlier link dies
--   → CSR opens /reset-password?token=… and picks a new password
--   → Edge Function complete-csr-password-reset (service role, server-side):
--       claim_csr_password_reset(hash)   — atomic one-time claim
--       Auth Admin API updateUserById    — the actual password change
--       finish_csr_password_reset(…)     — 'completed', completed_at, hash wiped
--
-- What changes here:
--   * NARROWED: enforce_csr_password_reset() (behind the existing deferred trigger
--     enforce_csr_password_reset_at_commit on auth.users) no longer accepts an
--     approval — it now always refuses an active CSR's password change made from a
--     Supabase recovery / magic-link / OTP session, so Supabase's own reset email
--     cannot bypass OPM. The approved path (Admin API) is not affected. No other
--     auth.users trigger or Auth behaviour is touched.
--   * ADDED columns reset_token_hash / reset_token_created_at /
--     reset_token_claimed_at. "Used at" reuses completed_at; link expiry reuses
--     expires_at (the approval window), so regenerating never extends it.
--   * The token hash is never readable through the API (column-level SELECT).
--   * review_csr_password_reset: reject now also revokes an APPROVED request
--     (and its link). request_csr_password_reset: expiring a request also wipes
--     its token. Everything else in both functions is unchanged.
--   * NEW: create_csr_password_reset_link (OPM), claim / release / finish
--     (service_role only — called by the Edge Function, never by the browser).
--
-- Existing rows are kept exactly as they are: the new columns start NULL, so an
-- already-approved request simply has no link yet (OPM can copy one while its
-- 45-minute window is still open).
-- Safe to run once; it fails (and changes nothing) if run a second time.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. Block Supabase recovery / magic-link password resets for active CSRs ──
-- Same narrow scoping as 20261020000002 (verified against github.com/supabase/auth):
-- the trigger fires only for statements that target recovery_token — Auth's
-- UpdatePassword(), never sign-in re-encryption — and runs at COMMIT, after Auth
-- has deleted the user's other sessions (PUT /user keeps only the caller's
-- session; the Admin API keeps none). So a surviving 'otp' / 'magiclink' /
-- 'recovery' session (Auth's own IsRecovery set) means the password was changed
-- FROM such a session — Supabase's self-service reset, which must not bypass OPM.
-- Allowed, because no such session survives or the rule does not apply:
--   * Copy Reset Link → Edge Function → Admin API updateUserById (all sessions removed)
--   * OPM / admin / Dashboard / service-role Admin API password sets
--   * a CSR signed in with their current password (password session survives)
--   * staff other than active CSRs, drivers, sign-in, Recover()/token clean-up
-- The trigger enforce_csr_password_reset_at_commit (deferrable, initially
-- deferred, AFTER UPDATE OF recovery_token ON auth.users) is already live and is
-- kept as is; only its function changes. Its old approval check is gone.
create or replace function public.enforce_csr_password_reset() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.encrypted_password is not distinct from old.encrypted_password then return null; end if;
  if not exists (select 1 from public.profiles
    where id = new.id and role = 'csr' and status = 'active') then return null; end if;
  if exists (select 1 from auth.sessions s
    join auth.mfa_amr_claims c on c.session_id = s.id
    where s.user_id = new.id and c.authentication_method in ('otp', 'magiclink', 'recovery')) then
    raise exception 'csr_password_reset_requires_opm_link' using errcode = '42501';
  end if;
  return null;
end $$;

-- ── 2. Token columns — only a SHA-256 hex digest, never the token itself ──
alter table public.csr_password_reset_requests
  add column reset_token_hash       text,
  add column reset_token_created_at timestamptz,
  add column reset_token_claimed_at timestamptz,
  add constraint csr_password_reset_token_hash_format
    check (reset_token_hash is null or reset_token_hash ~ '^[0-9a-f]{64}$'),
  add constraint csr_password_reset_token_only_when_approved
    check (reset_token_hash is null or status = 'approved');
create unique index csr_password_reset_token_hash_key
  on public.csr_password_reset_requests(reset_token_hash) where reset_token_hash is not null;

-- ── 3. Readers (OPM / the CSR themself, via the existing RLS policies) get every
--      column EXCEPT the token hash and claim marker. ──
revoke select on public.csr_password_reset_requests from authenticated;
grant select (id, user_id, requested_email, status, requested_at, reviewed_by, reviewed_at,
              expires_at, completed_at, reset_token_created_at)
  on public.csr_password_reset_requests to authenticated;

-- ── 4. request_csr_password_reset — unchanged except: expiring also wipes the token ──
create or replace function public.request_csr_password_reset(p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_profile public.profiles%rowtype;
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if length(v_email) > 320 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then return; end if;
  select p.* into v_profile from public.profiles p
    join auth.users u on u.id = p.id
    where lower(p.email) = v_email and lower(u.email) = v_email
      and p.role = 'csr' and p.status = 'active' limit 1;
  if not found then return; end if;
  update public.csr_password_reset_requests
     set status = 'expired', reset_token_hash = null, reset_token_claimed_at = null
    where user_id = v_profile.id and status = 'approved' and expires_at <= now();
  if exists (select 1 from public.csr_password_reset_requests
    where user_id = v_profile.id and status in ('pending', 'approved')) then return; end if;
  if exists (select 1 from public.csr_password_reset_requests
    where user_id = v_profile.id and requested_at > now() - interval '15 minutes') then return; end if;
  insert into public.csr_password_reset_requests(user_id, requested_email)
    values (v_profile.id, v_email);
  insert into public.activity_log(id, type, ts, member_name, member_email)
    values (gen_random_uuid()::text, 'password_reset_requested', now(), v_profile.name, v_email);
exception when unique_violation then
  return;
end $$;

-- ── 5. review_csr_password_reset — approve: pending only (unchanged).
--      Reject: pending OR approved; rejecting an approved request revokes its link. ──
create or replace function public.review_csr_password_reset(p_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_request public.csr_password_reset_requests%rowtype;
  v_reviewer public.profiles%rowtype;
  v_name text;
begin
  if not public.is_opm() then raise exception 'not_authorized' using errcode = '42501'; end if;
  select * into v_request from public.csr_password_reset_requests
    where id = p_id and status in ('pending', 'approved') for update;
  if not found or (p_approve and v_request.status <> 'pending') then
    raise exception 'request_not_pending';
  end if;
  if p_approve and not exists (select 1 from public.profiles p
    join auth.users u on u.id = p.id
    where p.id = v_request.user_id and p.role = 'csr' and p.status = 'active'
      and lower(p.email) = lower(v_request.requested_email)
      and lower(u.email) = lower(v_request.requested_email)) then
    raise exception 'member_not_eligible';
  end if;
  update public.csr_password_reset_requests
    set status = case when p_approve then 'approved' else 'rejected' end,
        reviewed_by = auth.uid(), reviewed_at = now(),
        expires_at = case when p_approve then now() + interval '45 minutes' else null end,
        reset_token_hash = null, reset_token_created_at = null, reset_token_claimed_at = null
    where id = p_id;
  select * into v_reviewer from public.profiles where id = auth.uid();
  select name into v_name from public.profiles where id = v_request.user_id;
  insert into public.activity_log(id, type, ts, admin_email, admin_role, member_name, member_email)
    values (gen_random_uuid()::text,
      case when p_approve then 'password_reset_approved' else 'password_reset_rejected' end,
      now(), v_reviewer.email, 'opm', v_name, v_request.requested_email);
end $$;

-- ── 6. Copy Reset Link (OPM). Returns the raw token ONCE; stores only SHA-256.
--      A new link replaces the previous one; the 45-minute window is not extended. ──
create function public.create_csr_password_reset_link(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_request public.csr_password_reset_requests%rowtype;
  v_reviewer public.profiles%rowtype;
  v_name  text;
  v_token text;
begin
  if not public.is_opm() then raise exception 'not_authorized' using errcode = '42501'; end if;
  select * into v_request from public.csr_password_reset_requests where id = p_id for update;
  if not found or v_request.status <> 'approved' then raise exception 'request_not_approved'; end if;
  if v_request.expires_at <= now() then raise exception 'request_expired'; end if;
  if not exists (select 1 from public.profiles p
    join auth.users u on u.id = p.id
    where p.id = v_request.user_id and p.role = 'csr' and p.status = 'active'
      and lower(p.email) = lower(v_request.requested_email)
      and lower(u.email) = lower(v_request.requested_email)) then
    raise exception 'member_not_eligible';
  end if;
  -- A link that is being used right now (claimed by the Edge Function) is not
  -- replaced for 5 minutes, so an in-flight reset cannot be cut off half-way.
  if v_request.reset_token_claimed_at > now() - interval '5 minutes' then
    raise exception 'reset_in_progress';
  end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');           -- 256 random bits
  update public.csr_password_reset_requests
     set reset_token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex'),
         reset_token_created_at = now(), reset_token_claimed_at = null
   where id = p_id;
  select * into v_reviewer from public.profiles where id = auth.uid();
  select name into v_name from public.profiles where id = v_request.user_id;
  insert into public.activity_log(id, type, ts, admin_email, admin_role, member_name, member_email)
    values (gen_random_uuid()::text, 'password_reset_link_generated', now(),
            v_reviewer.email, 'opm', v_name, v_request.requested_email);
  return v_token;
end $$;

-- ── 7. Edge Function steps (service_role only) ──

-- 7a. Atomic one-time claim. Exactly one caller can flip reset_token_claimed_at
--     from NULL; a concurrent second call waits on the row lock, re-checks the
--     WHERE clause and gets nothing. Any failure returns no row (no reason given).
create function public.claim_csr_password_reset(p_token_hash text)
returns table(request_id uuid, target_user_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return; end if;
  update public.csr_password_reset_requests r
     set reset_token_claimed_at = now()
   where r.reset_token_hash = p_token_hash
     and r.status = 'approved' and r.expires_at > now()
     and r.reset_token_claimed_at is null
     and exists (select 1 from public.profiles p
       join auth.users u on u.id = p.id
       where p.id = r.user_id and p.role = 'csr' and p.status = 'active'
         and lower(p.email) = lower(r.requested_email)
         and lower(u.email) = lower(r.requested_email))
  returning r.id, r.user_id into request_id, target_user_id;
  if found then return next; end if;
end $$;

-- 7b. Undo a claim ONLY when Auth definitively refused the new password (e.g. too
--     weak) — the password did not change, so the same link may be tried again.
--     Never called for network/unknown errors: then the link stays used.
create function public.release_csr_password_reset_claim(p_request_id uuid, p_token_hash text) returns void
language sql security definer set search_path = '' as $$
  update public.csr_password_reset_requests
     set reset_token_claimed_at = null
   where id = p_request_id and reset_token_hash = p_token_hash
     and status = 'approved' and reset_token_claimed_at is not null;
$$;

-- 7c. After Auth changed the password: complete the request, wipe the token, audit.
create function public.finish_csr_password_reset(p_request_id uuid, p_token_hash text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_request public.csr_password_reset_requests%rowtype;
  v_name text;
begin
  update public.csr_password_reset_requests
     set status = 'completed', completed_at = now(), reset_token_hash = null
   where id = p_request_id and reset_token_hash = p_token_hash
     and status = 'approved' and reset_token_claimed_at is not null
  returning * into v_request;
  if not found then raise exception 'reset_not_claimed'; end if;
  select name into v_name from public.profiles where id = v_request.user_id;
  insert into public.activity_log(id, type, ts, member_name, member_email)
    values (gen_random_uuid()::text, 'password_changed', now(), v_name, v_request.requested_email);
end $$;

-- ── 8. Execute rights ──
revoke all on function public.create_csr_password_reset_link(uuid),
  public.claim_csr_password_reset(text),
  public.release_csr_password_reset_claim(uuid, text),
  public.finish_csr_password_reset(uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_csr_password_reset_link(uuid) to authenticated;
grant execute on function public.claim_csr_password_reset(text),
  public.release_csr_password_reset_claim(uuid, text),
  public.finish_csr_password_reset(uuid, text)
  to service_role;

notify pgrst, 'reload schema';
commit;
