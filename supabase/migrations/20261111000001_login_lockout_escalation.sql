-- ════════════════════════════════════════════════════════════════════════════
-- Login lockout — every lock is 5 minutes longer than the last (up to 1 hour), and once an
-- account has been locked, ONE more wrong password locks it again.
--
-- Manual SQL Editor application only. Shared/production project.
--
-- Rules (record_login_failure is the only function that changes; everything else — the table
-- keys, login_lock_seconds, record_login_success, grants, the Edge Function — is untouched):
--   • a fresh account: the 5th consecutive wrong password locks it for 5 minutes, as before
--     (failures older than 15 minutes still do not add up)
--   • after a lock, ANY wrong password locks it again at once — no new set of 5 tries — and
--     every lock is 5 minutes longer than the one before:
--         5, 10, 15, 20, … 55, 60 minutes — then it stays at 60 minutes (the maximum)
--   • "3 hours with no failed attempt" forgets everything: back to a fresh 5 tries and a
--     5-minute first lock. The clock runs from the last wrong password, so an account that
--     reaches the 1-hour lock needs the rest of the 3 hours to pass after it ends
--   • a successful sign-in clears everything (record_login_success deletes the row)
--   • attempts during a lock are still refused, not counted, and do not extend it
--   • unknown addresses are treated exactly like real ones
--
-- login_attempts.lock_level = how many locks the account has had in this run (stored up to 12,
-- which is already the 1-hour maximum). Rows locked right now are marked level 1, so when their
-- lock ends the next wrong password re-locks them at the next step.
--
-- Safety checks first: if the live record_login_failure() is not the version this file was
-- written against (or lock_level already exists), the migration stops and changes nothing.
-- ════════════════════════════════════════════════════════════════════════════
begin;

do $$
begin
  if not exists (select 1 from pg_proc
                  where oid = to_regprocedure('public.record_login_failure(text)')
                    and prosrc like '%15 minutes%' and prosrc like '%invalid_email%' and prosrc not like '%lock_level%') then
    raise exception 'login lockout escalation: live record_login_failure() is not the expected version — stop and compare it with 20261031000002';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'login_attempts' and column_name = 'lock_level') then
    raise exception 'login lockout escalation: login_attempts.lock_level already exists';
  end if;
end $$;

alter table public.login_attempts add column lock_level integer not null default 0;

-- Anyone locked at this moment has had one lock.
update public.login_attempts set lock_level = 1 where locked_until is not null and locked_until > now();

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
      update public.login_attempts
         set failed_count = v_row.failed_count, last_failed_at = now(), locked_until = null
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

revoke all on function public.record_login_failure(text) from public, anon, authenticated;
grant execute on function public.record_login_failure(text) to service_role;

notify pgrst, 'reload schema';
commit;
