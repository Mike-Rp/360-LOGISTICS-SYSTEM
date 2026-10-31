-- ════════════════════════════════════════════════════════════════════════════
-- REQ-018 — OPM leave coverage: time-boxed delegation of driver/truck work to a CSR.
--
-- Manual SQL Editor application only. Shared/production project.
--
-- Problem: only the Operation Manager can reset a driver PIN or register drivers
-- and trucks. While the OPM is on leave (and cannot be reached), a driver who
-- forgets their PIN, or a new driver/truck, has nobody who can help.
--
-- Solution: before leaving, the OPM grants ONE named CSR a window (start + end,
-- any length) for either or both of:
--   • reset driver PINs        → delegated_reset_driver_pin()
--   • register drivers/trucks  → register_driver() / register_truck()
-- Nothing else is delegated: no archiving, no team management, and the CSR can
-- still never READ a PIN (driver_pins stays OPM-only) — they only see the new
-- PIN that delegated_reset_driver_pin() returns once.
--
-- The database is the authority: every delegated call re-checks "this CSR, active,
-- inside the window, not revoked". Expiry needs no scheduled job. Every action is
-- written to activity_log with reason 'Under OPM delegation'; the PIN is never logged.
--
-- sync_driver_login() is OPM-only and stays that way. Its body moves, unchanged, into
-- the internal _set_driver_login() (no browser role can call it); sync_driver_login()
-- becomes "OPM check + _set_driver_login()". The delegated functions call the internal
-- one after their own delegation check.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. Grants table ──
create table public.fleet_delegations (
  id            uuid primary key default gen_random_uuid(),
  csr_id        uuid not null references public.profiles(id) on delete cascade,
  granted_by    uuid not null references public.profiles(id) on delete cascade,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  can_reset_pin boolean not null default false,
  can_register  boolean not null default false,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  constraint fleet_delegations_window check (ends_at > starts_at),
  constraint fleet_delegations_scope  check (can_reset_pin or can_register)
);
create index fleet_delegations_csr_idx on public.fleet_delegations (csr_id, ends_at desc);

alter table public.fleet_delegations enable row level security;
revoke all on public.fleet_delegations from public, anon, authenticated;
grant select on public.fleet_delegations to authenticated;
-- Only the OPM lists grants. A CSR learns their own through my_fleet_delegation().
-- Writes happen only inside the security-definer functions below.
create policy fleet_delegations_opm_read on public.fleet_delegations
  for select to authenticated using (public.is_opm());

