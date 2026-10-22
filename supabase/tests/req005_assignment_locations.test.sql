-- ════════════════════════════════════════════════════════════════════════════
-- REQ-005 database tests — exact pickup / delivery locations.
--
-- Run AFTER migration 20261020000000_assignment_location_coordinates.sql.
--
-- Leaves NOTHING behind: the whole test is one DO block that always finishes by
-- raising an exception, so Postgres rolls back every test row, edit and audit
-- entry. Read the final message:
--   "REQ-005 TESTS PASSED (n checks) — rolled back on purpose"  → all good
--   "REQ-005 FAIL: …"                                            → what broke
--
-- It impersonates an existing active admin/CSR (for edit_assignment's
-- can_write + password re-check) and, if one exists, a driver login (to prove
-- drivers can't change the new columns). Real rows are only read, never changed.
-- ════════════════════════════════════════════════════════════════════════════
do $test$
declare
  n        int := 0;               -- checks passed
  t_id     text := 'ASN-REQ005-TEST';
  h_id     text := 'ASN-REQ005-OLD';
  staff    uuid;
  staff_sid uuid := gen_random_uuid();
  c_staff  text;
  drv_uid  uuid;
  r        public.assignments%rowtype;
  log_diff jsonb;
  ok       boolean;
begin
  -- ── setup: act as a signed-in admin/CSR who just re-entered their password ──
  select id into staff from public.profiles where status = 'active' and role in ('admin', 'csr') limit 1;
  if staff is null then raise exception 'REQ-005 FAIL: setup — no active admin/csr profile to act as'; end if;
  -- REQ-009: can_write()/is_staff() now also require session_is_current(), which
  -- matches the JWT's session_id against the newest row in auth.sessions for that
  -- user. This impersonation predates that and never had one — add a throwaway
  -- session for the real staff row; the whole test rolls back, so nothing persists.
  insert into auth.sessions (id, user_id, created_at, updated_at) values (staff_sid, staff, now(), now());
  c_staff := jsonb_build_object(
    'sub', staff, 'role', 'authenticated', 'session_id', staff_sid,
    'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint))
  )::text;
  perform set_config('request.jwt.claims', c_staff, true);
  if not public.can_write() then raise exception 'REQ-005 FAIL: setup — impersonated staff cannot write'; end if;

  -- ── 1. CREATE: exact stops + origin/destination persist ──
  -- REQ-011: the new assignments-insert guard only allows dispatch_assignment()'s own
  -- insert; briefly drop impersonation so this raw fixture insert runs as "no session"
  -- the same way it always effectively has (nothing here exercises RLS/the insert guard).
  perform set_config('request.jwt.claims', '{}', true);
  insert into public.assignments (id, destination, destination_area, company, pickup_location, task_status, state,
                                  pickup_latitude, pickup_longitude, delivery_location, delivery_latitude, delivery_longitude)
  values (t_id, 'Makati City → SM Mall of Asia, Pasay City', 'Pasay City', 'REQ-005 test', '6750 Ayala Ave, Makati City',
          'Assigned', 'active', 14.554729, 121.024445, 'SM Mall of Asia, Pasay City', 14.537752, 120.98);
  perform set_config('request.jwt.claims', c_staff, true);
  n := n + 1;

  -- ── 2. READ: the same values come back ──
  select * into r from public.assignments where id = t_id;
  if r.pickup_location <> '6750 Ayala Ave, Makati City' or r.pickup_latitude <> 14.554729 or r.pickup_longitude <> 121.024445
     or r.delivery_location <> 'SM Mall of Asia, Pasay City' or r.delivery_latitude <> 14.537752 or r.delivery_longitude <> 120.98
     or r.destination <> 'Makati City → SM Mall of Asia, Pasay City' or r.destination_area <> 'Pasay City' then
    raise exception 'REQ-005 FAIL: read — stored values differ: %', to_jsonb(r);
  end if;
  n := n + 1;

  -- ── 3. EDIT pickup: new address + coordinates replace the old ones ──
  perform public.edit_assignment(t_id, '{"pickup_location":"Glorietta 4, Makati City","pickup_latitude":14.551,"pickup_longitude":121.025}', 'REQ-005 test: pickup');
  select * into r from public.assignments where id = t_id;
  if r.pickup_location <> 'Glorietta 4, Makati City' or r.pickup_latitude <> 14.551 or r.pickup_longitude <> 121.025 then
    raise exception 'REQ-005 FAIL: edit pickup — %', to_jsonb(r);
  end if;
  if r.delivery_latitude <> 14.537752 then raise exception 'REQ-005 FAIL: edit pickup touched delivery'; end if;
  n := n + 1;

  -- ── 4. EDIT delivery: new address + coordinates replace the old ones ──
  perform public.edit_assignment(t_id, '{"delivery_location":"NAIA Terminal 3, Pasay City","delivery_latitude":14.5196,"delivery_longitude":121.0186}', 'REQ-005 test: delivery');
  select * into r from public.assignments where id = t_id;
  if r.delivery_location <> 'NAIA Terminal 3, Pasay City' or r.delivery_latitude <> 14.5196 or r.delivery_longitude <> 121.0186 then
    raise exception 'REQ-005 FAIL: edit delivery — %', to_jsonb(r);
  end if;
  n := n + 1;

  -- ── 5. STALE: address changed without coordinates → old coordinates cleared + audited ──
  perform public.edit_assignment(t_id, '{"pickup_location":"Typed address, no map pick"}', 'REQ-005 test: stale');
  select * into r from public.assignments where id = t_id;
  if r.pickup_latitude is not null or r.pickup_longitude is not null then
    raise exception 'REQ-005 FAIL: stale coordinates kept — %', to_jsonb(r);
  end if;
  select changes into log_diff from public.activity_log
   where assignment_id = t_id and type = 'task_edited' order by ts desc, id desc limit 1;
  if not (log_diff ? 'pickup_latitude') or (log_diff -> 'pickup_latitude' ->> 'new') is not null then
    raise exception 'REQ-005 FAIL: cleared coordinates not in audit diff — %', log_diff;
  end if;
  n := n + 1;

  -- same rule for a direct table update (e.g. a future sync path)
  update public.assignments set delivery_location = 'Typed drop-off' where id = t_id;
  select * into r from public.assignments where id = t_id;
  if r.delivery_latitude is not null or r.delivery_longitude is not null then
    raise exception 'REQ-005 FAIL: direct update kept stale delivery coordinates';
  end if;
  n := n + 1;

  -- ── 6. RELABEL: same point re-sent with a new address label is kept ──
  perform public.edit_assignment(t_id, '{"pickup_location":"Ayala Triangle","pickup_latitude":14.557,"pickup_longitude":121.023}', 'REQ-005 test: set');
  perform public.edit_assignment(t_id, '{"pickup_location":"Ayala Triangle Gardens","pickup_latitude":14.557,"pickup_longitude":121.023}', 'REQ-005 test: relabel');
  select * into r from public.assignments where id = t_id;
  if r.pickup_latitude is distinct from 14.557::float8 or r.pickup_longitude is distinct from 121.023::float8 then
    raise exception 'REQ-005 FAIL: explicitly re-sent coordinates were cleared — %', to_jsonb(r);
  end if;
  n := n + 1;

  -- ── 7. VALIDATION through edit_assignment ──
  ok := false; begin perform public.edit_assignment(t_id, '{"pickup_latitude":150,"pickup_longitude":121}', 'x');
  exception when others then ok := sqlerrm like 'invalid_coordinates%'; end;
  if not ok then raise exception 'REQ-005 FAIL: latitude 150 accepted by edit_assignment'; end if;
  n := n + 1;

  ok := false; begin perform public.edit_assignment(t_id, '{"delivery_latitude":14.5,"delivery_longitude":300}', 'x');
  exception when others then ok := sqlerrm like 'invalid_coordinates%'; end;
  if not ok then raise exception 'REQ-005 FAIL: longitude 300 accepted by edit_assignment'; end if;
  n := n + 1;

  ok := false; begin perform public.edit_assignment(t_id, '{"pickup_latitude":14.5}', 'x');
  exception when others then ok := sqlerrm like 'invalid_coordinates%'; end;
  if not ok then raise exception 'REQ-005 FAIL: latitude without longitude accepted'; end if;
  n := n + 1;

  ok := false; begin perform public.edit_assignment(t_id, '{"pickup_latitude":"14.5","pickup_longitude":"121"}', 'x');
  exception when others then ok := sqlerrm like 'invalid_coordinates%'; end;
  if not ok then raise exception 'REQ-005 FAIL: coordinates as strings accepted by edit_assignment'; end if;
  n := n + 1;

  -- ── 8. VALIDATION by the table itself (any write path) ──
  ok := false; begin update public.assignments set pickup_latitude = 150, pickup_longitude = 121 where id = t_id;
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'REQ-005 FAIL: table accepted latitude 150'; end if;
  n := n + 1;

  ok := false; begin update public.assignments set delivery_location = 'X', delivery_latitude = 14.5, delivery_longitude = 300 where id = t_id;
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'REQ-005 FAIL: table accepted longitude 300'; end if;
  n := n + 1;

  ok := false; begin update public.assignments set pickup_latitude = 'NaN', pickup_longitude = 121 where id = t_id;
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'REQ-005 FAIL: table accepted NaN'; end if;
  n := n + 1;

  ok := false; begin update public.assignments set pickup_latitude = 14.5, pickup_longitude = 'Infinity' where id = t_id;
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'REQ-005 FAIL: table accepted Infinity'; end if;
  n := n + 1;

  ok := false; begin update public.assignments set pickup_latitude = 14.5, pickup_longitude = null where id = t_id;
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'REQ-005 FAIL: table accepted latitude without longitude'; end if;
  n := n + 1;

  ok := false; begin update public.assignments set pickup_location = '', pickup_latitude = 14.5, pickup_longitude = 121 where id = t_id;
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'REQ-005 FAIL: table accepted coordinates without an address'; end if;
  n := n + 1;

  -- reversed Philippine pair: latitude 121 is out of range, so it cannot be stored swapped
  ok := false; begin update public.assignments set pickup_latitude = 121.02, pickup_longitude = 14.55 where id = t_id;
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'REQ-005 FAIL: table accepted a reversed (lng, lat) pair'; end if;
  n := n + 1;

  -- ── 9. HISTORICAL: an assignment without the new fields works as before ──
  perform set_config('request.jwt.claims', '{}', true);
  insert into public.assignments (id, destination, destination_area, company, pickup_location, task_status, state)
  values (h_id, 'Laguna → Imus Business Center, Cavite', 'Cavite', 'REQ-005 test', 'Warehouse 3, Laguna', 'Assigned', 'active');
  perform set_config('request.jwt.claims', c_staff, true);
  select * into r from public.assignments where id = h_id;
  if r.pickup_latitude is not null or r.delivery_location is not null or r.delivery_latitude is not null
     or r.destination <> 'Laguna → Imus Business Center, Cavite' then
    raise exception 'REQ-005 FAIL: historical-style row — %', to_jsonb(r);
  end if;
  perform public.edit_assignment(h_id, '{"remarks":"edit without any location fields"}', 'REQ-005 test: historical');
  n := n + 1;

  -- ── 10. DRIVERS cannot change the new columns ──
  select auth_user_id into drv_uid from public.drivers where auth_user_id is not null and archived_at is null limit 1;
  if drv_uid is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', drv_uid, 'role', 'authenticated')::text, true);
    ok := false; begin update public.assignments set pickup_latitude = 14.6, pickup_longitude = 121.0 where id = t_id;
    exception when others then ok := sqlstate = '42501'; end;
    if not ok then raise exception 'REQ-005 FAIL: a driver could change pickup coordinates'; end if;
    n := n + 1;
  end if;

  raise exception 'REQ-005 TESTS PASSED (% checks%) — rolled back on purpose, nothing was saved',
    n, case when drv_uid is null then '; driver check skipped: no driver login found' else '' end;
end
$test$;
