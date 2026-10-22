-- ════════════════════════════════════════════════════════════════════════════
-- Small cleanup items from the backend/database backlog.
--
-- Manual SQL Editor application only. Shared/production project.
--
-- 1. Drop csr_password_reset_approved() — obsolete, no remaining callers
--    anywhere (no RLS policy, function, test, or frontend RPC call references
--    it; confirmed by a repo-wide search before writing this).
-- 2. Correct a stale/misleading comment in advance_driver_stage(): the
--    app.bypass_driver_guard flag is set via set_config(..., true) with
--    is_local=true, which makes it last for the rest of the CURRENT
--    TRANSACTION, not just "until the call ends" as the comment previously
--    implied (those are the same thing for a single advance_driver_stage()
--    call today, but misleading if this function is ever called from inside
--    a larger transaction later). No behavior change — comment only, rest of
--    the function body is unchanged from 20261023000011_stage_remarks.sql.
-- ════════════════════════════════════════════════════════════════════════════
begin;

drop function if exists public.csr_password_reset_approved();

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

  -- corrected: this lasts for the rest of the current TRANSACTION (is_local=true
  -- in set_config), not just until this call returns
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
    update public.assignments
      set operational_stage = 'unloaded', unloading_completed_at = now(), unloading_remark = v_remark
      where id = p_assignment_id;

  else
    raise exception 'unknown_transition: %', p_transition using errcode = '22023';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
