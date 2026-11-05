-- ════════════════════════════════════════════════════════════════════════════
-- ETA → Scheduled Time of Arrival (STA).
--
-- Manual SQL Editor application only. Shared/production project.
-- Apply, then push the matching frontend right after (see the transition note).
--
-- Why: the system cannot compute an estimated arrival (no maps / distance
-- service), so the dispatcher TYPES the planned arrival time of day. That is a
-- scheduled time, not an estimate. The actual arrival stays in `ata`, so the
-- report compares plan (STA) with result (ATA). Behaviour is unchanged: the
-- "overdue / delivered late" checks, the pickup-time rule and every saved value
-- stay exactly as they are — only the name changes.
--
-- What this file does (one transaction — all or nothing):
--   0. Safety checks before touching anything:
--        • `eta` exists and `scheduled_arrival_time` does not;
--        • no other function in `public` mentions `eta` (it would break);
--        • edit_assignment() and dispatch_assignment() are the versions this
--          file was written against.
--      If any check fails the whole migration stops and nothing changes.
--   1. Renames assignments.eta → assignments.scheduled_arrival_time and proves,
--      with a fingerprint of every row's value taken before and after, that no
--      saved value changed.
--   2. Re-creates edit_assignment() and dispatch_assignment() with the new
--      column / key name. Everything else in both is unchanged.
--   3. Documents the column (shows up in ERD tools).
--
-- Transition: a browser tab or phone still running the OLD build keeps sending
-- the key "eta". Both functions treat it as "scheduled_arrival_time" (the new
-- key wins if both are sent), so Edit and Dispatch keep working until that page
-- refreshes. The old build shows an empty ETA until it refreshes. Remove the
-- alias in a later migration once the new build has been live for a while.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- ── 0 + 1. checks, rename, proof that no value changed ──
do $$
declare
  v_others text;
  v_before text;
  v_after  text;
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'assignments' and column_name = 'eta') then
    raise exception 'STA migration: column assignments.eta not found (already renamed?)';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'assignments' and column_name = 'scheduled_arrival_time') then
    raise exception 'STA migration: column assignments.scheduled_arrival_time already exists';
  end if;

  -- function bodies are stored as text, so a rename would silently break any other one that uses `eta`
  select string_agg(p.oid::regprocedure::text, ', ') into v_others
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prosrc ~ '\meta\M'
     and p.proname not in ('edit_assignment', 'dispatch_assignment');
  if v_others is not null then
    raise exception 'STA migration: these functions also mention eta and must be updated first: %', v_others;
  end if;

  -- the two functions rewritten below must be the versions this file copies
  if not exists (select 1 from pg_proc where oid = 'public.edit_assignment(text,jsonb,text)'::regprocedure
                    and prosrc like '%delivery_longitude%' and prosrc like '%driver_acknowledged_at%') then
    raise exception 'STA migration: live edit_assignment() is not the expected version — stop and compare it with 20261020000000';
  end if;
  if not exists (select 1 from pg_proc where oid = 'public.dispatch_assignment(jsonb)'::regprocedure
                    and prosrc like '%recipient_driver_id%' and prosrc like '%verified_dispatch_id%') then
    raise exception 'STA migration: live dispatch_assignment() is not the expected version — stop and compare it with 20261025000003';
  end if;

  select md5(coalesce(string_agg(id || '|' || eta, ',' order by id), '')) into v_before from public.assignments;

  alter table public.assignments rename column eta to scheduled_arrival_time;

  select md5(coalesce(string_agg(id || '|' || scheduled_arrival_time, ',' order by id), '')) into v_after from public.assignments;
  if v_before is distinct from v_after then
    raise exception 'STA migration: saved values changed during the rename (% vs %)', v_before, v_after;
  end if;
end $$;

comment on column public.assignments.scheduled_arrival_time is
  'Scheduled Time of Arrival (STA): the planned arrival time of day for the delivery, typed by the dispatcher (display text, e.g. "04:00 PM"). The date is delivery_date; the actual arrival time is ata.';

