-- ════════════════════════════════════════════════════════════════════════════
-- REQ-002 database tests — every required driver photo and status step.
--
-- Run AFTER 20261021000002_driver_workflow_gates.sql.
--
-- Leaves NOTHING behind: one transaction, one DO block that always finishes by
-- raising an exception, then ROLLBACK. Read the final message:
--   "GATE TESTS PASSED (n checks) — rolled back on purpose"  → all good
--   "GATE FAIL: …"                                            → what broke
--
-- Throwaway driver / CSR / assignments only (@gate-test.invalid, ids containing
-- GATETEST); real rows are never touched. Run the whole file at once.
--
-- advance_driver_stage() switches on app.bypass_driver_guard for the rest of the
-- TRANSACTION. Live, every API call is its own transaction; here everything is
-- one, so the flag is cleared after each stage call to mimic separate requests.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- A throwaway active assignment for the test driver.
create function pg_temp.gt_assignment(p_id text, p_driver text) returns void
language sql as $f$
  insert into public.assignments (id, destination, destination_area, company, pickup_location, task_status, state, driver_id, driver_name)
  values (p_id, 'Makati City → Pasay City', 'Pasay City', 'Gate test', 'Makati City', 'Assigned', 'active', p_driver, 'Gate Test Driver');
$f$;

-- Store one photo slot (as the app does after a successful upload).
create function pg_temp.gt_photo(p_id text, p_slot text) returns void
language sql as $f$
  insert into public.status_photos (assignment_id, status, url) values (p_id, p_slot, 'test://' || p_slot);
$f$;

do $test$
declare
  n      int := 0;
  drv_u  uuid := gen_random_uuid();
  csr_u  uuid := gen_random_uuid();
  drv_id text := 'DR-GATETEST';
  a1     text := 'ASN-GATETEST-1';     -- walks the whole workflow
  a2     text := 'ASN-GATETEST-2';     -- shortcut attempts / issue report
  c_drv  text; c_csr text;
  err    text;
  cnt    int;
  r      public.assignments%rowtype;
