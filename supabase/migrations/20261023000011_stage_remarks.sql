-- ════════════════════════════════════════════════════════════════════════════
-- Stage remarks — optional driver-entered notes at Loading/Unloading.
--
-- Manual SQL Editor application only. Shared/production project.
--
-- REQ-002's own design doc explicitly deferred this: "Add durable,
-- stage-specific Loading and Unloading driver remarks only after a storage
-- model and authorized read/write path are approved." Design now approved:
--   * Two nullable columns directly on assignments, not a separate table —
--     a remark happens at most once per stage per assignment, same reasoning
--     REQ-002 already used for its event timestamps ("each event happens at
--     most once... rather than a separate append-only event table").
--   * Capped at 300 chars, matching this schema's other free-text fields
--     (resolution_note, etc.).
--   * Set only as an optional extra argument to advance_driver_stage() on the
--     finish_loading/finish_unloading transitions — never required, never
--     blocks progression, same low-stakes status as the assignment's own
--     Remarks field.
--   * Write-once: set only by the driver during their own transition, not
--     editable afterward by anyone — same pattern as driver-authored issue
--     reports. Readable by staff and the owning driver via the existing
--     assignments SELECT policy; no new RLS policy needed, these are just two
--     more columns on an already-readable row.
--
-- p_remark is appended as a new parameter WITH a default, so this is the same
-- function (same OID, grants untouched) — every existing 2-argument call
-- still works unchanged.
--
-- Frontend wiring (an input for the driver to type a remark, wherever the
-- Loading/Unloading finish action lives) is a separate, later piece of work —
-- this migration only adds the storage and server-side acceptance path.
-- ════════════════════════════════════════════════════════════════════════════
begin;

alter table public.assignments
  add column if not exists loading_remark   text,
  add column if not exists unloading_remark text,
  add constraint assignments_loading_remark_length
    check (loading_remark is null or char_length(loading_remark) <= 300),
  add constraint assignments_unloading_remark_length
    check (unloading_remark is null or char_length(unloading_remark) <= 300);

create or replace function public.advance_driver_stage(p_assignment_id text, p_transition text, p_remark text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  a public.assignments%rowtype;
  v_remark text := nullif(btrim(coalesce(p_remark, '')), '');
begin
  if not (public.can_write() or public.driver_owns_assignment(p_assignment_id)) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into a from public.assignments where id = p_assignment_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if a.state <> 'active' then raise exception 'not_active' using errcode = '42501'; end if;

  if public.has_open_blocking_issue(p_assignment_id) then
    raise exception 'open_blocking_issue' using errcode = '42501';
  end if;

  if v_remark is not null and char_length(v_remark) > 300 then
    raise exception 'remark_too_long' using errcode = '22023';
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
    -- added: optional driver remark, write-once
    update public.assignments
      set operational_stage = 'loaded', loading_completed_at = now(), loading_remark = v_remark
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
    -- added: optional driver remark, write-once
    update public.assignments
      set operational_stage = 'unloaded', unloading_completed_at = now(), unloading_remark = v_remark
      where id = p_assignment_id;

  else
    raise exception 'unknown_transition: %', p_transition using errcode = '22023';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
