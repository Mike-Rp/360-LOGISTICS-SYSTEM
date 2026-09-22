-- ════════════════════════════════════════════════════════════════════════════
-- Archive drivers and trucks instead of deleting them, and require a fresh
-- password for archiving a driver or setting a new PIN.
--
-- REQUIRES 20260923000000_assignment_edit_cancel.sql (for signed_in_recently()).
--
--   archive_driver(id)        — admin/csr, password re-entered in the last 5 min,
--                               no active delivery; removes the driver's login
--   archive_truck(id)         — admin/csr, not on an active delivery
--   reset_driver_pin(id, pin) — admin/csr, password re-entered in the last 5 min
--
-- Archived rows stay in the table (past deliveries keep pointing at them) but are
-- invisible to every "active" list in the app and can't be assigned again.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Archive columns ──
alter table public.drivers add column archived_at timestamptz;
alter table public.trucks  add column archived_at timestamptz;

-- ── 2. An archived driver loses all driver access (every driver RLS rule goes through this) ──
create or replace function public.my_driver_id() returns text
language sql stable security definer set search_path = '' as $$
  select d.id from public.drivers d
  where d.auth_user_id = auth.uid() and d.archived_at is null limit 1;
$$;

-- Login screen: an archived driver's number counts as "not registered"
create or replace function public.driver_mobile_exists(p_phone text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.drivers d
    where public.normalise_mobile(d.phone) = public.normalise_mobile(p_phone) and d.archived_at is null
  );
$$;

-- ── 3. Archive a driver ──
create function public.archive_driver(p_driver_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.drivers%rowtype;
begin
  if not public.can_write() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if not public.signed_in_recently(300) then raise exception 'reauth_required' using errcode = '42501'; end if;

  select * into d from public.drivers where id = p_driver_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if d.archived_at is not null then raise exception 'already_archived' using errcode = '22023'; end if;
  if exists (select 1 from public.assignments a where a.driver_id = p_driver_id and a.state = 'active') then
    raise exception 'driver_busy' using errcode = '22023';
  end if;

  update public.drivers set archived_at = now(), status = 'Pending' where id = p_driver_id;
  delete from public.driver_pins where driver_id = p_driver_id;
  -- removing the Auth user blocks login; drivers.auth_user_id is set to null by its FK
  if d.auth_user_id is not null then delete from auth.users where id = d.auth_user_id; end if;

  insert into public.activity_log (id, type, driver_name)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'driver_archived', d.name);
end $$;

-- ── 4. Archive a truck ──
create function public.archive_truck(p_truck_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.trucks%rowtype;
begin
  if not public.can_write() then raise exception 'not_authorized' using errcode = '42501'; end if;

  select * into t from public.trucks where id = p_truck_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if t.archived_at is not null then raise exception 'already_archived' using errcode = '22023'; end if;
  if exists (select 1 from public.assignments a where a.truck_id = p_truck_id and a.state = 'active') then
    raise exception 'truck_busy' using errcode = '22023';
  end if;

  update public.trucks set archived_at = now(), status = 'Available' where id = p_truck_id;

  insert into public.activity_log (id, type, truck_plate)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'truck_archived', t.plate_number);
end $$;

-- ── 5. New PIN (reuses the existing login logic in sync_driver_login) ──
create function public.reset_driver_pin(p_driver_id text, p_pin text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_phone text;
begin
  if not public.can_write() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if not public.signed_in_recently(300) then raise exception 'reauth_required' using errcode = '42501'; end if;
  select phone into v_phone from public.drivers where id = p_driver_id and archived_at is null;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.sync_driver_login(p_driver_id, v_phone, p_pin);
end $$;

-- ── 6. Nothing may be assigned to an archived driver or truck (dispatch, edit, or direct API) ──
create function public.guard_assignment_archived() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.driver_id is not null and (tg_op = 'INSERT' or new.driver_id is distinct from old.driver_id)
     and exists (select 1 from public.drivers where id = new.driver_id and archived_at is not null) then
    raise exception 'driver_archived' using errcode = '22023';
  end if;
  if new.truck_id is not null and (tg_op = 'INSERT' or new.truck_id is distinct from old.truck_id)
     and exists (select 1 from public.trucks where id = new.truck_id and archived_at is not null) then
    raise exception 'truck_archived' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger assignments_archived_guard before insert or update on public.assignments
  for each row execute function public.guard_assignment_archived();

-- ── 7. Privileges (same pattern as the other migrations) ──
revoke all on function
  public.archive_driver(text),
  public.archive_truck(text),
  public.reset_driver_pin(text, text),
  public.guard_assignment_archived()
from public, anon, authenticated;

grant execute on function
  public.archive_driver(text),
  public.archive_truck(text),
  public.reset_driver_pin(text, text)
to authenticated;
