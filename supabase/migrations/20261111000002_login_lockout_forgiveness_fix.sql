-- ════════════════════════════════════════════════════════════════════════════
-- Login lockout — fix: the 3-hour forgiveness was not written back to the table.
--
-- Manual SQL Editor application only. Shared/production project.
--
-- Found by login_lockout.test.sql (check 10) after 20261111000001: when an account had been
-- quiet for 3 hours, record_login_failure() correctly treated it as fresh IN MEMORY
-- (level 0, count 0) and counted the new wrong password as failure 1 — but the update that
-- saves that first failure did not write lock_level back, so the stored level stayed at
-- whatever it was (e.g. 5). The very next wrong password then saw "level 5, last failure just
-- now" and locked the account for 30 minutes instead of starting a fresh run of 5 tries.
--
-- The ONLY change: that update now also writes lock_level = 0 (it is always 0 on that path).
-- Everything else is identical to 20261111000001: the rules, the 1-hour cap, the grants.
--
-- Safety check first: if the live record_login_failure() is not the version this file fixes
-- (the escalation version that has the bug), the migration stops and changes nothing.
-- ════════════════════════════════════════════════════════════════════════════
begin;

do $$
begin
  if not exists (select 1 from pg_proc
                  where oid = to_regprocedure('public.record_login_failure(text)')
                    and prosrc like '%lock_level = least(v_level, 12)%'
                    and prosrc like '%set failed_count = v_row.failed_count, last_failed_at = now(), locked_until = null%') then
    raise exception 'login lockout fix: live record_login_failure() is not the expected (escalation) version — stop and compare it with 20261111000001';
  end if;
end $$;

create or replace function public.record_login_failure(p_email text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_row   public.login_attempts%rowtype;
  v_level integer;
  v_secs  integer;
begin
  if char_length(v_email) not between 3 and 320 then
    raise exception 'invalid_email' using errcode = '22023';
  end if;

  -- Housekeeping: drop old, unlocked rows so the table can't grow without bound
  -- (a day idle is far past the 3-hour memory below, so nothing is forgotten early).
  delete from public.login_attempts
   where last_failed_at < now() - interval '1 day'
     and (locked_until is null or locked_until < now());

  insert into public.login_attempts (email) values (v_email) on conflict (email) do nothing;
  select * into v_row from public.login_attempts where email = v_email for update;

  -- Already locked: attempts during a lock are rejected, not counted, and do not extend it.
  if v_row.locked_until is not null and v_row.locked_until > now() then
    return ceil(extract(epoch from (v_row.locked_until - now())))::integer;
  end if;

  -- 3 hours with no failed attempt: forget everything (fresh 5 tries, first lock is 5 minutes).
  if v_row.last_failed_at < now() - interval '3 hours' then
    v_row.failed_count := 0;
    v_row.lock_level   := 0;
  end if;

  if v_row.lock_level > 0 then
    -- It has been locked before and is still remembered: this wrong password locks it again,
    -- one step (5 minutes) longer.
    v_level := v_row.lock_level + 1;
  else
    -- Never locked in this run: the 5-failures rule. Failures older than 15 minutes don't add up.
    if v_row.last_failed_at < now() - interval '15 minutes' then v_row.failed_count := 0; end if;
    v_row.failed_count := v_row.failed_count + 1;

    if v_row.failed_count < 5 then
      -- lock_level is written too: after the 3-hour forgiveness the stored level must go back to 0.
      update public.login_attempts
         set failed_count = v_row.failed_count, lock_level = 0, last_failed_at = now(), locked_until = null
       where email = v_email;
      return 0;
    end if;
    v_level := 1;
  end if;

  v_secs := least(v_level * 300, 3600);               -- 5 minutes per step, 1 hour at most
  update public.login_attempts
     set failed_count = 0, lock_level = least(v_level, 12), last_failed_at = now(),
         locked_until = now() + make_interval(secs => v_secs)
   where email = v_email;
  return v_secs;
end $$;

-- Accounts the bug may already have touched: any row that is not locked and has a level but whose
-- last failure is more than 3 hours old is simply forgiven (the next failure would have done it).
update public.login_attempts set lock_level = 0, failed_count = 0
 where lock_level > 0 and last_failed_at < now() - interval '3 hours' and (locked_until is null or locked_until < now());

revoke all on function public.record_login_failure(text) from public, anon, authenticated;
grant execute on function public.record_login_failure(text) to service_role;

notify pgrst, 'reload schema';
commit;
