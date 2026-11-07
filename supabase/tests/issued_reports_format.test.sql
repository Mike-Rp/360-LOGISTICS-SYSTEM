-- ════════════════════════════════════════════════════════════════════════════
-- Recent Reports: PDF vs Excel format — database tests.
-- Run AFTER migration 20261107000000_issued_reports_format.sql.
--
-- Leaves NOTHING behind: one transaction, one DO block that always finishes by
-- raising an exception, then ROLLBACK. Read the final message:
--   "FORMAT TESTS PASSED (n checks) — rolled back on purpose"  → all good
--   "FORMAT FAIL: …"                                            → what broke
--
-- Requests are simulated like the other tests do: request.jwt.claims (sub + session_id +
-- a password sign-in time) and role authenticated. Throwaway users only
-- (@format-test.invalid); real rows are never touched. Run the whole file at once.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create function pg_temp.fm_session(p_uid uuid) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.sessions (id, user_id, created_at, updated_at) values (v, p_uid, now(), now());
  return v;
end $f$;

create function pg_temp.fm_claims(p_uid uuid, p_sid uuid) returns text
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
  nobody uuid := gen_random_uuid();     -- signed in, but has no staff profile (like a driver)
  c_opm text; c_csr text; c_none text;
  r_pdf jsonb; r_old jsonb; r_xls jsonb; page jsonb; one jsonb;
  err   text;
  ok    boolean;
  cnt   int;
