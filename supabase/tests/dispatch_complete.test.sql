-- ════════════════════════════════════════════════════════════════════════════
-- Dispatch / completion database tests (run AFTER 20261021000004_dispatch_complete_rpcs.sql).
--
-- Leaves NOTHING behind: one transaction, one DO block that always finishes by
-- raising an exception, then ROLLBACK. Read the final message:
--   "DISPATCH TESTS PASSED (n checks) — rolled back on purpose"  → all good
--   "DISPATCH FAIL: …"                                            → what broke
--
-- Throwaway users / drivers / trucks only (@dispatch-test.invalid, ids
-- containing DISPTEST); real rows are never touched. Check 12 adds a temporary
-- trigger (and its function) on activity_log that only fires for the test
-- driver; the rollback removes both. Run the whole file at once.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create function pg_temp.dt_claims(p_uid uuid, p_sid uuid) returns text
language sql as $f$
  select jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', p_sid)::text;
$f$;

-- Makes the test driver's activity-log insert fail (for the all-or-nothing check).
create function public.dt_fail_log_tmp() returns trigger
language plpgsql as $f$
begin
  if new.driver_name = 'Dispatch Test Fail Driver' then raise exception 'forced_log_failure'; end if;
  return new;
end $f$;

do $test$
declare
  n      int := 0;
  csr_u  uuid := gen_random_uuid();
  opm_u  uuid := gen_random_uuid();
  drv_u  uuid := gen_random_uuid();
  csr_s  uuid := gen_random_uuid();
  csr_old uuid := gen_random_uuid();
  opm_s  uuid := gen_random_uuid();
  drv_s  uuid := gen_random_uuid();
  d1 text := 'DR-DISPTEST-1';  d2 text := 'DR-DISPTEST-2';  d3 text := 'DR-DISPTEST-3';
  d_arch text := 'DR-DISPTEST-ARCH';  d_fail text := 'DR-DISPTEST-FAIL';
  t1 text := 'TRK-DISPTEST-1'; t2 text := 'TRK-DISPTEST-2'; t3 text := 'TRK-DISPTEST-3'; t4 text := 'TRK-DISPTEST-4';
  c_opm text; c_drv text; c_csr_old text; c_csr text;
  -- a valid dispatch request; each call adds driver_id / truck_id
  base   jsonb := jsonb_build_object(
    'destination', 'Makati City → Pasay City', 'destination_area', 'Pasay City', 'company', 'Dispatch test',
    'pickup_location', 'Makati warehouse', 'delivery_location', 'Pasay City',
    'pickup_time', '09:00 AM', 'picked_up_date', 'Oct 22, 2026', 'eta', '01:00 PM',
    'delivery_date', 'Oct 22, 2026', 'remarks', '  Fragile  ');
  v_id   text;
  v_label text;
  r      public.assignments%rowtype;
  l      public.activity_log%rowtype;
  err    text;
  cnt    int;
