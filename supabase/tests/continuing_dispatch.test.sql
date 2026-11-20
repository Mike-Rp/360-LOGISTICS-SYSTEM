-- Run after 20261118000000_continuing_dispatch.sql in an authorized test DB.
-- The final success exception intentionally aborts this entire transaction.
begin;
do $test$
declare
  n integer := 0;
  csr_u uuid := gen_random_uuid();
  opm_u uuid := gen_random_uuid();
  csr_s uuid := gen_random_uuid();
  opm_s uuid := gen_random_uuid();
  csr_claims text;
  opm_claims text;
  source_id text := 'ASN-CDTEST-SOURCE';
  incomplete_id text := 'ASN-CDTEST-INCOMPLETE';
  d1 text := 'DR-CDTEST-1';
  d2 text := 'DR-CDTEST-2';
  t1 text := 'TRK-CDTEST-1';
  t2 text := 'TRK-CDTEST-2';
  request jsonb := jsonb_build_object(
    'driver_id', 'DR-CDTEST-1', 'truck_id', 'TRK-CDTEST-1',
    'destination', 'Naga City → Legazpi City', 'destination_area', 'Legazpi City',
    'company', 'Continuing test', 'pickup_location', 'Test pickup, Naga City',
    'delivery_location', 'Test delivery, Legazpi City', 'pickup_time', '09:00 AM',
    'picked_up_date', 'Nov 19, 2026', 'scheduled_arrival_time', '02:00 PM',
    'delivery_date', 'Nov 19, 2026', 'remarks', 'Test only');
  new_id text;
  err text;
