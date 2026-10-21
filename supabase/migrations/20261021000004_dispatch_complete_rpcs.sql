-- ════════════════════════════════════════════════════════════════════════════
-- Dispatch and completion as ONE database action each (backend item #3).
--
-- Manual SQL Editor application only. Shared/production project.
-- ADDITIVE: only creates two functions. Nothing is dropped or blocked, so the
-- current frontend (which still saves dispatch/completion through
-- syncAdminData) keeps working unchanged. Safe to apply before the frontend.
--
-- Before: the screen saved a dispatch as separate requests (assignment, its 6
-- document slots, driver status, truck status, activity log). A dropped
-- connection part-way left half a delivery, and two staff could book the same
-- driver/truck at the same moment because nothing re-checked "still free?".
--
-- Now:
--   dispatch_assignment(p_fields jsonb) → the new assignment id
--     Locks the driver and truck rows, re-checks both are free, then inserts the
--     assignment + 6 document slots, marks driver/truck Assigned and writes the
--     task_assigned log row — all or nothing.
--   complete_assignment(p_id text) → the completed_at label
--     Locks the assignment, checks it is active, Delivered and all 6 documents
--     are approved, then archives it, frees driver/truck and writes the
--     task_completed log row — all or nothing.
--
-- Both: admin/CSR only (can_write(), which also requires the newest session).
-- Actor email/role/time on the log row are stamped by stamp_activity.
-- Display times use the same format the browser used ("Oct 21, 03:15 PM"),
-- in Philippine time.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create function public.dispatch_assignment(p_fields jsonb) returns text
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
  -- trimmed copy of every text field
  select jsonb_object_agg(key, btrim(value)) into f from jsonb_each_text(p_fields);

  -- Lock driver then truck (always this order). A second dispatch for the same
  -- driver or truck waits here, then sees this one's committed result.
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

  -- Same id shape the screen made (ASN + 5 digits), but never a duplicate.
  for i in 1..50 loop
    v_id := 'ASN' || lpad(floor(random() * 100000)::int::text, 5, '0');
    exit when not exists (select 1 from public.assignments where id = v_id);
    v_id := null;
  end loop;
  if v_id is null then raise exception 'no_free_id' using errcode = '55000'; end if;

  insert into public.assignments
    (id, driver_id, driver_name, truck_id, truck_plate, destination, destination_area, company,
     pickup_location, delivery_location, pickup_time, picked_up_date, eta, ata, delivery_date, remarks,
     task_status, assigned_at, state)
  values
    (v_id, d.id, d.name, t.id, t.plate_number, f ->> 'destination', f ->> 'destination_area', f ->> 'company',
     f ->> 'pickup_location', nullif(f ->> 'delivery_location', ''), coalesce(f ->> 'pickup_time', ''),
     coalesce(f ->> 'picked_up_date', ''), coalesce(f ->> 'eta', ''), '', coalesce(f ->> 'delivery_date', ''),
     coalesce(f ->> 'remarks', ''), 'Assigned', v_label, 'active');

  insert into public.assignment_documents (assignment_id, type, position, uploaded, doc_status)
  select v_id, doc_types[i], i - 1, false, 'pending' from generate_subscripts(doc_types, 1) i;

  update public.drivers set status = 'Assigned' where id = d.id;
  update public.trucks  set status = 'Assigned' where id = t.id;

  -- Same text the screen logged: "<origin> → <destination area>"
  insert into public.activity_log (id, type, driver_name, truck_plate, assignment_id, destination, company)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'task_assigned', d.name, t.plate_number, v_id,
          split_part(f ->> 'destination', ' → ', 1) || ' → ' || (f ->> 'destination_area'), f ->> 'company');
  return v_id;
end $$;

create function public.complete_assignment(p_id text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  doc_types text[] := array['Proof of Delivery', 'Receiving Acknowledgement Report', 'Dispatch Slip',
                            'Sales Invoice', 'Bill of Lading', 'Waybill / Delivery Receipt'];
  a       public.assignments%rowtype;
  v_label text := to_char(now() at time zone 'Asia/Manila', 'Mon FMDD, HH12:MI AM');
begin
  if not public.can_write() then raise exception 'not_authorized' using errcode = '42501'; end if;

  -- Same row lock as cancel/edit/advance_driver_stage: they take turns.
  select * into a from public.assignments where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if a.state = 'completed' then raise exception 'already_completed' using errcode = '42501'; end if;
  if a.state <> 'active' or a.task_status <> 'Delivered' then
    raise exception 'not_completable' using errcode = '42501';
  end if;
  -- every required document uploaded and approved (same rule as canCompleteAssignment)
  if (select count(*) from public.assignment_documents x
      where x.assignment_id = p_id and x.type = any(doc_types) and x.uploaded and x.doc_status = 'approved')
     <> array_length(doc_types, 1) then
    raise exception 'documents_not_approved' using errcode = '42501';
  end if;

  update public.assignments set state = 'completed', completed_at = v_label where id = p_id;

  -- free the driver/truck unless another active assignment still uses them
  if not exists (select 1 from public.assignments x where x.state = 'active' and x.driver_id = a.driver_id) then
    update public.drivers set status = 'Complete' where id = a.driver_id;
  end if;
  if not exists (select 1 from public.assignments x where x.state = 'active' and x.truck_id = a.truck_id) then
    update public.trucks set status = 'Available' where id = a.truck_id;
  end if;

  insert into public.activity_log (id, type, driver_name, truck_plate, assignment_id, destination, company)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'task_completed', a.driver_name, a.truck_plate, p_id, a.destination, a.company);
  return v_label;
end $$;

revoke all on function public.dispatch_assignment(jsonb) from public, anon, authenticated;
revoke all on function public.complete_assignment(text)  from public, anon, authenticated;
grant execute on function public.dispatch_assignment(jsonb) to authenticated;
grant execute on function public.complete_assignment(text)  to authenticated;

commit;
