-- ════════════════════════════════════════════════════════════════════════════
-- REQ-019 Driver unavailable / truck maintenance — database tests.
-- Run AFTER migration 20261101000005_fleet_unavailability.sql.
--
-- Leaves NOTHING behind: one transaction, one DO block that always finishes by
-- raising an exception, then ROLLBACK. Read the final message:
--   "UNAVAILABILITY TESTS PASSED (n checks) — rolled back on purpose"  → all good
--   "UNAVAILABILITY FAIL: …"                                            → what broke
--
-- Requests are simulated like the other tests do: request.jwt.claims (sub + session_id +
-- a password sign-in time) and role authenticated. Throwaway users, drivers and trucks only
-- (@unavailability-test.invalid, DR-UNAVT*, T-UNAVT*); real rows are never touched.
-- Run the whole file at once.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create function pg_temp.un_session(p_uid uuid) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.sessions (id, user_id, created_at, updated_at) values (v, p_uid, now(), now());
  return v;
end $f$;

create function pg_temp.un_claims(p_uid uuid, p_sid uuid) returns text
language sql as $f$
  select jsonb_build_object(
    'sub', p_uid, 'role', 'authenticated', 'session_id', p_sid,
    'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint))
  )::text;
$f$;

do $test$
declare
  n      int := 0;
  opm_u  uuid := gen_random_uuid();
  csr_u  uuid := gen_random_uuid();
  s_opm  uuid; s_csr uuid;
  c_opm  text; c_csr text;
  id1    uuid; id5 uuid; idt uuid;
  a2     text; a3 text;
  cnt    int;
  err    text;
  ok     boolean;
  a      record;
  fields jsonb;
