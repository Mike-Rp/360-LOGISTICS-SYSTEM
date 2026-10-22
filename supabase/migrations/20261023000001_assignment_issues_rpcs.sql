-- ════════════════════════════════════════════════════════════════════════════
-- REQ-008 phase 2 of 4 — report_assignment_issue() / resolve_assignment_issue().
--
-- Manual SQL Editor application only. Shared/production project.
--
-- Still inert in practice: the current driver app's "Report a problem" button
-- calls the OLD path (driverUpdate -> issue_reason + task_status='Failed /
-- Issue'), not this new RPC. Nothing calls report_assignment_issue() or
-- resolve_assignment_issue() until phase 4 switches the frontend over — same
-- "safe until wired" pattern as phase 1. Retiring the old path is explicitly
-- a phase 3/4 concern (coordinated client rollout), not done here.
--
-- Issue-type -> blocking mapping matches src/app/lib/issueWorkflow.ts's
-- BLOCKING_ISSUE_REASONS exactly, including the literal 'Other...' (with the
-- ellipsis) the frontend actually sends. This is the "one versioned,
-- server-owned mapping" the requirement doc asked for — currently all 7
-- types are blocking, matching what the existing UI already assumes. Review
-- with operations before treating this as final; it's isolated to one CASE
-- list, easy to revise later without touching anything else.
--
-- report_assignment_issue: the reporting Driver only, for their own active
-- assignment. Does NOT set task_status='Failed / Issue' — that's the old
-- path's behavior; this one only records the issue. The progression gate
-- that actually stops a driver from advancing while an issue is open is
-- phase 3, not this.
--
-- resolve_assignment_issue: CSR/admin only (can_write()) — OPM stays
-- view-only in shipment screens, consistent with REQ-004. Leaves
-- task_status/operational_stage untouched.
-- ════════════════════════════════════════════════════════════════════════════
begin;

alter table public.activity_log add column if not exists issue_id bigint;

create function public.report_assignment_issue(
  p_assignment_id text, p_issue_type text, p_reason text, p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a             public.assignments%rowtype;
  v_is_blocking boolean;
  v_reason      text := btrim(coalesce(p_reason, ''));
  v_issue_id    bigint;
  v_existing    public.assignment_issues%rowtype;
begin
  if not public.driver_owns_assignment(p_assignment_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- Idempotent replay: a request already produced a row under this key — return
  -- that same row rather than erroring or creating a duplicate.
  if p_idempotency_key is not null then
    select * into v_existing from public.assignment_issues where idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object(
        'id', v_existing.id, 'assignmentId', v_existing.assignment_id, 'issueType', v_existing.issue_type,
        'reason', v_existing.reason, 'isBlocking', v_existing.is_blocking, 'status', v_existing.status,
        'reportedAt', v_existing.reported_at
      );
    end if;
  end if;

  v_is_blocking := p_issue_type in (
    'Cargo damaged in transit', 'Wrong delivery address', 'Customer refused delivery',
    'Vehicle breakdown', 'Cargo lost or missing', 'Accident / road incident', 'Other...'
  );
  if v_is_blocking is null or not v_is_blocking then
    raise exception 'invalid_issue_type' using errcode = '22023';
  end if;
  if v_reason = '' then raise exception 'missing_reason' using errcode = '22023'; end if;
  if char_length(v_reason) > 500 then raise exception 'reason_too_long' using errcode = '22023'; end if;

  select * into a from public.assignments where id = p_assignment_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if a.state <> 'active' then raise exception 'not_active' using errcode = '42501'; end if;
  if a.driver_id is null or a.driver_id <> public.my_driver_id() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  begin
    insert into public.assignment_issues
      (assignment_id, issue_type, reason, is_blocking, reported_by_driver_id, reported_by_name,
       task_status_at_report, operational_stage_at_report, idempotency_key)
    values
      (p_assignment_id, p_issue_type, v_reason, v_is_blocking, a.driver_id, a.driver_name,
       a.task_status, a.operational_stage, p_idempotency_key)
    returning id into v_issue_id;
  exception when unique_violation then
    raise exception 'issue_already_open' using errcode = '23505';
  end;

  insert into public.activity_log (id, type, driver_name, truck_plate, assignment_id, reason, issue_id)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'issue_reported', a.driver_name, a.truck_plate, p_assignment_id, v_reason, v_issue_id);

  -- Same staff notification type/shape the old driverUpdate() path already used.
  insert into public.notifications
    (id, type, message, assignment_id, driver_name, truck_plate, reason, read, time_label, navigate_to)
  values
    ('notif-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
     'issue_report', '[' || a.truck_plate || '] Issue: ' || v_reason, p_assignment_id,
     a.driver_name, a.truck_plate, v_reason, false,
     to_char(now() at time zone 'Asia/Manila', 'Mon FMDD, HH12:MI AM'), 'Monitor');

  return jsonb_build_object(
    'id', v_issue_id, 'assignmentId', p_assignment_id, 'issueType', p_issue_type,
    'reason', v_reason, 'isBlocking', v_is_blocking, 'status', 'open', 'reportedAt', now()
  );
end $$;

create function public.resolve_assignment_issue(p_issue_id bigint, p_resolution_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  iss             public.assignment_issues%rowtype;
  a               public.assignments%rowtype;
  v_resolver_name text;
  v_note          text := nullif(btrim(coalesce(p_resolution_note, '')), '');
begin
  if not public.can_write() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'note_too_long' using errcode = '22023';
  end if;

  -- Lock assignment then issue, same order report_assignment_issue locks the
  -- assignment in, so the two can never deadlock against each other.
  select * into iss from public.assignment_issues where id = p_issue_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;

  select * into a from public.assignments where id = iss.assignment_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if a.state <> 'active' then raise exception 'assignment_not_active' using errcode = '42501'; end if;
  if iss.status <> 'open' then raise exception 'already_resolved' using errcode = '42501'; end if;

  select name into v_resolver_name from public.profiles where id = auth.uid();

  update public.assignment_issues
    set status = 'resolved', resolved_at = now(), resolved_by_user_id = auth.uid(),
        resolved_by_name = v_resolver_name, resolution_note = v_note, updated_at = now()
    where id = p_issue_id;

  insert into public.activity_log (id, type, driver_name, truck_plate, assignment_id, reason, issue_id)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'issue_resolved', a.driver_name, a.truck_plate, iss.assignment_id, v_note, p_issue_id);

  return jsonb_build_object(
    'id', iss.id, 'assignmentId', iss.assignment_id, 'status', 'resolved',
    'resolvedAt', now(), 'resolvedBy', v_resolver_name, 'resolutionNote', v_note
  );
end $$;

revoke all on function public.report_assignment_issue(text, text, text, text) from public, anon, authenticated;
revoke all on function public.resolve_assignment_issue(bigint, text) from public, anon, authenticated;
grant execute on function public.report_assignment_issue(text, text, text, text) to authenticated;
grant execute on function public.resolve_assignment_issue(bigint, text) to authenticated;

commit;
