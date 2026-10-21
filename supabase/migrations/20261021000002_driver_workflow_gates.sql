-- ════════════════════════════════════════════════════════════════════════════
-- REQ-002 follow-up — enforce every required driver photo and status step.
--
-- Manual SQL Editor application only. Shared/production project.
--
-- Found on the live database (2026-10-21):
--   1. advance_driver_stage() did not check three photos the app requires:
--        start_loading    → loading_before   (app: pickup step needs 4 truck + before-loading)
--        start_unloading  → unloading_before
--        finish_unloading → unloading_after
--   2. guard_assignment_update() let a driver set task_status to ANY allowed
--      value at ANY time — e.g. straight from Assigned to Delivered — skipping
--      every stage and photo with one direct table update.
--
-- Fix (design of REQ-002 kept: depart sets 'Picked Up' in the RPC; the app then
-- sets 'In Transit', and after unloading 'Delivered', with its own update):
--   * advance_driver_stage(): the three photo checks are added. Nothing else in
--     the function changes.
--   * guard_assignment_update(): a driver's own task_status change must be one of
--         Picked Up  → In Transit                     (after depart, or legacy pickup)
--         In Transit → Delivered   only when unloading is finished (stage 'unloaded')
--         Assigned / Picked Up / In Transit → Failed / Issue   (issue report)
--     anything else → 'invalid_status_transition'. Staff (can_write) and the
--     stage RPC (bypass flag) are unaffected, exactly as before.
--
-- Existing rows are not changed. Active assignments already past a step keep
-- their state; the new checks apply to their next step only.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. Stage RPC: unchanged except the three photo checks marked "added" ──
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
    -- added
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
    -- added
    if not exists (select 1 from public.status_photos where assignment_id = p_assignment_id and status = 'unloading_before') then
      raise exception 'missing_required_photo: unloading_before' using errcode = '22023';
    end if;
    update public.assignments set operational_stage = 'unloading', unloading_started_at = now()
      where id = p_assignment_id;

  elsif p_transition = 'finish_unloading' then
    if a.operational_stage <> 'unloading' then raise exception 'wrong_stage' using errcode = '22023'; end if;
    -- added
    if not exists (select 1 from public.status_photos where assignment_id = p_assignment_id and status = 'unloading_after') then
      raise exception 'missing_required_photo: unloading_after' using errcode = '22023';
    end if;
    update public.assignments set operational_stage = 'unloaded', unloading_completed_at = now()
      where id = p_assignment_id;

  else
    raise exception 'unknown_transition: %', p_transition using errcode = '22023';
  end if;
end $$;

-- ── 2. Table guard: unchanged except the driver status-transition rule (added) ──
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
  -- added: a driver's own status change must follow the workflow
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
