-- ════════════════════════════════════════════════════════════════════════════
-- REQ-019 — Drivers can be marked Unavailable, trucks Under maintenance.
--
-- Manual SQL Editor application only. Shared/production project.
--
-- A driver who is sick, on leave, in an emergency or a no-show — or a truck in the shop —
-- must not be handed a delivery. The OPM marks them with a reason; nobody can dispatch them
-- until they are marked back (or the expected return date passes).
--
--   • fleet_unavailability — one row per period, drivers AND trucks, with the reason, an
--     optional note and expected return, who marked it and when it ended. History is kept.
--       driver reasons: sick, leave, emergency, no_show, other (other needs a note)
--       truck reason:   maintenance
--     "Active" = not ended AND (no expected return OR it has not passed yet). So a period
--     with a return date expires by itself — no scheduled job (same idea as fleet_delegations).
--     At most one open period per driver / truck.
--   • current_unavailability — view of the active periods, readable by all staff (a CSR
--     dispatching must see who is out). Only the OPM can write.
--   • OPM-only functions (no password — reversible, like archiving a truck):
--       mark_driver_unavailable / mark_driver_available
--       mark_truck_maintenance  / mark_truck_available
--       update_unavailability   (note / expected return of an active period)
--     A driver with an active delivery cannot be marked (driver_busy); a truck on a delivery
--     cannot go to maintenance (truck_busy). A no-show with no return date ends at the end of
--     that day (Asia/Manila). Every action is logged.
--   • A guard on assignments refuses an unavailable driver / truck in a NEW or CHANGED
--     delivery (driver_unavailable / truck_under_maintenance). It lives on the table instead of
--     inside dispatch_assignment()/edit_assignment(), so it covers dispatch, a driver swap and
--     a truck swap without re-creating those two large functions.
--   • Archiving a driver / truck ends any open period.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. Records ──
create table public.fleet_unavailability (
  id                 uuid primary key default gen_random_uuid(),
  driver_id          text references public.drivers(id) on delete cascade,
  truck_id           text references public.trucks(id)  on delete cascade,
  reason             text not null,
  note               text,
  expected_return_at timestamptz,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  ended_at           timestamptz,
  ended_by           uuid references public.profiles(id) on delete set null,
  constraint fleet_unavailability_one_subject check ((driver_id is not null) <> (truck_id is not null)),
  constraint fleet_unavailability_reason check (
    (driver_id is not null and reason in ('sick', 'leave', 'emergency', 'no_show', 'other'))
    or (truck_id is not null and reason = 'maintenance')),
  constraint fleet_unavailability_other_needs_note check (reason <> 'other' or btrim(coalesce(note, '')) <> ''),
  constraint fleet_unavailability_note_length check (char_length(coalesce(note, '')) <= 200),
  constraint fleet_unavailability_return_after_start check (expected_return_at is null or expected_return_at > created_at)
);
create unique index fleet_unavailability_one_open_driver on public.fleet_unavailability (driver_id) where driver_id is not null and ended_at is null;
create unique index fleet_unavailability_one_open_truck  on public.fleet_unavailability (truck_id)  where truck_id  is not null and ended_at is null;

alter table public.fleet_unavailability enable row level security;
revoke all on public.fleet_unavailability from public, anon, authenticated;
grant select on public.fleet_unavailability to authenticated;
create policy fleet_unavailability_staff_read on public.fleet_unavailability
  for select to authenticated using (public.is_staff());

-- What is unavailable right now (what the screens and dispatch lists use).
create view public.current_unavailability with (security_invoker = true) as
  select id, driver_id, truck_id, reason, note, expected_return_at, created_at as since
    from public.fleet_unavailability
   where ended_at is null and (expected_return_at is null or now() < expected_return_at);
revoke all on public.current_unavailability from public, anon, authenticated;
grant select on public.current_unavailability to authenticated;

-- ── 2. Internal checks (used by the functions and the guard; not callable from a browser) ──
create function public.driver_is_unavailable(p_driver_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.fleet_unavailability u
                  where u.driver_id = p_driver_id and u.ended_at is null
                    and (u.expected_return_at is null or now() < u.expected_return_at));
$$;

create function public.truck_is_in_maintenance(p_truck_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.fleet_unavailability u
                  where u.truck_id = p_truck_id and u.ended_at is null
                    and (u.expected_return_at is null or now() < u.expected_return_at));
$$;

