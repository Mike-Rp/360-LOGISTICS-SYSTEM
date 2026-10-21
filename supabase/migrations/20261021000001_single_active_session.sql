-- ════════════════════════════════════════════════════════════════════════════
-- Single active session per account (Driver, CSR, OPM) — newest login wins.
--
-- Manual SQL Editor application only. Shared/production project.
--
-- Rule: when an account signs in on Device B, Device A loses ALL data access on
-- its very next request, and is logged out by the app.
--
-- How (no custom table, Supabase-managed data only):
--   * Supabase Auth records every login in auth.sessions (user_id, created_at),
--     and every access token carries its session id (JWT claim session_id).
--   * session_is_current(): "is this request's session the account's NEWEST
--     session?" — one lookup on the existing (user_id, created_at) index.
--   * Every RLS policy (tables + Storage) and every authorizing RPC already goes
--     through is_staff() / can_write() / is_opm() / my_driver_id()
--     (driver_owns_assignment() calls my_driver_id()). Adding the check there,
--     plus the 3 policies that compare auth.uid() directly, covers everything.
--   * Built-in "Single session per user" is not used: it needs the Pro plan and
--     only applies on token refresh (an issued token keeps working ~1 hour).
--
-- Also:
--   * my_session_status() — 'current' | 'replaced' | 'signed_out' for the app's
--     message. A current session also removes the account's older sessions
--     (their refresh tokens go with them), so a displaced device cannot quietly
--     come back once the newer device signs out.
--   * sync_driver_login() — when an existing driver's PIN or phone changes (PIN
--     reset, edit), that driver's sessions end; the old phone must sign in again.
--   * touch_last_active() / csr_password_reset_approved() check the session too.
--
-- Not affected: anonymous calls (Forgot Password), the service role (Edge
-- Function, Dashboard), Auth itself. Not covered: Storage signed URLs already
-- handed out (they are long-lived) — separate follow-up.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. The check ──
create function public.session_is_current() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
      from auth.sessions s
     where s.user_id = auth.uid()
     order by s.created_at desc, s.id desc        -- id breaks a same-instant tie
     limit 1), false);
$$;

-- ── 2. The shared helpers (unchanged except for the session check) ──
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.session_is_current()
     and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active');
$$;

create or replace function public.can_write() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.session_is_current()
     and exists (
       select 1 from public.profiles p
       where p.id = auth.uid() and p.status = 'active' and p.role in ('admin', 'csr')
     );
$$;

create or replace function public.is_opm() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.session_is_current()
     and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active' and p.role = 'opm');
$$;

create or replace function public.my_driver_id() returns text
language sql stable security definer set search_path = '' as $$
  select d.id from public.drivers d
  where d.auth_user_id = auth.uid() and d.archived_at is null and public.session_is_current()
  limit 1;
$$;

-- ── 3. The three policies that compare auth.uid() directly ──
alter policy profiles_select on public.profiles
  using ((id = auth.uid() and public.session_is_current()) or public.is_opm());

alter policy drivers_select on public.drivers
  using (public.is_staff() or (auth_user_id = auth.uid() and public.session_is_current()));

alter policy csr_password_reset_owner_read on public.csr_password_reset_requests
  using (user_id = auth.uid() and public.session_is_current());

-- ── 4. Other functions that act on auth.uid() directly ──
create or replace function public.touch_last_active() returns void
language sql security definer set search_path = '' as $$
  update public.profiles set last_active = now()
   where id = auth.uid() and public.session_is_current();
$$;

create or replace function public.csr_password_reset_approved() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.session_is_current() and exists (
    select 1 from public.csr_password_reset_requests r
    join public.profiles p on p.id = r.user_id
    where r.user_id = auth.uid() and r.status = 'approved' and r.expires_at > now()
      and p.role = 'csr' and p.status = 'active'
  );
$$;

-- ── 5. Session status for the app ──
-- 'current'    this request's session is the newest → older sessions are removed
-- 'replaced'   a newer login of the same account exists
-- 'signed_out' no live session (signed out, PIN/password reset, account removed)
create function public.my_session_status() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  v_sid  uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_mine timestamptz;
begin
  if v_uid is null or v_sid is null then return 'signed_out'; end if;
  if public.session_is_current() then
    delete from auth.sessions where user_id = v_uid and id <> v_sid;
    return 'current';
  end if;
  select created_at into v_mine from auth.sessions where id = v_sid and user_id = v_uid;
  if exists (select 1 from auth.sessions s where s.user_id = v_uid and s.id <> v_sid
               and (v_mine is null or s.created_at >= v_mine)) then
    return 'replaced';
  end if;
  return 'signed_out';
end $$;

-- ── 6. Driver PIN / phone change ends that driver's existing sessions ──
-- Unchanged except: remember the old login email + PIN, and if either changed
-- for an existing login, delete the driver's sessions in the same transaction.
create or replace function public.sync_driver_login(p_driver_id text, p_phone text, p_pin text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid;
  v_email     text;
  v_pw        text;
  v_old_email text;
  v_old_pin   text;
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

-- ── 7. Execute rights (create or replace keeps the existing grants) ──
revoke all on function public.session_is_current(), public.my_session_status() from public, anon;
grant execute on function public.session_is_current(), public.my_session_status() to authenticated;

notify pgrst, 'reload schema';
commit;
