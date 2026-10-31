-- ════════════════════════════════════════════════════════════════════════════
-- Login lockout — only REAL accounts are counted and locked.
-- Follow-up to 20261031000000_login_lockout.sql, which counted any typed email
-- (real or not). Now an address that has no Auth account is never recorded: no
-- counter, no lock, and no row left behind. Everything else is unchanged.
--
-- Manual SQL Editor application only. Shared/production project.
--
-- Trade-off (chosen deliberately): the "too many failed attempts" message now
-- appears only for accounts that exist, so repeating a wrong login can hint
-- that an address is real. Supabase Auth's own rate limit still applies.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.record_login_failure(p_email text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_row   public.login_attempts%rowtype;
begin
  if char_length(v_email) not between 3 and 320 then
    raise exception 'invalid_email' using errcode = '22023';
  end if;

  -- Not a real account: nothing to protect, so nothing is recorded.
  if not exists (select 1 from auth.users where lower(email) = v_email) then
    return 0;
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

revoke all on function public.record_login_failure(text) from public, anon, authenticated;
grant execute on function public.record_login_failure(text) to service_role;

-- Clear any rows the first version recorded for addresses that don't exist.
delete from public.login_attempts la
 where not exists (select 1 from auth.users u where lower(u.email) = la.email);

notify pgrst, 'reload schema';
commit;
