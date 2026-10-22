-- ════════════════════════════════════════════════════════════════════════════
-- REQ-011 hardening — block direct assignment creation and direct completion,
-- outside dispatch_assignment() / complete_assignment().
--
-- Manual SQL Editor application only. Shared/production project.
--
-- Found on the live database: `assignments_insert` and `assignments_update`
-- RLS policies grant any can_write() staff member raw INSERT/UPDATE on
-- `assignments`. Cancellation is already closed (guard_assignment_cancel()
-- requires app.verified_cancellation_id, set only inside cancel_assignment()),
-- but nothing stops a direct INSERT (skipping driver/truck availability
-- checks, the 6 document slots, and the task_assigned log row) or a direct
-- `UPDATE ... SET state = 'completed'` (skipping the documents-approved
-- check, driver/truck release, and the task_completed log row).
--
-- Fix, same transaction-local-flag technique as cancellation:
--   1. dispatch_assignment() now sets app.verified_dispatch_id = the new row's
--      id right before its own INSERT (cleared right after, same as the other
--      verified_*_id flags).
--   2. New BEFORE INSERT trigger guard_assignment_insert(): refuses any insert
--      whose id doesn't match that flag. Exempts auth.uid() is null (service-
--      role / unauthenticated contexts), same exemption every other guard on
--      this table already uses.
--   3. guard_assignment_cancel() (already fires on every assignments update,
--      not just cancellations — see its own REQ-013 comment) gets one more
--      check: a state -> 'completed' transition must carry
--      app.verified_completion_id, the flag complete_assignment() already
--      sets for the completed_at_utc guard below it. No new flag needed.
--
-- Nothing here changes complete_assignment()/dispatch_assignment()'s
-- observable behavior for a legitimate caller — only a direct table write
-- that bypasses them starts failing. Existing rows are unaffected.
--
-- Also fixes two existing test fixtures that insert directly into
-- `assignments` while impersonating a CSR (request.jwt.claims still set from
-- an earlier step) rather than with no session: req003_cancel_cutoff.test.sql
-- and req005_assignment_locations.test.sql now clear request.jwt.claims
-- around those raw inserts, matching the convention dispatch_complete.test.sql
-- already used. Run both after applying this, plus dispatch_complete.test.sql,
-- to confirm nothing regressed.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. dispatch_assignment(): flag the one legitimate insert ──
create or replace function public.dispatch_assignment(p_fields jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare
  allowed  text[] := array['driver_id', 'truck_id', 'destination', 'destination_area', 'company',
                           'pickup_location', 'delivery_location', 'pickup_time', 'picked_up_date',
                           'eta', 'delivery_date', 'remarks'];
  required text[] := array['driver_id', 'truck_id', 'destination', 'destination_area', 'company', 'pickup_location'];
  doc_types text[] := array['Proof of Delivery', 'Receiving Acknowledgement Report', 'Dispatch Slip',
                            'Sales Invoice', 'Bill of Lading', 'Waybill / Delivery Receipt'];
  k        text;
  d        public.drivers%rowtype;
  t        public.trucks%rowtype;
  v_id     text;
  v_label  text := to_char(now() at time zone 'Asia/Manila', 'Mon FMDD, HH12:MI AM');
  f        jsonb;
begin
  if not public.can_write() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'invalid_fields' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_fields) loop
    if not (k = any(allowed)) then raise exception 'field_not_allowed: %', k using errcode = '22023'; end if;
    if jsonb_typeof(p_fields -> k) <> 'string' then raise exception 'invalid_value: %', k using errcode = '22023'; end if;
  end loop;
  foreach k in array required loop
    if btrim(coalesce(p_fields ->> k, '')) = '' then raise exception 'required_field: %', k using errcode = '22023'; end if;
  end loop;
  if char_length(coalesce(p_fields ->> 'remarks', '')) > 150 then
    raise exception 'remarks_too_long' using errcode = '22023';
  end if;
  select jsonb_object_agg(key, btrim(value)) into f from jsonb_each_text(p_fields);

  select * into d from public.drivers where id = f ->> 'driver_id' for update;
  if not found then raise exception 'driver_not_found' using errcode = '22023'; end if;
  select * into t from public.trucks where id = f ->> 'truck_id' for update;
  if not found then raise exception 'truck_not_found' using errcode = '22023'; end if;
  if d.archived_at is not null then raise exception 'driver_archived' using errcode = '22023'; end if;
  if t.archived_at is not null then raise exception 'truck_archived' using errcode = '22023'; end if;
  if exists (select 1 from public.assignments x where x.state = 'active' and x.driver_id = d.id) then
    raise exception 'driver_busy' using errcode = '22023';
  end if;
  if t.status <> 'Available'
     or exists (select 1 from public.assignments x where x.state = 'active' and x.truck_id = t.id) then
    raise exception 'truck_unavailable' using errcode = '22023';
  end if;

  for i in 1..50 loop
    v_id := 'ASN' || lpad(floor(random() * 100000)::int::text, 5, '0');
    exit when not exists (select 1 from public.assignments where id = v_id);
    v_id := null;
  end loop;
  if v_id is null then raise exception 'no_free_id' using errcode = '55000'; end if;

  -- added: only this insert may create an assignment row (see guard_assignment_insert)
  perform set_config('app.verified_dispatch_id', v_id, true);
  insert into public.assignments
    (id, driver_id, driver_name, truck_id, truck_plate, destination, destination_area, company,
     pickup_location, delivery_location, pickup_time, picked_up_date, eta, ata, delivery_date, remarks,
     task_status, assigned_at, state)
  values
    (v_id, d.id, d.name, t.id, t.plate_number, f ->> 'destination', f ->> 'destination_area', f ->> 'company',
     f ->> 'pickup_location', nullif(f ->> 'delivery_location', ''), coalesce(f ->> 'pickup_time', ''),
     coalesce(f ->> 'picked_up_date', ''), coalesce(f ->> 'eta', ''), '', coalesce(f ->> 'delivery_date', ''),
     coalesce(f ->> 'remarks', ''), 'Assigned', v_label, 'active');
  perform set_config('app.verified_dispatch_id', '', true);

  insert into public.assignment_documents (assignment_id, type, position, uploaded, doc_status)
  select v_id, doc_types[i], i - 1, false, 'pending' from generate_subscripts(doc_types, 1) i;

  update public.drivers set status = 'Assigned' where id = d.id;
  update public.trucks  set status = 'Assigned' where id = t.id;

  insert into public.activity_log (id, type, driver_name, truck_plate, assignment_id, destination, company)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'task_assigned', d.name, t.plate_number, v_id,
          split_part(f ->> 'destination', ' → ', 1) || ' → ' || (f ->> 'destination_area'), f ->> 'company');
  return v_id;
