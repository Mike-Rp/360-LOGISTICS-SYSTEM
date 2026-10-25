-- ════════════════════════════════════════════════════════════════════════════
-- REQ-004 follow-up (2 of 3) — Truck registration as an atomic RPC.
--
-- Manual SQL Editor application only. Shared/production project.
--
-- Previously, "Register Truck" made up the new truck's ID from the current
-- timestamp in the browser, and checked for a duplicate plate only against
-- whatever trucks were already loaded on screen — not the live database at
-- the moment of submission. Two admins registering trucks within the same
-- window could both pass that check and create two trucks sharing a real
-- plate number. register_truck() moves both decisions server-side: it
-- assigns the ID itself (same loop-until-unique pattern dispatch_assignment()
-- already uses) and checks for a duplicate plate against live data inside
-- the same transaction, so two simultaneous registrations can't both win.
--
-- trucks_insert RLS already requires is_opm() (REQ-004's own
-- 20261018000003_opm_role.sql), so this function requires the same —
-- nothing is being newly restricted, just moved off the client-driven path.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create function public.register_truck(p_plate_number text, p_classification text, p_capacity text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_plate text := upper(btrim(coalesce(p_plate_number, '')));
  v_class text := btrim(coalesce(p_classification, ''));
  v_id    text;
begin
  if not public.is_opm() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if v_plate !~ '^[A-Z]{3} \d{3,4}$' then raise exception 'invalid_plate' using errcode = '22023'; end if;
  if v_class = '' then raise exception 'invalid_classification' using errcode = '22023'; end if;

  -- Matches the existing client behavior: only active (non-archived) trucks
  -- block a plate from being reused.
  if exists (select 1 from public.trucks where plate_number = v_plate and archived_at is null) then
    raise exception 'duplicate_plate' using errcode = '23505';
  end if;

  for i in 1..50 loop
    v_id := 'T' || lpad(floor(random() * 100000)::int::text, 5, '0');
    exit when not exists (select 1 from public.trucks where id = v_id);
    v_id := null;
  end loop;
  if v_id is null then raise exception 'no_free_id' using errcode = '55000'; end if;

  insert into public.trucks (id, plate_number, status, classification, capacity)
  values (v_id, v_plate, 'Available', v_class, nullif(btrim(coalesce(p_capacity, '')), ''));

  insert into public.activity_log (id, type, truck_plate)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'truck_added', v_plate);

  return v_id;
end $$;

grant execute on function public.register_truck(text, text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