-- ── 3. The guard: no unavailable driver / truck in a new or changed delivery ──
create function public.guard_assignment_availability() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.state = 'active' then
    if new.driver_id is not null
       and (tg_op = 'INSERT' or new.driver_id is distinct from old.driver_id)
       and public.driver_is_unavailable(new.driver_id) then
      raise exception 'driver_unavailable' using errcode = '22023';
    end if;
    if new.truck_id is not null
       and (tg_op = 'INSERT' or new.truck_id is distinct from old.truck_id)
       and public.truck_is_in_maintenance(new.truck_id) then
      raise exception 'truck_under_maintenance' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

create trigger assignments_availability_guard
  before insert or update of driver_id, truck_id on public.assignments
  for each row execute function public.guard_assignment_availability();

-- ── 4. Archiving a driver / truck ends any open period ──
create function public.close_unavailability_on_archive() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.fleet_unavailability set ended_at = now()
   where ended_at is null
     and ((tg_table_name = 'drivers' and driver_id = new.id)
       or (tg_table_name = 'trucks'  and truck_id  = new.id));
  return new;
end $$;

create trigger drivers_close_unavailability after update of archived_at on public.drivers
  for each row when (old.archived_at is null and new.archived_at is not null)
  execute function public.close_unavailability_on_archive();
create trigger trucks_close_unavailability after update of archived_at on public.trucks
  for each row when (old.archived_at is null and new.archived_at is not null)
  execute function public.close_unavailability_on_archive();

-- ── 5. Drivers: mark unavailable / mark back ──
create function public.mark_driver_unavailable(
  p_driver_id text, p_reason text, p_note text default null, p_expected_return timestamptz default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  d        public.drivers%rowtype;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_return timestamptz := p_expected_return;
  v_id     uuid;
  v_label  text;
begin
  if not public.is_opm() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if p_reason is null or p_reason not in ('sick', 'leave', 'emergency', 'no_show', 'other') then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  if p_reason = 'other' and v_note is null then raise exception 'note_required' using errcode = '22023'; end if;
  if char_length(coalesce(v_note, '')) > 200 then raise exception 'note_too_long' using errcode = '22023'; end if;
  if v_return is not null and v_return <= now() then raise exception 'invalid_return' using errcode = '22023'; end if;

  select * into d from public.drivers where id = p_driver_id for update;
  if not found then raise exception 'driver_not_found' using errcode = '22023'; end if;
  if d.archived_at is not null then raise exception 'driver_archived' using errcode = '22023'; end if;
  if exists (select 1 from public.assignments x where x.state = 'active' and x.driver_id = d.id) then
    raise exception 'driver_busy' using errcode = '22023';
  end if;

  -- A period whose return date has passed is over, but still holds the "one open period" slot.
  update public.fleet_unavailability set ended_at = expected_return_at
   where driver_id = d.id and ended_at is null and expected_return_at is not null and expected_return_at <= now();
  if public.driver_is_unavailable(d.id) then raise exception 'already_unavailable' using errcode = '22023'; end if;

  if v_return is null and p_reason = 'no_show' then      -- a no-show lasts until the end of today
    v_return := (date_trunc('day', now() at time zone 'Asia/Manila') + interval '1 day') at time zone 'Asia/Manila';
  end if;

  insert into public.fleet_unavailability (driver_id, reason, note, expected_return_at, created_by)
  values (d.id, p_reason, v_note, v_return, auth.uid())
  returning id into v_id;

  v_label := case p_reason when 'sick' then 'Sick' when 'leave' then 'Vacation / Leave'
                           when 'emergency' then 'Emergency' when 'no_show' then 'No-show' else 'Other' end;
  insert into public.activity_log (id, type, driver_name, reason)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'driver_unavailable', d.name, v_label || coalesce(' — ' || v_note, ''));

  return v_id;
end $$;

create function public.mark_driver_available(p_driver_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  u public.fleet_unavailability%rowtype;
  v_name text;
begin
  if not public.is_opm() then raise exception 'not_authorized' using errcode = '42501'; end if;

  select * into u from public.fleet_unavailability
   where driver_id = p_driver_id and ended_at is null
     and (expected_return_at is null or now() < expected_return_at)
   for update;
  if not found then raise exception 'not_unavailable' using errcode = '22023'; end if;

  update public.fleet_unavailability set ended_at = now(), ended_by = auth.uid() where id = u.id;

  select name into v_name from public.drivers where id = p_driver_id;
  insert into public.activity_log (id, type, driver_name)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'driver_available_again', v_name);
end $$;

