-- ════════════════════════════════════════════════════════════════════════════
-- Login lockout — database tests
-- (run AFTER 20261031000000_login_lockout.sql).
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

  -- ── 3. failures 1-4 do not lock ──
  for i in 1..4 loop
    r := public.record_login_failure(e);
    if r <> 0 then raise exception 'LOCKOUT FAIL: failure % returned % (expected 0)', i, r; end if;
  end loop;
  if public.login_lock_seconds(e) <> 0 then raise exception 'LOCKOUT FAIL: locked before the 5th failure'; end if;
  n := n + 1;

  -- ── 4. the 5th failure locks for ~5 minutes ──
  r := public.record_login_failure(e);
  if r <> 300 then raise exception 'LOCKOUT FAIL: 5th failure returned % (expected 300)', r; end if;
  r := public.login_lock_seconds(e);
  if r not between 295 and 300 then raise exception 'LOCKOUT FAIL: lock_seconds = % (expected ~300)', r; end if;
  n := n + 1;

  -- ── 5. attempts during the lock are not counted and keep the same lock ──
  r := public.record_login_failure(e);
  if r not between 295 and 300 then raise exception 'LOCKOUT FAIL: failure during lock returned %', r; end if;
  reset role;
  select failed_count into c from public.login_attempts where email = e;
  if c <> 5 then raise exception 'LOCKOUT FAIL: failures during a lock were counted (count = %)', c; end if;
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

  -- ── 7. once a lock expires, the next failure starts a fresh count of 1 ──
  set local role service_role;
  for i in 1..5 loop perform public.record_login_failure(e); end loop;
  reset role;
  update public.login_attempts set locked_until = now() - interval '1 second' where email = e;
  set local role service_role;
  if public.login_lock_seconds(e) <> 0 then raise exception 'LOCKOUT FAIL: expired lock still reported'; end if;
  r := public.record_login_failure(e);
  if r <> 0 then raise exception 'LOCKOUT FAIL: first failure after expiry locked again (%)', r; end if;
  reset role;
  select failed_count into c from public.login_attempts where email = e;
  if c <> 1 then raise exception 'LOCKOUT FAIL: count after expiry = % (expected 1)', c; end if;
  n := n + 1;

  -- ── 8. failures older than 15 minutes do not add up ──
  update public.login_attempts set failed_count = 4, last_failed_at = now() - interval '16 minutes', locked_until = null where email = e;
  set local role service_role;
  r := public.record_login_failure(e);
  if r <> 0 then raise exception 'LOCKOUT FAIL: stale failures counted toward a lock'; end if;
  reset role;
  select failed_count into c from public.login_attempts where email = e;
  if c <> 1 then raise exception 'LOCKOUT FAIL: stale count not reset (count = %)', c; end if;
  n := n + 1;

  -- ── 9. emails are case/space-insensitive and accounts are independent ──
  perform set_config('role', 'service_role', true);
  for i in 1..5 loop perform public.record_login_failure('  SomeOne@Lockout-Test.Invalid '); end loop;
  if public.login_lock_seconds(e) = 0 then raise exception 'LOCKOUT FAIL: email matching is case-sensitive'; end if;
  if public.login_lock_seconds('other@lockout-test.invalid') <> 0 then raise exception 'LOCKOUT FAIL: lock leaked to another account'; end if;
  n := n + 1;

  -- ── 10. an address with no account is locked after 5 failures too (same as a real one) ──
  for i in 1..4 loop
    r := public.record_login_failure('nobody@lockout-test.invalid');
    if r <> 0 then raise exception 'LOCKOUT FAIL: non-existent account locked at failure %', i; end if;
  end loop;
  r := public.record_login_failure('nobody@lockout-test.invalid');
  if r <> 300 then raise exception 'LOCKOUT FAIL: 5th failure on a non-existent account returned %', r; end if;
  if public.login_lock_seconds('nobody@lockout-test.invalid') not between 295 and 300 then
    raise exception 'LOCKOUT FAIL: non-existent account is not locked';
  end if;
  n := n + 1;

  reset role;
  raise exception 'LOCKOUT TESTS PASSED (% checks) — rolled back on purpose', n;
end
$test$;

rollback;
