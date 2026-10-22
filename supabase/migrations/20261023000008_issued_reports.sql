-- ════════════════════════════════════════════════════════════════════════════
-- REQ-007 — persistent, publicly-verifiable Report IDs.
--
-- Manual SQL Editor application only. Shared/production project.
--
-- Design decisions (per explicit approval — see BACKEND_DATABASE_REQUIREMENTS.md):
--   * Weekly period = the ISO calendar week (Mon-Sun) containing the moment
--     of generation — Reports.tsx's Weekly report currently has NO date
--     filter at all, so this is the first time one exists.
--   * Verification is metadata-only: type, period, generator, generated-at,
--     row count. Never raw delivery data. issued_reports rows are immutable
--     once written, so the verification page always reflects exactly what
--     was true at generation time, regardless of later edits to the
--     underlying assignments — no live re-query, no recomputation.
--   * row_digest is a frozen forensic artifact (hash of the included
--     assignment IDs, computed client-side from the exact rows the PDF
--     rendered) for possible future/manual auditing — it is not compared
--     live against anything; this migration does not duplicate Reports.tsx's
--     row-selection logic in SQL.
--   * All 4 of Reports.tsx's report types (weekly, monthly, delay,
--     utilization) share this one mechanism for consistency — the doc entry
--     named only weekly/monthly, but restricting this to 2 of the 4 types
--     the same screen already generates would be visibly inconsistent to an
--     admin printing a Delay or Utilization report. period_start/end are
--     nullable since delay/utilization reports ("On demand"/"Historical")
--     have no natural period boundary.
--   * Report IDs are random (RPT-xxxxxxxxxxxx, 48 bits), never sequential —
--     this is a PUBLIC lookup key (the QR code), so a guessable/enumerable
--     ID would let anyone walk through every issued report.
--
-- issue_report(): admin/CSR only (can_write()) — matches who may dispatch/
-- edit/cancel elsewhere; OPM stays view-only (REQ-004).
-- verify_report(): public — granted to anon, no session required, since the
-- QR code is meant to be scanned by anyone holding the printed report.
-- Returns only the safe fields; the table itself has no SELECT grant at all,
-- so nothing is reachable except through this one function.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create table public.issued_reports (
  id                    text primary key,
  report_type           text not null check (report_type in ('weekly', 'monthly', 'delay', 'utilization')),
  generated_by_user_id  uuid references public.profiles(id) on delete set null,
  generated_by_name     text not null,
  generated_at          timestamptz not null default now(),
  report_period_start   date,
  report_period_end     date,
  row_count             integer not null default 0,
  row_digest            text,
  created_at            timestamptz not null default now()
);
create index issued_reports_generated_at_idx on public.issued_reports (generated_at desc);

alter table public.issued_reports enable row level security;
-- No SELECT policy for anyone — every read goes through verify_report(),
-- same "RPC only" convention as every other guarded table in this schema.
revoke all on public.issued_reports from anon, authenticated;

create function public.issue_report(
  p_report_type text, p_period_start date, p_period_end date, p_row_count int, p_row_digest text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id   text;
  v_name text;
begin
  if not public.can_write() then raise exception 'not_authorized' using errcode = '42501'; end if;
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

create function public.verify_report(p_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', id, 'reportType', report_type, 'generatedByName', generated_by_name,
    'generatedAt', generated_at, 'periodStart', report_period_start, 'periodEnd', report_period_end,
    'rowCount', row_count
  )
  from public.issued_reports where id = p_id;
$$;

revoke all on function public.issue_report(text, date, date, int, text) from public, anon, authenticated;
grant execute on function public.issue_report(text, date, date, int, text) to authenticated;

revoke all on function public.verify_report(text) from public, authenticated;
grant execute on function public.verify_report(text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