begin
  -- ── setup ──
  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (opm_u,  'authenticated', 'authenticated', 'opm@format-test.invalid',  extensions.crypt('x-pass-1', extensions.gen_salt('bf')), now(), now(), now()),
         (csr_u,  'authenticated', 'authenticated', 'csr@format-test.invalid',  extensions.crypt('x-pass-2', extensions.gen_salt('bf')), now(), now(), now()),
         (nobody, 'authenticated', 'authenticated', 'nobody@format-test.invalid', extensions.crypt('x-pass-3', extensions.gen_salt('bf')), now(), now(), now());
  insert into public.profiles (id, email, name, role, status)
  values (opm_u, 'opm@format-test.invalid', 'Format Test OPM', 'opm', 'active'),
         (csr_u, 'csr@format-test.invalid', 'Format Test CSR', 'csr', 'active');
  c_opm  := pg_temp.fm_claims(opm_u,  pg_temp.fm_session(opm_u));
  c_csr  := pg_temp.fm_claims(csr_u,  pg_temp.fm_session(csr_u));
  c_none := pg_temp.fm_claims(nobody, pg_temp.fm_session(nobody));

  -- ── 1. one issue_report() only — the 5-argument version is gone, so a call without a format is not ambiguous ──
  if to_regprocedure('public.issue_report(text,date,date,int,text)') is not null then
    raise exception 'FORMAT FAIL: the old 5-argument issue_report() still exists';
  end if;
  if to_regprocedure('public.issue_report(text,date,date,int,text,text)') is null then
    raise exception 'FORMAT FAIL: the new issue_report() is missing';
  end if;
  if has_function_privilege('anon', 'public.issue_report(text,date,date,int,text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.issue_report(text,date,date,int,text,text)', 'EXECUTE') then
    raise exception 'FORMAT FAIL: wrong execute privileges on issue_report()';
  end if;
  n := n + 1;

  -- ── 2. the table: format is required, defaults to pdf, and only pdf / excel are allowed ──
  if (select is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = 'issued_reports' and column_name = 'report_format') <> 'NO' then
    raise exception 'FORMAT FAIL: report_format may be empty';
  end if;
  insert into public.issued_reports (id, report_type, generated_by_name) values ('RPT-FORMATTEST-DEFAULT', 'weekly', 'x');
  if (select report_format from public.issued_reports where id = 'RPT-FORMATTEST-DEFAULT') is distinct from 'pdf' then
    raise exception 'FORMAT FAIL: a row written without a format is not "pdf"';
  end if;
  ok := false; begin insert into public.issued_reports (id, report_type, generated_by_name, report_format)
    values ('RPT-FORMATTEST-BAD', 'weekly', 'x', 'word'); exception when check_violation then ok := true; end;
  if not ok then raise exception 'FORMAT FAIL: an unknown format was stored'; end if;
  n := n + 1;

  -- ── 3. issuing: no format = pdf (what printing and older screens send); excel when asked; both roles may ──
  perform set_config('request.jwt.claims', c_csr, true);
  set local role authenticated;
  -- exactly how the printing code calls it: five named arguments, no format
  r_old := public.issue_report(p_report_type => 'weekly', p_period_start => null, p_period_end => null, p_row_count => 3, p_row_digest => 'abc');
  r_pdf := public.issue_report('monthly', null, null, 5, 'def', 'pdf');
  reset role;
  perform set_config('request.jwt.claims', c_opm, true);
  set local role authenticated;
  r_xls := public.issue_report('delay', null, null, 7, 'ghi', 'excel');
  reset role;
  if (select report_format from public.issued_reports where id = r_old ->> 'id') is distinct from 'pdf'
     or (select report_format from public.issued_reports where id = r_pdf ->> 'id') is distinct from 'pdf' then
    raise exception 'FORMAT FAIL: a printed report was not recorded as pdf';
  end if;
  if (select report_format from public.issued_reports where id = r_xls ->> 'id') is distinct from 'excel' then
    raise exception 'FORMAT FAIL: an Excel report was not recorded as excel';
  end if;
  if (r_xls ->> 'id') !~ '^RPT-[0-9A-F]{12}$' or r_xls -> 'generatedAt' is null then
    raise exception 'FORMAT FAIL: the response shape changed (%)', r_xls;
  end if;
  if (select generated_by_name from public.issued_reports where id = r_xls ->> 'id') is distinct from 'Format Test OPM' then
    raise exception 'FORMAT FAIL: the generator name is no longer stamped by the server';
  end if;
  n := n + 1;

  -- ── 4. validation: the format is checked, and the older rules still hold ──
  perform set_config('request.jwt.claims', c_csr, true);
  set local role authenticated;
  err := null; begin perform public.issue_report('weekly', null, null, 1, null, 'xlsx'); exception when others then err := sqlerrm; end;
  if err is distinct from 'invalid_format' then raise exception 'FORMAT FAIL: format "xlsx" gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.issue_report('weekly', null, null, 1, null, ''); exception when others then err := sqlerrm; end;
  if err is distinct from 'invalid_format' then raise exception 'FORMAT FAIL: an empty format gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.issue_report('weekly', null, null, 1, null, null); exception when others then err := sqlerrm; end;
  if err is distinct from 'invalid_format' then raise exception 'FORMAT FAIL: a null format gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.issue_report('yearly', null, null, 1, null, 'pdf'); exception when others then err := sqlerrm; end;
  if err is distinct from 'invalid_report_type' then raise exception 'FORMAT FAIL: a bad report type gave %', coalesce(err, 'success'); end if;
  err := null; begin perform public.issue_report('weekly', null, null, -1, null, 'excel'); exception when others then err := sqlerrm; end;
  if err is distinct from 'invalid_row_count' then raise exception 'FORMAT FAIL: a negative row count gave %', coalesce(err, 'success'); end if;
  reset role;
  perform set_config('request.jwt.claims', c_none, true);
  set local role authenticated;
  err := null; begin perform public.issue_report('weekly', null, null, 1, null, 'excel'); exception when others then err := sqlerrm; end;
  if err is distinct from 'not_authorized' then raise exception 'FORMAT FAIL: a non-staff user could issue a report (%)', coalesce(err, 'success'); end if;
  reset role;
  select count(*) into cnt from public.issued_reports where generated_by_name in ('Format Test OPM', 'Format Test CSR');
  if cnt <> 3 then raise exception 'FORMAT FAIL: refused requests still wrote a row (% rows)', cnt; end if;
  n := n + 1;

  -- ── 5. the history list returns each report's format, newest first, and nothing else changed ──
  perform set_config('request.jwt.claims', c_csr, true);
  set local role authenticated;
  page := public.list_issued_reports_page(100, 0);
  reset role;
  one := (select e from jsonb_array_elements(page -> 'reports') e where e ->> 'id' = r_xls ->> 'id');
  if one is null or one ->> 'format' is distinct from 'excel' then raise exception 'FORMAT FAIL: the list does not show the Excel report as excel (%)', one; end if;
  one := (select e from jsonb_array_elements(page -> 'reports') e where e ->> 'id' = r_old ->> 'id');
  if one is null or one ->> 'format' is distinct from 'pdf' then raise exception 'FORMAT FAIL: the list does not show a printed report as pdf (%)', one; end if;
  if (select count(*) from jsonb_array_elements(page -> 'reports') e where e ->> 'format' is null) <> 0 then
    raise exception 'FORMAT FAIL: a listed report has no format';
  end if;
  if (page ->> 'total')::int <> (select count(*) from public.issued_reports) then
    raise exception 'FORMAT FAIL: the list total no longer matches the table';
  end if;
  if not (one ?& array['id', 'reportType', 'generatedByName', 'generatedAt', 'periodStart', 'periodEnd', 'rowCount']) then
    raise exception 'FORMAT FAIL: a field the history screen already relies on went missing (%)', one;
  end if;
  n := n + 1;

  raise exception 'FORMAT TESTS PASSED (% checks) — rolled back on purpose', n;
end
$test$;

rollback;
