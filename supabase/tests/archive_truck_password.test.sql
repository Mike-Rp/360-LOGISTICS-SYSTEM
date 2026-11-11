-- ════════════════════════════════════════════════════════════════════════════
-- Archiving a truck needs the OPM's password (like archiving a driver) — database tests.
-- Run AFTER migration 20261111000000_archive_truck_requires_password.sql.
--
-- Leaves NOTHING behind: one transaction, one DO block that always finishes by
-- raising an exception, then ROLLBACK. Read the final message:
--   "ARCHIVE TRUCK TESTS PASSED (n checks) — rolled back on purpose"  → all good
--   "ARCHIVE TRUCK FAIL: …"                                            → what broke
--
-- Requests are simulated like the other tests do: request.jwt.claims (sub + session_id + the time
-- the password was last typed) and role authenticated. "Stale" = the password was last typed an
-- hour ago. Throwaway users and trucks only (@archive-test.invalid, T-ARCHT*); real rows are never
-- touched. Run the whole file at once.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create function pg_temp.at_session(p_uid uuid) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.sessions (id, user_id, created_at, updated_at) values (v, p_uid, now(), now());
  return v;
end $f$;

create function pg_temp.at_claims(p_uid uuid, p_sid uuid, p_fresh boolean default true) returns text
language sql as $f$
  select jsonb_build_object(
    'sub', p_uid, 'role', 'authenticated', 'session_id', p_sid,
    'amr', jsonb_build_array(jsonb_build_object('method', 'password',
            'timestamp', extract(epoch from now())::bigint - case when p_fresh then 0 else 3600 end))
  )::text;
$f$;

do $test$
declare
  n     int := 0;
  opm_u uuid := gen_random_uuid();
  csr_u uuid := gen_random_uuid();
  s_opm uuid; s_csr uuid;
  c_opm text; c_opm_stale text; c_csr text;
  err   text;
  a     record;
begin
  -- ── setup ──
  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (opm_u, 'authenticated', 'authenticated', 'opm@archive-test.invalid', extensions.crypt('x-pass-1', extensions.gen_salt('bf')), now(), now(), now()),
         (csr_u, 'authenticated', 'authenticated', 'csr@archive-test.invalid', extensions.crypt('x-pass-2', extensions.gen_salt('bf')), now(), now(), now());
  insert into public.profiles (id, email, name, role, status)
  values (opm_u, 'opm@archive-test.invalid', 'Archive Test OPM', 'opm', 'active'),
         (csr_u, 'csr@archive-test.invalid', 'Archive Test CSR', 'csr', 'active');
  s_opm := pg_temp.at_session(opm_u);  s_csr := pg_temp.at_session(csr_u);
  c_opm := pg_temp.at_claims(opm_u, s_opm);  c_opm_stale := pg_temp.at_claims(opm_u, s_opm, false);  c_csr := pg_temp.at_claims(csr_u, s_csr);

  insert into public.trucks (id, plate_number, status) values
    ('T-ARCHT1', 'ZQA 8001', 'Available'),     -- archived with the password
    ('T-ARCHT2', 'ZQA 8002', 'Available'),     -- refused without it
    ('T-ARCHT3', 'ZQA 8003', 'Assigned');      -- on an active delivery
  insert into public.assignments (id, destination, destination_area, company, pickup_location, task_status, state, truck_id, truck_plate)
  values ('ASN-ARCHT1', 'Makati City → Pasay City', 'Pasay City', 'Archive test', 'Makati City', 'Assigned', 'active', 'T-ARCHT3', 'ZQA 8003');

  -- ── 1. without a recent password the OPM is refused and nothing changes ──
  perform set_config('request.jwt.claims', c_opm_stale, true);
  set local role authenticated;
  err := null; begin perform public.archive_truck('T-ARCHT2'); exception when others then err := sqlerrm; end;
  reset role;
  if err is distinct from 'reauth_required' then raise exception 'ARCHIVE TRUCK FAIL: archiving without a recent password gave %', coalesce(err, 'success'); end if;
  if (select archived_at from public.trucks where id = 'T-ARCHT2') is not null then
    raise exception 'ARCHIVE TRUCK FAIL: the truck was archived without the password';
  end if;
  if exists (select 1 from public.activity_log where type = 'truck_archived' and truck_plate = 'ZQA 8002') then
    raise exception 'ARCHIVE TRUCK FAIL: a refused request still wrote a log row';
  end if;
  n := n + 1;

  -- ── 2. with the password just typed, it works, is stamped and logged ──
  perform set_config('request.jwt.claims', c_opm, true);
  set local role authenticated;
  perform public.archive_truck('T-ARCHT1');
  reset role;
  select * into a from public.trucks where id = 'T-ARCHT1';
  if a.archived_at is null or a.status <> 'Available' then raise exception 'ARCHIVE TRUCK FAIL: the truck was not archived correctly'; end if;
  if not exists (select 1 from public.activity_log where type = 'truck_archived' and truck_plate = 'ZQA 8001' and admin_role = 'opm') then
    raise exception 'ARCHIVE TRUCK FAIL: the archiving was not logged';
  end if;
  n := n + 1;

  -- ── 3. nobody but the OPM, password or not ──
  perform set_config('request.jwt.claims', c_csr, true);
  set local role authenticated;
  err := null; begin perform public.archive_truck('T-ARCHT2'); exception when others then err := sqlerrm; end;
  reset role;
  if err is distinct from 'not_authorized' then raise exception 'ARCHIVE TRUCK FAIL: a CSR archiving a truck gave %', coalesce(err, 'success'); end if;
  if (select archived_at from public.trucks where id = 'T-ARCHT2') is not null then raise exception 'ARCHIVE TRUCK FAIL: a CSR archived a truck'; end if;
  n := n + 1;

  -- ── 4. the older rules still hold (with a fresh password) ──
  perform set_config('request.jwt.claims', c_opm, true);
  set local role authenticated;
  err := null; begin perform public.archive_truck('T-ARCHT3'); exception when others then err := sqlerrm; end;
  if err is distinct from 'truck_busy' then raise exception 'ARCHIVE TRUCK FAIL: a truck on a delivery gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.archive_truck('T-ARCHT1'); exception when others then err := sqlerrm; end;
  if err is distinct from 'already_archived' then raise exception 'ARCHIVE TRUCK FAIL: archiving twice gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.archive_truck('T-NOSUCH'); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_found' then raise exception 'ARCHIVE TRUCK FAIL: an unknown truck gave %', coalesce(err, 'success'); end if;
  reset role;
  if (select archived_at from public.trucks where id = 'T-ARCHT3') is not null then raise exception 'ARCHIVE TRUCK FAIL: a busy truck was archived'; end if;
  n := n + 1;

  -- ── 5. the password check comes before anything else is revealed ──
  -- a stale session cannot even learn whether a truck exists or is busy
  perform set_config('request.jwt.claims', c_opm_stale, true);
  set local role authenticated;
  err := null; begin perform public.archive_truck('T-NOSUCH'); exception when others then err := sqlerrm; end;
  if err is distinct from 'reauth_required' then raise exception 'ARCHIVE TRUCK FAIL: an unknown truck with a stale password gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.archive_truck('T-ARCHT3'); exception when others then err := sqlerrm; end;
  if err is distinct from 'reauth_required' then raise exception 'ARCHIVE TRUCK FAIL: a busy truck with a stale password gave %', coalesce(err, 'success'); end if;
  reset role;
  n := n + 1;

  raise exception 'ARCHIVE TRUCK TESTS PASSED (% checks) — rolled back on purpose', n;
end
$test$;

rollback;
