-- ════════════════════════════════════════════════════════════════════════════
-- Scheduled Time of Arrival (STA) — database tests
-- (run AFTER 20261105000000_rename_eta_to_scheduled_arrival_time.sql).
--
-- Leaves NOTHING behind: one transaction, one DO block that always finishes by
-- raising an exception, then ROLLBACK. Read the final message:
--   "STA TESTS PASSED (n checks) — rolled back on purpose"  → all good
--   "STA FAIL: …"                                            → what broke
--
-- Throwaway user / drivers / trucks only (@sta-test.invalid, ids containing
-- SATTEST); real rows are never touched. Run the whole file at once.
-- (That saved values survive the rename is proved inside the migration itself.)
-- ════════════════════════════════════════════════════════════════════════════
begin;

do $test$
declare
  n      int := 0;
  csr_u  uuid := gen_random_uuid();
  csr_s  uuid := gen_random_uuid();
  c_csr  text;
  d1 text := 'DR-SATTEST-1';  d2 text := 'DR-SATTEST-2';  d3 text := 'DR-SATTEST-3';
  t1 text := 'TRK-SATTEST-1'; t2 text := 'TRK-SATTEST-2'; t3 text := 'TRK-SATTEST-3';
  -- a valid dispatch request without the arrival time and without driver/truck
  base   jsonb := jsonb_build_object(
    'destination', 'Makati City → Pasay City', 'destination_area', 'Pasay City', 'company', 'STA test',
    'pickup_location', 'Makati warehouse', 'delivery_location', 'Pasay City',
    'pickup_time', '09:00 AM', 'picked_up_date', 'Nov 6, 2026', 'delivery_date', 'Nov 6, 2026');
  a1 text; a2 text; a3 text;
  r      public.assignments%rowtype;
  err    text;
  cnt    int;
