-- ════════════════════════════════════════════════════════════════════════════
-- Force cancel with an open blocking issue — database tests.
--
-- Run AFTER 20261111000003_cancel_with_open_issue.sql (and everything before it).
--
-- Rules under test: a delivery with an OPEN BLOCKING ISSUE can be cancelled at any stage before it is
-- delivered; without one the loading cutoff still applies; a resolved issue does not open the door;
-- the password, reason and role rules are unchanged; the issue row stays open; a direct table update
-- still cannot cancel.
--
-- Leaves NOTHING behind: one transaction, one DO block that always finishes by raising an exception,
-- then ROLLBACK. Read the final message:
--   "FORCE CANCEL TESTS PASSED (n checks) — rolled back on purpose"  → all good
--   "FORCE CANCEL FAIL: …"                                            → what broke
--
-- Throwaway users / driver / trucks / assignments only (@force-cancel-test.invalid, ids containing
-- FCTEST); real rows are never touched. Run the whole file at once.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create function pg_temp.fc_claims(p_uid uuid, p_sid uuid) returns text
language sql as $f$
  select jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', p_sid)::text;
$f$;

-- A throwaway active assignment at a given stage.
create function pg_temp.fc_assignment(p_id text, p_driver text, p_truck text,
                                      p_status text, p_stage text, p_loaded boolean) returns void
language sql as $f$
  insert into public.assignments (id, destination, destination_area, company, pickup_location, task_status, state,
                                  driver_id, driver_name, truck_id, truck_plate, operational_stage, loading_completed_at)
  values (p_id, 'Makati City → Pasay City', 'Pasay City', 'Force cancel test', 'Makati City', p_status, 'active',
          p_driver, 'Force Cancel Test Driver', p_truck, 'FCT-0001', p_stage, case when p_loaded then now() end);
$f$;

-- A throwaway issue report on an assignment (status 'open' or 'resolved').
create function pg_temp.fc_issue(p_assignment text, p_driver text, p_status text) returns void
language sql as $f$
  insert into public.assignment_issues (assignment_id, issue_type, reason, is_blocking, status, reported_by_driver_id,
                                        reported_by_name, task_status_at_report, resolved_at)
  values (p_assignment, 'Vehicle breakdown', 'Vehicle breakdown', true, p_status, p_driver,
          'Force Cancel Test Driver', 'In Transit', case when p_status = 'resolved' then now() end);
$f$;

do $test$
declare
  n      int := 0;
  csr_u  uuid := gen_random_uuid();
  opm_u  uuid := gen_random_uuid();
  csr_s  uuid := gen_random_uuid();
  opm_s  uuid := gen_random_uuid();
  drv_id text := 'DR-FCTEST';
  trk_id text := 'TRK-FCTEST';
  trk2   text := 'TRK-FCTEST-2';
  pw     text := 'Force-Cancel-Pass-1';
  v_reason text := 'Vehicle broke down and cannot be repaired';
  c_opm text; c_csr text;
  r      public.assignments%rowtype;
  err    text;
  cnt    int;
