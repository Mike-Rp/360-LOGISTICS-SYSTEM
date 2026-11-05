-- ════════════════════════════════════════════════════════════════════════════
-- Recent Reports pagination — database tests
-- (run AFTER 20261105000001_list_issued_reports_page.sql).
--
-- Leaves NOTHING behind: one transaction, one DO block that always finishes by
-- raising an exception, then ROLLBACK. Read the final message:
--   "REPORT PAGE TESTS PASSED (n checks) — rolled back on purpose"  → all good
--   "REPORT PAGE FAIL: …"                                            → what broke
--
-- IMPORTANT: to test an empty history and exact totals this file deletes every
-- row of public.issued_reports INSIDE the transaction and builds its own rows.
-- The final exception + ROLLBACK put all real reports back, untouched. Do not
-- edit the file so that it can end without raising — run the whole file at once.
-- Throwaway users only (@rpage-test.invalid).
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- ids of a page's "reports" array, in the order they were returned
create function pg_temp.pg_ids(p jsonb) returns text[]
language sql as $f$
  select coalesce(array_agg(e.value ->> 'id' order by e.ord), '{}')
    from jsonb_array_elements(p -> 'reports') with ordinality as e(value, ord);
$f$;

-- what a page SHOULD contain: cut from the whole history in the documented order
create function pg_temp.pg_expected(p_limit int, p_offset int) returns text[]
language sql as $f$
  select coalesce(array_agg(id order by generated_at desc, id desc), '{}')
    from (select id, generated_at from public.issued_reports
           order by generated_at desc, id desc limit p_limit offset p_offset) x;
$f$;

do $test$
declare
  n      int := 0;
  csr_u  uuid := gen_random_uuid();  csr_s uuid := gen_random_uuid();  csr_old uuid := gen_random_uuid();
  opm_u  uuid := gen_random_uuid();  opm_s uuid := gen_random_uuid();
  drv_u  uuid := gen_random_uuid();  drv_s uuid := gen_random_uuid();
  c_csr text; c_csr_old text; c_opm text; c_drv text; c_none text := '{}';
  v      jsonb;
  w      jsonb;
  pages  jsonb;
  pg     jsonb;
  ids    text[];
  seen   text[];
  off    int;
  ok     boolean;
  err    text;
  rid    text;