-- ── 2a. edit_assignment(): same as 20261020000000, with the renamed field + the transition alias ──
create or replace function public.edit_assignment(p_id text, p_changes jsonb, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  allowed text[] := array['driver_id', 'truck_id', 'destination', 'destination_area', 'company', 'pickup_location',
                          'pickup_time', 'picked_up_date', 'scheduled_arrival_time', 'delivery_date', 'remarks',
                          'delivery_location', 'pickup_latitude', 'pickup_longitude',
                          'delivery_latitude', 'delivery_longitude'];
  coord_keys text[] := array['pickup_latitude', 'pickup_longitude', 'delivery_latitude', 'delivery_longitude'];
  a       public.assignments%rowtype;
  k       text;
  v       numeric;
  diff    jsonb := '{}'::jsonb;
  d_name  text;
  t_plate text;
begin
  if not public.can_write() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if not public.signed_in_recently(300) then raise exception 'reauth_required' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) = 0 or char_length(btrim(p_reason)) > 150 then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'invalid_changes' using errcode = '22023';
  end if;

  -- transition: an old page sends "eta" — same field, new name (the new key wins if both are sent)
  if p_changes ? 'eta' then
    if not (p_changes ? 'scheduled_arrival_time') then
      p_changes := p_changes || jsonb_build_object('scheduled_arrival_time', p_changes -> 'eta');
    end if;
    p_changes := p_changes - 'eta';
  end if;

  -- lock the row so a driver's "Picked Up" can't land between the check and the write
  select * into a from public.assignments where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if a.state <> 'active' or a.task_status <> 'Assigned' then
    raise exception 'not_editable' using errcode = '42501';
  end if;

  for k in select jsonb_object_keys(p_changes) loop
    if not (k = any(allowed)) then raise exception 'field_not_editable: %', k using errcode = '22023'; end if;
    if k = any(coord_keys) then
      -- a real JSON number (not a string), or null to clear; JSON has no NaN / Infinity
      if jsonb_typeof(p_changes -> k) not in ('number', 'null') then
        raise exception 'invalid_coordinates: %', k using errcode = '22023';
      end if;
      if jsonb_typeof(p_changes -> k) = 'number' then
        v := (p_changes ->> k)::numeric;
        if (k like '%latitude'  and (v < -90  or v > 90))
           or (k like '%longitude' and (v < -180 or v > 180)) then
          raise exception 'invalid_coordinates: %', k using errcode = '22023';
        end if;
      end if;
      continue;
    end if;
    if jsonb_typeof(p_changes -> k) <> 'string' then raise exception 'invalid_value: %', k using errcode = '22023'; end if;
    if k <> 'remarks' and btrim(p_changes ->> k) = '' then raise exception 'required_field: %', k using errcode = '22023'; end if;
  end loop;
  if char_length(coalesce(p_changes ->> 'remarks', '')) > 150 then
    raise exception 'remarks_too_long' using errcode = '22023';
  end if;
  -- latitude and longitude travel together: never one without the other
  if (p_changes ? 'pickup_latitude') <> (p_changes ? 'pickup_longitude')
     or (p_changes ? 'delivery_latitude') <> (p_changes ? 'delivery_longitude')
     or (jsonb_typeof(p_changes -> 'pickup_latitude') = 'null') <> (jsonb_typeof(p_changes -> 'pickup_longitude') = 'null')
     or (jsonb_typeof(p_changes -> 'delivery_latitude') = 'null') <> (jsonb_typeof(p_changes -> 'delivery_longitude') = 'null') then
    raise exception 'invalid_coordinates: latitude and longitude must be sent together' using errcode = '22023';
  end if;

  -- old → new for every field that really changes
  foreach k in array allowed loop
    continue when not (p_changes ? k);
    continue when (to_jsonb(a) ->> k) is not distinct from (p_changes ->> k);
    diff := diff || jsonb_build_object(k, jsonb_build_object('old', to_jsonb(a) ->> k, 'new', p_changes ->> k));
  end loop;
  if diff = '{}'::jsonb then raise exception 'no_changes' using errcode = '22023'; end if;

  -- an address that changes without new coordinates loses its old ones (the
  -- assignments_location_consistency trigger clears them) — record that too
  if diff ? 'pickup_location' and not (p_changes ? 'pickup_latitude') and a.pickup_latitude is not null then
    diff := diff
      || jsonb_build_object('pickup_latitude',  jsonb_build_object('old', a.pickup_latitude::text,  'new', null))
      || jsonb_build_object('pickup_longitude', jsonb_build_object('old', a.pickup_longitude::text, 'new', null));
  end if;
  if diff ? 'delivery_location' and not (p_changes ? 'delivery_latitude') and a.delivery_latitude is not null then
    diff := diff
      || jsonb_build_object('delivery_latitude',  jsonb_build_object('old', a.delivery_latitude::text,  'new', null))
      || jsonb_build_object('delivery_longitude', jsonb_build_object('old', a.delivery_longitude::text, 'new', null));
  end if;

  -- driver swap: the new driver must exist and be free; release the old one
  if diff ? 'driver_id' then
    select d.name into d_name from public.drivers d where d.id = p_changes ->> 'driver_id';
    if not found then raise exception 'driver_not_found' using errcode = '22023'; end if;
    if exists (select 1 from public.assignments x
               where x.state = 'active' and x.driver_id = p_changes ->> 'driver_id' and x.id <> p_id) then
      raise exception 'driver_busy' using errcode = '22023';
    end if;
    update public.drivers set status = 'Pending'  where id = a.driver_id;
    update public.drivers set status = 'Assigned' where id = p_changes ->> 'driver_id';
    diff := diff || jsonb_build_object('driver_name', jsonb_build_object('old', a.driver_name, 'new', d_name));
  end if;

  -- truck swap: the new truck must be Available; release the old one
  if diff ? 'truck_id' then
    select t.plate_number into t_plate from public.trucks t
      where t.id = p_changes ->> 'truck_id' and t.status = 'Available';
    if not found then raise exception 'truck_unavailable' using errcode = '22023'; end if;
    update public.trucks set status = 'Available' where id = a.truck_id;
    update public.trucks set status = 'Assigned'  where id = p_changes ->> 'truck_id';
    diff := diff || jsonb_build_object('truck_plate', jsonb_build_object('old', a.truck_plate, 'new', t_plate));
  end if;

  -- coordinates that were explicitly sent must survive the stale-coordinate trigger
  perform set_config('app.explicit_pickup_coords',   case when p_changes ? 'pickup_latitude'   then 'on' else 'off' end, true);
  perform set_config('app.explicit_delivery_coords', case when p_changes ? 'delivery_latitude' then 'on' else 'off' end, true);

  -- one UPDATE, so an address and its coordinates always change together
  update public.assignments set
    driver_id       = case when diff ? 'driver_id'       then p_changes ->> 'driver_id'       else driver_id       end,
    driver_name     = coalesce(d_name, driver_name),
    truck_id        = case when diff ? 'truck_id'        then p_changes ->> 'truck_id'        else truck_id        end,
    truck_plate     = coalesce(t_plate, truck_plate),
    destination     = case when diff ? 'destination'     then p_changes ->> 'destination'     else destination     end,
    destination_area = case when diff ? 'destination_area' then p_changes ->> 'destination_area' else destination_area end,
    company         = case when diff ? 'company'         then p_changes ->> 'company'         else company         end,
    pickup_location = case when diff ? 'pickup_location' then p_changes ->> 'pickup_location' else pickup_location end,
    pickup_time     = case when diff ? 'pickup_time'     then p_changes ->> 'pickup_time'     else pickup_time     end,
    picked_up_date  = case when diff ? 'picked_up_date'  then p_changes ->> 'picked_up_date'  else picked_up_date  end,
    scheduled_arrival_time = case when diff ? 'scheduled_arrival_time' then p_changes ->> 'scheduled_arrival_time' else scheduled_arrival_time end,
    delivery_date   = case when diff ? 'delivery_date'   then p_changes ->> 'delivery_date'   else delivery_date   end,
    remarks         = case when diff ? 'remarks'         then p_changes ->> 'remarks'         else remarks         end,
    delivery_location  = case when diff ? 'delivery_location' then p_changes ->> 'delivery_location' else delivery_location end,
    -- coordinates: whatever was sent (number, or null to clear) — p_changes ? k, not diff ? k,
    -- so re-sending the same point with a new address keeps it instead of being cleared
    pickup_latitude    = case when p_changes ? 'pickup_latitude'    then (p_changes ->> 'pickup_latitude')::double precision    else pickup_latitude    end,
    pickup_longitude   = case when p_changes ? 'pickup_longitude'   then (p_changes ->> 'pickup_longitude')::double precision   else pickup_longitude   end,
    delivery_latitude  = case when p_changes ? 'delivery_latitude'  then (p_changes ->> 'delivery_latitude')::double precision  else delivery_latitude  end,
    delivery_longitude = case when p_changes ? 'delivery_longitude' then (p_changes ->> 'delivery_longitude')::double precision else delivery_longitude end,
    -- a new driver hasn't seen this task yet
    driver_acknowledged_at = case when diff ? 'driver_id' then null else driver_acknowledged_at end
  where id = p_id;

  perform set_config('app.explicit_pickup_coords',   'off', true);
  perform set_config('app.explicit_delivery_coords', 'off', true);

  -- admin_email / admin_role / admin_user_id are stamped by the stamp_activity trigger
  insert into public.activity_log (id, type, driver_name, truck_plate, assignment_id, destination, company, reason, changes)
  values (
    'act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
    'task_edited',
    coalesce(d_name, a.driver_name), coalesce(t_plate, a.truck_plate), p_id,
    coalesce(p_changes ->> 'destination', a.destination), coalesce(p_changes ->> 'company', a.company),
    btrim(p_reason), diff
  );