-- ── 2. "Does the signed-in CSR hold an active grant for this scope?" ──
-- p_scope: 'pin' | 'register'. can_write() already requires an active admin/csr
-- profile and the current session.
create function public.has_fleet_delegation(p_scope text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_write() and exists (
    select 1 from public.fleet_delegations d
     where d.csr_id = auth.uid()
       and d.revoked_at is null
       and d.starts_at <= now() and now() < d.ends_at
       and case p_scope when 'pin' then d.can_reset_pin
                        when 'register' then d.can_register
                        else false end);
$$;

-- What the CSR's screen needs: until when each kind of access lasts (null = none now).
create function public.my_fleet_delegation() returns table (pin_until timestamptz, register_until timestamptz)
language sql stable security definer set search_path = '' as $$
  select max(d.ends_at) filter (where d.can_reset_pin),
         max(d.ends_at) filter (where d.can_register)
    from public.fleet_delegations d
   where public.can_write()
     and d.csr_id = auth.uid()
     and d.revoked_at is null
     and d.starts_at <= now() and now() < d.ends_at;
$$;

-- ── 3. OPM: grant and revoke ──
create function public.grant_fleet_delegation(
  p_csr_id uuid, p_starts_at timestamptz, p_ends_at timestamptz,
  p_can_reset_pin boolean, p_can_register boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  p       public.profiles%rowtype;
  v_id    uuid;
  v_scope text;
begin
  if not public.is_opm() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if not public.signed_in_recently(300) then raise exception 'reauth_required' using errcode = '42501'; end if;

  select * into p from public.profiles where id = p_csr_id and role = 'csr' and status = 'active';
  if not found then raise exception 'member_not_found' using errcode = 'P0002'; end if;

  -- No maximum length: the OPM sets the window to match the leave. It only has to be
  -- a real window that has not already ended.
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at or p_ends_at <= now() then
    raise exception 'invalid_window' using errcode = '22023';
  end if;
  if not (coalesce(p_can_reset_pin, false) or coalesce(p_can_register, false)) then
    raise exception 'no_scope' using errcode = '22023';
  end if;

  insert into public.fleet_delegations (csr_id, granted_by, starts_at, ends_at, can_reset_pin, can_register)
  values (p_csr_id, auth.uid(), p_starts_at, p_ends_at,
          coalesce(p_can_reset_pin, false), coalesce(p_can_register, false))
  returning id into v_id;

  v_scope := concat_ws(' + ',
    case when p_can_reset_pin then 'Reset driver PINs' end,
    case when p_can_register  then 'Register drivers & trucks' end);

  insert into public.activity_log (id, type, member_name, member_email, reason)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'delegation_granted', p.name, p.email,
          v_scope || ' · '
            || to_char(p_starts_at at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') || ' to '
            || to_char(p_ends_at   at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') || ' (PHT)');

  return v_id;
end $$;

-- Ending a grant only removes access, so it needs no password re-entry.
create function public.revoke_fleet_delegation(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.fleet_delegations%rowtype;
  p public.profiles%rowtype;
begin
  if not public.is_opm() then raise exception 'not_authorized' using errcode = '42501'; end if;

  select * into d from public.fleet_delegations where id = p_id for update;
  if not found then raise exception 'delegation_not_found' using errcode = 'P0002'; end if;
  if d.revoked_at is not null or d.ends_at <= now() then
    raise exception 'delegation_not_active' using errcode = '22023';
  end if;

  update public.fleet_delegations set revoked_at = now() where id = p_id;

  select * into p from public.profiles where id = d.csr_id;
  insert into public.activity_log (id, type, member_name, member_email)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'delegation_revoked', p.name, p.email);
end $$;

-- ── 4. sync_driver_login(): same body, now split into an internal part ──
create function public._set_driver_login(p_driver_id text, p_phone text, p_pin text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid;
  v_email     text;
  v_pw        text;
  v_old_email text;
  v_old_pin   text;
begin
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
    select lower(u.email) into v_old_email from auth.users u where u.id = v_uid;
    select dp.pin into v_old_pin from public.driver_pins dp where dp.driver_id = p_driver_id;
    update auth.users
       set email = v_email,
           encrypted_password = extensions.crypt(v_pw, extensions.gen_salt('bf')),
           updated_at = now()
     where id = v_uid;
    update auth.identities
       set identity_data = identity_data || jsonb_build_object('email', v_email), updated_at = now()
     where user_id = v_uid and provider = 'email';
    if v_old_email is distinct from v_email or v_old_pin is distinct from p_pin then
      delete from auth.sessions where user_id = v_uid;   -- refresh tokens cascade
    end if;
  end if;

  insert into public.driver_pins (driver_id, pin) values (p_driver_id, p_pin)
  on conflict (driver_id) do update set pin = excluded.pin;

  return v_uid;
end $$;

create or replace function public.sync_driver_login(p_driver_id text, p_phone text, p_pin text)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_opm() then raise exception 'not_authorized' using errcode = '42501'; end if;
  return public._set_driver_login(p_driver_id, p_phone, p_pin);
end $$;

-- ── 5. Delegated PIN reset: the server picks the PIN and returns it once ──
create function public.delegated_reset_driver_pin(p_driver_id text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_phone text;
  v_name  text;
  v_pin   text;
begin
  if not public.has_fleet_delegation('pin') then raise exception 'not_authorized' using errcode = '42501'; end if;
  if not public.signed_in_recently(300) then raise exception 'reauth_required' using errcode = '42501'; end if;

  select phone, name into v_phone, v_name from public.drivers where id = p_driver_id and archived_at is null;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;

  v_pin := (1000 + floor(random() * 9000)::int)::text;      -- 1000-9999, same range the app uses
  perform public._set_driver_login(p_driver_id, v_phone, v_pin);

  -- The PIN itself is never logged.
  insert into public.activity_log (id, type, driver_name, reason)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'driver_pin_reset', v_name, 'Under OPM delegation');

  return v_pin;
end $$;

-- ── 6. register_truck / register_driver: OPM, or a CSR with an active registration grant ──
create or replace function public.register_truck(p_plate_number text, p_classification text, p_capacity text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_plate text := upper(btrim(coalesce(p_plate_number, '')));
  v_class text := btrim(coalesce(p_classification, ''));
  v_id    text;
begin
  if not (public.is_opm() or public.has_fleet_delegation('register')) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_plate !~ '^[A-Z]{3} \d{3,4}$' then raise exception 'invalid_plate' using errcode = '22023'; end if;
  if v_class = '' then raise exception 'invalid_classification' using errcode = '22023'; end if;

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

  insert into public.activity_log (id, type, truck_plate, reason)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'truck_added', v_plate,
          case when public.is_opm() then null else 'Under OPM delegation' end);

  return v_id;
end $$;

create or replace function public.register_driver(p_first_name text, p_surname text, p_phone text, p_pin text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_first text := btrim(coalesce(p_first_name, ''));
  v_last  text := btrim(coalesce(p_surname, ''));
  v_name  text;
  v_phone_norm text := public.normalise_mobile(p_phone);
  v_id    text;
begin
  if not (public.is_opm() or public.has_fleet_delegation('register')) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if v_first = '' or v_last = '' then raise exception 'invalid_name' using errcode = '22023'; end if;
  if v_first !~ '^[[:alpha:]][[:alpha:][:space:]''.-]*$'
     or v_last !~ '^[[:alpha:]][[:alpha:][:space:]''.-]*$' then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  v_name := v_first || ' ' || v_last;

  if v_phone_norm !~ '^09\d{9}$' then raise exception 'invalid_phone' using errcode = '22023'; end if;

  if exists (select 1 from public.drivers where archived_at is null
             and public.normalise_mobile(phone) = v_phone_norm) then
    raise exception 'duplicate_phone' using errcode = '23505';
  end if;
  if exists (select 1 from public.drivers where archived_at is null
             and lower(regexp_replace(name, '\s+', ' ', 'g')) = lower(regexp_replace(v_name, '\s+', ' ', 'g'))) then
    raise exception 'duplicate_name' using errcode = '23505';
  end if;

  for i in 1..50 loop
    v_id := 'DR' || lpad(floor(random() * 100000)::int::text, 5, '0');
    exit when not exists (select 1 from public.drivers where id = v_id);
    v_id := null;
  end loop;
  if v_id is null then raise exception 'no_free_id' using errcode = '55000'; end if;

  insert into public.drivers (id, name, phone) values (v_id, v_name, '+63' || substr(v_phone_norm, 2));

  -- Internal login creator (the OPM-only sync_driver_login() would refuse a delegated CSR).
  perform public._set_driver_login(v_id, p_phone, p_pin);

  insert into public.activity_log (id, type, driver_name, reason)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'driver_added', v_name,
          case when public.is_opm() then null else 'Under OPM delegation' end);

  return v_id;
end $$;

-- ── 7. Execute rights ──
-- Internal: no browser role may call it directly.
revoke all on function public._set_driver_login(text, text, text) from public, anon, authenticated;

revoke all on function
  public.has_fleet_delegation(text),
  public.my_fleet_delegation(),
  public.grant_fleet_delegation(uuid, timestamptz, timestamptz, boolean, boolean),
  public.revoke_fleet_delegation(uuid),
  public.delegated_reset_driver_pin(text)
  from public, anon;
grant execute on function
  public.has_fleet_delegation(text),
  public.my_fleet_delegation(),
  public.grant_fleet_delegation(uuid, timestamptz, timestamptz, boolean, boolean),
  public.revoke_fleet_delegation(uuid),
  public.delegated_reset_driver_pin(text)
  to authenticated;

notify pgrst, 'reload schema';
commit;