begin
  insert into auth.users (id, aud, role, email, created_at, updated_at) values
    (csr_u, 'authenticated', 'authenticated', 'csr@continuing-test.invalid', now(), now()),
    (opm_u, 'authenticated', 'authenticated', 'opm@continuing-test.invalid', now(), now());
  insert into public.profiles (id, email, name, role, status) values
    (csr_u, 'csr@continuing-test.invalid', 'Continuing Test CSR', 'csr', 'active'),
    (opm_u, 'opm@continuing-test.invalid', 'Continuing Test OPM', 'opm', 'active');
  insert into auth.sessions (id, user_id, created_at, updated_at) values
    (csr_s, csr_u, now(), now()), (opm_s, opm_u, now(), now());
  insert into public.drivers (id, name, phone, status) values
    (d1, 'Continuing Test Driver One', '+639990008101', 'Assigned'),
    (d2, 'Continuing Test Driver Two', '+639990008102', 'Pending');
  insert into public.trucks (id, plate_number, status) values
    (t1, 'CNT-0001', 'Assigned'), (t2, 'CNT-0002', 'Available');
  insert into public.assignments
    (id, driver_id, driver_name, truck_id, truck_plate, destination, destination_area,
     company, pickup_location, task_status, state)
  values
    (source_id, d1, 'Continuing Test Driver One', t1, 'CNT-0001', 'Laguna → Naga',
     'Naga City', 'Previous test', 'Laguna test pickup', 'Delivered', 'active'),
    (incomplete_id, d2, 'Continuing Test Driver Two', t2, 'CNT-0002', 'Laguna → Bicol',
     'Legazpi City', 'Incomplete test', 'Laguna test pickup', 'Delivered', 'active');
  insert into public.assignment_documents (assignment_id, type, position, uploaded, doc_status)
  select source_id, types.type, types.position, true, 'approved'
  from unnest(array['Proof of Delivery', 'Receiving Acknowledgement Report', 'Dispatch Slip',
                    'Sales Invoice', 'Bill of Lading', 'Waybill / Delivery Receipt'])
    with ordinality as types(type, position);
  insert into public.assignment_documents (assignment_id, type, position, uploaded, doc_status)
  select incomplete_id, type, position, true, 'approved'
  from public.assignment_documents where assignment_id = source_id;
  update public.assignment_documents set doc_status = 'pending'
    where assignment_id = incomplete_id and type = 'Proof of Delivery';
  csr_claims := jsonb_build_object('sub', csr_u, 'role', 'authenticated', 'session_id', csr_s)::text;
  opm_claims := jsonb_build_object('sub', opm_u, 'role', 'authenticated', 'session_id', opm_s)::text;

  if has_function_privilege('anon', 'public.dispatch_continuing_assignment(text,jsonb,boolean)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.dispatch_continuing_assignment(text,jsonb,boolean)', 'EXECUTE') then
    raise exception 'CONTINUING FAIL: incorrect execute grants';
  end if;
  n := n + 1;

  set local role authenticated;
  perform set_config('request.jwt.claims', opm_claims, true);
  if public.continuing_dispatch_capability() then raise exception 'CONTINUING FAIL: OPM capability'; end if;
  err := null;
  begin perform public.dispatch_continuing_assignment(source_id, request, true);
  exception when others then err := sqlerrm; end;
  if err is distinct from 'not_authorized' then raise exception 'CONTINUING FAIL: OPM call gave %', coalesce(err, 'success'); end if;
  n := n + 1;

  perform set_config('request.jwt.claims', csr_claims, true);
  if not public.continuing_dispatch_capability() then raise exception 'CONTINUING FAIL: CSR capability'; end if;
  err := null;
  begin perform public.dispatch_continuing_assignment(source_id, request, false);
  exception when others then err := sqlerrm; end;
  if err is distinct from 'operational_review_required' then raise exception 'CONTINUING FAIL: review gate gave %', coalesce(err, 'success'); end if;
  n := n + 1;

  err := null;
  begin perform public.dispatch_continuing_assignment(incomplete_id,
    request || jsonb_build_object('driver_id', d2, 'truck_id', t2), true);
  exception when others then err := sqlerrm; end;
  if err is distinct from 'source_not_completed' then raise exception 'CONTINUING FAIL: Delivered-only source gave %', coalesce(err, 'success'); end if;
  n := n + 1;

  err := null;
  begin perform public.dispatch_continuing_assignment(source_id,
    request || jsonb_build_object('truck_id', t2), true);
  exception when others then err := sqlerrm; end;
  if err is distinct from 'source_not_completed' then raise exception 'CONTINUING FAIL: source was not yet Completed'; end if;
  n := n + 1;

  perform public.complete_assignment(source_id);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  if (select state from public.assignments where id = source_id) <> 'completed'
     or (select completed_at_utc from public.assignments where id = source_id) is null then
    raise exception 'CONTINUING FAIL: source completion not persisted';
  end if;
  n := n + 1;

  set local role authenticated;
  perform set_config('request.jwt.claims', csr_claims, true);
  err := null;
  begin perform public.dispatch_continuing_assignment(source_id,
    request || jsonb_build_object('driver_id', d2), true);
  exception when others then err := sqlerrm; end;
  if err is distinct from 'source_pair_mismatch' then raise exception 'CONTINUING FAIL: pair mismatch gave %', coalesce(err, 'success'); end if;
  n := n + 1;

  reset role;
  perform set_config('request.jwt.claims', '', true);
  update public.assignments set truck_id = null where id = source_id;
  set local role authenticated;
  perform set_config('request.jwt.claims', csr_claims, true);
  err := null;
  begin perform public.dispatch_continuing_assignment(source_id, request, true);
  exception when others then err := sqlerrm; end;
  if err is distinct from 'source_pair_missing' then raise exception 'CONTINUING FAIL: missing pair gave %', coalesce(err, 'success'); end if;
  n := n + 1;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  update public.assignments set truck_id = t1 where id = source_id;

  reset role;
  perform set_config('request.jwt.claims', '', true);
  update public.assignments set state = 'completed', completed_at_utc = now(), completed_at = 'Nov 18, 2026'
    where id = incomplete_id;
  set local role authenticated;
  perform set_config('request.jwt.claims', csr_claims, true);
  err := null;
  begin perform public.dispatch_continuing_assignment(incomplete_id,
    request || jsonb_build_object('driver_id', d2, 'truck_id', t2), true);
  exception when others then err := sqlerrm; end;
  if err is distinct from 'source_documents_not_approved' then raise exception 'CONTINUING FAIL: incomplete docs gave %', coalesce(err, 'success'); end if;
  n := n + 1;

  -- An older fixture models a conflict without making the completed source stale.
  reset role;
  perform set_config('request.jwt.claims', '', true);
  insert into public.assignments (id, driver_id, truck_id, destination_area, task_status, state, created_at)
    values ('ASN-CDTEST-BUSY', d1, t2, 'Naga City', 'Assigned', 'active', now() - interval '1 day');
  set local role authenticated;
  perform set_config('request.jwt.claims', csr_claims, true);
  err := null;
  begin perform public.dispatch_continuing_assignment(source_id, request, true);
  exception when others then err := sqlerrm; end;
  if err is distinct from 'driver_busy' then raise exception 'CONTINUING FAIL: busy driver gave %', coalesce(err, 'success'); end if;
  n := n + 1;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  delete from public.assignments where id = 'ASN-CDTEST-BUSY';

  insert into public.assignments (id, driver_id, truck_id, destination_area, task_status, state, created_at)
    values ('ASN-CDTEST-TRUCK-BUSY', d2, t1, 'Naga City', 'Assigned', 'active', now() - interval '1 day');
  set local role authenticated;
  perform set_config('request.jwt.claims', csr_claims, true);
  err := null;
  begin perform public.dispatch_continuing_assignment(source_id, request, true);
  exception when others then err := sqlerrm; end;
  if err is distinct from 'truck_unavailable' then raise exception 'CONTINUING FAIL: busy truck gave %', coalesce(err, 'success'); end if;
  n := n + 1;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  delete from public.assignments where id = 'ASN-CDTEST-TRUCK-BUSY';

  insert into public.assignments (id, driver_id, truck_id, destination_area, task_status, state, created_at)
    values ('ASN-CDTEST-LATER', d1, t2, 'Naga City', 'Cancelled', 'cancelled', now() + interval '1 minute');
  set local role authenticated;
  perform set_config('request.jwt.claims', csr_claims, true);
  err := null;
  begin perform public.dispatch_continuing_assignment(source_id, request, true);
  exception when others then err := sqlerrm; end;
  if err is distinct from 'source_stale' then raise exception 'CONTINUING FAIL: later assignment gave %', coalesce(err, 'success'); end if;
  n := n + 1;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  delete from public.assignments where id = 'ASN-CDTEST-LATER';

  insert into public.fleet_unavailability (driver_id, reason) values (d1, 'leave');
  set local role authenticated;
  perform set_config('request.jwt.claims', csr_claims, true);
  err := null;
  begin perform public.dispatch_continuing_assignment(source_id, request, true);
  exception when others then err := sqlerrm; end;
  if err is distinct from 'driver_unavailable' then raise exception 'CONTINUING FAIL: unavailable driver gave %', coalesce(err, 'success'); end if;
  n := n + 1;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  delete from public.fleet_unavailability where driver_id = d1;

  insert into public.fleet_unavailability (truck_id, reason) values (t1, 'maintenance');
  set local role authenticated;
  perform set_config('request.jwt.claims', csr_claims, true);
  err := null;
  begin perform public.dispatch_continuing_assignment(source_id, request, true);
  exception when others then err := sqlerrm; end;
  if err is distinct from 'truck_under_maintenance' then raise exception 'CONTINUING FAIL: maintained truck gave %', coalesce(err, 'success'); end if;
  n := n + 1;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  delete from public.fleet_unavailability where truck_id = t1;

  reset role;
  perform set_config('request.jwt.claims', opm_claims, true);
  update public.drivers set archived_at = now() where id = d1;
  set local role authenticated;
  perform set_config('request.jwt.claims', csr_claims, true);
  err := null;
  begin perform public.dispatch_continuing_assignment(source_id, request, true);
  exception when others then err := sqlerrm; end;
  if err is distinct from 'driver_archived' then raise exception 'CONTINUING FAIL: archived driver gave %', coalesce(err, 'success'); end if;
  n := n + 1;
  reset role;
  perform set_config('request.jwt.claims', opm_claims, true);
  update public.drivers set archived_at = null where id = d1;

  set local role authenticated;
  perform set_config('request.jwt.claims', csr_claims, true);
  if public.dispatch_assignment(request || jsonb_build_object('driver_id', d2, 'truck_id', t2)) !~ '^ASN[0-9]{5}$' then
    raise exception 'CONTINUING FAIL: normal dispatch changed';
  end if;
  n := n + 1;

  new_id := public.dispatch_continuing_assignment(source_id, request, true);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  if new_id = source_id or new_id !~ '^ASN[0-9]{5}$'
     or (select continuation_source_id from public.assignments where id = new_id) <> source_id
     or (select continuation_reviewed_by from public.assignments where id = new_id) <> csr_u
     or (select continuation_reviewed_at from public.assignments where id = new_id) is null
     or (select state from public.assignments where id = source_id) <> 'completed'
     or (select destination from public.assignments where id = source_id) <> 'Laguna → Naga'
     or (select count(*) from public.assignment_documents where assignment_id = source_id
          and uploaded and doc_status = 'approved') <> 6 then
    raise exception 'CONTINUING FAIL: new ASN, relationship, or original history incorrect';
  end if;
  n := n + 1;

  if (select count(*) from public.assignment_documents where assignment_id = new_id
      and not uploaded and doc_status = 'pending') <> 6
     or (select status from public.drivers where id = d1) <> 'Assigned'
     or (select status from public.trucks where id = t1) <> 'Assigned' then
    raise exception 'CONTINUING FAIL: new document slots or resource status incorrect';
  end if;
  n := n + 1;

  set local role authenticated;
  perform set_config('request.jwt.claims', csr_claims, true);
  err := null;
  begin perform public.dispatch_continuing_assignment(source_id, request, true);
  exception when others then err := sqlerrm; end;
  if err is distinct from 'source_stale' then raise exception 'CONTINUING FAIL: reused source gave %', coalesce(err, 'success'); end if;
  err := null;
  begin update public.assignments set continuation_source_id = null where id = new_id;
  exception when others then err := sqlerrm; end;
  if err is distinct from 'not_authorized' then raise exception 'CONTINUING FAIL: direct link edit gave %', coalesce(err, 'success'); end if;
  n := n + 1;

  raise exception 'CONTINUING TESTS PASSED (% checks) — rolled back on purpose', n;
end
$test$;
rollback;
