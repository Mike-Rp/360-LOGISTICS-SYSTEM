-- ════════════════════════════════════════════════════════════════════════════
-- Recent Reports pagination — list_issued_reports_page(limit, offset).
--
-- Manual SQL Editor application only. Shared/production project.
-- ADDITIVE: one new function and one index. list_issued_reports(), issue_report()
-- and verify_report() are untouched, so the current Reports page keeps working
-- until the frontend switches over.
--
-- Why: list_issued_reports(limit) can return at most 100 rows, has no offset
-- and no total, so the Recent Reports table cannot show real page numbers or
-- reach report #101 and beyond.
--
-- list_issued_reports_page(p_limit int default 10, p_offset int default 0) → jsonb
--   {
--     "total":  <number of ALL issued reports>,
--     "limit":  <page size actually used, 1–100>,
--     "offset": <offset actually used, ≥ 0>,
--     "reports": [ { "id", "reportType", "generatedByName", "generatedAt",
--                    "periodStart", "periodEnd", "rowCount" }, … ]   -- newest first
--   }
--   * Order of the WHOLE history is generated_at DESC, id DESC, then the page is
--     cut from it — the id is the tie-breaker, so reports issued in the same
--     instant never swap places between pages.
--   * Field names match verify_report() and the frontend's IssuedReportSummary.
--     row_digest and generated_by_user_id are not returned (not needed to list).
--   * total and reports come from ONE statement, so they always agree even if a
--     report is issued while the page is being read.
--   * Empty history → total 0, reports []. Offset past the last page → the real
--     total with reports []. A null / too-small / too-large limit or a null /
--     negative offset is corrected (limit 1–100, offset ≥ 0), never an error.
--   * Staff only: is_staff() (read access, so OPM can view history too), the same
--     check as list_issued_reports(). anon and everyone else are refused. The
--     table itself still has no direct SELECT for anyone.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- the exact sort order used above, so a deep page does not need a full sort
create index if not exists issued_reports_generated_at_id_idx
  on public.issued_reports (generated_at desc, id desc);

create function public.list_issued_reports_page(p_limit int default 10, p_offset int default 0) returns jsonb
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
                 'periodEnd', r.report_period_end, 'rowCount', r.row_count)
               order by r.generated_at desc, r.id desc)
        from (select * from public.issued_reports
               order by generated_at desc, id desc
               limit v_limit offset v_offset) r
      ), '[]'::jsonb)
    )
  );
end $$;

revoke all on function public.list_issued_reports_page(int, int) from public, anon, authenticated;
grant execute on function public.list_issued_reports_page(int, int) to authenticated;

notify pgrst, 'reload schema';
commit;
