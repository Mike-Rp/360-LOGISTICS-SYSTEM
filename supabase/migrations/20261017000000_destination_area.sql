-- Add a general destination area without changing existing combined route values.
-- Existing assignments remain NULL; only new inserts require this value.
begin;

alter table public.assignments add column if not exists destination_area text;

create or replace function public.require_assignment_destination_area() returns trigger
language plpgsql set search_path = '' as $$
begin
  if btrim(coalesce(new.destination_area, '')) = '' then
    raise exception 'destination_area_required' using errcode = '22023';
  end if;
  new.destination_area := btrim(new.destination_area);
  return new;
end $$;

drop trigger if exists assignments_destination_area_required on public.assignments;
create trigger assignments_destination_area_required
before insert on public.assignments
for each row execute function public.require_assignment_destination_area();

revoke all on function public.require_assignment_destination_area()
from public, anon, authenticated;

-- Keep edit_assignment's existing authorization, status lock, reauthentication,
-- audit logging and allowed fields; add only destination_area.

create or replace function public.edit_assignment(p_id text, p_changes jsonb, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  allowed text[] := array['driver_id', 'truck_id', 'destination', 'destination_area', 'company', 'pickup_location',
                          'pickup_time', 'picked_up_date', 'eta', 'delivery_date', 'remarks'];
  a       public.assignments%rowtype;
  k       text;
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
    if jsonb_typeof(p_changes -> k) <> 'string' then raise exception 'invalid_value: %', k using errcode = '22023'; end if;
    if k <> 'remarks' and btrim(p_changes ->> k) = '' then raise exception 'required_field: %', k using errcode = '22023'; end if;
  end loop;
  if char_length(coalesce(p_changes ->> 'remarks', '')) > 150 then
    raise exception 'remarks_too_long' using errcode = '22023';
  end if;

  -- old → new for every field that really changes
  foreach k in array allowed loop
    continue when not (p_changes ? k);
    continue when (to_jsonb(a) ->> k) is not distinct from (p_changes ->> k);
    diff := diff || jsonb_build_object(k, jsonb_build_object('old', to_jsonb(a) ->> k, 'new', p_changes ->> k));
  end loop;
  if diff = '{}'::jsonb then raise exception 'no_changes' using errcode = '22023'; end if;

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
    -- a new driver hasn't seen this task yet
    driver_acknowledged_at = case when diff ? 'driver_id' then null else driver_acknowledged_at end
  where id = p_id;

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
