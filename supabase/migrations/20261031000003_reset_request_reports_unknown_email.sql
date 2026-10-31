-- ════════════════════════════════════════════════════════════════════════════
-- Forgot-password: tell the person when the email has no eligible CSR account.
-- Until now request_csr_password_reset() returned nothing, so the screen showed
-- "Request Submitted" for ANY email, including ones that don't exist.
--
-- It now returns a boolean:
--   true  = the email belongs to an active CSR account (a request was created, or
--           one is already pending/approved/recent — all fine from the person's view)
--   false = no eligible CSR account (no such email, not a CSR, or not active)
-- The request/notification logic is otherwise exactly the previous version
-- (20261027000001).
--
-- Manual SQL Editor application only. Shared/production project.
--
-- Trade-off (chosen deliberately): the anonymous screen can now reveal whether
-- an email belongs to an active CSR account. Nothing else is exposed, and no
-- reset link is ever returned here — OPM still has to approve first.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- The return type changes, so the function must be dropped and re-created.
drop function if exists public.request_csr_password_reset(text);

create function public.request_csr_password_reset(p_email text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_profile public.profiles%rowtype;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_request_id uuid;
begin
  if length(v_email) > 320 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then return false; end if;
  select p.* into v_profile from public.profiles p
    join auth.users u on u.id = p.id
    where lower(p.email) = v_email and lower(u.email) = v_email
      and p.role = 'csr' and p.status = 'active' limit 1;
  if not found then return false; end if;
  update public.csr_password_reset_requests
     set status = 'expired', reset_token_hash = null, reset_token_claimed_at = null
    where user_id = v_profile.id and status = 'approved' and expires_at <= now();
  if exists (select 1 from public.csr_password_reset_requests
    where user_id = v_profile.id and status in ('pending', 'approved')) then return true; end if;
  if exists (select 1 from public.csr_password_reset_requests
    where user_id = v_profile.id and requested_at > now() - interval '15 minutes') then return true; end if;
  insert into public.csr_password_reset_requests(user_id, requested_email)
    values (v_profile.id, v_email)
    returning id into v_request_id;
  insert into public.activity_log(id, type, ts, member_name, member_email)
    values (gen_random_uuid()::text, 'password_reset_requested', now(), v_profile.name, v_email);
  insert into public.notifications
    (id, type, message, assignment_id, read, time_label, reset_request_id)
  values
    ('notif-resetreq-' || v_request_id, 'password_reset_requested',
     v_email || ' requested a password reset.', null, false,
     to_char(now() at time zone 'Asia/Manila', 'Mon FMDD, HH12:MI AM'), v_request_id)
  on conflict (id) do nothing;
  return true;
exception when unique_violation then
  return true;
end $$;

revoke all on function public.request_csr_password_reset(text) from public, anon, authenticated;
grant execute on function public.request_csr_password_reset(text) to anon;

notify pgrst, 'reload schema';
commit;
