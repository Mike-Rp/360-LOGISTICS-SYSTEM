-- ════════════════════════════════════════════════════════════════════════════
-- Role model change: OPM (Operational Manager) replaces the old OM flag as a
-- real role, and takes over fleet/PIN/account-creation duties exclusively.
--
-- Before: profiles.role in ('admin', 'csr', 'viewer'); one viewer could be
-- flagged is_om = true, whose only special power was inviting/removing staff.
--
-- After: profiles.role in ('admin', 'csr', 'opm'). 'viewer' is dropped (no
-- rows use it). 'admin' stays only because an existing account already has
-- it — admin and csr are fully equivalent from here on, nothing admin-only
-- remains. OPM is its own role, not a flag, and is the ONLY role (not even
-- admin/csr) that can:
--   - register, edit, or archive drivers and trucks
--   - view or reset a driver's PIN
--   - create a new staff account (narrowed to CSR only — no more Viewer invites)
-- Everything else (dispatch, edit/cancel assignments, approve/reject
-- documents, reading every screen) is untouched — admin/csr keep it exactly
-- as today, and OPM can read it too (is_staff() already covers any role).
--
-- Bootstraps one OPM account directly (operationalmanager@360logistics.ph),
-- since OPM-only account creation means nothing could create the first OPM
-- through the app otherwise.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. Allow 'opm', drop 'viewer' ──
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'csr', 'opm'));

-- ── 2. Role-based OPM check (replaces the is_om flag) ──
create function public.is_opm() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active' and p.role = 'opm');
$$;

revoke all on function public.is_opm() from public, anon, authenticated;
grant execute on function public.is_opm() to authenticated;

-- ── 3. profiles: OPM reads everyone (Accounts page) and may only manage CSR accounts ──
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_opm());

drop policy if exists profiles_update_om on public.profiles;
create policy profiles_update_opm on public.profiles for update to authenticated
  using      (public.is_opm() and role = 'csr')
  with check (public.is_opm() and role = 'csr');

-- ── 4. drivers / trucks: register, edit, archive/delete become OPM-only ──
drop policy if exists drivers_insert on public.drivers;
create policy drivers_insert on public.drivers for insert to authenticated with check (public.is_opm());
drop policy if exists drivers_update on public.drivers;
create policy drivers_update on public.drivers for update to authenticated
  using (public.is_opm()) with check (public.is_opm());
drop policy if exists drivers_delete on public.drivers;
create policy drivers_delete on public.drivers for delete to authenticated using (public.is_opm());

drop policy if exists trucks_insert on public.trucks;
create policy trucks_insert on public.trucks for insert to authenticated with check (public.is_opm());
drop policy if exists trucks_update on public.trucks;
create policy trucks_update on public.trucks for update to authenticated
  using (public.is_opm()) with check (public.is_opm());
drop policy if exists trucks_delete on public.trucks;
create policy trucks_delete on public.trucks for delete to authenticated using (public.is_opm());

-- ── 5. driver_pins: only OPM may view ──
drop policy if exists driver_pins_select on public.driver_pins;
create policy driver_pins_select on public.driver_pins for select to authenticated using (public.is_opm());

-- ── 6. Functions: swap can_write()/is_om() for is_opm() where this is now exclusive ──
create or replace function public.archive_driver(p_driver_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.drivers%rowtype;
begin
  if not public.is_opm() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if not public.signed_in_recently(300) then raise exception 'reauth_required' using errcode = '42501'; end if;

  select * into d from public.drivers where id = p_driver_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if d.archived_at is not null then raise exception 'already_archived' using errcode = '22023'; end if;
  if exists (select 1 from public.assignments a where a.driver_id = p_driver_id and a.state = 'active') then
    raise exception 'driver_busy' using errcode = '22023';
  end if;

  update public.drivers set archived_at = now(), status = 'Pending' where id = p_driver_id;
  delete from public.driver_pins where driver_id = p_driver_id;
  if d.auth_user_id is not null then delete from auth.users where id = d.auth_user_id; end if;

  insert into public.activity_log (id, type, driver_name)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'driver_archived', d.name);