begin
  -- ── setup: a CSR on its newest session who just signed in with a password ──
  insert into auth.users (id, aud, role, email, created_at, updated_at)
  values (csr_u, 'authenticated', 'authenticated', 'csr@sta-test.invalid', now(), now());
  insert into public.profiles (id, email, name, role, status)
  values (csr_u, 'csr@sta-test.invalid', 'Sta Test Csr', 'csr', 'active');
  insert into auth.sessions (id, user_id, created_at, updated_at) values (csr_s, csr_u, now(), now());
  insert into public.drivers (id, name, phone, status) values
    (d1, 'Sta Test Driver One', '+639990007101', 'Pending'),
    (d2, 'Sta Test Driver Two', '+639990007102', 'Pending'),
    (d3, 'Sta Test Driver Three', '+639990007103', 'Pending');
  insert into public.trucks (id, plate_number, status) values
    (t1, 'STA-0001', 'Available'), (t2, 'STA-0002', 'Available'), (t3, 'STA-0003', 'Available');
  c_csr := jsonb_build_object('sub', csr_u, 'role', 'authenticated', 'session_id', csr_s,
    'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint)))::text;

  -- ── 1. the column is renamed: no `eta`, a text `scheduled_arrival_time` that is never null ──
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'assignments' and column_name = 'eta')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'assignments'
                      and column_name = 'scheduled_arrival_time' and data_type = 'text' and is_nullable = 'NO'
                      and column_default = '''''::text') then
    raise exception 'STA FAIL: assignments columns are wrong after the rename';
  end if;
  n := n + 1;

  -- ── 2. only the two rewritten functions still mention `eta` (the old-key alias) ──
  select count(*) into cnt from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosrc ~ '\meta\M'
     and p.proname not in ('edit_assignment', 'dispatch_assignment');
  if cnt <> 0 then raise exception 'STA FAIL: % other function(s) still mention eta', cnt; end if;
  n := n + 1;

  -- ── 3. dispatch with the new key: stored, trimmed ──
  set local role authenticated;
  perform set_config('request.jwt.claims', c_csr, true);
  a1 := public.dispatch_assignment(base || jsonb_build_object('driver_id', d1, 'truck_id', t1, 'scheduled_arrival_time', '  04:00 PM  '));
  reset role;
  select * into r from public.assignments where id = a1;
  if r.scheduled_arrival_time <> '04:00 PM' or r.state <> 'active' or r.task_status <> 'Assigned' then
    raise exception 'STA FAIL: dispatch with the new key saved "%"', r.scheduled_arrival_time;
  end if;
  n := n + 1;

  -- ── 4. dispatch with the OLD key (a page that has not refreshed): same field; new key wins if both ──
  set local role authenticated;
  perform set_config('request.jwt.claims', c_csr, true);
  a2 := public.dispatch_assignment(base || jsonb_build_object('driver_id', d2, 'truck_id', t2, 'eta', '05:30 PM'));
  a3 := public.dispatch_assignment(base || jsonb_build_object('driver_id', d3, 'truck_id', t3, 'eta', '01:00 AM', 'scheduled_arrival_time', '02:00 PM'));
  reset role;
  if (select scheduled_arrival_time from public.assignments where id = a2) <> '05:30 PM' then
    raise exception 'STA FAIL: the old "eta" key was not stored as the scheduled arrival time';
  end if;
  if (select scheduled_arrival_time from public.assignments where id = a3) <> '02:00 PM' then
    raise exception 'STA FAIL: with both keys the new one did not win';
  end if;
  n := n + 1;

  -- ── 5. dispatch refuses a non-text value (under either key) and unknown fields ──
  set local role authenticated;
  perform set_config('request.jwt.claims', c_csr, true);
  err := null; begin perform public.dispatch_assignment(base || jsonb_build_object('driver_id', d1, 'truck_id', t1, 'scheduled_arrival_time', 5)); exception when others then err := sqlerrm; end;
  if err is distinct from 'invalid_value: scheduled_arrival_time' then raise exception 'STA FAIL: numeric new key gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.dispatch_assignment(base || jsonb_build_object('driver_id', d1, 'truck_id', t1, 'eta', 5)); exception when others then err := sqlerrm; end;
  if err is distinct from 'invalid_value: scheduled_arrival_time' then raise exception 'STA FAIL: numeric old key gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.dispatch_assignment(base || jsonb_build_object('driver_id', d1, 'truck_id', t1, 'bogus', 'x')); exception when others then err := sqlerrm; end;
  if err is distinct from 'field_not_allowed: bogus' then raise exception 'STA FAIL: unknown field gave %', coalesce(err, 'success'); end if;
  n := n + 1;

  -- ── 6. edit with the new key: saved, and the audit row names the new field ──
  perform public.edit_assignment(a1, '{"scheduled_arrival_time": "06:00 PM"}', 'STA test: new key');
  reset role;
  if (select scheduled_arrival_time from public.assignments where id = a1) <> '06:00 PM' then
    raise exception 'STA FAIL: edit with the new key did not save';
  end if;
  if not exists (select 1 from public.activity_log
                  where assignment_id = a1 and type = 'task_edited'
                    and changes -> 'scheduled_arrival_time' ->> 'old' = '04:00 PM'
                    and changes -> 'scheduled_arrival_time' ->> 'new' = '06:00 PM'
                    and not (changes ? 'eta')) then
    raise exception 'STA FAIL: the audit row does not show old → new under scheduled_arrival_time';
  end if;
  n := n + 1;

  -- ── 7. edit with the OLD key works the same and is logged under the new name ──
  set local role authenticated;
  perform set_config('request.jwt.claims', c_csr, true);
  perform public.edit_assignment(a1, '{"eta": "07:15 PM"}', 'STA test: old key');
  reset role;
  if (select scheduled_arrival_time from public.assignments where id = a1) <> '07:15 PM' then
    raise exception 'STA FAIL: edit with the old key did not save';
  end if;
  if not exists (select 1 from public.activity_log
                  where assignment_id = a1 and type = 'task_edited'
                    and changes -> 'scheduled_arrival_time' ->> 'new' = '07:15 PM'
                    and not (changes ? 'eta')) then
    raise exception 'STA FAIL: an old-key edit was not logged under scheduled_arrival_time';
  end if;
  n := n + 1;

  -- ── 8. edit: no-change, blank, unknown field, and both keys (new wins) ──
  set local role authenticated;
  perform set_config('request.jwt.claims', c_csr, true);
  err := null; begin perform public.edit_assignment(a1, '{"eta": "07:15 PM"}', 'STA test: same'); exception when others then err := sqlerrm; end;
  if err is distinct from 'no_changes' then raise exception 'STA FAIL: an unchanged value gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.edit_assignment(a1, '{"scheduled_arrival_time": "  "}', 'STA test: blank'); exception when others then err := sqlerrm; end;
  if err is distinct from 'required_field: scheduled_arrival_time' then raise exception 'STA FAIL: blank value gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.edit_assignment(a1, '{"bogus": "x"}', 'STA test: unknown'); exception when others then err := sqlerrm; end;
  if err is distinct from 'field_not_editable: bogus' then raise exception 'STA FAIL: unknown field gave %', coalesce(err, 'success'); end if;
  perform public.edit_assignment(a1, '{"eta": "08:00 PM", "scheduled_arrival_time": "09:00 PM"}', 'STA test: both');
  reset role;
  if (select scheduled_arrival_time from public.assignments where id = a1) <> '09:00 PM' then
    raise exception 'STA FAIL: with both keys the new one did not win in edit';
  end if;
  n := n + 1;

  raise exception 'STA TESTS PASSED (% checks) — rolled back on purpose, nothing was saved', n;
end
$test$;
rollback;