-- ── 6. Trucks: maintenance / back in service ──
create function public.mark_truck_maintenance(
  p_truck_id text, p_note text default null, p_expected_return timestamptz default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  t        public.trucks%rowtype;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_id     uuid;
begin
  if not public.is_opm() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if char_length(coalesce(v_note, '')) > 200 then raise exception 'note_too_long' using errcode = '22023'; end if;
  if p_expected_return is not null and p_expected_return <= now() then raise exception 'invalid_return' using errcode = '22023'; end if;

  select * into t from public.trucks where id = p_truck_id for update;
  if not found then raise exception 'truck_not_found' using errcode = '22023'; end if;
  if t.archived_at is not null then raise exception 'truck_archived' using errcode = '22023'; end if;
  if t.status <> 'Available'
     or exists (select 1 from public.assignments x where x.state = 'active' and x.truck_id = t.id) then
    raise exception 'truck_busy' using errcode = '22023';
  end if;

  update public.fleet_unavailability set ended_at = expected_return_at
   where truck_id = t.id and ended_at is null and expected_return_at is not null and expected_return_at <= now();
  if public.truck_is_in_maintenance(t.id) then raise exception 'already_unavailable' using errcode = '22023'; end if;

  insert into public.fleet_unavailability (truck_id, reason, note, expected_return_at, created_by)
  values (t.id, 'maintenance', v_note, p_expected_return, auth.uid())
  returning id into v_id;

  insert into public.activity_log (id, type, truck_plate, reason)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'truck_maintenance_started', t.plate_number, 'Maintenance' || coalesce(' — ' || v_note, ''));

  return v_id;
end $$;

create function public.mark_truck_available(p_truck_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  u public.fleet_unavailability%rowtype;
  v_plate text;
begin
  if not public.is_opm() then raise exception 'not_authorized' using errcode = '42501'; end if;

  select * into u from public.fleet_unavailability
   where truck_id = p_truck_id and ended_at is null
     and (expected_return_at is null or now() < expected_return_at)
   for update;
  if not found then raise exception 'not_unavailable' using errcode = '22023'; end if;

  update public.fleet_unavailability set ended_at = now(), ended_by = auth.uid() where id = u.id;

  select plate_number into v_plate from public.trucks where id = p_truck_id;
  insert into public.activity_log (id, type, truck_plate)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'truck_maintenance_ended', v_plate);
end $$;

-- ── 7. Change the note / expected return of an active period (driver or truck) ──
-- Both values are replaced: pass null for the return date to make it open-ended.
create function public.update_unavailability(p_id uuid, p_note text default null, p_expected_return timestamptz default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  u      public.fleet_unavailability%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_name text;
begin
  if not public.is_opm() then raise exception 'not_authorized' using errcode = '42501'; end if;

  select * into u from public.fleet_unavailability
   where id = p_id and ended_at is null and (expected_return_at is null or now() < expected_return_at)
   for update;
  if not found then raise exception 'not_unavailable' using errcode = '22023'; end if;

  if u.reason = 'other' and v_note is null then raise exception 'note_required' using errcode = '22023'; end if;
  if char_length(coalesce(v_note, '')) > 200 then raise exception 'note_too_long' using errcode = '22023'; end if;
  if p_expected_return is not null and p_expected_return <= now() then raise exception 'invalid_return' using errcode = '22023'; end if;

  update public.fleet_unavailability set note = v_note, expected_return_at = p_expected_return where id = u.id;

  if u.driver_id is not null then
    select name into v_name from public.drivers where id = u.driver_id;
    insert into public.activity_log (id, type, driver_name, reason)
    values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
            'unavailability_updated', v_name, 'Updated' || coalesce(' — ' || v_note, ''));
  else
    select plate_number into v_name from public.trucks where id = u.truck_id;
    insert into public.activity_log (id, type, truck_plate, reason)
    values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
            'unavailability_updated', v_name, 'Updated' || coalesce(' — ' || v_note, ''));
  end if;
end $$;

-- ── 8. Execute rights ──
revoke all on function public.driver_is_unavailable(text), public.truck_is_in_maintenance(text),
  public.guard_assignment_availability(), public.close_unavailability_on_archive()
  from public, anon, authenticated;

revoke all on function
  public.mark_driver_unavailable(text, text, text, timestamptz),
  public.mark_driver_available(text),
  public.mark_truck_maintenance(text, text, timestamptz),
  public.mark_truck_available(text),
  public.update_unavailability(uuid, text, timestamptz)
  from public, anon;
grant execute on function
  public.mark_driver_unavailable(text, text, text, timestamptz),
  public.mark_driver_available(text),
  public.mark_truck_maintenance(text, text, timestamptz),
  public.mark_truck_available(text),
  public.update_unavailability(uuid, text, timestamptz)
  to authenticated;

notify pgrst, 'reload schema';
commit;