begin
  -- ── setup ──
  insert into auth.users (id, aud, role, email, created_at, updated_at)
  values (csr_u, 'authenticated', 'authenticated', 'csr@dispatch-test.invalid', now(), now()),
         (opm_u, 'authenticated', 'authenticated', 'opm@dispatch-test.invalid', now(), now()),
         (drv_u, 'authenticated', 'authenticated', 'drv@dispatch-test.invalid', now(), now());
  insert into public.profiles (id, email, name, role, status)
  values (csr_u, 'csr@dispatch-test.invalid', 'Dispatch Test CSR', 'csr', 'active'),
         (opm_u, 'opm@dispatch-test.invalid', 'Dispatch Test OPM', 'opm', 'active');
  insert into auth.sessions (id, user_id, created_at, updated_at) values
    (csr_old, csr_u, now() - interval '10 minutes', now()), (csr_s, csr_u, now(), now()),
    (opm_s, opm_u, now(), now()), (drv_s, drv_u, now(), now());
  insert into public.drivers (id, name, phone, status, auth_user_id) values
    (d1, 'Dispatch Test Driver 1', '+639990006101', 'Pending', drv_u),
    (d2, 'Dispatch Test Driver 2', '+639990006102', 'Pending', null),
    (d3, 'Dispatch Test Driver 3', '+639990006103', 'Pending', null),
    (d_fail, 'Dispatch Test Fail Driver', '+639990006104', 'Pending', null);
  insert into public.drivers (id, name, phone, status, archived_at) values
    (d_arch, 'Dispatch Test Archived', '+639990006105', 'Pending', now());
  insert into public.trucks (id, plate_number, status) values
    (t1, 'DSP-0001', 'Available'), (t2, 'DSP-0002', 'Available'), (t3, 'DSP-0003', 'Available'), (t4, 'DSP-0004', 'Assigned');
  c_opm := pg_temp.dt_claims(opm_u, opm_s);  c_drv := pg_temp.dt_claims(drv_u, drv_s);
  c_csr_old := pg_temp.dt_claims(csr_u, csr_old);  c_csr := pg_temp.dt_claims(csr_u, csr_s);

  -- ── 1. both functions exist; anon cannot call them, signed-in users can ──
  if has_function_privilege('anon', 'public.dispatch_assignment(jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.complete_assignment(text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.dispatch_assignment(jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.complete_assignment(text)', 'EXECUTE') then
    raise exception 'DISPATCH FAIL: wrong execute privileges';
  end if;
  n := n + 1;

  -- ── 2. OPM, a driver and a CSR's replaced session may not dispatch or complete ──
  set local role authenticated;
  foreach err in array array[c_opm, c_drv, c_csr_old] loop
    perform set_config('request.jwt.claims', err, true);
    v_id := null;
    begin perform public.dispatch_assignment((base || jsonb_build_object('driver_id', d1, 'truck_id', t1))); v_id := 'success';
    exception when others then v_id := sqlerrm; end;
    if v_id is distinct from 'not_authorized' then raise exception 'DISPATCH FAIL: unauthorised dispatch gave %', v_id; end if;
    v_id := null;
    begin perform public.complete_assignment('ASN-DISPTEST-NOPE'); v_id := 'success';
    exception when others then v_id := sqlerrm; end;
    if v_id is distinct from 'not_authorized' then raise exception 'DISPATCH FAIL: unauthorised complete gave %', v_id; end if;
  end loop;
  n := n + 1;

  -- From here: the CSR on its current session.
  perform set_config('request.jwt.claims', c_csr, true);

  -- ── 3. bad requests are refused ──
  err := null; begin perform public.dispatch_assignment((base || jsonb_build_object('driver_id', d1, 'truck_id', t1)) - 'company'); exception when others then err := sqlerrm; end;
  if err is distinct from 'required_field: company' then raise exception 'DISPATCH FAIL: missing company gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.dispatch_assignment((base || jsonb_build_object('driver_id', d1, 'truck_id', t1)) || '{"destination_area": "  "}'); exception when others then err := sqlerrm; end;
  if err is distinct from 'required_field: destination_area' then raise exception 'DISPATCH FAIL: blank area gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.dispatch_assignment((base || jsonb_build_object('driver_id', d1, 'truck_id', t1)) || '{"state": "completed"}'); exception when others then err := sqlerrm; end;
  if err is distinct from 'field_not_allowed: state' then raise exception 'DISPATCH FAIL: extra field gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.dispatch_assignment((base || jsonb_build_object('driver_id', d1, 'truck_id', t1)) || '{"eta": 5}'); exception when others then err := sqlerrm; end;
  if err is distinct from 'invalid_value: eta' then raise exception 'DISPATCH FAIL: number value gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.dispatch_assignment((base || jsonb_build_object('driver_id', d1, 'truck_id', t1)) || jsonb_build_object('remarks', repeat('x', 151))); exception when others then err := sqlerrm; end;
  if err is distinct from 'remarks_too_long' then raise exception 'DISPATCH FAIL: long remarks gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.dispatch_assignment((base || jsonb_build_object('driver_id', 'DR-DISPTEST-NOPE', 'truck_id', t1))); exception when others then err := sqlerrm; end;
  if err is distinct from 'driver_not_found' then raise exception 'DISPATCH FAIL: unknown driver gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.dispatch_assignment((base || jsonb_build_object('driver_id', d_arch, 'truck_id', t1))); exception when others then err := sqlerrm; end;
  if err is distinct from 'driver_archived' then raise exception 'DISPATCH FAIL: archived driver gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.dispatch_assignment((base || jsonb_build_object('driver_id', d1, 'truck_id', t4))); exception when others then err := sqlerrm; end;
  if err is distinct from 'truck_unavailable' then raise exception 'DISPATCH FAIL: busy truck gave %', coalesce(err, 'success'); end if;
  n := n + 1;

  -- ── 4. a valid dispatch creates the assignment ──
  v_id := public.dispatch_assignment((base || jsonb_build_object('driver_id', d1, 'truck_id', t1)));
  reset role;
  if v_id !~ '^ASN[0-9]{5}$' then raise exception 'DISPATCH FAIL: id % has the wrong shape', v_id; end if;
  select * into r from public.assignments where id = v_id;
  if r.state <> 'active' or r.task_status <> 'Assigned' or r.driver_id <> d1 or r.driver_name <> 'Dispatch Test Driver 1'
     or r.truck_id <> t1 or r.truck_plate <> 'DSP-0001' or r.destination_area <> 'Pasay City'
     or r.remarks <> 'Fragile' or r.delivery_location <> 'Pasay City' or r.ata <> '' then
    raise exception 'DISPATCH FAIL: assignment saved wrong: %', to_jsonb(r);
  end if;
  if r.assigned_at !~ '^[A-Z][a-z]{2} [0-9]{1,2}, [0-9]{2}:[0-9]{2} (AM|PM)$' then
    raise exception 'DISPATCH FAIL: assigned_at "%" is not the display format', r.assigned_at;
  end if;
  n := n + 1;

  -- ── 5. its 6 document slots, empty and pending, in order ──
  if (select string_agg(type || ':' || position || ':' || uploaded || ':' || doc_status, ',' order by position)
        from public.assignment_documents where assignment_id = v_id)
     <> 'Proof of Delivery:0:false:pending,Receiving Acknowledgement Report:1:false:pending,Dispatch Slip:2:false:pending,'
        || 'Sales Invoice:3:false:pending,Bill of Lading:4:false:pending,Waybill / Delivery Receipt:5:false:pending' then
    raise exception 'DISPATCH FAIL: document slots are wrong';
  end if;
  n := n + 1;

  -- ── 6. driver and truck are marked Assigned; the log row names the CSR ──
  if (select status from public.drivers where id = d1) <> 'Assigned'
     or (select status from public.trucks where id = t1) <> 'Assigned' then
    raise exception 'DISPATCH FAIL: driver/truck not marked Assigned';
  end if;
  select * into l from public.activity_log where assignment_id = v_id and type = 'task_assigned';
  if not found or l.admin_user_id <> csr_u or l.admin_email <> 'csr@dispatch-test.invalid' or l.admin_role <> 'csr'
     or l.driver_name <> 'Dispatch Test Driver 1' or l.truck_plate <> 'DSP-0001'
     or l.destination <> 'Makati City → Pasay City' or l.company <> 'Dispatch test' then
    raise exception 'DISPATCH FAIL: task_assigned log row wrong: %', to_jsonb(l);
  end if;
  n := n + 1;

  -- ── 7. no double-booking: busy driver, busy truck; nothing extra is created ──
  set local role authenticated;
  perform set_config('request.jwt.claims', c_csr, true);
  err := null; begin perform public.dispatch_assignment((base || jsonb_build_object('driver_id', d1, 'truck_id', t2))); exception when others then err := sqlerrm; end;
  if err is distinct from 'driver_busy' then raise exception 'DISPATCH FAIL: busy driver gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.dispatch_assignment((base || jsonb_build_object('driver_id', d2, 'truck_id', t1))); exception when others then err := sqlerrm; end;
  if err is distinct from 'truck_unavailable' then raise exception 'DISPATCH FAIL: booked truck gave %', coalesce(err, 'success'); end if;
  reset role;
  if (select count(*) from public.assignments where driver_id like 'DR-DISPTEST%') <> 1
     or (select status from public.drivers where id = d2) <> 'Pending'
     or (select status from public.trucks where id = t2) <> 'Available' then
    raise exception 'DISPATCH FAIL: a refused dispatch left something behind';
  end if;
  n := n + 1;

  -- ── 8. complete: refused while not Delivered ──
  set local role authenticated;
  perform set_config('request.jwt.claims', c_csr, true);
  err := null; begin perform public.complete_assignment(v_id); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_completable' then raise exception 'DISPATCH FAIL: complete while Assigned gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.complete_assignment('ASN-DISPTEST-NOPE'); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_found' then raise exception 'DISPATCH FAIL: unknown assignment gave %', coalesce(err, 'success'); end if;
  n := n + 1;

  -- ── 9. complete: refused while a document is not approved ──
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  update public.assignments set task_status = 'Delivered', operational_stage = 'unloaded' where id = v_id;
  update public.assignment_documents set uploaded = true, doc_status = 'approved', file_url = 'docs/' || v_id || '/x.jpg'
   where assignment_id = v_id and type <> 'Bill of Lading';
  update public.assignment_documents set uploaded = true, doc_status = 'pending', file_url = 'docs/' || v_id || '/bol.jpg'
   where assignment_id = v_id and type = 'Bill of Lading';
  set local role authenticated;
  perform set_config('request.jwt.claims', c_csr, true);
  err := null; begin perform public.complete_assignment(v_id); exception when others then err := sqlerrm; end;
  if err is distinct from 'documents_not_approved' then raise exception 'DISPATCH FAIL: pending document gave %', coalesce(err, 'success'); end if;
  reset role;
  if (select state from public.assignments where id = v_id) <> 'active' then
    raise exception 'DISPATCH FAIL: a refused complete changed the assignment';
  end if;
  n := n + 1;

  -- ── 10. complete: archived, driver/truck freed, log row written ──
  perform set_config('request.jwt.claims', '{}', true);
  update public.assignment_documents set doc_status = 'approved' where assignment_id = v_id and type = 'Bill of Lading';
  set local role authenticated;
  perform set_config('request.jwt.claims', c_csr, true);
  v_label := public.complete_assignment(v_id);
  reset role;
  select * into r from public.assignments where id = v_id;
  if r.state <> 'completed' or r.completed_at is distinct from v_label
     or v_label !~ '^[A-Z][a-z]{2} [0-9]{1,2}, [0-9]{2}:[0-9]{2} (AM|PM)$' then
    raise exception 'DISPATCH FAIL: completion saved wrong: % / %', r.state, r.completed_at;
  end if;
  if (select status from public.drivers where id = d1) <> 'Complete'
     or (select status from public.trucks where id = t1) <> 'Available' then
    raise exception 'DISPATCH FAIL: driver/truck not freed';
  end if;
  select * into l from public.activity_log where assignment_id = v_id and type = 'task_completed';
  if not found or l.admin_user_id <> csr_u or l.destination <> 'Makati City → Pasay City' then
    raise exception 'DISPATCH FAIL: task_completed log row wrong: %', to_jsonb(l);
  end if;
  n := n + 1;

  -- ── 11. completing twice is refused; the freed driver/truck can be dispatched again ──
  set local role authenticated;
  perform set_config('request.jwt.claims', c_csr, true);
  err := null; begin perform public.complete_assignment(v_id); exception when others then err := sqlerrm; end;
  if err is distinct from 'already_completed' then raise exception 'DISPATCH FAIL: second complete gave %', coalesce(err, 'success'); end if;
  v_id := public.dispatch_assignment((base || jsonb_build_object('driver_id', d1, 'truck_id', t1)));
  reset role;
  if (select state from public.assignments where id = v_id) <> 'active' then
    raise exception 'DISPATCH FAIL: re-dispatch of the freed driver/truck failed';
  end if;
  n := n + 1;

  -- ── 12. all or nothing: a failure at the last step (the log row) saves nothing ──
  perform set_config('request.jwt.claims', '{}', true);
  create trigger dt_fail_log before insert on public.activity_log
    for each row execute function public.dt_fail_log_tmp();
  set local role authenticated;
  perform set_config('request.jwt.claims', c_csr, true);
  err := null; begin perform public.dispatch_assignment((base || jsonb_build_object('driver_id', d_fail, 'truck_id', t3))); exception when others then err := sqlerrm; end;
  reset role;
  if err is distinct from 'forced_log_failure' then raise exception 'DISPATCH FAIL: forced failure gave %', coalesce(err, 'success'); end if;
  if exists (select 1 from public.assignments where driver_id = d_fail)
     or exists (select 1 from public.assignment_documents x join public.assignments a on a.id = x.assignment_id where a.driver_id = d_fail)
     or (select status from public.drivers where id = d_fail) <> 'Pending'
     or (select status from public.trucks where id = t3) <> 'Available' then
    raise exception 'DISPATCH FAIL: a failed dispatch left half a delivery behind';
  end if;
  n := n + 1;

  raise exception 'DISPATCH TESTS PASSED (% checks) — rolled back on purpose, nothing was saved', n;
end
$test$;
rollback;
