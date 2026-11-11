-- ════════════════════════════════════════════════════════════════════════════
-- Login lockout — database tests.
-- Run AFTER 20261031000000_login_lockout.sql and 20261111000001_login_lockout_escalation.sql.
--
-- Rules under test: 5 wrong passwords lock a fresh account for 5 minutes; after a lock ONE wrong
-- password locks it again, each lock 5 minutes longer than the last, up to 1 hour; 3 hours with no
-- failed attempt forgets everything; a success clears everything.
--
-- Leaves NOTHING behind: one transaction, one DO block that always finishes by
-- raising an exception, then ROLLBACK. Read the final message:
--   "LOCKOUT TESTS PASSED (n checks) — rolled back on purpose"  → all good
--   "LOCKOUT FAIL: …"                                            → what broke
-- Throwaway addresses only (@lockout-test.invalid). Run the whole file at once.
-- ════════════════════════════════════════════════════════════════════════════
begin;

do $test$
declare
  n   int := 0;
  e   text := 'someone@lockout-test.invalid';
  r   int;
  c   int;
  lvl int;
begin
  -- ── 1. only service_role may call the three functions ──
  if has_function_privilege('anon', 'public.record_login_failure(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_login_failure(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.login_lock_seconds(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.login_lock_seconds(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_login_success(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_login_success(text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.record_login_failure(text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.login_lock_seconds(text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.record_login_success(text)', 'EXECUTE') then
    raise exception 'LOCKOUT FAIL: wrong execute privileges';
  end if;
  n := n + 1;

  -- ── 2. the browser roles cannot touch the table directly ──
  if has_table_privilege('anon', 'public.login_attempts', 'SELECT')
     or has_table_privilege('authenticated', 'public.login_attempts', 'SELECT')
     or has_table_privilege('authenticated', 'public.login_attempts', 'INSERT')
     or has_table_privilege('authenticated', 'public.login_attempts', 'UPDATE')
     or has_table_privilege('authenticated', 'public.login_attempts', 'DELETE') then
    raise exception 'LOCKOUT FAIL: browser roles can reach login_attempts';
  end if;
  n := n + 1;

  set local role service_role;

  -- ── 3. a fresh account: failures 1-4 do not lock ──
  for i in 1..4 loop
    r := public.record_login_failure(e);
    if r <> 0 then raise exception 'LOCKOUT FAIL: failure % returned % (expected 0)', i, r; end if;
  end loop;
  if public.login_lock_seconds(e) <> 0 then raise exception 'LOCKOUT FAIL: locked before the 5th failure'; end if;
  n := n + 1;

  -- ── 4. the 5th failure locks for 5 minutes ──
  r := public.record_login_failure(e);
  if r <> 300 then raise exception 'LOCKOUT FAIL: 5th failure returned % (expected 300)', r; end if;
  r := public.login_lock_seconds(e);
  if r not between 295 and 300 then raise exception 'LOCKOUT FAIL: lock_seconds = % (expected ~300)', r; end if;
  n := n + 1;

  -- ── 5. attempts during the lock are not counted, do not extend it and do not raise the level ──
  r := public.record_login_failure(e);
  if r not between 295 and 300 then raise exception 'LOCKOUT FAIL: failure during lock returned %', r; end if;
  reset role;
  select failed_count, lock_level into c, lvl from public.login_attempts where email = e;
  if c <> 0 or lvl <> 1 then raise exception 'LOCKOUT FAIL: an attempt during a lock changed the state (count %, level %)', c, lvl; end if;
  n := n + 1;

  -- ── 6. a success clears everything ──
  set local role service_role;
  perform public.record_login_success(e);
  if public.login_lock_seconds(e) <> 0 then raise exception 'LOCKOUT FAIL: still locked after success'; end if;
  reset role;
  if exists (select 1 from public.login_attempts where email = e) then
    raise exception 'LOCKOUT FAIL: row survived a successful login';
  end if;
  n := n + 1;

  -- ── 7. after a lock ends, ONE wrong password locks again — no new 5 tries — and for 10 minutes ──
  set local role service_role;
  for i in 1..5 loop perform public.record_login_failure(e); end loop;            -- first lock (5 min)
  reset role;
  update public.login_attempts set locked_until = now() - interval '1 second' where email = e;   -- the lock has just ended
  set local role service_role;
  if public.login_lock_seconds(e) <> 0 then raise exception 'LOCKOUT FAIL: expired lock still reported'; end if;
  r := public.record_login_failure(e);
  if r <> 600 then raise exception 'LOCKOUT FAIL: first failure after a lock returned % (expected a 600-second lock)', r; end if;
  reset role;
  select failed_count, lock_level into c, lvl from public.login_attempts where email = e;
  if lvl <> 2 or c <> 0 then raise exception 'LOCKOUT FAIL: after the second lock level = %, count = %', lvl, c; end if;
  n := n + 1;

  -- ── 8. every lock is 5 minutes longer than the last, up to 1 hour, then it stays at 1 hour ──
  for i in 3..16 loop
    update public.login_attempts set locked_until = now() - interval '1 second' where email = e;
    set local role service_role;
    r := public.record_login_failure(e);
    reset role;
    if r <> least(i * 300, 3600) then raise exception 'LOCKOUT FAIL: lock number % returned % seconds (expected %)', i, r, least(i * 300, 3600); end if;
  end loop;
  select lock_level into lvl from public.login_attempts where email = e;
  if lvl <> 12 then raise exception 'LOCKOUT FAIL: the stored level is % (expected it to stop at 12)', lvl; end if;
  set local role service_role;
  r := public.login_lock_seconds(e);
  if r not between 3595 and 3600 then raise exception 'LOCKOUT FAIL: the longest lock is % seconds (expected 3600)', r; end if;
  -- still refused, not counted, not extended
  r := public.record_login_failure(e);
  if r not between 3595 and 3600 then raise exception 'LOCKOUT FAIL: attempt during the 1-hour lock returned %', r; end if;
  reset role;
  n := n + 1;

  -- ── 9. for a fresh account (never locked), failures older than 15 minutes do not add up ──
  update public.login_attempts
     set failed_count = 4, lock_level = 0, last_failed_at = now() - interval '16 minutes', locked_until = null
   where email = e;
  set local role service_role;
  r := public.record_login_failure(e);
  if r <> 0 then raise exception 'LOCKOUT FAIL: stale failures counted toward a lock'; end if;
  reset role;
  select failed_count into c from public.login_attempts where email = e;
  if c <> 1 then raise exception 'LOCKOUT FAIL: stale count not reset (count = %)', c; end if;
  n := n + 1;

  -- ── 10. 3 hours with no failed attempt forgets everything; just under 3 hours does not ──
  update public.login_attempts
     set failed_count = 0, lock_level = 5, last_failed_at = now() - interval '2 hours 59 minutes', locked_until = now() - interval '1 second'
   where email = e;
  set local role service_role;
  r := public.record_login_failure(e);
  if r <> 1800 then raise exception 'LOCKOUT FAIL: just under 3 hours should still remember the locks (got %, expected 1800)', r; end if;
  reset role;
  update public.login_attempts
     set failed_count = 0, lock_level = 5, last_failed_at = now() - interval '3 hours 1 minute', locked_until = now() - interval '1 second'
   where email = e;
  set local role service_role;
  r := public.record_login_failure(e);
  if r <> 0 then raise exception 'LOCKOUT FAIL: after 3 quiet hours the account was not forgiven (got %)', r; end if;
  reset role;
  select failed_count, lock_level into c, lvl from public.login_attempts where email = e;
  if lvl <> 0 or c <> 1 then raise exception 'LOCKOUT FAIL: after the reset level = %, count = % (expected 0 and 1)', lvl, c; end if;
  -- ...and it really is fresh: four more failures do not lock, the fifth locks for 5 minutes
  set local role service_role;
  for i in 1..3 loop
    r := public.record_login_failure(e);
    if r <> 0 then raise exception 'LOCKOUT FAIL: fresh account locked at failure %', i + 1; end if;
  end loop;
  r := public.record_login_failure(e);
  if r <> 300 then raise exception 'LOCKOUT FAIL: fresh account''s 5th failure returned % (expected 300)', r; end if;
  n := n + 1;

  -- ── 11. a success after several locks clears the level too ──
  reset role;
  update public.login_attempts set lock_level = 7, locked_until = now() + interval '30 minutes' where email = e;
  set local role service_role;
  perform public.record_login_success(e);
  for i in 1..4 loop
    r := public.record_login_failure(e);
    if r <> 0 then raise exception 'LOCKOUT FAIL: failure % after a success returned % (expected a fresh start)', i, r; end if;
  end loop;
  r := public.record_login_failure(e);
  if r <> 300 then raise exception 'LOCKOUT FAIL: after a success the next lock was % seconds (expected 300)', r; end if;
  n := n + 1;

  -- ── 12. emails are case/space-insensitive and accounts are independent ──
  perform set_config('role', 'service_role', true);
  perform public.record_login_success(e);
  for i in 1..5 loop perform public.record_login_failure('  SomeOne@Lockout-Test.Invalid '); end loop;
  if public.login_lock_seconds(e) = 0 then raise exception 'LOCKOUT FAIL: email matching is case-sensitive'; end if;
  if public.login_lock_seconds('other@lockout-test.invalid') <> 0 then raise exception 'LOCKOUT FAIL: lock leaked to another account'; end if;
  n := n + 1;

  -- ── 13. an address with no account is locked after 5 failures too, and escalates the same way ──
  for i in 1..4 loop
    r := public.record_login_failure('nobody@lockout-test.invalid');
    if r <> 0 then raise exception 'LOCKOUT FAIL: non-existent account locked at failure %', i; end if;
  end loop;
  r := public.record_login_failure('nobody@lockout-test.invalid');
  if r <> 300 then raise exception 'LOCKOUT FAIL: 5th failure on a non-existent account returned %', r; end if;
  reset role;
  update public.login_attempts set locked_until = now() - interval '1 second' where email = 'nobody@lockout-test.invalid';
  set local role service_role;
  r := public.record_login_failure('nobody@lockout-test.invalid');
  if r <> 600 then raise exception 'LOCKOUT FAIL: a non-existent account did not escalate (got %)', r; end if;
  n := n + 1;

  reset role;
  raise exception 'LOCKOUT TESTS PASSED (% checks) — rolled back on purpose', n;
end
$test$;

rollback;