begin
  -- ── setup ──
  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (opm_u, 'authenticated', 'authenticated', 'opm@unavailability-test.invalid', extensions.crypt('x-pass-1', extensions.gen_salt('bf')), now(), now(), now()),
         (csr_u, 'authenticated', 'authenticated', 'csr@unavailability-test.invalid', extensions.crypt('x-pass-2', extensions.gen_salt('bf')), now(), now(), now());
  insert into public.profiles (id, email, name, role, status)
  values (opm_u, 'opm@unavailability-test.invalid', 'Unavailability Test OPM', 'opm', 'active'),
         (csr_u, 'csr@unavailability-test.invalid', 'Unavailability Test CSR', 'csr', 'active');
  s_opm := pg_temp.un_session(opm_u);  s_csr := pg_temp.un_session(csr_u);
  c_opm := pg_temp.un_claims(opm_u, s_opm);  c_csr := pg_temp.un_claims(csr_u, s_csr);

  insert into public.drivers (id, name, phone, status) values
    ('DR-UNAVT1', 'Unavail Test One',   '+639990008001', 'Pending'),
    ('DR-UNAVT2', 'Unavail Test Two',   '+639990008002', 'Assigned'),   -- on an active delivery
    ('DR-UNAVT3', 'Unavail Test Three', '+639990008003', 'Pending'),
    ('DR-UNAVT4', 'Unavail Test Four',  '+639990008004', 'Pending'),
    ('DR-UNAVT5', 'Unavail Test Five',  '+639990008005', 'Pending');
  insert into public.trucks (id, plate_number, status) values
    ('T-UNAVT1', 'ZQU 7001', 'Available'),
    ('T-UNAVT2', 'ZQU 7002', 'Assigned'),                                  -- on an active delivery
    ('T-UNAVT3', 'ZQU 7003', 'Available'),
    ('T-UNAVT4', 'ZQU 7004', 'Available'),
    ('T-UNAVT5', 'ZQU 7005', 'Available');
  insert into public.assignments (id, destination, destination_area, company, pickup_location, task_status, state, driver_id, driver_name, truck_id, truck_plate)
  values ('ASN-UNAVT1', 'Makati City → Pasay City', 'Pasay City', 'Unavailability test', 'Makati City', 'Assigned', 'active',
          'DR-UNAVT2', 'Unavail Test Two', 'T-UNAVT2', 'ZQU 7002');

  -- ── 1. execute / table rights ──
  if has_function_privilege('anon', 'public.mark_driver_unavailable(text,text,text,timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public.mark_driver_available(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.mark_truck_maintenance(text,text,timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public.mark_truck_available(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.update_unavailability(uuid,text,timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.driver_is_unavailable(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.truck_is_in_maintenance(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.guard_assignment_availability()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.mark_driver_unavailable(text,text,text,timestamptz)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.update_unavailability(uuid,text,timestamptz)', 'EXECUTE') then
    raise exception 'UNAVAILABILITY FAIL: wrong execute privileges';
  end if;
  if has_table_privilege('anon', 'public.fleet_unavailability', 'SELECT')
     or has_table_privilege('anon', 'public.current_unavailability', 'SELECT')
     or has_table_privilege('authenticated', 'public.fleet_unavailability', 'INSERT')
     or has_table_privilege('authenticated', 'public.fleet_unavailability', 'UPDATE')
     or has_table_privilege('authenticated', 'public.fleet_unavailability', 'DELETE') then
    raise exception 'UNAVAILABILITY FAIL: browser roles can reach the table beyond a policy-limited select';
  end if;
  n := n + 1;

  -- ── 2. a CSR can read but not change anything ──
  perform set_config('request.jwt.claims', c_csr, true);
  set local role authenticated;
  err := null; begin perform public.mark_driver_unavailable('DR-UNAVT1', 'sick'); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_authorized' then raise exception 'UNAVAILABILITY FAIL: a CSR marked a driver (%)', coalesce(err, 'success'); end if;
  err := null; begin perform public.mark_driver_available('DR-UNAVT1'); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_authorized' then raise exception 'UNAVAILABILITY FAIL: a CSR marked a driver back (%)', coalesce(err, 'success'); end if;
  err := null; begin perform public.mark_truck_maintenance('T-UNAVT1'); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_authorized' then raise exception 'UNAVAILABILITY FAIL: a CSR put a truck in maintenance (%)', coalesce(err, 'success'); end if;
  err := null; begin perform public.mark_truck_available('T-UNAVT1'); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_authorized' then raise exception 'UNAVAILABILITY FAIL: a CSR ended maintenance (%)', coalesce(err, 'success'); end if;
  err := null; begin perform public.update_unavailability(gen_random_uuid(), 'x', null); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_authorized' then raise exception 'UNAVAILABILITY FAIL: a CSR updated a period (%)', coalesce(err, 'success'); end if;
  ok := false; begin insert into public.fleet_unavailability (driver_id, reason) values ('DR-UNAVT1', 'sick'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'UNAVAILABILITY FAIL: a CSR inserted a period directly'; end if;
  reset role;
  n := n + 1;

  -- ── 3. the OPM's input is validated and busy people/trucks are refused (nothing is written) ──
  perform set_config('request.jwt.claims', c_opm, true);
  set local role authenticated;
  err := null; begin perform public.mark_driver_unavailable('DR-UNAVT1', 'vacation'); exception when others then err := sqlerrm; end;
  if err is distinct from 'invalid_reason' then raise exception 'UNAVAILABILITY FAIL: unknown reason gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.mark_driver_unavailable('DR-UNAVT1', null); exception when others then err := sqlerrm; end;
  if err is distinct from 'invalid_reason' then raise exception 'UNAVAILABILITY FAIL: null reason gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.mark_driver_unavailable('DR-UNAVT1', 'other'); exception when others then err := sqlerrm; end;
  if err is distinct from 'note_required' then raise exception 'UNAVAILABILITY FAIL: "other" without a note gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.mark_driver_unavailable('DR-UNAVT1', 'other', '   '); exception when others then err := sqlerrm; end;
  if err is distinct from 'note_required' then raise exception 'UNAVAILABILITY FAIL: "other" with a blank note gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.mark_driver_unavailable('DR-UNAVT1', 'sick', repeat('x', 201)); exception when others then err := sqlerrm; end;
  if err is distinct from 'note_too_long' then raise exception 'UNAVAILABILITY FAIL: a 201-character note gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.mark_driver_unavailable('DR-UNAVT1', 'sick', null, now() - interval '1 hour'); exception when others then err := sqlerrm; end;
  if err is distinct from 'invalid_return' then raise exception 'UNAVAILABILITY FAIL: a return date in the past gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.mark_driver_unavailable('DR-NOSUCH', 'sick'); exception when others then err := sqlerrm; end;
  if err is distinct from 'driver_not_found' then raise exception 'UNAVAILABILITY FAIL: an unknown driver gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.mark_driver_unavailable('DR-UNAVT2', 'sick'); exception when others then err := sqlerrm; end;
  if err is distinct from 'driver_busy' then raise exception 'UNAVAILABILITY FAIL: a driver on a delivery gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.mark_truck_maintenance('T-NOSUCH'); exception when others then err := sqlerrm; end;
  if err is distinct from 'truck_not_found' then raise exception 'UNAVAILABILITY FAIL: an unknown truck gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.mark_truck_maintenance('T-UNAVT2'); exception when others then err := sqlerrm; end;
  if err is distinct from 'truck_busy' then raise exception 'UNAVAILABILITY FAIL: a truck on a delivery gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.mark_truck_maintenance('T-UNAVT1', repeat('x', 201)); exception when others then err := sqlerrm; end;
  if err is distinct from 'note_too_long' then raise exception 'UNAVAILABILITY FAIL: a truck note over 200 characters gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.mark_truck_maintenance('T-UNAVT1', null, now() - interval '1 hour'); exception when others then err := sqlerrm; end;
  if err is distinct from 'invalid_return' then raise exception 'UNAVAILABILITY FAIL: a truck return date in the past gave %', coalesce(err, 'success'); end if;
  reset role;
  if (select count(*) from public.fleet_unavailability where driver_id like 'DR-UNAVT%' or truck_id like 'T-UNAVT%') <> 0 then
    raise exception 'UNAVAILABILITY FAIL: a refused request still wrote a row';
  end if;
  n := n + 1;

  -- ── 4. marking a driver: recorded, visible to staff, logged, once at a time ──
  perform set_config('request.jwt.claims', c_opm, true);
  set local role authenticated;
  id1 := public.mark_driver_unavailable('DR-UNAVT1', 'sick', 'flu', now() + interval '2 days');
  err := null; begin perform public.mark_driver_unavailable('DR-UNAVT1', 'leave'); exception when others then err := sqlerrm; end;
  if err is distinct from 'already_unavailable' then raise exception 'UNAVAILABILITY FAIL: marking twice gave %', coalesce(err, 'success'); end if;
  reset role;
  perform set_config('request.jwt.claims', c_csr, true);
  set local role authenticated;
  select count(*) into cnt from public.current_unavailability where driver_id = 'DR-UNAVT1' and reason = 'sick' and note = 'flu';
  reset role;
  if id1 is null or cnt <> 1 then raise exception 'UNAVAILABILITY FAIL: staff cannot see the active period (%)', cnt; end if;
  select * into a from public.activity_log where type = 'driver_unavailable' and driver_name = 'Unavail Test One';
  if not found or a.admin_role is distinct from 'opm' or a.reason is distinct from 'Sick — flu' then
    raise exception 'UNAVAILABILITY FAIL: the marking was not logged correctly (%)', a.reason;
  end if;
  n := n + 1;

  -- ── 5. a no-show with no return date lasts until the end of today (Manila) ──
  perform set_config('request.jwt.claims', c_opm, true);
  set local role authenticated;
  perform public.mark_driver_unavailable('DR-UNAVT3', 'no_show');
  reset role;
  select * into a from public.fleet_unavailability where driver_id = 'DR-UNAVT3' and ended_at is null;
  if not found or a.expected_return_at <= now() or a.expected_return_at > now() + interval '24 hours 1 minute'
     or (a.expected_return_at at time zone 'Asia/Manila')::time <> '00:00:00' then
    raise exception 'UNAVAILABILITY FAIL: a no-show did not default to the end of today (%)', a.expected_return_at;
  end if;
  n := n + 1;

  -- ── 6. dispatch refuses an unavailable driver and a truck in maintenance; normal dispatch still works ──
  perform set_config('request.jwt.claims', c_opm, true);
  set local role authenticated;
  perform public.mark_truck_maintenance('T-UNAVT1', 'brakes', now() + interval '1 day');
  reset role;

  perform set_config('request.jwt.claims', c_csr, true);
  set local role authenticated;
  fields := jsonb_build_object('driver_id', 'DR-UNAVT1', 'truck_id', 'T-UNAVT3', 'destination', 'Makati City',
                               'destination_area', 'Pasay City', 'company', 'Unavailability test', 'pickup_location', 'Makati City');
  err := null; begin perform public.dispatch_assignment(fields); exception when others then err := sqlerrm; end;
  if err is distinct from 'driver_unavailable' then raise exception 'UNAVAILABILITY FAIL: dispatch to a sick driver gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.dispatch_assignment(fields || jsonb_build_object('driver_id', 'DR-UNAVT3')); exception when others then err := sqlerrm; end;
  if err is distinct from 'driver_unavailable' then raise exception 'UNAVAILABILITY FAIL: dispatch to a no-show driver gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.dispatch_assignment(fields || jsonb_build_object('driver_id', 'DR-UNAVT4', 'truck_id', 'T-UNAVT1')); exception when others then err := sqlerrm; end;
  if err is distinct from 'truck_under_maintenance' then raise exception 'UNAVAILABILITY FAIL: dispatch with a truck in maintenance gave %', coalesce(err, 'success'); end if;
  a2 := public.dispatch_assignment(fields || jsonb_build_object('driver_id', 'DR-UNAVT4'));      -- free driver + free truck
  reset role;
  if a2 is null then raise exception 'UNAVAILABILITY FAIL: a normal dispatch no longer works'; end if;

  -- a driver / truck swap on an existing delivery goes through the same guard (UPDATE of driver_id / truck_id)
  err := null; begin update public.assignments set driver_id = 'DR-UNAVT1' where id = a2; exception when others then err := sqlerrm; end;
  if err is distinct from 'driver_unavailable' then raise exception 'UNAVAILABILITY FAIL: a swap to an unavailable driver gave %', coalesce(err, 'success'); end if;
  err := null; begin update public.assignments set truck_id = 'T-UNAVT1' where id = a2; exception when others then err := sqlerrm; end;
  if err is distinct from 'truck_under_maintenance' then raise exception 'UNAVAILABILITY FAIL: a swap to a truck in maintenance gave %', coalesce(err, 'success'); end if;
  update public.assignments set remarks = 'unrelated edit' where id = a2;                         -- other edits are untouched
  update public.assignments set driver_id = driver_id where id = a2;                              -- same driver re-saved is fine
  n := n + 1;

  -- ── 7. truck maintenance: visible, logged, once at a time, never while on a delivery ──
  select count(*) into cnt from public.current_unavailability where truck_id = 'T-UNAVT1' and reason = 'maintenance' and note = 'brakes';
  if cnt <> 1 then raise exception 'UNAVAILABILITY FAIL: the maintenance period is not visible (%)', cnt; end if;
  if not exists (select 1 from public.activity_log where type = 'truck_maintenance_started' and truck_plate = 'ZQU 7001'
                    and admin_role = 'opm' and reason = 'Maintenance — brakes') then
    raise exception 'UNAVAILABILITY FAIL: the maintenance start was not logged correctly';
  end if;
  perform set_config('request.jwt.claims', c_opm, true);
  set local role authenticated;
  err := null; begin perform public.mark_truck_maintenance('T-UNAVT1'); exception when others then err := sqlerrm; end;
  if err is distinct from 'already_unavailable' then raise exception 'UNAVAILABILITY FAIL: a second maintenance period gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.mark_truck_maintenance('T-UNAVT3'); exception when others then err := sqlerrm; end;    -- T3 is now on the delivery from check 6
  if err is distinct from 'truck_busy' then raise exception 'UNAVAILABILITY FAIL: a truck that was just dispatched gave %', coalesce(err, 'success'); end if;
  reset role;
  n := n + 1;

  -- ── 8. updating a period: OPM only, validated, replaces both values ──
  perform set_config('request.jwt.claims', c_csr, true);
  set local role authenticated;
  err := null; begin perform public.update_unavailability(id1, 'x', null); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_authorized' then raise exception 'UNAVAILABILITY FAIL: a CSR updated a real period (%)', coalesce(err, 'success'); end if;
  reset role;

  perform set_config('request.jwt.claims', c_opm, true);
  set local role authenticated;
  id5 := public.mark_driver_unavailable('DR-UNAVT5', 'other', 'jury duty');
  err := null; begin perform public.update_unavailability(id5, '   ', null); exception when others then err := sqlerrm; end;
  if err is distinct from 'note_required' then raise exception 'UNAVAILABILITY FAIL: emptying the note of an "other" period gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.update_unavailability(id1, 'x', now() - interval '1 hour'); exception when others then err := sqlerrm; end;
  if err is distinct from 'invalid_return' then raise exception 'UNAVAILABILITY FAIL: a past return date in an update gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.update_unavailability(id1, repeat('x', 201), null); exception when others then err := sqlerrm; end;
  if err is distinct from 'note_too_long' then raise exception 'UNAVAILABILITY FAIL: an over-long note in an update gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.update_unavailability(gen_random_uuid(), 'x', null); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_unavailable' then raise exception 'UNAVAILABILITY FAIL: updating nothing gave %', coalesce(err, 'success'); end if;
  perform public.update_unavailability(id1, 'recovering', null);                                  -- open-ended now
  reset role;
  select * into a from public.fleet_unavailability where id = id1;
  if a.note is distinct from 'recovering' or a.expected_return_at is not null then
    raise exception 'UNAVAILABILITY FAIL: the update did not replace the note and return date';
  end if;
  if not exists (select 1 from public.activity_log where type = 'unavailability_updated' and driver_name = 'Unavail Test One' and admin_role = 'opm') then
    raise exception 'UNAVAILABILITY FAIL: the update was not logged';
  end if;
  n := n + 1;

  -- ── 9. marking back ends it at once, is logged, and unblocks dispatch ──
  perform set_config('request.jwt.claims', c_opm, true);
  set local role authenticated;
  perform public.mark_driver_available('DR-UNAVT1');
  err := null; begin perform public.mark_driver_available('DR-UNAVT1'); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_unavailable' then raise exception 'UNAVAILABILITY FAIL: marking back twice gave %', coalesce(err, 'success'); end if;
  perform public.mark_truck_available('T-UNAVT1');
  err := null; begin perform public.mark_truck_available('T-UNAVT1'); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_unavailable' then raise exception 'UNAVAILABILITY FAIL: ending maintenance twice gave %', coalesce(err, 'success'); end if;
  reset role;
  if exists (select 1 from public.current_unavailability where driver_id = 'DR-UNAVT1' or truck_id = 'T-UNAVT1') then
    raise exception 'UNAVAILABILITY FAIL: still listed as unavailable after marking back';
  end if;
  if not exists (select 1 from public.activity_log where type = 'driver_available_again' and driver_name = 'Unavail Test One' and admin_role = 'opm')
     or not exists (select 1 from public.activity_log where type = 'truck_maintenance_ended' and truck_plate = 'ZQU 7001' and admin_role = 'opm') then
    raise exception 'UNAVAILABILITY FAIL: marking back was not logged';
  end if;
  perform set_config('request.jwt.claims', c_csr, true);
  set local role authenticated;
  a3 := public.dispatch_assignment(jsonb_build_object('driver_id', 'DR-UNAVT1', 'truck_id', 'T-UNAVT1', 'destination', 'Makati City',
          'destination_area', 'Pasay City', 'company', 'Unavailability test', 'pickup_location', 'Makati City'));
  reset role;
  if a3 is null then raise exception 'UNAVAILABILITY FAIL: dispatch is still blocked after marking back'; end if;
  n := n + 1;

  -- ── 10. a period whose return date has passed is over by itself ──
  update public.fleet_unavailability set created_at = now() - interval '2 hours', expected_return_at = now() - interval '1 hour'
   where driver_id = 'DR-UNAVT3' and ended_at is null;
  if exists (select 1 from public.current_unavailability where driver_id = 'DR-UNAVT3') or public.driver_is_unavailable('DR-UNAVT3') then
    raise exception 'UNAVAILABILITY FAIL: an expired period is still active';
  end if;
  perform set_config('request.jwt.claims', c_opm, true);
  set local role authenticated;
  err := null; begin perform public.mark_driver_available('DR-UNAVT3'); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_unavailable' then raise exception 'UNAVAILABILITY FAIL: marking back an expired period gave %', coalesce(err, 'success'); end if;
  perform public.mark_driver_unavailable('DR-UNAVT3', 'sick');                                    -- the expired one is closed, a new one opens
  reset role;
  if (select count(*) from public.fleet_unavailability where driver_id = 'DR-UNAVT3') <> 2
     or (select count(*) from public.fleet_unavailability where driver_id = 'DR-UNAVT3' and ended_at is null) <> 1 then
    raise exception 'UNAVAILABILITY FAIL: re-marking after an expiry left the wrong rows';
  end if;
  n := n + 1;

  -- ── 11. archiving a driver / truck ends its open period ──
  perform set_config('request.jwt.claims', c_opm, true);
  set local role authenticated;
  idt := public.mark_truck_maintenance('T-UNAVT5');
  reset role;
  update public.drivers set archived_at = now() where id = 'DR-UNAVT5';
  update public.trucks  set archived_at = now() where id = 'T-UNAVT5';
  if (select ended_at from public.fleet_unavailability where id = id5) is null
     or (select ended_at from public.fleet_unavailability where id = idt) is null then
    raise exception 'UNAVAILABILITY FAIL: archiving did not end the open period';
  end if;
  perform set_config('request.jwt.claims', c_opm, true);
  set local role authenticated;
  err := null; begin perform public.mark_driver_unavailable('DR-UNAVT5', 'sick'); exception when others then err := sqlerrm; end;
  if err is distinct from 'driver_archived' then raise exception 'UNAVAILABILITY FAIL: marking an archived driver gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.mark_truck_maintenance('T-UNAVT5'); exception when others then err := sqlerrm; end;
  if err is distinct from 'truck_archived' then raise exception 'UNAVAILABILITY FAIL: marking an archived truck gave %', coalesce(err, 'success'); end if;
  reset role;
  n := n + 1;

  -- ── 12. the table's own rules hold even for direct writes ──
  ok := false; begin insert into public.fleet_unavailability (driver_id, reason) values ('DR-UNAVT3', 'sick'); exception when unique_violation then ok := true; end;
  if not ok then raise exception 'UNAVAILABILITY FAIL: two open periods for one driver were allowed'; end if;
  ok := false; begin insert into public.fleet_unavailability (driver_id, reason) values ('DR-UNAVT4', 'maintenance'); exception when check_violation then ok := true; end;
  if not ok then raise exception 'UNAVAILABILITY FAIL: a driver was given the truck reason'; end if;
  ok := false; begin insert into public.fleet_unavailability (truck_id, reason) values ('T-UNAVT4', 'sick'); exception when check_violation then ok := true; end;
  if not ok then raise exception 'UNAVAILABILITY FAIL: a truck was given a driver reason'; end if;
  ok := false; begin insert into public.fleet_unavailability (driver_id, truck_id, reason) values ('DR-UNAVT4', 'T-UNAVT4', 'sick'); exception when check_violation then ok := true; end;
  if not ok then raise exception 'UNAVAILABILITY FAIL: one period was attached to a driver and a truck'; end if;
  ok := false; begin insert into public.fleet_unavailability (driver_id, reason, note) values ('DR-UNAVT4', 'other', ''); exception when check_violation then ok := true; end;
  if not ok then raise exception 'UNAVAILABILITY FAIL: "other" without a note was allowed'; end if;
  n := n + 1;

  raise exception 'UNAVAILABILITY TESTS PASSED (% checks) — rolled back on purpose', n;
end
$test$;

rollback;
