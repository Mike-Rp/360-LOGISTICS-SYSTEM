-- ════════════════════════════════════════════════════════════════════════════
-- REQ-018 OPM leave coverage (fleet delegation) — database tests.
-- Run AFTER migration 20261101000000_fleet_delegation.sql.
--
-- Leaves NOTHING behind: one transaction, one DO block that always finishes by
-- raising an exception, then ROLLBACK. Read the final message:
--   "DELEGATION TESTS PASSED (n checks) — rolled back on purpose"  → all good
--   "DELEGATION FAIL: …"                                            → what broke
--
-- Requests are simulated like the session tests do: request.jwt.claims (sub +
-- session_id + a password sign-in time) and role authenticated. Throwaway users
-- only (@delegation-test.invalid); real rows are never touched. Run the whole
-- file at once.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create function pg_temp.dl_session(p_uid uuid) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.sessions (id, user_id, created_at, updated_at) values (v, p_uid, now(), now());
  return v;
end $f$;

-- p_fresh = false → the password was last typed an hour ago (re-auth should be demanded)
create function pg_temp.dl_claims(p_uid uuid, p_sid uuid, p_fresh boolean default true) returns text
language sql as $f$
  select jsonb_build_object(
    'sub', p_uid, 'role', 'authenticated', 'session_id', p_sid,
    'amr', jsonb_build_array(jsonb_build_object('method', 'password',
            'timestamp', extract(epoch from now())::bigint - case when p_fresh then 0 else 3600 end))
  )::text;
$f$;

do $test$
declare
  n      int := 0;
  opm_u  uuid := gen_random_uuid();
  csr_u  uuid := gen_random_uuid();     -- gets both scopes
  csr2_u uuid := gen_random_uuid();     -- PIN reset only (very long window)
  csr3_u uuid := gen_random_uuid();     -- registration only
  csr4_u uuid := gen_random_uuid();     -- never granted anything
  drv_u  uuid := gen_random_uuid();
  drv_id text := 'DR-DELEGTEST';
  phone  text := '+639990007001';
  s_opm uuid; s_csr uuid; s_csr2 uuid; s_csr3 uuid; s_csr4 uuid;
  c_opm text; c_opm_old text; c_csr text; c_csr_old text; c_csr2 text; c_csr3 text; c_csr4 text;
  d1 uuid; d2 uuid; d3 uuid;
  v_pin  text;
  v_pin2 text;
  v_id  text;
  v_pin_until timestamptz; v_reg_until timestamptz;
  cnt   int;
  err   text;
  ok    boolean;
  a     record;
