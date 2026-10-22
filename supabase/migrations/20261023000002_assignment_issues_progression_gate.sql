-- ════════════════════════════════════════════════════════════════════════════
-- REQ-008 phase 3 of 4 — progression gate: block driver advancement while an
-- open blocking issue exists.
--
-- Manual SQL Editor application only. Shared/production project.
--
-- Adds one small helper, matching the exact style of is_staff()/can_write()/
-- driver_owns_assignment() (sql, stable, security definer, search_path ''):
--   has_open_blocking_issue(assignment_id) -> true iff assignment_issues has
--   a row for it with status='open' and is_blocking — i.e. the same condition
--   the phase-1 partial unique index already enforces "at most one of" per
--   assignment, so this is just reading that same invariant back.
--
-- Wired into the two existing gates from 20261021000002_driver_workflow_gates.sql
-- (re-declared here via CREATE OR REPLACE, same functions, same bodies except
-- the lines marked "added"):
--
--   * advance_driver_stage(): every transition in this RPC represents forward
--     progress (arrive_pickup, start_loading, finish_loading, depart,
--     arrive_destination, start_unloading, finish_unloading), so the check is
--     unconditional, right after the existing "not_active" check, before any
--     transition-specific logic. Applies to both driver- and staff-initiated
--     calls (this RPC is callable by can_write() staff too) — the rule is
--     about the physical state of the delivery, not who is operating it.
--
--   * guard_assignment_update(): this trigger already returns immediately for
--     can_write() staff (staff can freely edit assignment rows directly — a
--     pre-existing, deliberate exemption this migration does not touch), so
--     by the time the new check runs, the update is known to be driver-
--     initiated. Only the two *forward* transitions a driver can make via a
--     direct task_status update are affected (Picked Up -> In Transit,
--     In Transit -> Delivered); the existing Failed / Issue transition is a
--     stop, not an advance, and stays ungated — a driver can still report
--     through the legacy path even while a new-table issue is open (expected
--     and harmless during this transitional period; phase 4 retires the old
--     path). Raises a distinct 'open_blocking_issue' error rather than
--     folding into the existing generic 'invalid_status_transition', so the
--     cause is unambiguous to whoever reads the error.
--
-- Nothing else in either function changes. Existing rows/assignments are
-- unaffected unless they currently have an open blocking issue (the only
-- such row right now is the phase-2 test issue on ASN54196, already resolved
-- by that verification, so this changes zero live behavior as of application
-- time).
-- ════════════════════════════════════════════════════════════════════════════
begin;

create function public.has_open_blocking_issue(p_assignment_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.assignment_issues
    where assignment_id = p_assignment_id and status = 'open' and is_blocking
  );
$$;

