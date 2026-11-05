-- ════════════════════════════════════════════════════════════════════════════
-- Active OPM accounts may issue reports (Print / PDF).
--
-- Manual SQL Editor application only. Shared/production project.
--
-- Policy change (explicitly approved): 20261023000008 limited issue_report() to
-- can_write() (admin / CSR) and kept OPM view-only. OPM can open every Reports
-- preview, but Print / PDF calls issue_report() first and was refused with
-- 'not_authorized'. Now an active OPM may issue reports too.
--
-- The ONLY change: the authorization check
--     before:  if not public.can_write() then …
--     after:   if not (public.can_write() or public.is_opm()) then …
-- Everything else is identical to 20261023000008: signature, validation, random
-- RPT-… id, server-stamped generated_at / generated_by_name (read from the
-- caller's own profile, never from the browser), response shape, grants.
--
-- Deliberately NOT changed: can_write() itself (so OPM still cannot dispatch,
-- edit, cancel or complete deliveries), verify_report(), list_issued_reports(),
-- list_issued_reports_page(), issued_reports RLS / grants, report contents.
-- is_opm() = current session AND an ACTIVE profile with role 'opm'; removed
-- (archived) accounts, drivers, replaced sessions and anonymous callers are
-- still refused.
--
-- Safety checks first: if the live issue_report() is not the version this file
-- was written against (or it was already changed), the migration stops and
-- changes nothing.
-- ════════════════════════════════════════════════════════════════════════════
begin;

do $$
begin
  if to_regprocedure('public.is_opm()') is null or to_regprocedure('public.can_write()') is null then
    raise exception 'OPM reports migration: is_opm() / can_write() not found';
  end if;
  if not exists (select 1 from pg_proc
                  where oid = 'public.issue_report(text,date,date,int,text)'::regprocedure
                    and prosrc like '%public.can_write()%' and prosrc like '%gen_random_bytes%'
                    and prosrc like '%invalid_report_type%') then
    raise exception 'OPM reports migration: live issue_report() is not the expected version — stop and compare it with 20261023000008';
  end if;
  if exists (select 1 from pg_proc
              where oid = 'public.issue_report(text,date,date,int,text)'::regprocedure and prosrc like '%is_opm()%') then
    raise exception 'OPM reports migration: issue_report() already allows OPM';
  end if;
end $$;

create or replace function public.issue_report(
  p_report_type text, p_period_start date, p_period_end date, p_row_count int, p_row_digest text default null
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

  select name into v_name from public.profiles where id = auth.uid();

  for i in 1..50 loop
    v_id := 'RPT-' || upper(encode(extensions.gen_random_bytes(6), 'hex'));
    exit when not exists (select 1 from public.issued_reports where id = v_id);
    v_id := null;
  end loop;
  if v_id is null then raise exception 'no_free_id' using errcode = '55000'; end if;

  insert into public.issued_reports
    (id, report_type, generated_by_user_id, generated_by_name, report_period_start, report_period_end, row_count, row_digest)
  values
    (v_id, p_report_type, auth.uid(), coalesce(v_name, 'Unknown'), p_period_start, p_period_end, p_row_count, p_row_digest);

  return jsonb_build_object('id', v_id, 'generatedAt', now());
end $$;

-- same grants as before (create or replace keeps them; restated so the file is self-contained)
revoke all on function public.issue_report(text, date, date, int, text) from public, anon, authenticated;
grant execute on function public.issue_report(text, date, date, int, text) to authenticated;

notify pgrst, 'reload schema';
commit;