begin
  -- ── setup ──
  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (opm_u,  'authenticated', 'authenticated', 'opm@delegation-test.invalid',  extensions.crypt('x-pass-1', extensions.gen_salt('bf')), now(), now(), now()),
         (csr_u,  'authenticated', 'authenticated', 'csr@delegation-test.invalid',  extensions.crypt('x-pass-2', extensions.gen_salt('bf')), now(), now(), now()),
         (csr2_u, 'authenticated', 'authenticated', 'csr2@delegation-test.invalid', extensions.crypt('x-pass-3', extensions.gen_salt('bf')), now(), now(), now()),
         (csr3_u, 'authenticated', 'authenticated', 'csr3@delegation-test.invalid', extensions.crypt('x-pass-4', extensions.gen_salt('bf')), now(), now(), now()),
         (csr4_u, 'authenticated', 'authenticated', 'csr4@delegation-test.invalid', extensions.crypt('x-pass-5', extensions.gen_salt('bf')), now(), now(), now()),
         (drv_u,  'authenticated', 'authenticated', public.driver_login_email(phone), extensions.crypt('360pin-1111', extensions.gen_salt('bf')), now(), now(), now());
  insert into public.profiles (id, email, name, role, status)
  values (opm_u,  'opm@delegation-test.invalid',  'Delegation Test OPM',   'opm', 'active'),
         (csr_u,  'csr@delegation-test.invalid',  'Delegation Test CSR',   'csr', 'active'),
         (csr2_u, 'csr2@delegation-test.invalid', 'Delegation Test CSR 2', 'csr', 'active'),
         (csr3_u, 'csr3@delegation-test.invalid', 'Delegation Test CSR 3', 'csr', 'active'),
         (csr4_u, 'csr4@delegation-test.invalid', 'Delegation Test CSR 4', 'csr', 'active');
  insert into public.drivers (id, name, phone, status, auth_user_id) values (drv_id, 'Delegation Test Driver', phone, 'Pending', drv_u);
  insert into public.driver_pins (driver_id, pin) values (drv_id, '1111');

  s_opm := pg_temp.dl_session(opm_u);   s_csr := pg_temp.dl_session(csr_u);
  s_csr2 := pg_temp.dl_session(csr2_u); s_csr3 := pg_temp.dl_session(csr3_u); s_csr4 := pg_temp.dl_session(csr4_u);
  c_opm  := pg_temp.dl_claims(opm_u,  s_opm);       c_opm_old := pg_temp.dl_claims(opm_u, s_opm, false);
  c_csr  := pg_temp.dl_claims(csr_u,  s_csr);       c_csr_old := pg_temp.dl_claims(csr_u, s_csr, false);
  c_csr2 := pg_temp.dl_claims(csr2_u, s_csr2);
  c_csr3 := pg_temp.dl_claims(csr3_u, s_csr3);
  c_csr4 := pg_temp.dl_claims(csr4_u, s_csr4);

  -- ── 1. execute / table rights ──
  if has_function_privilege('anon', 'public.delegated_reset_driver_pin(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.grant_fleet_delegation(uuid,timestamptz,timestamptz,boolean,boolean,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.revoke_fleet_delegation(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.my_fleet_delegation()', 'EXECUTE')
     or has_function_privilege('anon', 'public._set_driver_login(text,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._set_driver_login(text,text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.delegated_reset_driver_pin(text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.my_fleet_delegation()', 'EXECUTE') then
    raise exception 'DELEGATION FAIL: wrong execute privileges';
  end if;
  if has_table_privilege('anon', 'public.fleet_delegations', 'SELECT')
     or has_table_privilege('authenticated', 'public.fleet_delegations', 'INSERT')
     or has_table_privilege('authenticated', 'public.fleet_delegations', 'UPDATE')
     or has_table_privilege('authenticated', 'public.fleet_delegations', 'DELETE') then
    raise exception 'DELEGATION FAIL: browser roles can reach fleet_delegations beyond a policy-limited select';
  end if;
  n := n + 1;

  -- ── 2. a CSR with NO grant can do none of the delegated things ──
  perform set_config('request.jwt.claims', c_csr4, true);
  set local role authenticated;
  if public.has_fleet_delegation('pin') or public.has_fleet_delegation('register') then
    raise exception 'DELEGATION FAIL: a CSR without a grant reports access';
  end if;
  select pin_until, register_until into v_pin_until, v_reg_until from public.my_fleet_delegation();
  if v_pin_until is not null or v_reg_until is not null then raise exception 'DELEGATION FAIL: my_fleet_delegation reports a grant that does not exist'; end if;
  err := null; begin perform public.delegated_reset_driver_pin(drv_id); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_authorized' then raise exception 'DELEGATION FAIL: ungranted CSR PIN reset gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.register_truck('ZQZ 9871', 'Test', ''); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_authorized' then raise exception 'DELEGATION FAIL: ungranted CSR truck registration gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.register_driver('Zzdelegate', 'Testdriver', '+639990007002', '4321'); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_authorized' then raise exception 'DELEGATION FAIL: ungranted CSR driver registration gave %', coalesce(err, 'success'); end if;
  reset role;
  n := n + 1;

  -- ── 3. granting: OPM only, password re-entry, sane window, at least one scope ──
  perform set_config('request.jwt.claims', c_csr, true);
  set local role authenticated;
  err := null; begin perform public.grant_fleet_delegation(csr_u, now(), now() + interval '1 day', true, true, '09171234567'); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_authorized' then raise exception 'DELEGATION FAIL: a CSR could grant (%)', coalesce(err, 'success'); end if;
  reset role;

  perform set_config('request.jwt.claims', c_opm_old, true);
  set local role authenticated;
  err := null; begin perform public.grant_fleet_delegation(csr_u, now(), now() + interval '1 day', true, true, '09171234567'); exception when others then err := sqlerrm; end;
  if err is distinct from 'reauth_required' then raise exception 'DELEGATION FAIL: grant without a fresh password gave %', coalesce(err, 'success'); end if;
  reset role;

  perform set_config('request.jwt.claims', c_opm, true);
  set local role authenticated;
  err := null; begin perform public.grant_fleet_delegation(csr_u, now() + interval '2 days', now() + interval '1 day', true, true, '09171234567'); exception when others then err := sqlerrm; end;
  if err is distinct from 'invalid_window' then raise exception 'DELEGATION FAIL: end before start gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.grant_fleet_delegation(csr_u, now() - interval '3 days', now() - interval '1 day', true, true, '09171234567'); exception when others then err := sqlerrm; end;
  if err is distinct from 'invalid_window' then raise exception 'DELEGATION FAIL: a window already over gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.grant_fleet_delegation(csr_u, null, now() + interval '1 day', true, true, '09171234567'); exception when others then err := sqlerrm; end;
  if err is distinct from 'invalid_window' then raise exception 'DELEGATION FAIL: null start gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.grant_fleet_delegation(csr_u, now(), now() + interval '1 day', false, false); exception when others then err := sqlerrm; end;
  if err is distinct from 'no_scope' then raise exception 'DELEGATION FAIL: no scope gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.grant_fleet_delegation(opm_u, now(), now() + interval '1 day', true, true, '09171234567'); exception when others then err := sqlerrm; end;
  if err is distinct from 'member_not_found' then raise exception 'DELEGATION FAIL: granting to the OPM gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.grant_fleet_delegation(gen_random_uuid(), now(), now() + interval '1 day', true, true, '09171234567'); exception when others then err := sqlerrm; end;
  if err is distinct from 'member_not_found' then raise exception 'DELEGATION FAIL: granting to nobody gave %', coalesce(err, 'success'); end if;
  n := n + 1;

  -- ── 4. a valid grant works, is logged, and has NO maximum length ──
  d1 := public.grant_fleet_delegation(csr_u,  now() - interval '1 hour', now() + interval '3 days', true, true, '09171234567');
  perform public.grant_fleet_delegation(csr2_u, now() - interval '1 hour', now() + interval '400 days', true, false, '09181234567');
  reset role;
  if d1 is null or (select count(*) from public.fleet_delegations where id = d1 and csr_id = csr_u and granted_by = opm_u) <> 1 then
    raise exception 'DELEGATION FAIL: the grant row is missing or wrong';
  end if;
  if (select count(*) from public.fleet_delegations where csr_id = csr2_u and ends_at > now() + interval '399 days') <> 1 then
    raise exception 'DELEGATION FAIL: a 400-day window was not accepted';
  end if;
  select * into a from public.activity_log where type = 'delegation_granted' and member_email = 'csr@delegation-test.invalid';
  if not found or a.admin_role is distinct from 'opm' or a.reason not like 'Reset driver PINs + Register drivers & trucks%' then
    raise exception 'DELEGATION FAIL: delegation_granted was not logged correctly (%)', a.reason;
  end if;
  n := n + 1;

  -- ── 5. the granted CSR: sees their access, resets a PIN, gets it once, nothing leaks ──
  perform set_config('request.jwt.claims', c_csr, true);
  set local role authenticated;
  if not public.has_fleet_delegation('pin') or not public.has_fleet_delegation('register') then
    raise exception 'DELEGATION FAIL: granted CSR reports no access';
  end if;
  select pin_until, register_until into v_pin_until, v_reg_until from public.my_fleet_delegation();
  if v_pin_until is null or v_reg_until is null or v_pin_until < now() + interval '2 days' then
    raise exception 'DELEGATION FAIL: my_fleet_delegation wrong (% / %)', v_pin_until, v_reg_until;
  end if;
  reset role;

  perform set_config('request.jwt.claims', c_csr_old, true);
  set local role authenticated;
  err := null; begin perform public.delegated_reset_driver_pin(drv_id); exception when others then err := sqlerrm; end;
  if err is distinct from 'reauth_required' then raise exception 'DELEGATION FAIL: delegated reset without a fresh password gave %', coalesce(err, 'success'); end if;
  reset role;

  perform set_config('request.jwt.claims', c_csr, true);
  set local role authenticated;
  v_pin := public.delegated_reset_driver_pin(drv_id);
  err := null; begin perform public.delegated_reset_driver_pin('DR-NOSUCH'); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_found' then raise exception 'DELEGATION FAIL: reset of a missing driver gave %', coalesce(err, 'success'); end if;
  reset role;
  if v_pin !~ '^[1-9][0-9]{3}$' then raise exception 'DELEGATION FAIL: returned PIN % is not 4 digits', v_pin; end if;
  if (select pin from public.driver_pins where driver_id = drv_id) is distinct from v_pin then
    raise exception 'DELEGATION FAIL: stored PIN does not match the returned one';
  end if;
  if not exists (select 1 from auth.users where id = drv_u and encrypted_password = extensions.crypt('360pin-' || v_pin, encrypted_password)) then
    raise exception 'DELEGATION FAIL: the driver login was not changed to the new PIN';
  end if;
  select * into a from public.activity_log where type = 'driver_pin_reset' and driver_name = 'Delegation Test Driver';
  if not found or a.reason is distinct from 'Under OPM delegation' or a.admin_role is distinct from 'csr'
     or a.admin_email is distinct from 'csr@delegation-test.invalid' then
    raise exception 'DELEGATION FAIL: delegated PIN reset was not logged as the CSR under delegation';
  end if;
  -- Only rows written by this test (same transaction timestamp), and only the PIN-reset kind.
  if exists (select 1 from public.activity_log where type = 'driver_pin_reset' and ts >= now()
              and (coalesce(reason, '') like '%' || v_pin || '%'
                or coalesce(driver_name, '') like '%' || v_pin || '%' or coalesce(member_name, '') like '%' || v_pin || '%')) then
    raise exception 'DELEGATION FAIL: the PIN leaked into the activity log';
  end if;
  n := n + 1;

  -- ── 6. what the delegated CSR still cannot do ──
  perform set_config('request.jwt.claims', c_csr, true);
  set local role authenticated;
  if (select count(*) from public.driver_pins) <> 0 then raise exception 'DELEGATION FAIL: a delegated CSR can READ PINs'; end if;
  if (select count(*) from public.fleet_delegations) <> 0 then raise exception 'DELEGATION FAIL: a CSR can list delegations'; end if;
  err := null; begin perform public.reset_driver_pin(drv_id, '2222'); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_authorized' then raise exception 'DELEGATION FAIL: reset_driver_pin (OPM) gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.sync_driver_login(drv_id, phone, '2222'); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_authorized' then raise exception 'DELEGATION FAIL: sync_driver_login (OPM) gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.archive_driver(drv_id); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_authorized' then raise exception 'DELEGATION FAIL: archive_driver gave %', coalesce(err, 'success'); end if;
  ok := false; begin perform public._set_driver_login(drv_id, phone, '2222'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'DELEGATION FAIL: _set_driver_login is callable from the browser'; end if;
  ok := false; begin insert into public.trucks (id, plate_number, status) values ('T-DIRECT', 'ZQZ 9872', 'Available'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'DELEGATION FAIL: a CSR inserted a truck directly'; end if;
  -- Delegation does not let a CSR edit driver rows directly (name, phone, or re-pointing the login).
  ok := false; begin update public.drivers set phone = '+639990007099' where id = drv_id; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'DELEGATION FAIL: a delegated CSR edited a driver''s phone directly'; end if;
  ok := false; begin update public.drivers set auth_user_id = null where id = drv_id; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'DELEGATION FAIL: a delegated CSR unlinked a driver''s login directly'; end if;
  ok := false; begin insert into public.fleet_delegations (csr_id, granted_by, starts_at, ends_at, can_reset_pin)
    values (csr_u, csr_u, now(), now() + interval '1 day', true); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'DELEGATION FAIL: a CSR granted themselves access'; end if;
  err := null; begin perform public.revoke_fleet_delegation(d1); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_authorized' then raise exception 'DELEGATION FAIL: a CSR revoked a grant (%)', coalesce(err, 'success'); end if;
  reset role;
  if (select pin from public.driver_pins where driver_id = drv_id) is distinct from v_pin then
    raise exception 'DELEGATION FAIL: a blocked call changed the PIN';
  end if;
  n := n + 1;

  -- ── 7. delegated registration of a truck and a driver, logged under delegation ──
  perform set_config('request.jwt.claims', c_csr, true);
  set local role authenticated;
  v_id := public.register_truck('ZQZ 9871', 'Test Truck', '1000');
  reset role;
  if (select count(*) from public.trucks where id = v_id and plate_number = 'ZQZ 9871') <> 1 then raise exception 'DELEGATION FAIL: delegated truck was not created'; end if;
  select * into a from public.activity_log where type = 'truck_added' and truck_plate = 'ZQZ 9871';
  if not found or a.reason is distinct from 'Under OPM delegation' or a.admin_role is distinct from 'csr' then
    raise exception 'DELEGATION FAIL: delegated truck registration not logged under delegation';
  end if;

  perform set_config('request.jwt.claims', c_csr, true);
  set local role authenticated;
  v_id := public.register_driver('Zzdelegate', 'Testdriver', '+639990007002', '4321');
  reset role;
  if (select count(*) from public.drivers where id = v_id and name = 'Zzdelegate Testdriver' and auth_user_id is not null) <> 1 then
    raise exception 'DELEGATION FAIL: delegated driver was not created with a login';
  end if;
  if (select pin from public.driver_pins where driver_id = v_id) is distinct from '4321' then
    raise exception 'DELEGATION FAIL: delegated driver has no PIN';
  end if;
  select * into a from public.activity_log where type = 'driver_added' and driver_name = 'Zzdelegate Testdriver';
  if not found or a.reason is distinct from 'Under OPM delegation' then raise exception 'DELEGATION FAIL: delegated driver registration not logged under delegation'; end if;
  n := n + 1;

  -- ── 8. scopes are separate ──
  perform set_config('request.jwt.claims', c_csr2, true);                 -- PIN only
  set local role authenticated;
  v_pin2 := public.delegated_reset_driver_pin(drv_id);
  err := null; begin perform public.register_truck('ZQZ 9873', 'Test', ''); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_authorized' then raise exception 'DELEGATION FAIL: PIN-only CSR registered a truck (%)', coalesce(err, 'success'); end if;
  reset role;

  insert into public.fleet_delegations (csr_id, granted_by, starts_at, ends_at, can_register)
  values (csr3_u, opm_u, now() - interval '1 hour', now() + interval '1 day', true);   -- registration only
  perform set_config('request.jwt.claims', c_csr3, true);
  set local role authenticated;
  err := null; begin perform public.delegated_reset_driver_pin(drv_id); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_authorized' then raise exception 'DELEGATION FAIL: registration-only CSR reset a PIN (%)', coalesce(err, 'success'); end if;
  perform public.register_truck('ZQZ 9874', 'Test', '');
  reset role;
  n := n + 1;

  -- ── 9. a grant that has not started, or has ended, gives nothing ──
  update public.fleet_delegations set starts_at = now() + interval '1 hour', ends_at = now() + interval '2 hours' where id = d1;
  perform set_config('request.jwt.claims', c_csr, true);
  set local role authenticated;
  if public.has_fleet_delegation('pin') or public.has_fleet_delegation('register') then raise exception 'DELEGATION FAIL: access before the start time'; end if;
  err := null; begin perform public.delegated_reset_driver_pin(drv_id); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_authorized' then raise exception 'DELEGATION FAIL: PIN reset before the start gave %', coalesce(err, 'success'); end if;
  reset role;

  update public.fleet_delegations set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 second' where id = d1;
  perform set_config('request.jwt.claims', c_csr, true);
  set local role authenticated;
  if public.has_fleet_delegation('pin') or public.has_fleet_delegation('register') then raise exception 'DELEGATION FAIL: access after the end time'; end if;
  select pin_until, register_until into v_pin_until, v_reg_until from public.my_fleet_delegation();
  if v_pin_until is not null or v_reg_until is not null then raise exception 'DELEGATION FAIL: my_fleet_delegation lists an ended grant'; end if;
  err := null; begin perform public.register_truck('ZQZ 9875', 'Test', ''); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_authorized' then raise exception 'DELEGATION FAIL: registration after the end gave %', coalesce(err, 'success'); end if;
  reset role;
  n := n + 1;

  -- ── 10. revoking ends access at once, only the OPM can, and it is logged ──
  perform set_config('request.jwt.claims', c_opm, true);
  set local role authenticated;
  d2 := public.grant_fleet_delegation(csr_u, now(), now() + interval '2 days', true, true, '09171234567');
  reset role;
  perform set_config('request.jwt.claims', c_csr, true);
  set local role authenticated;
  if not public.has_fleet_delegation('pin') then raise exception 'DELEGATION FAIL: the new grant did not give access'; end if;
  reset role;
  perform set_config('request.jwt.claims', c_opm, true);
  set local role authenticated;
  perform public.revoke_fleet_delegation(d2);
  err := null; begin perform public.revoke_fleet_delegation(d2); exception when others then err := sqlerrm; end;
  if err is distinct from 'delegation_not_active' then raise exception 'DELEGATION FAIL: revoking twice gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.revoke_fleet_delegation(d1); exception when others then err := sqlerrm; end;
  if err is distinct from 'delegation_not_active' then raise exception 'DELEGATION FAIL: revoking an ended grant gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.revoke_fleet_delegation(gen_random_uuid()); exception when others then err := sqlerrm; end;
  if err is distinct from 'delegation_not_found' then raise exception 'DELEGATION FAIL: revoking nothing gave %', coalesce(err, 'success'); end if;
  reset role;
  perform set_config('request.jwt.claims', c_csr, true);
  set local role authenticated;
  if public.has_fleet_delegation('pin') or public.has_fleet_delegation('register') then raise exception 'DELEGATION FAIL: access survived a revoke'; end if;
  reset role;
  if not exists (select 1 from public.activity_log where type = 'delegation_revoked' and member_email = 'csr@delegation-test.invalid' and admin_role = 'opm') then
    raise exception 'DELEGATION FAIL: the revoke was not logged';
  end if;
  n := n + 1;

  -- ── 11. an archived CSR's grant does nothing ──
  update public.profiles set status = 'removed' where id = csr3_u;
  perform set_config('request.jwt.claims', c_csr3, true);
  set local role authenticated;
  if public.has_fleet_delegation('register') then raise exception 'DELEGATION FAIL: an archived CSR keeps access'; end if;
  err := null; begin perform public.register_truck('ZQZ 9876', 'Test', ''); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_authorized' then raise exception 'DELEGATION FAIL: archived CSR registered a truck (%)', coalesce(err, 'success'); end if;
  reset role;
  perform set_config('request.jwt.claims', c_opm, true);
  set local role authenticated;
  err := null; begin perform public.grant_fleet_delegation(csr3_u, now(), now() + interval '1 day', true, true, '09171234567'); exception when others then err := sqlerrm; end;
  if err is distinct from 'member_not_found' then raise exception 'DELEGATION FAIL: granting to an archived CSR gave %', coalesce(err, 'success'); end if;
  reset role;
  n := n + 1;

  -- ── 12. the OPM sees grants; their own flow is unchanged and not marked as delegated ──
  perform set_config('request.jwt.claims', c_opm, true);
  set local role authenticated;
  select count(*) into cnt from public.fleet_delegations;
  if cnt < 3 then raise exception 'DELEGATION FAIL: the OPM cannot list grants (%)', cnt; end if;
  perform public.reset_driver_pin(drv_id, '3333');
  v_id := public.register_truck('ZQZ 9877', 'Test', '');
  reset role;
  if (select pin from public.driver_pins where driver_id = drv_id) is distinct from '3333' then raise exception 'DELEGATION FAIL: OPM PIN reset broke'; end if;
  select * into a from public.activity_log where type = 'truck_added' and truck_plate = 'ZQZ 9877';
  if not found or a.reason is not null or a.admin_role is distinct from 'opm' then raise exception 'DELEGATION FAIL: OPM registration wrongly marked as delegated'; end if;
  n := n + 1;

  -- ── 13. the driver's public Forgot-PIN number follows the coverage ──
  -- A real OPM profile in this database may already have a number saved; set it aside (inside this
  -- rolled-back transaction) so the checks below only see what the test creates.
  update public.profiles set phone = null where role = 'opm' and id <> opm_u;
  if to_regprocedure('public.grant_fleet_delegation(uuid,timestamptz,timestamptz,boolean,boolean)') is not null then
    raise exception 'DELEGATION FAIL: the old grant function (no contact number) still exists';
  end if;
  if not has_function_privilege('anon', 'public.driver_help_phone()', 'EXECUTE') then
    raise exception 'DELEGATION FAIL: the login screen cannot call driver_help_phone()';
  end if;

  perform set_config('request.jwt.claims', c_opm, true);
  set local role authenticated;
  err := null; begin perform public.grant_fleet_delegation(csr_u, now(), now() + interval '1 day', true, false); exception when others then err := sqlerrm; end;
  if err is distinct from 'invalid_phone' then raise exception 'DELEGATION FAIL: PIN-reset coverage without a number gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.grant_fleet_delegation(csr_u, now(), now() + interval '1 day', true, false, 'not a number'); exception when others then err := sqlerrm; end;
  if err is distinct from 'invalid_phone' then raise exception 'DELEGATION FAIL: a non-number was accepted (%)', coalesce(err, 'success'); end if;
  err := null; begin perform public.grant_fleet_delegation(csr_u, now(), now() + interval '1 day', true, false, '12345'); exception when others then err := sqlerrm; end;
  if err is distinct from 'invalid_phone' then raise exception 'DELEGATION FAIL: a too-short number was accepted (%)', coalesce(err, 'success'); end if;
  d3 := public.grant_fleet_delegation(csr_u, now(), now() + interval '1 day', false, true);          -- registration only: no number needed
  reset role;
  if (select contact_phone from public.fleet_delegations where id = d3) is not null then
    raise exception 'DELEGATION FAIL: registration-only coverage stored a number';
  end if;

  -- csr2's long PIN-reset coverage (number 09181234567) is the only qualifying grant right now
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
  if public.driver_help_phone() is distinct from '09181234567' then
    raise exception 'DELEGATION FAIL: the public number is % (expected the covering number)', coalesce(public.driver_help_phone(), 'null');
  end if;
  reset role;

  -- a newer PIN-reset coverage wins, and "+63 917 123 4567" is stored in local form
  perform set_config('request.jwt.claims', c_opm, true);
  set local role authenticated;
  d3 := public.grant_fleet_delegation(csr_u, now(), now() + interval '1 day', true, false, '+63 917 123 4567');
  reset role;
  if (select contact_phone from public.fleet_delegations where id = d3) is distinct from '09171234567' then
    raise exception 'DELEGATION FAIL: the number was not stored in local form';
  end if;
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
  if public.driver_help_phone() is distinct from '09171234567' then raise exception 'DELEGATION FAIL: the newest coverage did not win'; end if;
  reset role;

  -- revoking it puts the previous number back
  perform set_config('request.jwt.claims', c_opm, true);
  set local role authenticated;
  perform public.revoke_fleet_delegation(d3);
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
  if public.driver_help_phone() is distinct from '09181234567' then raise exception 'DELEGATION FAIL: a revoked coverage is still shown'; end if;
  reset role;

  -- an archived CSR's coverage is ignored even if newer (csr3 was archived in check 11)
  insert into public.fleet_delegations (csr_id, granted_by, starts_at, ends_at, can_reset_pin, contact_phone)
  values (csr3_u, opm_u, now(), now() + interval '1 day', true, '09191234567');
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
  if public.driver_help_phone() is distinct from '09181234567' then raise exception 'DELEGATION FAIL: an archived CSR''s number is shown'; end if;
  reset role;

  -- once the only qualifying coverage has ended, nothing is returned (the screen falls back to the built-in number)
  update public.fleet_delegations set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 second' where csr_id = csr2_u;
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
  if public.driver_help_phone() is not null then raise exception 'DELEGATION FAIL: an ended coverage is still shown (%)', public.driver_help_phone(); end if;
  reset role;
  n := n + 1;

  -- ── 14. the OPM's own profile number is the usual number drivers are shown ──
  -- Only the OPM can set it, with a fresh password, and it must be a real mobile number.
  perform set_config('request.jwt.claims', c_csr, true);
  set local role authenticated;
  err := null; begin perform public.set_own_phone('09171234567'); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_authorized' then raise exception 'DELEGATION FAIL: a CSR set the help number (%)', coalesce(err, 'success'); end if;
  reset role;

  perform set_config('request.jwt.claims', c_opm_old, true);
  set local role authenticated;
  err := null; begin perform public.set_own_phone('09171234567'); exception when others then err := sqlerrm; end;
  if err is distinct from 'reauth_required' then raise exception 'DELEGATION FAIL: setting the number without a fresh password gave %', coalesce(err, 'success'); end if;
  reset role;

  perform set_config('request.jwt.claims', c_opm, true);
  set local role authenticated;
  err := null; begin perform public.set_own_phone('not a number'); exception when others then err := sqlerrm; end;
  if err is distinct from 'invalid_phone' then raise exception 'DELEGATION FAIL: a non-number was accepted as the help number (%)', coalesce(err, 'success'); end if;
  err := null; begin perform public.set_own_phone('0938 4033 6501 111'); exception when others then err := sqlerrm; end;
  if err is distinct from 'invalid_phone' then raise exception 'DELEGATION FAIL: an over-long number was accepted (%)', coalesce(err, 'success'); end if;
  perform public.set_own_phone('+63 917 123 4567');                                  -- any common format, stored in local form
  reset role;
  if (select p.phone from public.profiles p where p.id = opm_u) is distinct from '09171234567' then
    raise exception 'DELEGATION FAIL: the OPM number was not stored in local form';
  end if;
  if not exists (select 1 from public.activity_log where type = 'driver_help_phone_changed' and admin_role = 'opm' and reason = 'Now 09171234567') then
    raise exception 'DELEGATION FAIL: the number change was not logged';
  end if;

  -- With no coverage, the public screen gets the OPM's number
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
  if public.driver_help_phone() is distinct from '09171234567' then raise exception 'DELEGATION FAIL: the public number is not the OPM''s profile number'; end if;
  reset role;

  -- A covering number wins while it is active; revoking it brings the OPM's number back
  perform set_config('request.jwt.claims', c_opm, true);
  set local role authenticated;
  d3 := public.grant_fleet_delegation(csr_u, now(), now() + interval '1 day', true, false, '09181234567');
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
  if public.driver_help_phone() is distinct from '09181234567' then raise exception 'DELEGATION FAIL: coverage did not take over from the OPM number'; end if;
  reset role;
  perform set_config('request.jwt.claims', c_opm, true);
  set local role authenticated;
  perform public.revoke_fleet_delegation(d3);
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
  if public.driver_help_phone() is distinct from '09171234567' then raise exception 'DELEGATION FAIL: the OPM number did not return after coverage ended'; end if;
  reset role;

  -- The number cannot be emptied: blank / whitespace is refused and the saved number stays
  perform set_config('request.jwt.claims', c_opm, true);
  set local role authenticated;
  err := null; begin perform public.set_own_phone(''); exception when others then err := sqlerrm; end;
  if err is distinct from 'phone_required' then raise exception 'DELEGATION FAIL: an empty number gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.set_own_phone('   '); exception when others then err := sqlerrm; end;
  if err is distinct from 'phone_required' then raise exception 'DELEGATION FAIL: a blank number gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.set_own_phone(null); exception when others then err := sqlerrm; end;
  if err is distinct from 'phone_required' then raise exception 'DELEGATION FAIL: a null number gave %', coalesce(err, 'success'); end if;
  reset role;
  if (select p.phone from public.profiles p where p.id = opm_u) is distinct from '09171234567' then
    raise exception 'DELEGATION FAIL: a refused change still altered the saved number';
  end if;
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
  if public.driver_help_phone() is distinct from '09171234567' then raise exception 'DELEGATION FAIL: the public number changed after a refused clear'; end if;
  reset role;

  -- An archived OPM's number is never shown
  update public.profiles set phone = '09171234567' where id = opm_u;
  update public.profiles set status = 'removed' where id = opm_u;
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
  if public.driver_help_phone() is not null then raise exception 'DELEGATION FAIL: an archived OPM''s number is shown'; end if;
  reset role;
  n := n + 1;

  raise exception 'DELEGATION TESTS PASSED (% checks) — rolled back on purpose', n;
end
$test$;

rollback;
