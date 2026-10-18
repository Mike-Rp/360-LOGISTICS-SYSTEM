-- ════════════════════════════════════════════════════════════════════════════
-- REQ-002 — Driver pickup/loading/arrival/unloading workflow — TRANSITIONS
--
-- Builds on 20261018000000_driver_workflow_stages.sql (the columns this reads
-- and writes). This adds the one function that actually moves a delivery
-- through the 7 new sub-stages, replacing what would otherwise be several
-- separate, unprotected client writes racing each other.
--
-- advance_driver_stage(assignment_id, transition) — callable by the owning
-- driver or admin/csr, SECURITY DEFINER, one call per transition:
--   - locks the assignment row, checks the CURRENT stage matches what this
--     transition expects. A mismatch raises 'wrong_stage' rather than
--     silently doing nothing — the future driver UI should treat that error
--     on a retry as "already there", not as a failure, since network retries
--     must be safe.
--   - for start_loading / finish_loading / depart, also requires the matching
--     status_photos rows already exist (uploaded + inserted by the client
--     BEFORE calling this, same order driverUpdate() already uses in db.ts:
--     "photos first, so the status change never points at a photo that failed
--     to save"). Missing a required photo raises 'missing_required_photo: <key>'.
--   - stamps exactly one new timestamptz column with the SERVER's own now()
--     per transition, and for 'depart' only, also flips task_status to
--     'Picked Up' in the same statement — the driver's next visible action
--     stays the existing, unchanged In Transit button.
--
-- Deliberately NOT covered by this function: the existing 'In Transit' and
-- 'Delivered' taps stay exactly as they are today (old single-photo path via
-- driverUpdate() / guard_assignment_update()). In particular, nothing yet
-- stops a driver from tapping Delivered without ever reaching 'unloaded' —
-- adding that gate to guard_assignment_update() now would break Delivered for
-- every assignment immediately, since no client code writes operational_stage
-- until the driver UI for this ships. That gate is a deliberate follow-up
-- migration once the UI is live for everyone, same reasoning as the
-- destination_area part1/part2 split. No admin override/force-reset in this
-- pass either (explicitly deferred).
--
-- Why guard_assignment_update() needs a small change: it currently rejects
-- any driver-originated write to assignments outside task_status /
-- issue_reason / driver_acknowledged_at — including writes made from inside a
-- SECURITY DEFINER function, because the trigger reads the real caller's
-- identity (auth.uid()), not the function owner's. advance_driver_stage sets
-- a transaction-local flag right before its own already-validated UPDATE, and
-- the trigger only relaxes its check while that flag is set. A direct client
-- `.update()` call never sets this flag, so it still cannot touch these
-- columns — only this function's validated path can.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.guard_assignment_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.can_write() then
    return new;
  end if;
  if coalesce(current_setting('app.bypass_driver_guard', true), '') = 'on' then
    return new;
  end if;
  if (to_jsonb(new) - array['task_status', 'issue_reason', 'driver_acknowledged_at'])
     is distinct from
     (to_jsonb(old) - array['task_status', 'issue_reason', 'driver_acknowledged_at']) then
    raise exception 'drivers may only update status, issue reason and acknowledgement' using errcode = '42501';
  end if;
  if new.task_status not in ('Assigned', 'Picked Up', 'In Transit', 'Delivered', 'Failed / Issue') then
    raise exception 'invalid status for a driver update' using errcode = '42501';
  end if;
  return new;
end $$;

create function public.advance_driver_stage(p_assignment_id text, p_transition text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.assignments%rowtype;
begin
  if not (public.can_write() or public.driver_owns_assignment(p_assignment_id)) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into a from public.assignments where id = p_assignment_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if a.state <> 'active' then raise exception 'not_active' using errcode = '42501'; end if;

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
    update public.assignments set operational_stage = 'unloading', unloading_started_at = now()
      where id = p_assignment_id;

  elsif p_transition = 'finish_unloading' then
    if a.operational_stage <> 'unloading' then raise exception 'wrong_stage' using errcode = '22023'; end if;
    update public.assignments set operational_stage = 'unloaded', unloading_completed_at = now()
      where id = p_assignment_id;

  else
    raise exception 'unknown_transition: %', p_transition using errcode = '22023';
  end if;
end $$;

revoke all on function public.advance_driver_stage(text, text) from public, anon, authenticated;
grant execute on function public.advance_driver_stage(text, text) to authenticated;

commit;
