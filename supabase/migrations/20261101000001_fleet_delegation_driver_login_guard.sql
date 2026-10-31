-- ════════════════════════════════════════════════════════════════════════════
-- REQ-018 fix (found by fleet_delegation.test.sql): a covering CSR could not register
-- a driver. register_driver() → _set_driver_login() links the new Auth login to the
-- driver row (UPDATE drivers SET auth_user_id), and the status-only guard from
-- 20261019000000 (guard_driver_update) refuses any non-OPM change except `status` —
-- even from inside our own security-definer function, because it asks "is the caller
-- the OPM?" (the JWT), not "who is running this code".
--
-- Fix, kept as narrow as possible:
--   • _set_driver_login() sets a transaction-local flag (app.driver_login_sync) around
--     that one UPDATE and clears it right after. Body otherwise identical to
--     20261101000000.
--   • guard_driver_update() additionally accepts a change when the flag is on AND the
--     row's login was previously unset AND the only column that changed (besides
--     status) is auth_user_id. Everything else is still OPM-only.
-- A browser client cannot set the flag: it can only call exposed public functions, not
-- set_config(), and a direct UPDATE of any driver column by a CSR is still refused.
--
-- Manual SQL Editor application only. Shared/production project.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create or replace function public._set_driver_login(p_driver_id text, p_phone text, p_pin text)
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
    -- Allow exactly this one link past the status-only guard (see guard_driver_update).
    perform set_config('app.driver_login_sync', 'on', true);
    update public.drivers set auth_user_id = v_uid where id = p_driver_id;
    perform set_config('app.driver_login_sync', 'off', true);
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

create or replace function public.guard_driver_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.is_opm() then return new; end if;
  -- _set_driver_login() linking a brand-new driver to its login: that one column, nothing else.
  if current_setting('app.driver_login_sync', true) = 'on'
     and old.auth_user_id is null
     and (to_jsonb(new) - 'status' - 'auth_user_id') is not distinct from (to_jsonb(old) - 'status' - 'auth_user_id') then
    return new;
  end if;
  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'only OPM may edit driver details; status is the only field CSR/admin may change' using errcode = '42501';
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
commit;
