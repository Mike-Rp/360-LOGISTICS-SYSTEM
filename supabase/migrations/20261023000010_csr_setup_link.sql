-- ════════════════════════════════════════════════════════════════════════════
-- CSR setup link — reuses REQ-006's reset-link machinery for the FIRST
-- password too, instead of OPM typing/seeing a temporary password that then
-- has to be relayed out-of-band (chat, verbally, email).
--
-- Manual SQL Editor application only. Shared/production project.
--
-- Nothing downstream needs to change: claim_csr_password_reset(),
-- release_csr_password_reset_claim(), finish_csr_password_reset(), and the
-- complete-csr-password-reset Edge Function are already fully generic — they
-- only care that a csr_password_reset_requests row is 'approved', unexpired,
-- unclaimed, and matches an active CSR profile. They have no idea whether the
-- row exists because a CSR asked for a reset or because OPM just created the
-- account, so this migration only has to produce that one row + token, the
-- exact way create_csr_password_reset_link() already does for later resets.
--
-- create_team_member(p_name, p_email, p_role) — drops the old p_password
-- argument entirely:
--   1. Creates the Auth user with a random, never-returned, never-logged
--      throwaway password (same `extensions.crypt()` path _create_auth_user
--      already used — nothing new here).
--   2. Inserts the profile row, same as before.
--   3. Inserts one 'approved' csr_password_reset_requests row for this new
--      user with a fresh one-time token (same generation technique as
--      create_csr_password_reset_link: 32 random bytes, SHA-256 hash stored,
--      raw token returned once). csr_password_reset_one_open_per_user can
--      never conflict here — the user_id is always brand new.
--   4. Returns setupToken instead of a password. The frontend builds
--      /reset-password?token=... from it, same page REQ-006 already built,
--      and shows a "Copy Setup Link" button instead of a visible password.
--
-- Expiry: 7 days, not the 45-minute reset window — this is onboarding, not a
-- security-sensitive reset, and a brand-new hire may not open the link the
-- same day it's sent.
-- ════════════════════════════════════════════════════════════════════════════
begin;

drop function if exists public.create_team_member(text, text, text, text);

create function public.create_team_member(p_name text, p_email text, p_role text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id           uuid;
  v_email        text := lower(trim(p_email));
  v_name         text := trim(p_name);
  v_throwaway_pw text := encode(extensions.gen_random_bytes(24), 'hex');
  v_setup_token  text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if not public.is_opm() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if p_role <> 'csr' then raise exception 'invalid_role'; end if;
  if v_name = '' or v_email = '' then raise exception 'missing_fields'; end if;

  v_id := public._create_auth_user(v_email, v_throwaway_pw, jsonb_build_object('name', v_name));
  insert into public.profiles (id, email, name, role) values (v_id, v_email, v_name, p_role);

  insert into public.csr_password_reset_requests
    (user_id, requested_email, status, reviewed_by, reviewed_at, expires_at,
     reset_token_hash, reset_token_created_at)
  values
    (v_id, v_email, 'approved', auth.uid(), now(), now() + interval '7 days',
     encode(extensions.digest(v_setup_token, 'sha256'), 'hex'), now());

  return jsonb_build_object(
    'id', v_id, 'name', v_name, 'email', v_email, 'role', p_role,
    'status', 'active', 'invitedAt', now(), 'setupToken', v_setup_token
  );
end $$;

revoke all on function public.create_team_member(text, text, text) from public, anon, authenticated;
grant execute on function public.create_team_member(text, text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