begin
  -- ── setup ──
  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (drv_u, 'authenticated', 'authenticated', 'drv@gate-test.invalid', extensions.crypt('x-pass-1', extensions.gen_salt('bf')), now(), now(), now()),
         (csr_u, 'authenticated', 'authenticated', 'csr@gate-test.invalid', extensions.crypt('x-pass-2', extensions.gen_salt('bf')), now(), now(), now());
  insert into public.profiles (id, email, name, role, status) values (csr_u, 'csr@gate-test.invalid', 'Gate Test CSR', 'csr', 'active');
  insert into public.drivers (id, name, phone, status, auth_user_id) values (drv_id, 'Gate Test Driver', '+639990009012', 'Assigned', drv_u);
  insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), drv_u, now(), now()), (gen_random_uuid(), csr_u, now(), now());
  c_drv := jsonb_build_object('sub', drv_u, 'role', 'authenticated',
             'session_id', (select id from auth.sessions where user_id = drv_u))::text;
  c_csr := jsonb_build_object('sub', csr_u, 'role', 'authenticated',
             'session_id', (select id from auth.sessions where user_id = csr_u))::text;
  perform pg_temp.gt_assignment(a1, drv_id);
  perform pg_temp.gt_assignment(a2, drv_id);
  perform pg_temp.gt_photo(a1, s) from unnest(array['pickup_front', 'pickup_left', 'pickup_right', 'pickup_rear']) s;

  perform set_config('request.jwt.claims', c_drv, true);
  set local role authenticated;

  -- ── 1. driver cannot jump straight from Assigned to Delivered / In Transit / Picked Up ──
  err := null; begin update public.assignments set task_status = 'Delivered' where id = a2; exception when others then err := sqlerrm; end;
  if err is distinct from 'invalid_status_transition' then raise exception 'GATE FAIL: Assigned → Delivered gave %', coalesce(err, 'success'); end if;
  err := null; begin update public.assignments set task_status = 'In Transit' where id = a2; exception when others then err := sqlerrm; end;
  if err is distinct from 'invalid_status_transition' then raise exception 'GATE FAIL: Assigned → In Transit gave %', coalesce(err, 'success'); end if;
  err := null; begin update public.assignments set task_status = 'Picked Up' where id = a2; exception when others then err := sqlerrm; end;
  if err is distinct from 'invalid_status_transition' then raise exception 'GATE FAIL: Assigned → Picked Up gave %', coalesce(err, 'success'); end if;
  n := n + 1;

  -- ── 2. start_loading needs the before-loading photo (4 truck photos alone are not enough) ──
  perform public.advance_driver_stage(a1, 'arrive_pickup');
  perform set_config('app.bypass_driver_guard', '', true);   -- = end of that API request
  err := null; begin perform public.advance_driver_stage(a1, 'start_loading'); exception when others then err := sqlerrm; end;
  if err is distinct from 'missing_required_photo: loading_before' then raise exception 'GATE FAIL: start_loading without loading_before gave %', coalesce(err, 'success'); end if;
  reset role;
  perform pg_temp.gt_photo(a1, 'loading_before');
  set local role authenticated;
  perform public.advance_driver_stage(a1, 'start_loading');
  perform set_config('app.bypass_driver_guard', '', true);   -- = end of that API request
  n := n + 1;

  -- ── 3. finish_loading still needs the after-loading photo (unchanged rule) ──
  err := null; begin perform public.advance_driver_stage(a1, 'finish_loading'); exception when others then err := sqlerrm; end;
  if err is distinct from 'missing_required_photo: loading_after' then raise exception 'GATE FAIL: finish_loading without loading_after gave %', coalesce(err, 'success'); end if;
  reset role;
  perform pg_temp.gt_photo(a1, 'loading_after');
  perform pg_temp.gt_photo(a1, s) from unnest(array['pretrip_front', 'pretrip_left', 'pretrip_right', 'pretrip_rear']) s;
  set local role authenticated;
  perform public.advance_driver_stage(a1, 'finish_loading');
  perform set_config('app.bypass_driver_guard', '', true);   -- = end of that API request
  perform public.advance_driver_stage(a1, 'depart');                 -- → Picked Up
  perform set_config('app.bypass_driver_guard', '', true);   -- = end of that API request
  n := n + 1;

  -- ── 4. after depart: Picked Up → Delivered refused, → In Transit allowed ──
  err := null; begin update public.assignments set task_status = 'Delivered' where id = a1; exception when others then err := sqlerrm; end;
  if err is distinct from 'invalid_status_transition' then raise exception 'GATE FAIL: Picked Up → Delivered gave %', coalesce(err, 'success'); end if;
  update public.assignments set task_status = 'In Transit' where id = a1;
  get diagnostics cnt = row_count;
  if cnt <> 1 then raise exception 'GATE FAIL: Picked Up → In Transit was blocked'; end if;
  n := n + 1;

  -- ── 5. In Transit → Delivered refused while unloading is not finished ──
  perform public.advance_driver_stage(a1, 'arrive_destination');
  perform set_config('app.bypass_driver_guard', '', true);   -- = end of that API request
  err := null; begin update public.assignments set task_status = 'Delivered' where id = a1; exception when others then err := sqlerrm; end;
  if err is distinct from 'invalid_status_transition' then raise exception 'GATE FAIL: Delivered before unloading gave %', coalesce(err, 'success'); end if;
  n := n + 1;

  -- ── 6. start_unloading needs the before-unloading photo ──
  err := null; begin perform public.advance_driver_stage(a1, 'start_unloading'); exception when others then err := sqlerrm; end;
  if err is distinct from 'missing_required_photo: unloading_before' then raise exception 'GATE FAIL: start_unloading without photo gave %', coalesce(err, 'success'); end if;
  reset role;
  perform pg_temp.gt_photo(a1, 'unloading_before');
  set local role authenticated;
  perform public.advance_driver_stage(a1, 'start_unloading');
  perform set_config('app.bypass_driver_guard', '', true);   -- = end of that API request
  n := n + 1;

  -- ── 7. finish_unloading needs the after-unloading photo ──
  err := null; begin perform public.advance_driver_stage(a1, 'finish_unloading'); exception when others then err := sqlerrm; end;
  if err is distinct from 'missing_required_photo: unloading_after' then raise exception 'GATE FAIL: finish_unloading without photo gave %', coalesce(err, 'success'); end if;
  reset role;
  perform pg_temp.gt_photo(a1, 'unloading_after');
  set local role authenticated;
  perform public.advance_driver_stage(a1, 'finish_unloading');
  perform set_config('app.bypass_driver_guard', '', true);   -- = end of that API request
  n := n + 1;

  -- ── 8. after unloading: the driver's Delivered update is allowed; full trail recorded ──
  update public.assignments set task_status = 'Delivered' where id = a1;
  get diagnostics cnt = row_count;
  reset role;
  select * into r from public.assignments where id = a1;
  if cnt <> 1 or r.task_status <> 'Delivered' or r.operational_stage <> 'unloaded'
     or r.pickup_arrived_at is null or r.loading_started_at is null or r.loading_completed_at is null
     or r.departed_at is null or r.destination_arrived_at is null
     or r.unloading_started_at is null or r.unloading_completed_at is null then
    raise exception 'GATE FAIL: finished delivery not recorded correctly (%/%)', r.task_status, r.operational_stage;
  end if;
  n := n + 1;

  -- ── 9. issue report: Assigned → Failed / Issue allowed; Delivered → Failed / Issue refused ──
  set local role authenticated;
  update public.assignments set task_status = 'Failed / Issue', issue_reason = 'Truck broke down' where id = a2;
  get diagnostics cnt = row_count;
  if cnt <> 1 then raise exception 'GATE FAIL: issue report was blocked'; end if;
  err := null; begin update public.assignments set task_status = 'Failed / Issue' where id = a1; exception when others then err := sqlerrm; end;
  if err is distinct from 'invalid_status_transition' then raise exception 'GATE FAIL: Delivered → Failed / Issue gave %', coalesce(err, 'success'); end if;
  n := n + 1;

  -- ── 10. updates that do not change the status still work (acknowledgement) ──
  update public.assignments set driver_acknowledged_at = now() where id = a1;
  get diagnostics cnt = row_count;
  if cnt <> 1 then raise exception 'GATE FAIL: acknowledgement update blocked'; end if;
  n := n + 1;

  -- ── 11. staff are unaffected: a CSR may still set a status directly ──
  reset role;
  perform set_config('request.jwt.claims', '{}', true);                                        -- test setup, not a driver
  update public.assignments set task_status = 'Assigned', issue_reason = null where id = a2;   -- back to Assigned for the CSR test
  perform set_config('request.jwt.claims', c_csr, true);
  set local role authenticated;
  update public.assignments set task_status = 'In Transit' where id = a2;
  get diagnostics cnt = row_count;
  reset role;
  if cnt <> 1 then raise exception 'GATE FAIL: CSR status update blocked'; end if;
  n := n + 1;

  raise exception 'GATE TESTS PASSED (% checks) — rolled back on purpose, nothing was saved', n;
end
$test$;
rollback;
