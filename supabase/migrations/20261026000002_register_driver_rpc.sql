-- ════════════════════════════════════════════════════════════════════════════
-- REQ-004 follow-up (3 of 3) — Driver registration as an atomic RPC.
--
-- Manual SQL Editor application only. Shared/production project.
--
-- Previously, "Register Driver" bundled three separate steps with no
-- atomicity guarantee: the browser made up the driver's ID and checked for a
-- duplicate name/phone against whatever was already loaded on screen (same
-- race condition as trucks); the driver row was written through the generic
-- client-driven auto-save path; and the Auth login + PIN were created
-- afterward by a SEPARATE call to the existing sync_driver_login(). If
-- anything failed between those steps — e.g. the connection drops right
-- after the driver row is created — the result is a driver who exists in
-- the fleet list but can never actually sign in, with nothing flagging it.
--
-- register_driver() does all of it as one transaction: assigns the ID
-- server-side, validates and duplicate-checks name/phone against live data,
-- inserts the driver row, and calls the EXISTING sync_driver_login()
-- (unchanged, already its own tested, atomic piece) to create the Auth
-- account and store the PIN — all inside the same transaction, so a failure
-- anywhere rolls back the whole thing instead of leaving a half-created
-- driver. Also fixes a separate reported bug along the way: driver names
-- had no format validation at all (e.g. "K1 Alas" was accepted) — same rule
-- update_own_display_name() already enforces for staff names.
--
-- drivers_insert RLS already requires is_opm() (REQ-004's own
-- 20261018000003_opm_role.sql, same as trucks_insert) — nothing newly
-- restricted here, just moved off the client-driven path.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create function public.register_driver(p_first_name text, p_surname text, p_phone text, p_pin text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_first text := btrim(coalesce(p_first_name, ''));
  v_last  text := btrim(coalesce(p_surname, ''));
  v_name  text;
  v_phone_norm text := public.normalise_mobile(p_phone);
  v_id    text;
begin
  if not public.is_opm() then raise exception 'not_authorized' using errcode = '42501'; end if;

  if v_first = '' or v_last = '' then raise exception 'invalid_name' using errcode = '22023'; end if;
  if v_first !~ '^[[:alpha:]][[:alpha:][:space:]''.-]*$'
     or v_last !~ '^[[:alpha:]][[:alpha:][:space:]''.-]*$' then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  v_name := v_first || ' ' || v_last;

  -- normalise_mobile() returns the LOCAL format ('0' + 10 digits) when it
  -- recognizes the input; require that shape here (10 digits after the
  -- leading 0, starting with 9 — same rule the client already enforces, and
  -- the one the driver login screen itself requires to sign in at all).
  if v_phone_norm !~ '^09\d{9}$' then raise exception 'invalid_phone' using errcode = '22023'; end if;

  -- Matches the existing client behavior: only active (non-archived) drivers
  -- block a name/phone from being reused.
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

  -- v_phone_norm is '0' + 10 digits (checked above) — drop the leading 0 to
  -- rebuild the '+63' + 10-digit form the rest of the app expects.
  insert into public.drivers (id, name, phone) values (v_id, v_name, '+63' || substr(v_phone_norm, 2));

  -- Existing, already-tested function — creates the Auth login (synthetic email +
  -- PIN-derived password) and stores the PIN, inside this same transaction.
  perform public.sync_driver_login(v_id, p_phone, p_pin);

  insert into public.activity_log (id, type, driver_name)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'driver_added', v_name);

  return v_id;
end $$;

grant execute on function public.register_driver(text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
