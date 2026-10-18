-- ════════════════════════════════════════════════════════════════════════════
-- Fix for REQ-004: dispatching broke entirely for CSR/admin.
--
-- 20261018000003_opm_role.sql locked drivers_update/trucks_update down to
-- is_opm() only, meaning to the database "editing a driver/truck" and
-- "dispatching a delivery" looked identical — both are just an UPDATE on
-- drivers/trucks. But dispatching, completing, and cancelling an assignment
-- only ever change ONE column: status (DriversManagement.tsx never touches
-- anything else on these two tables for those flows). Locking the whole
-- UPDATE to OPM broke that core, everyday CSR operation along with the
-- registration-editing it was meant to block.
--
-- Fix: restore drivers_update/trucks_update to can_write() OR is_opm() at
-- the row level (same shape as every other RLS policy here), then use a
-- guard trigger — same pattern as guard_assignment_update() — to restrict
-- what a non-OPM caller (can_write()-only: admin/csr) may actually change
-- to just `status`. An OPM caller is unrestricted, same as before. This
-- keeps "register/edit a driver or truck" OPM-exclusive while leaving
-- ordinary dispatch/complete/cancel working for CSR/admin as it always did.
-- ════════════════════════════════════════════════════════════════════════════
begin;

drop policy if exists drivers_update on public.drivers;
create policy drivers_update on public.drivers for update to authenticated
  using (public.can_write() or public.is_opm()) with check (public.can_write() or public.is_opm());

drop policy if exists trucks_update on public.trucks;
create policy trucks_update on public.trucks for update to authenticated
  using (public.can_write() or public.is_opm()) with check (public.can_write() or public.is_opm());

create function public.guard_driver_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.is_opm() then return new; end if;
  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'only OPM may edit driver details; status is the only field CSR/admin may change' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger drivers_status_only_guard before update on public.drivers
  for each row execute function public.guard_driver_update();

create function public.guard_truck_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.is_opm() then return new; end if;
  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'only OPM may edit truck details; status is the only field CSR/admin may change' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger trucks_status_only_guard before update on public.trucks
  for each row execute function public.guard_truck_update();

commit;