begin
  -- ── setup ──
  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (csr_u, 'authenticated', 'authenticated', 'csr@force-cancel-test.invalid', extensions.crypt(pw, extensions.gen_salt('bf')), now(), now(), now()),
         (opm_u, 'authenticated', 'authenticated', 'opm@force-cancel-test.invalid', extensions.crypt(pw, extensions.gen_salt('bf')), now(), now(), now());
  insert into public.profiles (id, email, name, role, status)
  values (csr_u, 'csr@force-cancel-test.invalid', 'Force Cancel Test CSR', 'csr', 'active'),
         (opm_u, 'opm@force-cancel-test.invalid', 'Force Cancel Test OPM', 'opm', 'active');
  insert into auth.sessions (id, user_id, created_at, updated_at) values (csr_s, csr_u, now(), now()), (opm_s, opm_u, now(), now());
  insert into public.drivers (id, name, phone, status) values (drv_id, 'Force Cancel Test Driver', '+639990007788', 'Assigned');
  insert into public.trucks (id, plate_number, status) values (trk_id, 'FCT-0001', 'Assigned'), (trk2, 'FCT-0002', 'Assigned');
  c_opm := pg_temp.fc_claims(opm_u, opm_s);  c_csr := pg_temp.fc_claims(csr_u, csr_s);

  perform set_config('request.jwt.claims', '{}', true);
  -- In Transit, loaded, with an open blocking issue (the case from the field)
  perform pg_temp.fc_assignment('ASN-FCTEST-A', drv_id, trk_id, 'In Transit', 'loaded', true);
  perform pg_temp.fc_issue('ASN-FCTEST-A', drv_id, 'open');
  -- In Transit, loaded, NO issue
  perform pg_temp.fc_assignment('ASN-FCTEST-B', drv_id, trk_id, 'In Transit', 'loaded', true);
  -- In Transit, loaded, issue already RESOLVED
  perform pg_temp.fc_assignment('ASN-FCTEST-C', drv_id, trk_id, 'In Transit', 'loaded', true);
  perform pg_temp.fc_issue('ASN-FCTEST-C', drv_id, 'resolved');
  -- unloading at the destination, with an open issue ("customer refused delivery")
  perform pg_temp.fc_assignment('ASN-FCTEST-D', drv_id, trk_id, 'In Transit', 'unloading', true);
  perform pg_temp.fc_issue('ASN-FCTEST-D', drv_id, 'open');
  -- already delivered but still 'active' row, with an open issue
  perform pg_temp.fc_assignment('ASN-FCTEST-E', drv_id, trk2, 'Delivered', 'unloaded', true);
  perform pg_temp.fc_issue('ASN-FCTEST-E', drv_id, 'open');
  -- Picked Up, open issue
  perform pg_temp.fc_assignment('ASN-FCTEST-F', drv_id, trk2, 'Picked Up', 'loaded', true);
  perform pg_temp.fc_issue('ASN-FCTEST-F', drv_id, 'open');
  -- still at the Assigned stage with an open issue (this already worked before)
  perform pg_temp.fc_assignment('ASN-FCTEST-G', drv_id, trk2, 'Assigned', null, false);
  perform pg_temp.fc_issue('ASN-FCTEST-G', drv_id, 'open');

  -- ── 1. without an open issue the loading cutoff is unchanged (In Transit refused) ──
  perform set_config('request.jwt.claims', c_csr, true);
  set local role authenticated;
  err := null; begin perform public.cancel_assignment('ASN-FCTEST-B', v_reason, pw); exception when others then err := sqlerrm; end;
  if err is distinct from 'loading_completed' then raise exception 'FORCE CANCEL FAIL: no issue, In Transit gave %', coalesce(err, 'success'); end if;
  n := n + 1;

  -- ── 2. a RESOLVED issue does not reopen cancellation ──
  err := null; begin perform public.cancel_assignment('ASN-FCTEST-C', v_reason, pw); exception when others then err := sqlerrm; end;
  if err is distinct from 'loading_completed' then raise exception 'FORCE CANCEL FAIL: resolved issue, In Transit gave %', coalesce(err, 'success'); end if;
  n := n + 1;

  -- ── 3. the other rules still apply with an open issue: role, reason, password ──
  perform set_config('request.jwt.claims', c_opm, true);
  err := null; begin perform public.cancel_assignment('ASN-FCTEST-A', v_reason, pw); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_authorized' then raise exception 'FORCE CANCEL FAIL: OPM cancel gave %', coalesce(err, 'success'); end if;
  perform set_config('request.jwt.claims', c_csr, true);
  err := null; begin perform public.cancel_assignment('ASN-FCTEST-A', '  too short ', pw); exception when others then err := sqlerrm; end;
  if err is distinct from 'invalid_reason' then raise exception 'FORCE CANCEL FAIL: short reason gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.cancel_assignment('ASN-FCTEST-A', v_reason, ''); exception when others then err := sqlerrm; end;
  if err is distinct from 'wrong_password' then raise exception 'FORCE CANCEL FAIL: empty password gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.cancel_assignment('ASN-FCTEST-A', v_reason, 'not-the-password'); exception when others then err := sqlerrm; end;
  if err is distinct from 'wrong_password' then raise exception 'FORCE CANCEL FAIL: wrong password gave %', coalesce(err, 'success'); end if;
  if (select state from public.assignments where id = 'ASN-FCTEST-A') <> 'active' then
    raise exception 'FORCE CANCEL FAIL: a refused cancel changed the assignment';
  end if;
  n := n + 1;

  -- ── 4. the table guard: a direct update still cannot cancel, even with an open issue ──
  err := null; begin update public.assignments set state = 'cancelled', task_status = 'Cancelled' where id = 'ASN-FCTEST-A';
  exception when others then err := sqlerrm; end;
  if err is distinct from 'not_authorized' then raise exception 'FORCE CANCEL FAIL: direct cancel gave %', coalesce(err, 'success'); end if;
  n := n + 1;

  -- ── 5. In Transit + open blocking issue: the CSR can cancel with password and reason ──
  perform public.cancel_assignment('ASN-FCTEST-A', '  ' || v_reason || '  ', pw);
  reset role;
  select * into r from public.assignments where id = 'ASN-FCTEST-A';
  if r.state <> 'cancelled' or r.task_status <> 'Cancelled' or r.cancel_reason <> v_reason or r.cancelled_at is null then
    raise exception 'FORCE CANCEL FAIL: cancel result % / % / %', r.state, r.task_status, r.cancel_reason;
  end if;
  n := n + 1;

  -- ── 6. the issue stays OPEN (it was not resolved), and the audit entry and driver notice exist ──
  if (select status from public.assignment_issues where assignment_id = 'ASN-FCTEST-A') <> 'open' then
    raise exception 'FORCE CANCEL FAIL: the cancelled assignment''s issue was not left open';
  end if;
  select count(*) into cnt from public.activity_log
   where type = 'task_cancelled' and assignment_id = 'ASN-FCTEST-A' and reason = v_reason and member_name = 'Force Cancel Test CSR';
  if cnt <> 1 then raise exception 'FORCE CANCEL FAIL: expected 1 task_cancelled audit entry, found %', cnt; end if;
  if exists (select 1 from public.activity_log l where l.assignment_id = 'ASN-FCTEST-A' and to_jsonb(l)::text like '%' || pw || '%') then
    raise exception 'FORCE CANCEL FAIL: password written to the activity log';
  end if;
  if not exists (select 1 from public.notifications where id = 'notif-cancel-ASN-FCTEST-A' and type = 'driver_cancelled') then
    raise exception 'FORCE CANCEL FAIL: no driver notification';
  end if;
  n := n + 1;

  -- ── 7. unloading at the destination, Picked Up, and the Assigned stage all work with an open issue ──
  perform set_config('request.jwt.claims', c_csr, true);
  set local role authenticated;
  perform public.cancel_assignment('ASN-FCTEST-D', v_reason, pw);
  perform public.cancel_assignment('ASN-FCTEST-F', v_reason, pw);
  perform public.cancel_assignment('ASN-FCTEST-G', v_reason, pw);
  reset role;
  if (select count(*) from public.assignments where id in ('ASN-FCTEST-D', 'ASN-FCTEST-F', 'ASN-FCTEST-G') and state = 'cancelled') <> 3 then
    raise exception 'FORCE CANCEL FAIL: unloading / Picked Up / Assigned with an open issue not cancellable';
  end if;
  n := n + 1;

  -- ── 8. a delivered assignment is never cancelled, even with an open issue; nor is one cancelled twice ──
  perform set_config('request.jwt.claims', c_csr, true);
  set local role authenticated;
  err := null; begin perform public.cancel_assignment('ASN-FCTEST-E', v_reason, pw); exception when others then err := sqlerrm; end;
  if err is distinct from 'loading_completed' then raise exception 'FORCE CANCEL FAIL: delivered gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.cancel_assignment('ASN-FCTEST-A', v_reason, pw); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_cancellable' then raise exception 'FORCE CANCEL FAIL: second cancel gave %', coalesce(err, 'success'); end if;
  n := n + 1;

  -- ── 9. cancelling an In Transit delivery that still has no issue stays refused after the others went through ──
  err := null; begin perform public.cancel_assignment('ASN-FCTEST-B', v_reason, pw); exception when others then err := sqlerrm; end;
  if err is distinct from 'loading_completed' then raise exception 'FORCE CANCEL FAIL: no-issue delivery gave %', coalesce(err, 'success'); end if;
  reset role;
  if (select state from public.assignments where id = 'ASN-FCTEST-B') <> 'active' then
    raise exception 'FORCE CANCEL FAIL: a refused cancel changed ASN-FCTEST-B';
  end if;
  n := n + 1;

  raise exception 'FORCE CANCEL TESTS PASSED (% checks) — rolled back on purpose', n;
end
$test$;

rollback;
