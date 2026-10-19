-- ════════════════════════════════════════════════════════════════════════════
-- REQ-005 — persist the exact pickup / delivery locations selected through Mapbox.
--
-- Extends the existing public.assignments table (no new table, no parallel model):
--
--   pickup_location      (existing text)   exact pickup address — REUSED, unchanged
--   pickup_latitude      double precision  NEW, nullable
--   pickup_longitude     double precision  NEW, nullable
--   delivery_location    text              NEW, nullable — exact delivery address
--   delivery_latitude    double precision  NEW, nullable
--   delivery_longitude   double precision  NEW, nullable
--
-- Unchanged: destination ("Origin → exact delivery location" route text) and
-- destination_area (general area). There is no separate `origin` column — the
-- route origin stays inside `destination`, exactly as today.
--
-- double precision matches the coordinates the app already stores
-- (status_photos.lat / lng) and keeps ~15 significant digits — far finer than
-- Mapbox returns.
--
-- Rules enforced by the database (they apply to every write path: Dispatch
-- create through the table, edit_assignment(), and any direct API call):
--   • latitude −90…90, longitude −180…180; NaN / ±Infinity are rejected
--   • latitude and longitude come as a pair — both set or both null
--   • coordinates need an address to belong to
--   • changing an address without sending new coordinates clears the old
--     ones (trigger), so a new address can never keep stale coordinates
--
-- Existing assignments: every new column stays NULL. No coordinates or delivery
-- addresses are invented; old deliveries keep working from pickup_location and
-- destination. Nothing new is required on insert, so Dispatch keeps working
-- before the frontend starts sending these fields.
--
-- Drivers cannot change any of these columns: guard_assignment_update() rejects
-- every driver change except task_status / issue_reason / acknowledgements.
--
-- Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. Columns ──
alter table public.assignments add column if not exists pickup_latitude    double precision;
alter table public.assignments add column if not exists pickup_longitude   double precision;
alter table public.assignments add column if not exists delivery_location  text;
alter table public.assignments add column if not exists delivery_latitude  double precision;
alter table public.assignments add column if not exists delivery_longitude double precision;

-- ── 2. Constraints (all existing rows are NULL, so they validate immediately) ──
-- `between` is false for NaN and ±Infinity in Postgres, so those are rejected too.
-- The explicit `is not null` matters: a CHECK passes on NULL, so without it a
-- latitude without its longitude would be accepted (see …_pair_fix.sql).
alter table public.assignments drop constraint if exists assignments_pickup_coords_check;
alter table public.assignments add constraint assignments_pickup_coords_check check (
  (pickup_latitude is null and pickup_longitude is null)
  or (pickup_latitude is not null and pickup_longitude is not null
      and pickup_latitude  between -90  and 90
      and pickup_longitude between -180 and 180
      and btrim(pickup_location) <> '')
);

alter table public.assignments drop constraint if exists assignments_delivery_coords_check;
alter table public.assignments add constraint assignments_delivery_coords_check check (
  (delivery_latitude is null and delivery_longitude is null)
  or (delivery_latitude is not null and delivery_longitude is not null
      and delivery_latitude  between -90  and 90
      and delivery_longitude between -180 and 180
      and btrim(coalesce(delivery_location, '')) <> '')
);

-- ── 3. No stale coordinates: a changed address without new coordinates clears them ──
-- edit_assignment() sets app.explicit_pickup_coords / app.explicit_delivery_coords
-- (transaction-local, same idea as app.bypass_driver_guard) when it was SENT
-- coordinates, so re-sending the same point with a relabelled address keeps it.
create or replace function public.clear_stale_assignment_coordinates() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.pickup_location is distinct from old.pickup_location
     and new.pickup_latitude  is not distinct from old.pickup_latitude
     and new.pickup_longitude is not distinct from old.pickup_longitude
     and coalesce(current_setting('app.explicit_pickup_coords', true), '') <> 'on' then
    new.pickup_latitude  := null;
    new.pickup_longitude := null;
  end if;
  if new.delivery_location is distinct from old.delivery_location
     and new.delivery_latitude  is not distinct from old.delivery_latitude
     and new.delivery_longitude is not distinct from old.delivery_longitude
     and coalesce(current_setting('app.explicit_delivery_coords', true), '') <> 'on' then
    new.delivery_latitude  := null;
    new.delivery_longitude := null;
  end if;
  return new;
end $$;

-- Fires after assignments_guard (triggers run in alphabetical order)
create or replace trigger assignments_location_consistency
before update on public.assignments
for each row execute function public.clear_stale_assignment_coordinates();

revoke all on function public.clear_stale_assignment_coordinates() from public, anon, authenticated;

-- ── 4. edit_assignment(): accept the new fields ──
-- Same as 20261017000002_destination_area_part1.sql (authorization, password
-- re-check, Assigned-only lock, driver/truck swap, audit log) plus:
--   • allowed: delivery_location, pickup_/delivery_ latitude / longitude
--   • coordinates must be JSON numbers (or null to clear), finite, in range,
--     and sent as a lat/lng pair — otherwise 'invalid_coordinates'
--   • an address change without new coordinates records the cleared
--     coordinates in the audit log (the trigger above does the clearing)
create or replace function public.edit_assignment(p_id text, p_changes jsonb, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  allowed text[] := array['driver_id', 'truck_id', 'destination', 'destination_area', 'company', 'pickup_location',
                          'pickup_time', 'picked_up_date', 'eta', 'delivery_date', 'remarks',
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
    eta             = case when diff ? 'eta'             then p_changes ->> 'eta'             else eta             end,
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

commit;
