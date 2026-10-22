-- ════════════════════════════════════════════════════════════════════════════
-- REQ-007 follow-up — staff-facing "Recent Reports" listing.
--
-- Manual SQL Editor application only. Shared/production project.
--
-- Found on the live app: Reports.tsx already had a "Recent Reports" table
-- with a placeholder reading "Report history is unavailable. This system
-- downloads reports without saving a generated-report record." — the same
-- "frontend built ahead of backend" pattern seen elsewhere this session. Now
-- that issue_report() actually saves a record, this is a real gap.
--
-- Distinct from verify_report(): that one is public (anon), takes a single
-- ID, and returns only the fields safe for an outside viewer. This one is
-- staff-only (is_staff() — read access, not can_write(), consistent with
-- OPM being able to view but not generate reports per REQ-004) and returns
-- recent rows for the admin's own history view.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create function public.list_issued_reports(p_limit int default 20) returns setof public.issued_reports
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'not_authorized' using errcode = '42501'; end if;
  return query
    select * from public.issued_reports
    order by generated_at desc
    limit least(greatest(coalesce(p_limit, 20), 1), 100);
end $$;

revoke all on function public.list_issued_reports(int) from public, anon, authenticated;
grant execute on function public.list_issued_reports(int) to authenticated;

notify pgrst, 'reload schema';
commit;
