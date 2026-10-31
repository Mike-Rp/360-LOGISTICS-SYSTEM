-- ════════════════════════════════════════════════════════════════════════════
-- Login lockout — 5 failed sign-ins lock the ACCOUNT for 5 minutes.
-- Applies to staff (admin / CSR / OPM) and drivers: both sign in with an
-- email-shaped Auth login (drivers' is derived from their mobile number).
--
-- Manual SQL Editor application only. Shared/production project.
--
-- The `login` Edge Function is the only caller (service_role); the browser can
-- neither read nor write this table. Rules:
--   • the 5th consecutive failure locks the account for 5 minutes
--   • while locked, every attempt is rejected — even with the right password
--   • a successful sign-in clears the counter
--   • once a lock expires, the next failure starts a fresh count of 1
--   • failures older than 15 minutes don't add up (old typos are forgotten)
-- Keyed by the lower-cased login email, whether or not that account exists, so
-- the lock cannot be used to find out which accounts are real.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create table if not exists public.login_attempts (
  email          text primary key check (char_length(email) between 3 and 320),
  failed_count   integer     not null default 0,
  last_failed_at timestamptz not null default now(),
  locked_until   timestamptz
);
create index if not exists login_attempts_last_failed_idx on public.login_attempts (last_failed_at);

alter table public.login_attempts enable row level security;
revoke all on public.login_attempts from public, anon, authenticated;

-- Seconds left on the lock (0 = not locked).
create or replace function public.login_lock_seconds(p_email text) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select ceil(extract(epoch from (locked_until - now())))::integer
      from public.login_attempts
     where email = lower(trim(p_email)) and locked_until > now()
  ), 0);
$$;

-- Count one failed sign-in. Returns the lock's remaining seconds (0 = not locked).
create or replace function public.record_login_failure(p_email text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_row   public.login_attempts%rowtype;
begin
  if char_length(v_email) not between 3 and 320 then
    raise exception 'invalid_email' using errcode = '22023';
  end if;

  -- Housekeeping: drop old, unlocked rows so the table can't grow without bound.
  delete from public.login_attempts
   where last_failed_at < now() - interval '1 day'
     and (locked_until is null or locked_until < now());

  insert into public.login_attempts (email) values (v_email) on conflict (email) do nothing;
  select * into v_row from public.login_attempts where email = v_email for update;

  -- Already locked: attempts during a lock are rejected, not counted.
  if v_row.locked_until is not null and v_row.locked_until > now() then
    return ceil(extract(epoch from (v_row.locked_until - now())))::integer;
  end if;

  -- An expired lock, or failures too old to matter, start a fresh count.
  if v_row.locked_until is not null or v_row.last_failed_at < now() - interval '15 minutes' then
    v_row.failed_count := 0;
  end if;
  v_row.failed_count := v_row.failed_count + 1;

  if v_row.failed_count >= 5 then
    update public.login_attempts
       set failed_count = v_row.failed_count, last_failed_at = now(), locked_until = now() + interval '5 minutes'
     where email = v_email;
    return 300;
  end if;

  update public.login_attempts
     set failed_count = v_row.failed_count, last_failed_at = now(), locked_until = null
   where email = v_email;
  return 0;
end $$;

-- A successful sign-in resets the counter.
create or replace function public.record_login_success(p_email text) returns void
language sql security definer set search_path = '' as $$
  delete from public.login_attempts where email = lower(trim(p_email));
$$;

revoke all on function public.login_lock_seconds(text)    from public, anon, authenticated;
revoke all on function public.record_login_failure(text)  from public, anon, authenticated;
revoke all on function public.record_login_success(text)  from public, anon, authenticated;
grant execute on function public.login_lock_seconds(text)   to service_role;
grant execute on function public.record_login_failure(text) to service_role;
grant execute on function public.record_login_success(text) to service_role;

notify pgrst, 'reload schema';
commit;
