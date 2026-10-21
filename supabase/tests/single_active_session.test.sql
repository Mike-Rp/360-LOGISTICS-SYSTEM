-- ════════════════════════════════════════════════════════════════════════════
-- Single active session — database tests (Driver, CSR, OPM; newest login wins).
--
-- Run AFTER migration 20261021000001_single_active_session.sql.
--
-- Leaves NOTHING behind: one transaction, one DO block that always finishes by
-- raising an exception, then ROLLBACK. Read the final message:
--   "SESSION TESTS PASSED (n checks) — rolled back on purpose"  → all good
--   "SESSION FAIL: …"                                            → what broke
--
-- Each "device" is a row in auth.sessions; a request from that device is
-- simulated with request.jwt.claims (sub + session_id, as Supabase Auth issues
-- them) and role authenticated. Throwaway users only (@session-test.invalid);
-- real rows are never touched. Run the whole file at once.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- A login (session) for p_uid created p_ago before now.
create function pg_temp.st_session(p_uid uuid, p_ago interval) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.sessions (id, user_id, created_at, updated_at) values (v, p_uid, now() - p_ago, now() - p_ago);
  return v;
end $f$;

-- Act as p_uid on session p_sid (null = a token without session_id), as role
-- authenticated. Call only while the role is reset (see st_reset).
create function pg_temp.st_claims(p_uid uuid, p_sid uuid) returns text
language sql as $f$
  select jsonb_strip_nulls(jsonb_build_object(
    'sub', p_uid, 'role', 'authenticated', 'session_id', p_sid,
    'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint))
  ))::text;
$f$;

do $test$
declare
  n      int := 0;
  drv_u  uuid := gen_random_uuid();   -- driver's Auth user
  csr_u  uuid := gen_random_uuid();
  csr2_u uuid := gen_random_uuid();   -- a different CSR account
  opm_u  uuid := gen_random_uuid();
  drv_id text := 'DR-SESSTEST';
  asn_id text := 'ASN-SESSTEST';
  phone  text := '+639990001234';
  d_old uuid; d_new uuid; c_old uuid; c_new uuid; c2 uuid; o_old uuid; o_new uuid;
  t_a uuid; s record;
  cnt   int;
  ok    boolean;
  st    text;
  err   text;
