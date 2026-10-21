-- ════════════════════════════════════════════════════════════════════════════
-- REQ-003 database tests — password-verified cancellation with Loading cutoff.
--
-- Run AFTER 20261021000000_csr_cancel_loading_cutoff.sql (and, because the
-- helpers now check it, 20261021000001_single_active_session.sql).
--
-- Leaves NOTHING behind: one transaction, one DO block that always finishes by
-- raising an exception, then ROLLBACK. Read the final message:
--   "CANCEL TESTS PASSED (n checks) — rolled back on purpose"  → all good
--   "CANCEL FAIL: …"                                            → what broke
--
-- Throwaway users / driver / trucks / assignments only (@cancel-test.invalid,
-- ids containing CANCELTEST); real rows are never touched. Run the whole file.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- Claims for p_uid on session p_sid, as Supabase Auth issues them.
create function pg_temp.ct_claims(p_uid uuid, p_sid uuid) returns text
language sql as $f$
  select jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', p_sid)::text;
$f$;

-- A throwaway active assignment for the test driver/truck at a given stage.
create function pg_temp.ct_assignment(p_id text, p_driver text, p_truck text,
                                      p_status text, p_stage text, p_loaded boolean) returns void
language sql as $f$
  insert into public.assignments (id, destination, destination_area, company, pickup_location, task_status, state,
                                  driver_id, driver_name, truck_id, truck_plate, operational_stage, loading_completed_at)
  values (p_id, 'Makati City → Pasay City', 'Pasay City', 'Cancel test', 'Makati City', p_status, 'active',
          p_driver, 'Cancel Test Driver', p_truck, 'CNL-0001', p_stage, case when p_loaded then now() end);
$f$;

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
  drv_id text := 'DR-CANCELTEST';
  trk_id text := 'TRK-CANCELTEST';
  trk2   text := 'TRK-CANCELTEST-2';
  pw     text := 'Cancel-Test-Pass-1';
  v_reason text := 'Customer postponed the shipment';
  c_opm text; c_drv text; c_csr_old text; c_csr text;   -- request claims, built before switching role
  r      public.assignments%rowtype;
  err    text;
  cnt    int;
