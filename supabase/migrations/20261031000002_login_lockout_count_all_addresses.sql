-- ════════════════════════════════════════════════════════════════════════════
-- Login lockout — count EVERY typed address again, real account or not.
-- Reverses 20261031000001_login_lockout_existing_accounts_only.sql by decision
-- of the team: an address with no account is locked after 5 failures too.
-- Besides matching that decision, it keeps real and fake addresses
-- indistinguishable, so the lock cannot be used to discover which accounts exist.
--
-- Manual SQL Editor application only. Shared/production project.
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

notify pgrst, 'reload schema';
commit;