begin
  -- ── setup ──
  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (drv_u,  'authenticated', 'authenticated', public.driver_login_email(phone), extensions.crypt('360pin-1111', extensions.gen_salt('bf')), now(), now(), now()),
         (csr_u,  'authenticated', 'authenticated', 'csr@session-test.invalid',  extensions.crypt('x-pass-1', extensions.gen_salt('bf')), now(), now(), now()),
         (csr2_u, 'authenticated', 'authenticated', 'csr2@session-test.invalid', extensions.crypt('x-pass-2', extensions.gen_salt('bf')), now(), now(), now()),
         (opm_u,  'authenticated', 'authenticated', 'opm@session-test.invalid',  extensions.crypt('x-pass-3', extensions.gen_salt('bf')), now(), now(), now());
  insert into public.profiles (id, email, name, role, status)
  values (csr_u,  'csr@session-test.invalid',  'Session Test CSR',   'csr', 'active'),
         (csr2_u, 'csr2@session-test.invalid', 'Session Test CSR 2', 'csr', 'active'),
         (opm_u,  'opm@session-test.invalid',  'Session Test OPM',   'opm', 'active');
  insert into public.drivers (id, name, phone, status, auth_user_id) values (drv_id, 'Session Test Driver', phone, 'Assigned', drv_u);
  insert into public.driver_pins (driver_id, pin) values (drv_id, '1111');
  insert into public.assignments (id, destination, destination_area, company, pickup_location, task_status, state, driver_id, driver_name)
  values (asn_id, 'Makati City → Pasay City', 'Pasay City', 'Session test', 'Makati City', 'Assigned', 'active', drv_id, 'Session Test Driver');

  -- Device 1 logged in 10 minutes ago, Device 2 just now (same account).
  d_old := pg_temp.st_session(drv_u, interval '10 minutes');
  d_new := pg_temp.st_session(drv_u, interval '1 second');
  c_old := pg_temp.st_session(csr_u, interval '10 minutes');
  c_new := pg_temp.st_session(csr_u, interval '1 second');
  c2    := pg_temp.st_session(csr2_u, interval '5 minutes');
  o_old := pg_temp.st_session(opm_u, interval '10 minutes');
  o_new := pg_temp.st_session(opm_u, interval '1 second');

  -- ── 1. session_is_current(): newest yes, older no ──
  perform set_config('request.jwt.claims', pg_temp.st_claims(drv_u, d_new), true);
  if not public.session_is_current() then raise exception 'SESSION FAIL: newest driver session not current'; end if;
  perform set_config('request.jwt.claims', pg_temp.st_claims(drv_u, d_old), true);
  if public.session_is_current() then raise exception 'SESSION FAIL: older driver session still current'; end if;
  n := n + 1;

  -- ── 2. Driver, NEW phone: sees own driver row and assignment; may act ──
  perform set_config('request.jwt.claims', pg_temp.st_claims(drv_u, d_new), true);
  set local role authenticated;
  if (select count(*) from public.assignments where id = asn_id) <> 1 or public.my_driver_id() is distinct from drv_id
     or (select count(*) from public.drivers where id = drv_id) <> 1 then
    raise exception 'SESSION FAIL: newest driver session lost access';
  end if;
  err := null; begin perform public.advance_driver_stage(asn_id, 'arrive_pickup');
  exception when others then err := sqlerrm; end;
  if err = 'not_authorized' then raise exception 'SESSION FAIL: newest driver session refused by the stage RPC'; end if;
  reset role;
  n := n + 1;

  -- ── 3. Driver, OLD phone: no driver row, no assignment, no update, no stage, no photo ──
  perform set_config('request.jwt.claims', pg_temp.st_claims(drv_u, d_old), true);
  set local role authenticated;
  if public.my_driver_id() is not null or public.driver_owns_assignment(asn_id)
     or (select count(*) from public.assignments where id = asn_id) <> 0
     or (select count(*) from public.drivers where id = drv_id) <> 0 then
    raise exception 'SESSION FAIL: old driver phone can still read';
  end if;
  update public.assignments set task_status = 'Picked Up' where id = asn_id;
  get diagnostics cnt = row_count;
  if cnt <> 0 then raise exception 'SESSION FAIL: old driver phone updated an assignment'; end if;
  err := null; begin perform public.advance_driver_stage(asn_id, 'arrive_pickup');
  exception when others then err := sqlerrm; end;
  if err is distinct from 'not_authorized' then raise exception 'SESSION FAIL: old driver phone stage RPC gave %', coalesce(err, 'success'); end if;
  ok := false; begin insert into public.status_photos (assignment_id, status, url) values (asn_id, 'pickup', 'x');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'SESSION FAIL: old driver phone added a photo'; end if;
  reset role;
  n := n + 1;

  -- ── 4. CSR: new device works; old device cannot read, write or see its profile ──
  perform set_config('request.jwt.claims', pg_temp.st_claims(csr_u, c_new), true);
  set local role authenticated;
  if not public.is_staff() or not public.can_write()
     or (select count(*) from public.assignments where id = asn_id) <> 1
     or (select count(*) from public.profiles where id = csr_u) <> 1 then
    raise exception 'SESSION FAIL: newest CSR session lost access';
  end if;
  reset role;
  perform set_config('request.jwt.claims', pg_temp.st_claims(csr_u, c_old), true);
  set local role authenticated;
  if public.is_staff() or public.can_write()
     or (select count(*) from public.assignments where id = asn_id) <> 0
     or (select count(*) from public.profiles where id = csr_u) <> 0
     or (select count(*) from public.activity_log) <> 0 then
    raise exception 'SESSION FAIL: old CSR device can still read';
  end if;
  ok := false; begin
    insert into public.assignments (id, destination, destination_area, company, pickup_location, task_status, state)
    values ('ASN-SESSTEST-2', 'A → B', 'Pasay City', 'Session test', 'A', 'Assigned', 'active');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'SESSION FAIL: old CSR device created an assignment'; end if;
  reset role;
  n := n + 1;

  -- ── 5. OPM: new device works; old device cannot read PINs/drivers or reset a PIN ──
  perform set_config('request.jwt.claims', pg_temp.st_claims(opm_u, o_new), true);
  set local role authenticated;
  if not public.is_opm() or (select count(*) from public.driver_pins where driver_id = drv_id) <> 1 then
    raise exception 'SESSION FAIL: newest OPM session lost access';
  end if;
  reset role;
  perform set_config('request.jwt.claims', pg_temp.st_claims(opm_u, o_old), true);
  set local role authenticated;
  if public.is_opm() or (select count(*) from public.driver_pins where driver_id = drv_id) <> 0
     or (select count(*) from public.drivers where id = drv_id) <> 0 then
    raise exception 'SESSION FAIL: old OPM device can still read';
  end if;
  ok := false; begin perform public.reset_driver_pin(drv_id, '2222');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'SESSION FAIL: old OPM device reset a PIN'; end if;
  reset role;
  n := n + 1;

  -- ── 6. Storage: every media policy goes through a session-checked helper ──
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
               and coalesce(qual, '') || coalesce(with_check, '') !~ '(is_staff|can_write|driver_owns_assignment)\(') then
    raise exception 'SESSION FAIL: a Storage policy bypasses the helpers';
  end if;
  perform set_config('request.jwt.claims', pg_temp.st_claims(drv_u, d_old), true);
  if public.driver_owns_assignment(asn_id) then raise exception 'SESSION FAIL: old phone passes the Storage check'; end if;
  n := n + 1;

  -- ── 7. a different account is unaffected ──
  perform set_config('request.jwt.claims', pg_temp.st_claims(csr2_u, c2), true);
  set local role authenticated;
  if not public.can_write() or (select count(*) from public.profiles where id = csr2_u) <> 1 then
    raise exception 'SESSION FAIL: another CSR account was affected';
  end if;
  reset role;
  n := n + 1;

  -- ── 8. my_session_status(): replaced → current (removes older) → still replaced ──
  perform set_config('request.jwt.claims', pg_temp.st_claims(drv_u, d_old), true);
  set local role authenticated;
  st := public.my_session_status();
  reset role;
  if st <> 'replaced' then raise exception 'SESSION FAIL: old phone status %', st; end if;
  perform set_config('request.jwt.claims', pg_temp.st_claims(drv_u, d_new), true);
  set local role authenticated;
  st := public.my_session_status();
  reset role;
  if st <> 'current' or (select count(*) from auth.sessions where user_id = drv_u) <> 1 then
    raise exception 'SESSION FAIL: current status % / sessions left %', st, (select count(*) from auth.sessions where user_id = drv_u);
  end if;
  perform set_config('request.jwt.claims', pg_temp.st_claims(drv_u, d_old), true);
  set local role authenticated;
  st := public.my_session_status();
  reset role;
  if st <> 'replaced' then raise exception 'SESSION FAIL: removed old phone status %', st; end if;
  n := n + 1;

  -- ── 9. no session left (signed out / reset / removed) → signed_out, no access ──
  t_a := pg_temp.st_session(csr2_u, interval '1 minute');
  delete from auth.sessions where user_id = csr2_u;
  perform set_config('request.jwt.claims', pg_temp.st_claims(csr2_u, t_a), true);
  set local role authenticated;
  if public.is_staff() or public.my_session_status() <> 'signed_out' then
    raise exception 'SESSION FAIL: deleted session still usable';
  end if;
  reset role;
  n := n + 1;

  -- ── 10. tokens without session_id, and anonymous callers, get nothing extra ──
  perform set_config('request.jwt.claims', pg_temp.st_claims(csr_u, null), true);
  if public.session_is_current() or public.is_staff() then raise exception 'SESSION FAIL: token without session_id accepted'; end if;
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
  ok := true; begin perform public.request_csr_password_reset('nobody@session-test.invalid');
  exception when others then ok := false; end;
  reset role;
  if not ok or public.session_is_current() then raise exception 'SESSION FAIL: anonymous path broken'; end if;
  n := n + 1;

  -- ── 11. two logins at the same instant → exactly one is current ──
  insert into auth.sessions (id, user_id, created_at, updated_at) values
    (gen_random_uuid(), csr2_u, now(), now()), (gen_random_uuid(), csr2_u, now(), now());
  cnt := 0;
  for s in select id from auth.sessions where user_id = csr2_u loop
    perform set_config('request.jwt.claims', pg_temp.st_claims(csr2_u, s.id), true);
    if public.session_is_current() then cnt := cnt + 1; end if;
  end loop;
  if cnt <> 1 then raise exception 'SESSION FAIL: % sessions current after a same-instant login', cnt; end if;
  n := n + 1;

  -- ── 12. PIN reset (OPM, newest session) ends every session of that driver ──
  perform pg_temp.st_session(drv_u, interval '2 minutes');
  perform pg_temp.st_session(drv_u, interval '1 minute');
  perform set_config('request.jwt.claims', pg_temp.st_claims(opm_u, o_new), true);
  set local role authenticated;
  perform public.reset_driver_pin(drv_id, '2222');
  reset role;
  if (select count(*) from auth.sessions where user_id = drv_u) <> 0
     or (select pin from public.driver_pins where driver_id = drv_id) <> '2222' then
    raise exception 'SESSION FAIL: PIN reset left driver sessions';
  end if;
  n := n + 1;

  -- ── 13. saving a driver whose PIN and phone did NOT change keeps their session ──
  perform pg_temp.st_session(drv_u, interval '1 second');
  perform set_config('request.jwt.claims', pg_temp.st_claims(opm_u, o_new), true);
  set local role authenticated;
  perform public.sync_driver_login(drv_id, phone, '2222');
  reset role;
  if (select count(*) from auth.sessions where user_id = drv_u) <> 1 then
    raise exception 'SESSION FAIL: unchanged driver save ended the session';
  end if;
  n := n + 1;

  -- ── 14. last-active is only touched by the current session ──
  update public.profiles set last_active = null where id = csr_u;
  perform set_config('request.jwt.claims', pg_temp.st_claims(csr_u, c_old), true);
  set local role authenticated;
  perform public.touch_last_active();
  reset role;
  if (select last_active from public.profiles where id = csr_u) is not null then
    raise exception 'SESSION FAIL: old device updated last_active';
  end if;
  perform set_config('request.jwt.claims', pg_temp.st_claims(csr_u, c_new), true);
  set local role authenticated;
  perform public.touch_last_active();
  reset role;
  if (select last_active from public.profiles where id = csr_u) is null then
    raise exception 'SESSION FAIL: current device could not update last_active';
  end if;
  n := n + 1;

  -- ── 15. the service role (Edge Function) is unaffected ──
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  ok := true; begin perform * from public.claim_csr_password_reset(repeat('0', 64));
  exception when others then ok := false; end;
  reset role;
  if not ok then raise exception 'SESSION FAIL: service role path broken'; end if;
  n := n + 1;

  raise exception 'SESSION TESTS PASSED (% checks) — rolled back on purpose, nothing was saved', n;
end
$test$;
rollback;
