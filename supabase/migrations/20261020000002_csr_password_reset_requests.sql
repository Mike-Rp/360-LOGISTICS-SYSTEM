-- REQ-006: CSR password-reset requests reviewed by OPM.
-- Manual SQL Editor review/application only. This project is shared/production.
-- No password or recovery token is stored here.
begin;
create table public.csr_password_reset_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  requested_email text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'completed', 'expired')),
  requested_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  expires_at timestamptz,
  completed_at timestamptz
);
create unique index csr_password_reset_one_open_per_user
  on public.csr_password_reset_requests(user_id) where status in ('pending', 'approved');
create index csr_password_reset_pending_idx
  on public.csr_password_reset_requests(requested_at desc) where status = 'pending';

alter table public.csr_password_reset_requests enable row level security;
revoke all on public.csr_password_reset_requests from public, anon, authenticated;
grant select on public.csr_password_reset_requests to authenticated;
create policy csr_password_reset_opm_read on public.csr_password_reset_requests
  for select to authenticated using (public.is_opm());
create policy csr_password_reset_owner_read on public.csr_password_reset_requests
  for select to authenticated using (user_id = auth.uid());

-- An anonymous submission always returns the same response. Invalid/non-CSR/removed
-- addresses do not create rows, and neither the response nor an error reveals why.
create function public.request_csr_password_reset(p_email text) returns void
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
  update public.csr_password_reset_requests set status = 'expired'
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

create function public.review_csr_password_reset(p_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_request public.csr_password_reset_requests%rowtype;
  v_reviewer public.profiles%rowtype;
  v_name text;
begin
  if not public.is_opm() then raise exception 'not_authorized' using errcode = '42501'; end if;
  select * into v_request from public.csr_password_reset_requests
    where id = p_id and status = 'pending' for update;
  if not found then raise exception 'request_not_pending'; end if;
  if not exists (select 1 from public.profiles p
    join auth.users u on u.id = p.id
    where p.id = v_request.user_id and p.role = 'csr' and p.status = 'active'
      and lower(p.email) = lower(v_request.requested_email)
      and lower(u.email) = lower(v_request.requested_email)) then
    raise exception 'member_not_eligible';
  end if;
  update public.csr_password_reset_requests
    set status = case when p_approve then 'approved' else 'rejected' end,
        reviewed_by = auth.uid(), reviewed_at = now(),
        expires_at = case when p_approve then now() + interval '45 minutes' else null end
    where id = p_id;
  select * into v_reviewer from public.profiles where id = auth.uid();
  select name into v_name from public.profiles where id = v_request.user_id;
  insert into public.activity_log(id, type, ts, admin_email, admin_role, member_name, member_email)
    values (gen_random_uuid()::text,
      case when p_approve then 'password_reset_approved' else 'password_reset_rejected' end,
      now(), v_reviewer.email, 'opm', v_name, v_request.requested_email);
end $$;

create function public.csr_password_reset_approved() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.csr_password_reset_requests r
    join public.profiles p on p.id = r.user_id
    where r.user_id = auth.uid() and r.status = 'approved' and r.expires_at > now()
      and p.role = 'csr' and p.status = 'active'
  );
$$;

-- The credential-change boundary — scoped to the CSR Forgot Password flow only.
--
-- How Supabase Auth writes passwords (github.com/supabase/auth, read 2026-10-20):
-- * A real password change — PUT /user (the browser's auth.updateUser) and the
--   Admin API PUT /admin/users/{id} alike — runs User.UpdatePassword(): ONE
--   UPDATE that sets encrypted_password and also clears recovery_token (and the
--   other one-time tokens). Then, in the same transaction, it deletes the user's
--   other sessions: PUT /user keeps only the caller's session, the Admin API
--   (no session) deletes them all.
-- * Sign-in hash re-encryption writes encrypted_password alone; Recover() /
--   token clean-up write recovery_token without changing the password.
-- * Each session's sign-in methods are in auth.mfa_amr_claims. Auth itself treats
--   'otp', 'magiclink' and 'recovery' as a recovery session
--   (AuthenticationMethod.IsRecovery); a Forgot Password link signs in that way.
--
-- So this check fires only for statements that target recovery_token (password
-- changes, not sign-in re-encryption), only when the hash really changed, only
-- for an active CSR, and — evaluated at COMMIT, after Auth removed the other
-- sessions — only when a recovery session survives, i.e. the change was made
-- FROM a recovery session. That case needs the one approved, unexpired request,
-- which is consumed (completed) in the same transaction as the password change;
-- otherwise the whole change rolls back. Not affected: the Admin API / Dashboard
-- (all sessions removed), a CSR signed in with their current password, staff
-- other than CSRs, drivers, sign-in, and SQL maintenance that sets
-- encrypted_password without touching recovery_token. No role name is assumed.
create function public.enforce_csr_password_reset() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_request public.csr_password_reset_requests%rowtype;
  v_name text;
begin
  if new.encrypted_password is not distinct from old.encrypted_password then return null; end if;
  if not exists (select 1 from public.profiles
    where id = new.id and role = 'csr' and status = 'active') then return null; end if;
  if not exists (select 1 from auth.sessions s
    join auth.mfa_amr_claims c on c.session_id = s.id
    where s.user_id = new.id and c.authentication_method in ('otp', 'magiclink', 'recovery')) then
    return null;
  end if;
  -- At most one open request per user (csr_password_reset_one_open_per_user);
  -- the row lock makes a concurrent second change find it already completed.
  update public.csr_password_reset_requests set status = 'completed', completed_at = now()
    where user_id = new.id and status = 'approved' and expires_at > now()
    returning * into v_request;
  if not found then raise exception 'approval_not_available' using errcode = '42501'; end if;
  select name into v_name from public.profiles where id = v_request.user_id;
  insert into public.activity_log(id, type, ts, member_name, member_email)
    values (gen_random_uuid()::text, 'password_changed', now(), v_name, v_request.requested_email);
  return null;
end $$;
create constraint trigger enforce_csr_password_reset_at_commit
  after update of recovery_token on auth.users
  deferrable initially deferred
  for each row execute function public.enforce_csr_password_reset();

revoke all on function public.request_csr_password_reset(text),
  public.review_csr_password_reset(uuid, boolean),
  public.csr_password_reset_approved(), public.enforce_csr_password_reset()
  from public, anon, authenticated;
grant execute on function public.request_csr_password_reset(text) to anon;
grant execute on function public.review_csr_password_reset(uuid, boolean),
  public.csr_password_reset_approved()
  to authenticated;
notify pgrst, 'reload schema';
commit;