begin
  -- ── setup ──
  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (csr_u, 'authenticated', 'authenticated', 'csr@cancel-test.invalid', extensions.crypt(pw, extensions.gen_salt('bf')), now(), now(), now()),
         (opm_u, 'authenticated', 'authenticated', 'opm@cancel-test.invalid', extensions.crypt(pw, extensions.gen_salt('bf')), now(), now(), now()),
         (drv_u, 'authenticated', 'authenticated', 'drv@cancel-test.invalid', extensions.crypt(pw, extensions.gen_salt('bf')), now(), now(), now());
  insert into public.profiles (id, email, name, role, status)
  values (csr_u, 'csr@cancel-test.invalid', 'Cancel Test CSR', 'csr', 'active'),
         (opm_u, 'opm@cancel-test.invalid', 'Cancel Test OPM', 'opm', 'active');
  insert into auth.sessions (id, user_id, created_at, updated_at) values
    (csr_old, csr_u, now() - interval '10 minutes', now()), (csr_s, csr_u, now(), now()),
    (opm_s, opm_u, now(), now()), (drv_s, drv_u, now(), now());
  insert into public.drivers (id, name, phone, status, auth_user_id) values (drv_id, 'Cancel Test Driver', '+639990005678', 'Assigned', drv_u);
  insert into public.trucks (id, plate_number, status) values (trk_id, 'CNL-0001', 'Assigned'), (trk2, 'CNL-0002', 'Assigned');
  c_opm := pg_temp.ct_claims(opm_u, opm_s);  c_drv := pg_temp.ct_claims(drv_u, drv_s);
  c_csr_old := pg_temp.ct_claims(csr_u, csr_old);  c_csr := pg_temp.ct_claims(csr_u, csr_s);

  -- ── 1. only the new 3-argument function exists; anon cannot call it ──
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'cancel_assignment') <> 1
     or not exists (select 1 from pg_proc where oid = 'public.cancel_assignment(text,text,text)'::regprocedure)
     or has_function_privilege('anon', 'public.cancel_assignment(text,text,text)', 'EXECUTE') then
    raise exception 'CANCEL FAIL: legacy overloads present or anon can execute';
  end if;
  n := n + 1;

  perform pg_temp.ct_assignment('ASN-CANCELTEST-A', drv_id, trk_id, 'Assigned', null, false);

  -- ── 2. who may cancel: OPM, the driver, and a CSR's replaced session may not ──
  set local role authenticated;
  perform set_config('request.jwt.claims', c_opm, true);
  err := null; begin perform public.cancel_assignment('ASN-CANCELTEST-A', v_reason, pw); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_authorized' then raise exception 'CANCEL FAIL: OPM cancel gave %', coalesce(err, 'success'); end if;
  perform set_config('request.jwt.claims', c_drv, true);
  err := null; begin perform public.cancel_assignment('ASN-CANCELTEST-A', v_reason, pw); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_authorized' then raise exception 'CANCEL FAIL: driver cancel gave %', coalesce(err, 'success'); end if;
  perform set_config('request.jwt.claims', c_csr_old, true);
  err := null; begin perform public.cancel_assignment('ASN-CANCELTEST-A', v_reason, pw); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_authorized' then raise exception 'CANCEL FAIL: replaced CSR session cancel gave %', coalesce(err, 'success'); end if;
  n := n + 1;

  -- From here: the CSR on its current session.
  perform set_config('request.jwt.claims', c_csr, true);

  -- ── 3. reason must be 10–150 characters (after trimming) ──
  err := null; begin perform public.cancel_assignment('ASN-CANCELTEST-A', '  too short ', pw); exception when others then err := sqlerrm; end;
  if err is distinct from 'invalid_reason' then raise exception 'CANCEL FAIL: short reason gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.cancel_assignment('ASN-CANCELTEST-A', repeat('x', 151), pw); exception when others then err := sqlerrm; end;
  if err is distinct from 'invalid_reason' then raise exception 'CANCEL FAIL: long reason gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.cancel_assignment('ASN-CANCELTEST-A', null, pw); exception when others then err := sqlerrm; end;
  if err is distinct from 'invalid_reason' then raise exception 'CANCEL FAIL: null reason gave %', coalesce(err, 'success'); end if;
  n := n + 1;

  -- ── 4. password is checked on every call (empty / wrong refused, nothing changes) ──
  err := null; begin perform public.cancel_assignment('ASN-CANCELTEST-A', v_reason, ''); exception when others then err := sqlerrm; end;
  if err is distinct from 'wrong_password' then raise exception 'CANCEL FAIL: empty password gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.cancel_assignment('ASN-CANCELTEST-A', v_reason, 'not-the-password'); exception when others then err := sqlerrm; end;
  if err is distinct from 'wrong_password' then raise exception 'CANCEL FAIL: wrong password gave %', coalesce(err, 'success'); end if;
  if (select state from public.assignments where id = 'ASN-CANCELTEST-A') <> 'active' then
    raise exception 'CANCEL FAIL: a refused cancel changed the assignment';
  end if;
  n := n + 1;

  -- ── 5. unknown assignment ──
  err := null; begin perform public.cancel_assignment('ASN-CANCELTEST-NOPE', v_reason, pw); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_found' then raise exception 'CANCEL FAIL: unknown assignment gave %', coalesce(err, 'success'); end if;
  n := n + 1;

  -- ── 6. a valid cancel: state, status, trimmed reason ──
  perform public.cancel_assignment('ASN-CANCELTEST-A', '  ' || v_reason || '  ', pw);
  reset role;
  select * into r from public.assignments where id = 'ASN-CANCELTEST-A';
  if r.state <> 'cancelled' or r.task_status <> 'Cancelled' or r.cancel_reason <> v_reason then
    raise exception 'CANCEL FAIL: cancel result % / % / %', r.state, r.task_status, r.cancel_reason;
  end if;
  n := n + 1;

  -- ── 7. driver and truck released (no other active assignment) ──
  if (select status from public.drivers where id = drv_id) <> 'Pending'
     or (select status from public.trucks where id = trk_id) <> 'Available' then
    raise exception 'CANCEL FAIL: driver/truck not released';
  end if;
  n := n + 1;

  -- ── 8. audit entry: type, reason, actor; never the password ──
  select count(*) into cnt from public.activity_log
   where type = 'task_cancelled' and assignment_id = 'ASN-CANCELTEST-A'
     and reason = v_reason and member_name = 'Cancel Test CSR' and admin_email = 'csr@cancel-test.invalid';
  if cnt <> 1 then raise exception 'CANCEL FAIL: expected 1 task_cancelled audit entry, found %', cnt; end if;
  if exists (select 1 from public.activity_log l where l.assignment_id = 'ASN-CANCELTEST-A' and to_jsonb(l)::text like '%' || pw || '%') then
    raise exception 'CANCEL FAIL: password written to the activity log';
  end if;
  n := n + 1;

  -- ── 9. cancelling again is refused ──
  set local role authenticated;
  err := null; begin perform public.cancel_assignment('ASN-CANCELTEST-A', v_reason, pw); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_cancellable' then raise exception 'CANCEL FAIL: second cancel gave %', coalesce(err, 'success'); end if;
  n := n + 1;

  -- ── 10. still cancellable at pickup arrival and while loading ──
  reset role;
  update public.drivers set status = 'Assigned' where id = drv_id;
  perform pg_temp.ct_assignment('ASN-CANCELTEST-B', drv_id, trk_id, 'Assigned', 'pickup_arrived', false);
  perform pg_temp.ct_assignment('ASN-CANCELTEST-C', drv_id, trk2,   'Assigned', 'loading', false);
  set local role authenticated;
  perform public.cancel_assignment('ASN-CANCELTEST-B', v_reason, pw);
  perform public.cancel_assignment('ASN-CANCELTEST-C', v_reason, pw);
  reset role;
  if (select count(*) from public.assignments where id in ('ASN-CANCELTEST-B', 'ASN-CANCELTEST-C') and state = 'cancelled') <> 2 then
    raise exception 'CANCEL FAIL: pickup-arrived / loading assignment not cancellable';
  end if;
  n := n + 1;

  -- ── 11. a driver/truck still on another active assignment is NOT released ──
  update public.drivers set status = 'Assigned' where id = drv_id;
  update public.trucks set status = 'Assigned' where id = trk_id;
  perform pg_temp.ct_assignment('ASN-CANCELTEST-D', drv_id, trk_id, 'Assigned', null, false);
  perform pg_temp.ct_assignment('ASN-CANCELTEST-E', drv_id, trk_id, 'Assigned', null, false);
  set local role authenticated;
  perform public.cancel_assignment('ASN-CANCELTEST-D', v_reason, pw);
  reset role;
  if (select status from public.drivers where id = drv_id) <> 'Assigned'
     or (select status from public.trucks where id = trk_id) <> 'Assigned' then
    raise exception 'CANCEL FAIL: released a driver/truck still in use';
  end if;
  n := n + 1;

  -- ── 12. Loading cutoff: loaded / departed / Picked Up / In Transit are refused ──
  perform pg_temp.ct_assignment('ASN-CANCELTEST-F', drv_id, trk2, 'Assigned', 'loaded', true);
  perform pg_temp.ct_assignment('ASN-CANCELTEST-G', drv_id, trk2, 'Picked Up', null, false);
  perform pg_temp.ct_assignment('ASN-CANCELTEST-H', drv_id, trk2, 'In Transit', 'destination_arrived', true);
  set local role authenticated;
  err := null; begin perform public.cancel_assignment('ASN-CANCELTEST-F', v_reason, pw); exception when others then err := sqlerrm; end;
  if err is distinct from 'loading_completed' then raise exception 'CANCEL FAIL: loaded gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.cancel_assignment('ASN-CANCELTEST-G', v_reason, pw); exception when others then err := sqlerrm; end;
  if err is distinct from 'loading_completed' then raise exception 'CANCEL FAIL: Picked Up gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.cancel_assignment('ASN-CANCELTEST-H', v_reason, pw); exception when others then err := sqlerrm; end;
  if err is distinct from 'loading_completed' then raise exception 'CANCEL FAIL: In Transit gave %', coalesce(err, 'success'); end if;
  n := n + 1;

  -- ── 13. the guard: no cancelling by direct table update ──
  err := null; begin update public.assignments set state = 'cancelled', task_status = 'Cancelled' where id = 'ASN-CANCELTEST-E';
  exception when others then err := sqlerrm; end;
  if err is distinct from 'not_authorized' then raise exception 'CANCEL FAIL: direct cancel gave %', coalesce(err, 'success'); end if;
  n := n + 1;

  -- ── 14. the guard: a completed Loading milestone cannot be erased to reopen cancellation ──
  err := null; begin update public.assignments set loading_completed_at = null, operational_stage = 'loading' where id = 'ASN-CANCELTEST-F';
  exception when others then err := sqlerrm; end;
  if err is distinct from 'loading_completed' then raise exception 'CANCEL FAIL: milestone erase gave %', coalesce(err, 'success'); end if;
  err := null; begin update public.assignments set task_status = 'Assigned' where id = 'ASN-CANCELTEST-G';
  exception when others then err := sqlerrm; end;
  if err is distinct from 'loading_completed' then raise exception 'CANCEL FAIL: status rewind gave %', coalesce(err, 'success'); end if;
  n := n + 1;

  -- ── 15. the guard: a recorded cancel reason cannot be rewritten ──
  err := null; begin update public.assignments set cancel_reason = 'Rewritten afterwards' where id = 'ASN-CANCELTEST-A';
  exception when others then err := sqlerrm; end;
  reset role;
  if err is null or (select cancel_reason from public.assignments where id = 'ASN-CANCELTEST-A') <> v_reason then
    raise exception 'CANCEL FAIL: cancel reason rewritten (%)', coalesce(err, 'no error');
  end if;
  n := n + 1;

  -- ── 16. drivers still progress past Loading: stage RPC (depart → Picked Up),
  --        the driver's own In Transit update, then arrival at the destination ──
  perform pg_temp.ct_assignment('ASN-CANCELTEST-P', drv_id, trk2, 'Assigned', null, false);
  insert into public.status_photos (assignment_id, status, url)
  select 'ASN-CANCELTEST-P', s, 'test://' || s from unnest(array['pickup_front', 'pickup_left', 'pickup_right', 'pickup_rear',
    'loading_before', 'loading_after', 'pretrip_front', 'pretrip_left', 'pretrip_right', 'pretrip_rear']) s;
  perform set_config('request.jwt.claims', c_drv, true);
  set local role authenticated;
  err := null; begin
    perform public.advance_driver_stage('ASN-CANCELTEST-P', 'arrive_pickup');
    perform public.advance_driver_stage('ASN-CANCELTEST-P', 'start_loading');
    perform public.advance_driver_stage('ASN-CANCELTEST-P', 'finish_loading');
    perform public.advance_driver_stage('ASN-CANCELTEST-P', 'depart');          -- → 'Picked Up'
    update public.assignments set task_status = 'In Transit'                     -- driver's own status update
     where id = 'ASN-CANCELTEST-P';
    get diagnostics cnt = row_count;
    if cnt <> 1 then raise exception 'driver In Transit update changed % rows', cnt; end if;
    perform public.advance_driver_stage('ASN-CANCELTEST-P', 'arrive_destination');
  exception when others then err := sqlerrm; end;
  reset role;
  if err is not null then raise exception 'CANCEL FAIL: driver could not progress past Loading — %', err; end if;
  select * into r from public.assignments where id = 'ASN-CANCELTEST-P';
  if r.loading_completed_at is null or r.departed_at is null or r.operational_stage <> 'destination_arrived' then
    raise exception 'CANCEL FAIL: driver progress not recorded (stage %)', r.operational_stage;
  end if;
  n := n + 1;

  raise exception 'CANCEL TESTS PASSED (% checks) — rolled back on purpose, nothing was saved', n;
end
$test$;
rollback;