end $$;

-- ── 2. New guard: nothing may insert into assignments except the flagged row above ──
create function public.guard_assignment_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  if coalesce(current_setting('app.verified_dispatch_id', true), '') <> new.id then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger assignments_insert_guard before insert on public.assignments
  for each row execute function public.guard_assignment_insert();

-- ── 3. guard_assignment_cancel(): one more transition to require its flag ──
create or replace function public.guard_assignment_cancel() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;

  if old.loading_completed_at is not null and new.loading_completed_at is distinct from old.loading_completed_at
     or old.departed_at is not null and new.departed_at is distinct from old.departed_at
     or old.destination_arrived_at is not null and new.destination_arrived_at is distinct from old.destination_arrived_at
     or old.unloading_started_at is not null and new.unloading_started_at is distinct from old.unloading_started_at
     or old.unloading_completed_at is not null and new.unloading_completed_at is distinct from old.unloading_completed_at
     or old.operational_stage in ('loaded', 'destination_arrived', 'unloading', 'unloaded')
        and new.operational_stage is distinct from old.operational_stage
        and coalesce(current_setting('app.bypass_driver_guard', true), '') <> 'on'
     or old.task_status in ('Picked Up', 'In Transit', 'Delivered')
        and new.task_status = 'Assigned'
  then
    raise exception 'loading_completed' using errcode = '42501';
  end if;

  if (new.state = 'cancelled' and old.state <> 'cancelled')
     or (new.task_status = 'Cancelled' and old.task_status <> 'Cancelled') then
    if coalesce(current_setting('app.verified_cancellation_id', true), '') <> old.id then
      raise exception 'not_authorized' using errcode = '42501';
    end if;
    if old.loading_completed_at is not null or old.departed_at is not null
       or old.operational_stage in ('loaded', 'destination_arrived', 'unloading', 'unloaded')
       or old.task_status in ('Picked Up', 'In Transit', 'Delivered', 'Cancelled') then
      raise exception 'loading_completed' using errcode = '42501';
    end if;
  end if;

  -- added: only complete_assignment() (which sets app.verified_completion_id right
  -- before this same transition) may move an assignment to 'completed'.
  if new.state = 'completed' and old.state <> 'completed' then
    if coalesce(current_setting('app.verified_completion_id', true), '') <> old.id then
      raise exception 'not_authorized' using errcode = '42501';
    end if;
  end if;

  if old.state = 'cancelled' and new.cancel_reason is distinct from old.cancel_reason then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if new.cancelled_at is distinct from old.cancelled_at
     and coalesce(current_setting('app.verified_cancellation_id', true), '') <> new.id then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if new.completed_at_utc is distinct from old.completed_at_utc
     and coalesce(current_setting('app.verified_completion_id', true), '') <> new.id then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  return new;
end $$;

notify pgrst, 'reload schema';
commit;