end $$;

create or replace function public.archive_truck(p_truck_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.trucks%rowtype;
begin
  if not public.is_opm() then raise exception 'not_authorized' using errcode = '42501'; end if;

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

create or replace function public.reset_driver_pin(p_driver_id text, p_pin text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_phone text;
begin
  if not public.is_opm() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if not public.signed_in_recently(300) then raise exception 'reauth_required' using errcode = '42501'; end if;
  select phone into v_phone from public.drivers where id = p_driver_id and archived_at is null;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.sync_driver_login(p_driver_id, v_phone, p_pin);
end $$;

create or replace function public.sync_driver_login(p_driver_id text, p_phone text, p_pin text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid;
  v_email text;
  v_pw    text;
begin
  if not public.is_opm() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if p_pin !~ '^\d{4}$' then raise exception 'invalid_pin'; end if;
  if public.normalise_mobile(p_phone) = '' then raise exception 'invalid_phone'; end if;

  v_email := public.driver_login_email(p_phone);
  v_pw    := '360pin-' || p_pin;      -- Auth requires >= 6 chars; must match db.ts

  select d.auth_user_id into v_uid from public.drivers d where d.id = p_driver_id;
  if not found then raise exception 'driver_not_found'; end if;

  if v_uid is null then
    v_uid := public._create_auth_user(v_email, v_pw, jsonb_build_object('driver_id', p_driver_id));
    update public.drivers set auth_user_id = v_uid where id = p_driver_id;
  else
    if exists (select 1 from auth.users u where lower(u.email) = v_email and u.id <> v_uid) then
      raise exception 'email_exists' using errcode = '23505';
    end if;
    update auth.users
       set email = v_email,
           encrypted_password = extensions.crypt(v_pw, extensions.gen_salt('bf')),
           updated_at = now()
     where id = v_uid;
    update auth.identities
       set identity_data = identity_data || jsonb_build_object('email', v_email), updated_at = now()
     where user_id = v_uid and provider = 'email';
  end if;

  insert into public.driver_pins (driver_id, pin) values (p_driver_id, p_pin)
  on conflict (driver_id) do update set pin = excluded.pin;

  return v_uid;
end $$;

create or replace function public.create_team_member(p_name text, p_email text, p_password text, p_role text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id    uuid;
  v_email text := lower(trim(p_email));
  v_name  text := trim(p_name);
begin
  if not public.is_opm() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if p_role <> 'csr' then raise exception 'invalid_role'; end if;
  if coalesce(length(p_password), 0) < 6 then raise exception 'weak_password'; end if;
  if v_name = '' or v_email = '' then raise exception 'missing_fields'; end if;

  v_id := public._create_auth_user(v_email, p_password, jsonb_build_object('name', v_name));
  insert into public.profiles (id, email, name, role) values (v_id, v_email, v_name, p_role);

  return jsonb_build_object(
    'id', v_id, 'name', v_name, 'email', v_email, 'role', p_role,
    'status', 'active', 'invitedAt', now()
  );
end $$;

create or replace function public.remove_team_member(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_opm() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_id and p.role = 'csr') then
    raise exception 'member_not_found';
  end if;
  delete from auth.users where id = p_id;
end $$;

-- ── 7. Drop the now-unused is_om flag and function ──
drop function if exists public.is_om();
alter table public.profiles drop column if exists is_om;

-- ── 8. Bootstrap the first OPM account ──
-- No password here on purpose (this repo never stores passwords — see
-- supabase/manual/seed_staff.sql). Create the Auth user by hand first in
-- Supabase Dashboard -> Authentication -> Users -> "Add user" (tick "Auto
-- Confirm User", choose the password there), THEN run this to attach the
-- opm role. See supabase/manual/seed_opm.sql for the ready-to-run version
-- of this same step.
insert into public.profiles (id, email, name, role)
select u.id, 'operationalmanager@360logistics.ph', 'Gefran Pervera', 'opm'
from auth.users u where lower(u.email) = 'operationalmanager@360logistics.ph'
on conflict (id) do update set role = excluded.role, status = 'active';

commit;