begin
  -- ── setup ──
  insert into auth.users (id, aud, role, email, created_at, updated_at)
  values (csr_u, 'authenticated', 'authenticated', 'csr@rpage-test.invalid', now(), now()),
         (opm_u, 'authenticated', 'authenticated', 'opm@rpage-test.invalid', now(), now()),
         (drv_u, 'authenticated', 'authenticated', 'drv@rpage-test.invalid', now(), now());
  insert into public.profiles (id, email, name, role, status)
  values (csr_u, 'csr@rpage-test.invalid', 'Rpage Test Csr', 'csr', 'active'),
         (opm_u, 'opm@rpage-test.invalid', 'Rpage Test Opm', 'opm', 'active');
  insert into auth.sessions (id, user_id, created_at, updated_at) values
    (csr_old, csr_u, now() - interval '10 minutes', now()), (csr_s, csr_u, now(), now()),
    (opm_s, opm_u, now(), now()), (drv_s, drv_u, now(), now());
  c_csr     := jsonb_build_object('sub', csr_u, 'role', 'authenticated', 'session_id', csr_s,
                 'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint)))::text;
  c_csr_old := jsonb_build_object('sub', csr_u, 'role', 'authenticated', 'session_id', csr_old)::text;
  c_opm     := jsonb_build_object('sub', opm_u, 'role', 'authenticated', 'session_id', opm_s)::text;
  c_drv     := jsonb_build_object('sub', drv_u, 'role', 'authenticated', 'session_id', drv_s)::text;

  -- ── 1. permissions: signed-in only; no one gets direct access to the table ──
  if has_function_privilege('anon', 'public.list_issued_reports_page(int,int)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.list_issued_reports_page(int,int)', 'EXECUTE')
     or has_table_privilege('anon', 'public.issued_reports', 'SELECT')
     or has_table_privilege('authenticated', 'public.issued_reports', 'SELECT') then
    raise exception 'REPORT PAGE FAIL: wrong execute / table privileges';
  end if;
  n := n + 1;

  -- ── 2. unauthorized callers: anonymous, a driver (no staff profile), a replaced staff session, no session ──
  set local role anon;
  ok := false; begin perform public.list_issued_reports_page(10, 0); exception when insufficient_privilege then ok := true; end;
  reset role;
  if not ok then raise exception 'REPORT PAGE FAIL: anon could call the function'; end if;
  set local role authenticated;
  foreach err in array array[c_drv, c_csr_old, c_none] loop
    perform set_config('request.jwt.claims', err, true);
    rid := null;
    begin perform public.list_issued_reports_page(10, 0); rid := 'success'; exception when others then rid := sqlerrm; end;
    if rid is distinct from 'not_authorized' then raise exception 'REPORT PAGE FAIL: unauthorised caller got %', rid; end if;
  end loop;
  reset role;
  n := n + 1;

  -- ── 3. empty history: total 0, no reports ──
  delete from public.issued_reports;      -- inside this transaction only; rolled back at the end
  set local role authenticated;
  perform set_config('request.jwt.claims', c_csr, true);
  v := public.list_issued_reports_page(10, 0);
  w := public.list_issued_reports_page(10, 30);
  reset role;
  if (v ->> 'total')::int <> 0 or jsonb_array_length(v -> 'reports') <> 0
     or (w ->> 'total')::int <> 0 or jsonb_array_length(w -> 'reports') <> 0
     or (v ->> 'limit')::int <> 10 or (v ->> 'offset')::int <> 0 then
    raise exception 'REPORT PAGE FAIL: empty history gave %', v;
  end if;
  n := n + 1;

  -- ── 4. exactly 10 reports: one full page; the next page is empty but the total stays 10 ──
  insert into public.issued_reports (id, report_type, generated_by_name, generated_at, row_count)
  select 'RPT-PAGETEST' || lpad(i::text, 4, '0'), 'weekly', 'Rpage Test', timestamptz '2026-11-01 00:00+08' + i * interval '1 minute', i
    from generate_series(1, 10) i;
  set local role authenticated;
  perform set_config('request.jwt.claims', c_csr, true);
  v := public.list_issued_reports_page(10, 0);
  w := public.list_issued_reports_page(10, 10);
  reset role;
  if (v ->> 'total')::int <> 10 or jsonb_array_length(v -> 'reports') <> 10
     or pg_temp.pg_ids(v) <> pg_temp.pg_expected(10, 0)
     or (w ->> 'total')::int <> 10 or jsonb_array_length(w -> 'reports') <> 0 then
    raise exception 'REPORT PAGE FAIL: 10 reports gave % / %', v, w;
  end if;
  if (pg_temp.pg_ids(v))[1] <> 'RPT-PAGETEST0010' or (pg_temp.pg_ids(v))[10] <> 'RPT-PAGETEST0001' then
    raise exception 'REPORT PAGE FAIL: newest report is not first';
  end if;
  n := n + 1;

  -- ── 5. 11 reports: page 1 has 10, page 2 has the 1 oldest; total 11 on both ──
  insert into public.issued_reports (id, report_type, generated_by_name, generated_at, row_count)
  values ('RPT-PAGETEST0011', 'monthly', 'Rpage Test', timestamptz '2026-11-01 00:00+08' + 11 * interval '1 minute', 11);
  set local role authenticated;
  perform set_config('request.jwt.claims', c_csr, true);
  v := public.list_issued_reports_page(10, 0);
  w := public.list_issued_reports_page(10, 10);
  reset role;
  if (v ->> 'total')::int <> 11 or (w ->> 'total')::int <> 11
     or jsonb_array_length(v -> 'reports') <> 10 or jsonb_array_length(w -> 'reports') <> 1
     or pg_temp.pg_ids(v) <> pg_temp.pg_expected(10, 0) or pg_temp.pg_ids(w) <> pg_temp.pg_expected(10, 10)
     or (pg_temp.pg_ids(w))[1] <> 'RPT-PAGETEST0001' then
    raise exception 'REPORT PAGE FAIL: 11 reports gave % / %', v, w;
  end if;
  n := n + 1;

  -- ── 6. more than 100 reports: first / middle / last pages, offsets past 100, exact totals ──
  delete from public.issued_reports;
  insert into public.issued_reports (id, report_type, generated_by_name, generated_at, row_count)
  select 'RPT-PAGETEST' || lpad(i::text, 4, '0'), 'weekly', 'Rpage Test', timestamptz '2026-11-01 00:00+08' + i * interval '1 minute', i
    from generate_series(1, 250) i;
  set local role authenticated;
  perform set_config('request.jwt.claims', c_csr, true);
  pages := '[]'::jsonb;
  foreach off in array array[0, 10, 90, 100, 120, 125, 240, 245, 249] loop
    pages := pages || jsonb_build_array(public.list_issued_reports_page(10, off));
  end loop;
  v := public.list_issued_reports_page(10, 250);                 -- exactly at the end
  w := public.list_issued_reports_page(10, 100000);              -- far beyond the end
  reset role;
  for i in 0 .. jsonb_array_length(pages) - 1 loop
    pg := pages -> i;
    off := (pg ->> 'offset')::int;
    if (pg ->> 'total')::int <> 250 or jsonb_array_length(pg -> 'reports') <> least(10, 250 - off)
       or pg_temp.pg_ids(pg) <> pg_temp.pg_expected(10, off) then
      raise exception 'REPORT PAGE FAIL: offset % of 250 gave %', off, pg;
    end if;
    if off = 120 and ((pg_temp.pg_ids(pg))[1] <> 'RPT-PAGETEST0130' or (pg_temp.pg_ids(pg))[10] <> 'RPT-PAGETEST0121') then
      raise exception 'REPORT PAGE FAIL: the page at offset 120 (past 100) holds the wrong reports: %', pg_temp.pg_ids(pg);
    end if;
  end loop;
  if (v ->> 'total')::int <> 250 or jsonb_array_length(v -> 'reports') <> 0
     or (w ->> 'total')::int <> 250 or jsonb_array_length(w -> 'reports') <> 0 then
    raise exception 'REPORT PAGE FAIL: an offset past the last page gave % / %', v, w;
  end if;
  n := n + 1;

  -- ── 7. equal generated_at: the id breaks the tie, so paging neither repeats nor skips a report ──
  delete from public.issued_reports;
  insert into public.issued_reports (id, report_type, generated_by_name, generated_at, row_count)
  select 'RPT-PAGETEST' || lpad(i::text, 4, '0'), 'delay', 'Rpage Test', timestamptz '2026-11-02 09:00+08', 0
    from generate_series(1, 25) i;
  set local role authenticated;
  perform set_config('request.jwt.claims', c_csr, true);
  pages := '[]'::jsonb;
  foreach off in array array[0, 10, 20] loop
    pages := pages || jsonb_build_array(public.list_issued_reports_page(10, off));
  end loop;
  reset role;
  seen := '{}';
  for i in 0 .. jsonb_array_length(pages) - 1 loop
    pg := pages -> i;
    off := (pg ->> 'offset')::int;
    seen := seen || pg_temp.pg_ids(pg);
    if pg_temp.pg_ids(pg) <> pg_temp.pg_expected(10, off) or (pg ->> 'total')::int <> 25 then
      raise exception 'REPORT PAGE FAIL: same-time reports, offset % gave %', off, pg;
    end if;
  end loop;
  if cardinality(seen) <> 25 or (select count(distinct x) from unnest(seen) x) <> 25
     or seen[1] <> 'RPT-PAGETEST0025' or seen[25] <> 'RPT-PAGETEST0001' then
    raise exception 'REPORT PAGE FAIL: same-time reports were repeated, skipped or out of order: %', seen;
  end if;
  n := n + 1;

  -- ── 8. page size and offset are corrected, never an error ──
  set local role authenticated;
  perform set_config('request.jwt.claims', c_csr, true);
  v := public.list_issued_reports_page(0, 0);        -- too small  → 1
  w := public.list_issued_reports_page(1000, 0);     -- too large  → 100 (only 25 exist)
  if (v ->> 'limit')::int <> 1 or jsonb_array_length(v -> 'reports') <> 1
     or (w ->> 'limit')::int <> 100 or jsonb_array_length(w -> 'reports') <> 25 then
    raise exception 'REPORT PAGE FAIL: limit was not corrected: % / %', v, w;
  end if;
  v := public.list_issued_reports_page(null, null);  -- defaults → 10, 0
  w := public.list_issued_reports_page(5, -7);       -- negative offset → 0
  reset role;
  if (v ->> 'limit')::int <> 10 or (v ->> 'offset')::int <> 0 or jsonb_array_length(v -> 'reports') <> 10
     or (w ->> 'limit')::int <> 5 or (w ->> 'offset')::int <> 0
     or pg_temp.pg_ids(w) <> pg_temp.pg_expected(5, 0) then
    raise exception 'REPORT PAGE FAIL: null / negative values were not corrected: % / %', v, w;
  end if;
  n := n + 1;

  -- ── 9. the fields the frontend uses, and nothing more; OPM (view-only) may read ──
  delete from public.issued_reports;
  insert into public.issued_reports (id, report_type, generated_by_user_id, generated_by_name, generated_at,
                                     report_period_start, report_period_end, row_count, row_digest)
  values ('RPT-PAGETEST0001', 'weekly', csr_u, 'Rpage Test Csr', timestamptz '2026-11-03 10:00+08', date '2026-11-02', date '2026-11-08', 7, 'secret-digest'),
         ('RPT-PAGETEST0002', 'delay',  null,  'Rpage Test Csr', timestamptz '2026-11-03 09:00+08', null, null, 3, null);
  set local role authenticated;
  perform set_config('request.jwt.claims', c_opm, true);
  v := public.list_issued_reports_page(10, 0);
  reset role;
  if (select array_agg(k order by k) from jsonb_object_keys(v -> 'reports' -> 0) k)
       is distinct from array['generatedAt', 'generatedByName', 'id', 'periodEnd', 'periodStart', 'reportType', 'rowCount'] then
    raise exception 'REPORT PAGE FAIL: unexpected fields: %', v -> 'reports' -> 0;
  end if;
  if v -> 'reports' -> 0 ->> 'id' <> 'RPT-PAGETEST0001' or v -> 'reports' -> 0 ->> 'reportType' <> 'weekly'
     or v -> 'reports' -> 0 ->> 'periodStart' <> '2026-11-02' or v -> 'reports' -> 0 ->> 'periodEnd' <> '2026-11-08'
     or (v -> 'reports' -> 0 ->> 'rowCount')::int <> 7 or v -> 'reports' -> 0 ->> 'generatedByName' <> 'Rpage Test Csr'
     or v -> 'reports' -> 1 -> 'periodStart' <> 'null'::jsonb or v -> 'reports' -> 1 -> 'periodEnd' <> 'null'::jsonb then
    raise exception 'REPORT PAGE FAIL: field values are wrong: %', v;
  end if;
  if v::text like '%secret-digest%' or v::text like '%generated_by_user_id%' or v::text like '%rowDigest%' then
    raise exception 'REPORT PAGE FAIL: a field that must not be listed was returned';
  end if;
  n := n + 1;

  -- ── 10. the existing functions still work: list_issued_reports, verify_report, issue_report ──
  set local role authenticated;
  perform set_config('request.jwt.claims', c_csr, true);
  if (select count(*) from public.list_issued_reports(20)) <> 2 then
    raise exception 'REPORT PAGE FAIL: list_issued_reports() changed';
  end if;
  w := public.issue_report('monthly', date '2026-11-01', date '2026-11-30', 4, null);
  v := public.list_issued_reports_page(10, 0);
  reset role;
  if (v ->> 'total')::int <> 3 or v -> 'reports' -> 0 ->> 'id' <> w ->> 'id' then
    raise exception 'REPORT PAGE FAIL: a freshly issued report is not first with the total raised to 3: %', v;
  end if;
  set local role anon;
  if public.verify_report('RPT-PAGETEST0001') ->> 'rowCount' <> '7' then
    raise exception 'REPORT PAGE FAIL: verify_report() changed';
  end if;
  reset role;
  n := n + 1;

  raise exception 'REPORT PAGE TESTS PASSED (% checks) — rolled back on purpose, nothing was saved', n;
end
$test$;
rollback;
