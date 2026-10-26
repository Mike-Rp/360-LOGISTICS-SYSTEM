-- ════════════════════════════════════════════════════════════════════════════
-- CSR reset / setup link: refuse a new password that equals the current one
-- (BACKEND_DATABASE_REQUIREMENTS.md — "Prevent Reusing Current Password During
-- CSR Reset").
--
-- Manual SQL Editor application only. Shared/production project.
-- ADDITIVE: one new function, nothing changed or dropped. Safe to apply before
-- the Edge Function is redeployed (the old Edge Function never calls it).
--
-- Why the database: the Edge Function changes the password through the Auth
-- Admin API, which — unlike a user changing their own password — does not
-- refuse the current one, and does not return the password hash. Only the
-- database can compare against auth.users.encrypted_password (bcrypt), the same
-- extensions.crypt() check cancel_assignment() already uses for re-entry.
--
-- csr_password_reset_password_matches(request id, token hash, password) → boolean
--   * service_role only (the Edge Function) — no browser role can call it, so
--     it is not a public "is this the password?" tester.
--   * Only answers for a request that is approved, unexpired and CLAIMED by
--     this exact token hash — i.e. the caller already holds the one-time link
--     that lets them set this account's password anyway. The user is taken from
--     the request row, never from the caller.
--   * Never returns or stores the hash or the password.
-- The Edge Function calls it right after claiming; on true it releases the
-- claim (same link can be retried until its original expiry) and answers
-- { "error": "password_reused" } without touching the password.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create function public.csr_password_reset_password_matches(p_request_id uuid, p_token_hash text, p_password text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_hash text;
begin
  select u.encrypted_password into v_hash
    from public.csr_password_reset_requests r
    join auth.users u on u.id = r.user_id
   where r.id = p_request_id and r.reset_token_hash = p_token_hash
     and r.status = 'approved' and r.expires_at > now()
     and r.reset_token_claimed_at is not null;
  if not found then raise exception 'reset_not_claimed'; end if;
  -- Supabase Auth stores bcrypt ($2a$/$2b$/$2y$). Anything else (or no password
  -- yet) cannot be the same password.
  if p_password is null or v_hash is null or v_hash !~ '^\$2[aby]\$' then return false; end if;
  return extensions.crypt(p_password, v_hash) = v_hash;
end $$;

revoke all on function public.csr_password_reset_password_matches(uuid, text, text) from public, anon, authenticated;
grant execute on function public.csr_password_reset_password_matches(uuid, text, text) to service_role;

notify pgrst, 'reload schema';
commit;