create or replace function public.advance_driver_stage(p_assignment_id text, p_transition text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  a public.assignments%rowtype;
begin
  if not (public.can_write() or public.driver_owns_assignment(p_assignment_id)) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into a from public.assignments where id = p_assignment_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if a.state <> 'active' then raise exception 'not_active' using errcode = '42501'; end if;

  -- added: no stage may advance while an open blocking issue exists
  if public.has_open_blocking_issue(p_assignment_id) then
    raise exception 'open_blocking_issue' using errcode = '42501';
  end if;

  -- scoped to this transaction only; cleared automatically when the call ends
  perform set_config('app.bypass_driver_guard', 'on', true);

  if p_transition = 'arrive_pickup' then
    if a.task_status <> 'Assigned' or a.operational_stage is not null then
      raise exception 'wrong_stage' using errcode = '22023';
    end if;
    update public.assignments set operational_stage = 'pickup_arrived', pickup_arrived_at = now()
      where id = p_assignment_id;

  elsif p_transition = 'start_loading' then
    if a.operational_stage <> 'pickup_arrived' then raise exception 'wrong_stage' using errcode = '22023'; end if;
    if not exists (select 1 from public.status_photos where assignment_id = p_assignment_id and status = 'pickup_front') then
      raise exception 'missing_required_photo: pickup_front' using errcode = '22023';
    end if;
    if not exists (select 1 from public.status_photos where assignment_id = p_assignment_id and status = 'pickup_left') then
      raise exception 'missing_required_photo: pickup_left' using errcode = '22023';
    end if;
    if not exists (select 1 from public.status_photos where assignment_id = p_assignment_id and status = 'pickup_right') then
      raise exception 'missing_required_photo: pickup_right' using errcode = '22023';
    end if;
    if not exists (select 1 from public.status_photos where assignment_id = p_assignment_id and status = 'pickup_rear') then
      raise exception 'missing_required_photo: pickup_rear' using errcode = '22023';
    end if;
    if not exists (select 1 from public.status_photos where assignment_id = p_assignment_id and status = 'loading_before') then
      raise exception 'missing_required_photo: loading_before' using errcode = '22023';
    end if;
    update public.assignments set operational_stage = 'loading', loading_started_at = now()
      where id = p_assignment_id;

  elsif p_transition = 'finish_loading' then
    if a.operational_stage <> 'loading' then raise exception 'wrong_stage' using errcode = '22023'; end if;
    if not exists (select 1 from public.status_photos where assignment_id = p_assignment_id and status = 'loading_after') then
      raise exception 'missing_required_photo: loading_after' using errcode = '22023';
    end if;
    update public.assignments set operational_stage = 'loaded', loading_completed_at = now()
      where id = p_assignment_id;

  elsif p_transition = 'depart' then
    if a.operational_stage <> 'loaded' then raise exception 'wrong_stage' using errcode = '22023'; end if;
    if not exists (select 1 from public.status_photos where assignment_id = p_assignment_id and status = 'pretrip_front') then
      raise exception 'missing_required_photo: pretrip_front' using errcode = '22023';
    end if;
    if not exists (select 1 from public.status_photos where assignment_id = p_assignment_id and status = 'pretrip_left') then
      raise exception 'missing_required_photo: pretrip_left' using errcode = '22023';
    end if;
    if not exists (select 1 from public.status_photos where assignment_id = p_assignment_id and status = 'pretrip_right') then
      raise exception 'missing_required_photo: pretrip_right' using errcode = '22023';
    end if;
    if not exists (select 1 from public.status_photos where assignment_id = p_assignment_id and status = 'pretrip_rear') then
      raise exception 'missing_required_photo: pretrip_rear' using errcode = '22023';
    end if;
    update public.assignments
      set operational_stage = null, departed_at = now(), task_status = 'Picked Up'
      where id = p_assignment_id;

  elsif p_transition = 'arrive_destination' then
    if a.task_status <> 'In Transit' or a.operational_stage is not null then
      raise exception 'wrong_stage' using errcode = '22023';
    end if;
    update public.assignments set operational_stage = 'destination_arrived', destination_arrived_at = now()
      where id = p_assignment_id;

  elsif p_transition = 'start_unloading' then
    if a.operational_stage <> 'destination_arrived' then raise exception 'wrong_stage' using errcode = '22023'; end if;
    if not exists (select 1 from public.status_photos where assignment_id = p_assignment_id and status = 'unloading_before') then
      raise exception 'missing_required_photo: unloading_before' using errcode = '22023';
    end if;
    update public.assignments set operational_stage = 'unloading', unloading_started_at = now()
      where id = p_assignment_id;

  elsif p_transition = 'finish_unloading' then
    if a.operational_stage <> 'unloading' then raise exception 'wrong_stage' using errcode = '22023'; end if;
    if not exists (select 1 from public.status_photos where assignment_id = p_assignment_id and status = 'unloading_after') then
      raise exception 'missing_required_photo: unloading_after' using errcode = '22023';
    end if;
    update public.assignments set operational_stage = 'unloaded', unloading_completed_at = now()
      where id = p_assignment_id;

  else
    raise exception 'unknown_transition: %', p_transition using errcode = '22023';
  end if;
end $$;

create or replace function public.guard_assignment_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.can_write() then return new; end if;
  if coalesce(current_setting('app.bypass_driver_guard', true), '') = 'on' then return new; end if;
  if (to_jsonb(new) - array['task_status', 'issue_reason', 'driver_acknowledged_at', 'cancel_acknowledged_at'])
     is distinct from
     (to_jsonb(old) - array['task_status', 'issue_reason', 'driver_acknowledged_at', 'cancel_acknowledged_at']) then
    raise exception 'drivers may only update status, issue reason and acknowledgement' using errcode = '42501';
  end if;
  if new.task_status not in ('Assigned', 'Picked Up', 'In Transit', 'Delivered', 'Failed / Issue') then
    raise exception 'invalid status for a driver update' using errcode = '42501';
  end if;
  -- added: a forward status move is blocked while an open blocking issue exists;
  -- reporting Failed / Issue through the legacy path is unaffected
  if new.task_status is distinct from old.task_status
     and new.task_status in ('In Transit', 'Delivered')
     and public.has_open_blocking_issue(new.id) then
    raise exception 'open_blocking_issue' using errcode = '42501';
  end if;
  if new.task_status is distinct from old.task_status and not (
       (old.task_status = 'Picked Up'  and new.task_status = 'In Transit')
    or (old.task_status = 'In Transit' and new.task_status = 'Delivered' and old.operational_stage = 'unloaded')
    or (old.task_status in ('Assigned', 'Picked Up', 'In Transit') and new.task_status = 'Failed / Issue')
  ) then
    raise exception 'invalid_status_transition' using errcode = '42501';
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
commit;