end $$;

-- ── 2b. dispatch_assignment(): same as 20261025000003, with the renamed field + the transition alias ──
create or replace function public.dispatch_assignment(p_fields jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare
  allowed  text[] := array['driver_id', 'truck_id', 'destination', 'destination_area', 'company',
                           'pickup_location', 'delivery_location', 'pickup_time', 'picked_up_date',
                           'scheduled_arrival_time', 'delivery_date', 'remarks'];
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

  -- transition: an old page sends "eta" — same field, new name (the new key wins if both are sent)
  if p_fields ? 'eta' then
    if not (p_fields ? 'scheduled_arrival_time') then
      p_fields := p_fields || jsonb_build_object('scheduled_arrival_time', p_fields -> 'eta');
    end if;
    p_fields := p_fields - 'eta';
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

  perform set_config('app.verified_dispatch_id', v_id, true);
  insert into public.assignments
    (id, driver_id, driver_name, truck_id, truck_plate, destination, destination_area, company,
     pickup_location, delivery_location, pickup_time, picked_up_date, scheduled_arrival_time, ata, delivery_date, remarks,
     task_status, assigned_at, state)
  values
    (v_id, d.id, d.name, t.id, t.plate_number, f ->> 'destination', f ->> 'destination_area', f ->> 'company',
     f ->> 'pickup_location', nullif(f ->> 'delivery_location', ''), coalesce(f ->> 'pickup_time', ''),
     coalesce(f ->> 'picked_up_date', ''), coalesce(f ->> 'scheduled_arrival_time', ''), '', coalesce(f ->> 'delivery_date', ''),
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

  -- driver-targeted notification
  insert into public.notifications
    (id, type, message, assignment_id, driver_name, truck_plate, read, time_label, navigate_to, recipient_driver_id)
  values
    ('notif-dispatch-' || v_id, 'driver_dispatched', 'You have a new delivery: ' || (f ->> 'destination'),
     v_id, d.name, t.plate_number, false,
     to_char(now() at time zone 'Asia/Manila', 'Mon FMDD, HH12:MI AM'), null, d.id)
  on conflict (id) do nothing;

  return v_id;
end $$;

notify pgrst, 'reload schema';
commit;
