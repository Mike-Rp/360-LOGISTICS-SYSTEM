-- ════════════════════════════════════════════════════════════════════════════
-- Recent Reports: say whether a report was a printed PDF or an Excel export.
--
-- Manual SQL Editor application only. Shared/production project.
--
-- Excel exports are now recorded in issued_reports like printed reports (they get a
-- Report ID and appear in Recent Reports). This adds the one thing the history could
-- not show: HOW the report left the system.
--
--   • issued_reports.report_format — 'pdf' | 'excel', NOT NULL, default 'pdf'. Every row that
--     exists today was recorded by a print, so the default is also the correct backfill.
--   • issue_report() gains p_format (default 'pdf'). Everything else is identical to
--     20261105000002: staff authorization (can_write() or is_opm()), validation, random
--     RPT-… id, server-stamped generated_at / generated_by_name, response shape.
--     A caller that does not send p_format (the printing code, older screens) still works
--     and is recorded as 'pdf'.
--     The old 5-argument version is DROPPED: with both versions present, a call that omits
--     p_format would be ambiguous and PostgREST would refuse it.
--   • list_issued_reports_page() returns "format" for each report. Same signature and rules
--     as 20261105000001, so create or replace is enough.
--
-- Deliberately NOT changed: verify_report() (the public page), list_issued_reports()
-- (select * — picks up the new column by itself), issued_reports RLS / grants.
--
-- Safety checks first: if the live functions are not the versions this file was written
-- against, it stops and changes nothing.
-- ════════════════════════════════════════════════════════════════════════════
begin;

do $$
begin
  if not exists (select 1 from pg_proc
                  where oid = to_regprocedure('public.issue_report(text,date,date,int,text)')
                    and prosrc like '%is_opm()%' and prosrc like '%gen_random_bytes%' and prosrc like '%invalid_report_type%') then
    raise exception 'issued reports format: live issue_report() is not the expected (OPM-enabled) version — stop and compare it with 20261105000002';
  end if;
  if not exists (select 1 from pg_proc
                  where oid = to_regprocedure('public.list_issued_reports_page(int,int)')
                    and prosrc like '%generatedByName%' and prosrc like '%rowCount%') then
    raise exception 'issued reports format: live list_issued_reports_page() is not the expected version — stop and compare it with 20261105000001';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'issued_reports' and column_name = 'report_format') then
    raise exception 'issued reports format: issued_reports.report_format already exists';
  end if;
end $$;

alter table public.issued_reports
  add column report_format text not null default 'pdf' check (report_format in ('pdf', 'excel'));

drop function public.issue_report(text, date, date, int, text);

create function public.issue_report(
  p_report_type text, p_period_start date, p_period_end date, p_row_count int, p_row_digest text default null,
  p_format text default 'pdf'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id   text;
  v_name text;
begin
  if not (public.can_write() or public.is_opm()) then raise exception 'not_authorized' using errcode = '42501'; end if;
  if p_report_type not in ('weekly', 'monthly', 'delay', 'utilization') then
    raise exception 'invalid_report_type' using errcode = '22023';
  end if;
  if p_row_count < 0 then raise exception 'invalid_row_count' using errcode = '22023'; end if;
  if p_format is null or p_format not in ('pdf', 'excel') then raise exception 'invalid_format' using errcode = '22023'; end if;

  select name into v_name from public.profiles where id = auth.uid();

  for i in 1..50 loop
    v_id := 'RPT-' || upper(encode(extensions.gen_random_bytes(6), 'hex'));
    exit when not exists (select 1 from public.issued_reports where id = v_id);
    v_id := null;
  end loop;
  if v_id is null then raise exception 'no_free_id' using errcode = '55000'; end if;

  insert into public.issued_reports
    (id, report_type, generated_by_user_id, generated_by_name, report_period_start, report_period_end, row_count, row_digest, report_format)
  values
    (v_id, p_report_type, auth.uid(), coalesce(v_name, 'Unknown'), p_period_start, p_period_end, p_row_count, p_row_digest, p_format);

  return jsonb_build_object('id', v_id, 'generatedAt', now());
end $$;

revoke all on function public.issue_report(text, date, date, int, text, text) from public, anon, authenticated;
grant execute on function public.issue_report(text, date, date, int, text, text) to authenticated;

create or replace function public.list_issued_reports_page(p_limit int default 10, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit  int := least(greatest(coalesce(p_limit, 10), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.is_staff() then raise exception 'not_authorized' using errcode = '42501'; end if;
  return (
    select jsonb_build_object(
      'total',   (select count(*) from public.issued_reports),
      'limit',   v_limit,
      'offset',  v_offset,
      'reports', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', r.id, 'reportType', r.report_type, 'generatedByName', r.generated_by_name,
                 'generatedAt', r.generated_at, 'periodStart', r.report_period_start,
                 'periodEnd', r.report_period_end, 'rowCount', r.row_count, 'format', r.report_format)
               order by r.generated_at desc, r.id desc)
        from (select * from public.issued_reports
               order by generated_at desc, id desc
               limit v_limit offset v_offset) r
      ), '[]'::jsonb)
    )
  );
end $$;

notify pgrst, 'reload schema';
commit;
