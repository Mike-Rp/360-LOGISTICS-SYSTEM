-- ════════════════════════════════════════════════════════════════════════════
-- 360 Logistics — relational schema, Auth-based roles, RLS
-- Replaces the edge function (supabase/functions/server) + the single KV table.
--
-- Read this top to bottom. Sections:
--   1. Tables
--   2. Helper functions used by the policies
--   3. Row Level Security policies   (replaces the role checks in index.tsx)
--   4. Guard triggers                (replaces the "smart document merge")
--   5. RPC functions                 (replaces login / team-member routes)
--   6. Storage bucket + policies     (replaces /upload-image)
--   7. Lock-down of the anon role
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto with schema extensions;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. TABLES
-- ids and display-time fields stay `text` on purpose: the React app generates
-- ids like "DR12345" and formats times as display strings. Tighten later.
-- ────────────────────────────────────────────────────────────────────────────

-- One row per staff login (admin / csr / viewer). No row => no access.
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  name        text,
  role        text not null check (role in ('admin', 'csr', 'viewer')),
  is_om       boolean not null default false,   -- the Operation Manager
  is_demo     boolean not null default false,   -- presentation-only "admin abuse" account
  status      text not null default 'active' check (status in ('active', 'removed')),
  invited_at  timestamptz not null default now(),
  last_active timestamptz
);

create table public.drivers (
  id                text primary key,
  name              text not null,
  phone             text not null,
  truck_number      text not null default '',
  status            text not null default 'Pending' check (status in ('Assigned', 'Pending', 'Complete')),
  current_location  text not null default '—',
  deliveries_today  integer not null default 0,
  rating            numeric not null default 0,
  shift             text,
  auth_user_id      uuid unique references auth.users(id) on delete set null,
  created_at        timestamptz not null default now()
);

-- PINs live apart from `drivers` so the policy can be stricter (admin/csr only).
-- Admins can still view a PIN (AccountsPanel PinCell) — the Auth password is hashed,
-- so this table is the only place the readable copy exists.
create table public.driver_pins (
  driver_id text primary key references public.drivers(id) on delete cascade,
  pin       text not null check (pin ~ '^\d{4}$')
);

create table public.trucks (
  id             text primary key,
  plate_number   text not null,
  status         text not null default 'Available' check (status in ('Available', 'Assigned')),
  classification text,
  capacity       text
);

-- ONE table replaces the three arrays assignments / completed / cancelled.
-- `state` says which array a row belongs to; the loader in db.ts splits them.
create table public.assignments (
  id                       text primary key,
  driver_id                text references public.drivers(id) on delete set null,
  driver_name              text not null default '',
  truck_id                 text references public.trucks(id) on delete set null,
  truck_plate              text not null default '',
  destination              text not null default '',
  company                  text not null default '',
  pickup_location          text not null default '',
  pickup_time              text not null default '',
  picked_up_date           text not null default '',
  eta                      text not null default '',
  ata                      text not null default '',
  delivery_date            text not null default '',
  remarks                  text not null default '',
  task_status              text not null default 'Assigned'
                           check (task_status in ('Assigned', 'Picked Up', 'In Transit', 'Delivered', 'Failed / Issue', 'Cancelled')),
  assigned_at              text not null default '',
  issue_reason             text,
  driver_acknowledged_at   text,
  state                    text not null default 'active' check (state in ('active', 'completed', 'cancelled')),
  completed_at             text,
  created_at               timestamptz not null default now()
);
create index assignments_driver_idx on public.assignments (driver_id);
create index assignments_state_idx  on public.assignments (state);

create table public.assignment_documents (
  assignment_id text not null references public.assignments(id) on delete cascade,
  type          text not null,
  position      smallint not null default 0,          -- keeps the array order the UI expects
  uploaded      boolean not null default false,
  doc_status    text not null default 'pending' check (doc_status in ('pending', 'approved', 'rejected')),
  file_url      text,
  reject_reason text,
  primary key (assignment_id, type)
);

-- statusPhotos was a Record<status, photo> — natural key is (assignment, status)
create table public.status_photos (
  assignment_id text not null references public.assignments(id) on delete cascade,
  status        text not null,
  url           text not null,
  taken_at      text not null default '',
  location      text not null default '',
  lat           double precision,
  lng           double precision,
  primary key (assignment_id, status)
);

create table public.delay_reports (
  id            bigint generated always as identity primary key,
  assignment_id text not null references public.assignments(id) on delete cascade,
  type          text not null check (type in ('pickup', 'delivery')),
  reason        text not null,
  reported_at   text not null default ''
);
create index delay_reports_assignment_idx on public.delay_reports (assignment_id);

-- no FK on assignment_id: a notification should outlive a deleted/cancelled assignment
create table public.notifications (
  id            text primary key,
  type          text not null check (type in ('doc_upload', 'status_update', 'delay_report', 'issue_report')),
  message       text not null default '',
  assignment_id text not null,
  driver_name   text not null default '',
  truck_plate   text not null default '',
  doc_type      text,
  status_update text,
  photo_url     text,
  reason        text,
  read          boolean not null default false,
  time_label    text not null default '',
  navigate_to   text,
  created_at    timestamptz not null default now()
);
create index notifications_created_idx on public.notifications (created_at desc);

-- Append-only audit log (no UPDATE/DELETE policy exists — see section 3)
create table public.activity_log (
  id             text primary key,
  type           text not null,
  ts             timestamptz not null default now(),
  admin_email    text,
  admin_role     text,
  driver_name    text,
  truck_plate    text,
  assignment_id  text,
  doc_type       text,
  reject_reason  text,
  destination    text,
  company        text,
  member_name    text,
  member_email   text
);
create index activity_log_ts_idx on public.activity_log (ts desc);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. HELPER FUNCTIONS (used inside policies)
-- SECURITY DEFINER so they can read `profiles`/`drivers` regardless of the
-- caller's own RLS — otherwise a policy on `profiles` would recurse into itself.
-- ────────────────────────────────────────────────────────────────────────────

create function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active');
$$;

-- admin + csr may write; viewer is read-only (same rule the old server enforced)
create function public.can_write() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and p.role in ('admin', 'csr')
  );
$$;

create function public.is_om() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active' and p.is_om);
$$;

create function public.my_driver_id() returns text
language sql stable security definer set search_path = '' as $$
  select d.id from public.drivers d where d.auth_user_id = auth.uid() limit 1;
$$;

create function public.driver_owns_assignment(p_assignment_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.assignments a
    where a.id = p_assignment_id and a.driver_id is not null and a.driver_id = public.my_driver_id()
  );
$$;

-- "+63 917 123 4567" / "09171234567" / "639171234567"  ->  "09171234567"
-- (same normalisation the old edge function did; the login screen builds the same string)
create function public.normalise_mobile(p text) returns text
language sql immutable set search_path = '' as $$
  select case when d ~ '^63\d{10}$' then '0' || substr(d, 3) else d end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) s;
$$;

-- Drivers sign in through Supabase Auth with a synthetic email + PIN-derived password
create function public.driver_login_email(p_phone text) returns text
language sql immutable set search_path = '' as $$
  select 'd' || public.normalise_mobile(p_phone) || '@drivers.360logistics.ph';
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. ROW LEVEL SECURITY
-- With RLS on and no matching policy, a request is DENIED. The anon key alone
-- (which everyone can see in the browser) therefore reads and writes nothing.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.profiles             enable row level security;
alter table public.drivers              enable row level security;
alter table public.driver_pins          enable row level security;
alter table public.trucks               enable row level security;
alter table public.assignments          enable row level security;
alter table public.assignment_documents enable row level security;
alter table public.status_photos        enable row level security;
alter table public.delay_reports        enable row level security;
alter table public.notifications        enable row level security;
alter table public.activity_log         enable row level security;

-- profiles: everyone reads their own row (needed right after login); the OM reads all
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_om());
-- OM may change role/status/name of csr+viewer members only. INSERT/DELETE go through RPCs.
create policy profiles_update_om on public.profiles for update to authenticated
  using      (public.is_om() and role in ('csr', 'viewer') and not is_om)
  with check (public.is_om() and role in ('csr', 'viewer') and not is_om);

-- drivers
create policy drivers_select on public.drivers for select to authenticated
  using (public.is_staff() or auth_user_id = auth.uid());
create policy drivers_insert on public.drivers for insert to authenticated with check (public.can_write());
create policy drivers_update on public.drivers for update to authenticated
  using (public.can_write()) with check (public.can_write());
create policy drivers_delete on public.drivers for delete to authenticated using (public.can_write());

-- driver_pins: admin/csr read only; writes happen inside sync_driver_login()
create policy driver_pins_select on public.driver_pins for select to authenticated using (public.can_write());

-- trucks: staff + any driver can read (driver-data returned all trucks before)
create policy trucks_select on public.trucks for select to authenticated
  using (public.is_staff() or public.my_driver_id() is not null);
create policy trucks_insert on public.trucks for insert to authenticated with check (public.can_write());
create policy trucks_update on public.trucks for update to authenticated
  using (public.can_write()) with check (public.can_write());
create policy trucks_delete on public.trucks for delete to authenticated using (public.can_write());

-- assignments: a driver sees only their own, and never cancelled ones
create policy assignments_select on public.assignments for select to authenticated
  using (
    public.is_staff()
    or (driver_id is not null and driver_id = public.my_driver_id() and state <> 'cancelled')
  );
create policy assignments_insert on public.assignments for insert to authenticated with check (public.can_write());
create policy assignments_update on public.assignments for update to authenticated
  using (
    public.can_write()
    or (driver_id is not null and driver_id = public.my_driver_id() and state = 'active')
  )
  with check (
    public.can_write()
    or (driver_id is not null and driver_id = public.my_driver_id())
  );
create policy assignments_delete on public.assignments for delete to authenticated using (public.can_write());

-- child tables: same visibility as their parent assignment
create policy docs_select on public.assignment_documents for select to authenticated
  using (public.is_staff() or public.driver_owns_assignment(assignment_id));
create policy docs_insert on public.assignment_documents for insert to authenticated
  with check (public.can_write() or public.driver_owns_assignment(assignment_id));
create policy docs_update on public.assignment_documents for update to authenticated
  using      (public.can_write() or public.driver_owns_assignment(assignment_id))
  with check (public.can_write() or public.driver_owns_assignment(assignment_id));
create policy docs_delete on public.assignment_documents for delete to authenticated using (public.can_write());

create policy photos_select on public.status_photos for select to authenticated
  using (public.is_staff() or public.driver_owns_assignment(assignment_id));
create policy photos_insert on public.status_photos for insert to authenticated
  with check (public.can_write() or public.driver_owns_assignment(assignment_id));
create policy photos_update on public.status_photos for update to authenticated
  using      (public.can_write() or public.driver_owns_assignment(assignment_id))
  with check (public.can_write() or public.driver_owns_assignment(assignment_id));
create policy photos_delete on public.status_photos for delete to authenticated using (public.can_write());

create policy delays_select on public.delay_reports for select to authenticated
  using (public.is_staff() or public.driver_owns_assignment(assignment_id));
create policy delays_insert on public.delay_reports for insert to authenticated
  with check (public.can_write() or public.driver_owns_assignment(assignment_id));
create policy delays_delete on public.delay_reports for delete to authenticated using (public.can_write());

-- notifications: staff read; drivers may only ADD one for their own assignment
create policy notifs_select on public.notifications for select to authenticated using (public.is_staff());
create policy notifs_insert on public.notifications for insert to authenticated
  with check (public.can_write() or public.driver_owns_assignment(assignment_id));
create policy notifs_update on public.notifications for update to authenticated
  using (public.can_write()) with check (public.can_write());
create policy notifs_delete on public.notifications for delete to authenticated using (public.can_write());

-- activity_log: append-only. There is deliberately NO update or delete policy.
create policy activity_select on public.activity_log for select to authenticated using (public.is_staff());
create policy activity_insert on public.activity_log for insert to authenticated with check (public.can_write());

-- Column-level grants: RLS decides WHICH ROWS; these decide WHICH COLUMNS.
revoke insert, update, delete on public.profiles    from authenticated;
grant  update (name, role, status)                  on public.profiles to authenticated;

revoke insert, update on public.drivers from authenticated;   -- auth_user_id is set only by sync_driver_login()
grant  insert (id, name, phone, truck_number, status, current_location, deliveries_today, rating, shift)
  on public.drivers to authenticated;
grant  update (name, phone, truck_number, status, current_location, deliveries_today, rating, shift)
  on public.drivers to authenticated;

revoke insert, update, delete on public.driver_pins from authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. GUARD TRIGGERS
-- RLS can't restrict individual columns per user, so triggers do it. They only
-- act for a signed-in non-writer (i.e. a driver). auth.uid() is null for the
-- service role / SQL editor, so migrations and admin scripts pass untouched.
-- ────────────────────────────────────────────────────────────────────────────

-- A driver may change ONLY: task_status, issue_reason, driver_acknowledged_at.
create function public.guard_assignment_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.can_write() then
    return new;
  end if;
  if (to_jsonb(new) - array['task_status', 'issue_reason', 'driver_acknowledged_at'])
     is distinct from
     (to_jsonb(old) - array['task_status', 'issue_reason', 'driver_acknowledged_at']) then
    raise exception 'drivers may only update status, issue reason and acknowledgement' using errcode = '42501';
  end if;
  if new.task_status not in ('Assigned', 'Picked Up', 'In Transit', 'Delivered', 'Failed / Issue') then
    raise exception 'invalid status for a driver update' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger assignments_guard before update on public.assignments
  for each row execute function public.guard_assignment_update();

-- Same idea as the old server "smart merge": a driver can only attach a NEW file
-- (which resets the doc to 'pending'); approved/rejected status is preserved otherwise.
create function public.guard_document_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.can_write() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.doc_status := 'pending';
    new.reject_reason := null;
    return new;
  end if;
  -- UPDATE
  new.assignment_id := old.assignment_id;
  new.type          := old.type;
  new.position      := old.position;
  if new.file_url is distinct from old.file_url and new.file_url is not null then
    new.uploaded      := true;
    new.doc_status    := 'pending';
    new.reject_reason := null;
  else
    new.file_url      := old.file_url;
    new.uploaded      := old.uploaded;
    new.doc_status    := old.doc_status;
    new.reject_reason := old.reject_reason;
  end if;
  return new;
end $$;

create trigger documents_guard before insert or update on public.assignment_documents
  for each row execute function public.guard_document_write();

-- Stamp the audit log with the REAL signed-in admin — the browser can't spoof it.
create function public.stamp_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    select p.email, p.role into new.admin_email, new.admin_role from public.profiles p where p.id = auth.uid();
  end if;
  if new.ts is null then new.ts := now(); end if;
  return new;
end $$;

create trigger activity_stamp before insert on public.activity_log
  for each row execute function public.stamp_activity();

-- Deleting a driver must also remove their login (otherwise an orphan auth user remains).
create function public.drop_driver_login() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.auth_user_id is not null then
    delete from auth.users where id = old.auth_user_id;
  end if;
  return old;
end $$;

create trigger drivers_drop_login after delete on public.drivers
  for each row execute function public.drop_driver_login();

-- ────────────────────────────────────────────────────────────────────────────
-- 5. RPC FUNCTIONS — the parts of the edge function that need the privileged
--    `auth` schema. Each one checks WHO is calling before it does anything.
--    NOTE: writing auth.users directly is not an officially documented API.
--    It is the widely used no-edge-function pattern, but verify on your project.
-- ────────────────────────────────────────────────────────────────────────────

-- Internal helper: create an email+password login. Not callable from the browser.
create function public._create_auth_user(p_email text, p_password text, p_meta jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id    uuid := gen_random_uuid();
  v_email text := lower(trim(p_email));
begin
  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
    raise exception 'email_exists' using errcode = '23505';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, coalesce(p_meta, '{}'::jsonb), now(), now(),
    '', '', '', '', '', '', '', ''
  );

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (
    gen_random_uuid(), v_id, v_id::text,
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
    'email', now(), now(), now()
  );
  return v_id;
end $$;

-- Create the driver's login, or update it when the phone/PIN changed. Idempotent.
-- The drivers row must already exist (the app inserts it first).
create function public.sync_driver_login(p_driver_id text, p_phone text, p_pin text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid;
  v_email text;
  v_pw    text;
begin
  if not public.can_write() then raise exception 'not_authorized' using errcode = '42501'; end if;
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

-- OM invites a CSR / Viewer (replaces POST /team-members)
create function public.create_team_member(p_name text, p_email text, p_password text, p_role text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id    uuid;
  v_email text := lower(trim(p_email));
  v_name  text := trim(p_name);
begin
  if not public.is_om() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if p_role not in ('csr', 'viewer') then raise exception 'invalid_role'; end if;
  if coalesce(length(p_password), 0) < 6 then raise exception 'weak_password'; end if;
  if v_name = '' or v_email = '' then raise exception 'missing_fields'; end if;

  v_id := public._create_auth_user(v_email, p_password, jsonb_build_object('name', v_name));
  insert into public.profiles (id, email, name, role) values (v_id, v_email, v_name, p_role);

  return jsonb_build_object(
    'id', v_id, 'name', v_name, 'email', v_email, 'role', p_role,
    'status', 'active', 'invitedAt', now()
  );
end $$;

-- OM removes a member (replaces DELETE /team-members/:id). Deleting the auth user cascades to profiles.
create function public.remove_team_member(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_om() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_id and p.role in ('csr', 'viewer') and not p.is_om) then
    raise exception 'member_not_found';
  end if;
  delete from auth.users where id = p_id;
end $$;

-- Any signed-in staff member stamps their own last_active
create function public.touch_last_active() returns void
language sql security definer set search_path = '' as $$
  update public.profiles set last_active = now() where id = auth.uid();
$$;

-- Wipe app data, keep accounts + activity log (replaces POST /reset-data).
-- Deleting drivers also removes their logins (drivers_drop_login trigger).
create function public.reset_all_data() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_write() then raise exception 'not_authorized' using errcode = '42501'; end if;
  delete from public.notifications where true;
  delete from public.assignments   where true;   -- cascades to documents / photos / delay reports
  delete from public.drivers       where true;
  delete from public.trucks        where true;
end $$;

-- Functions are executable by PUBLIC by default — close that, then open only what the app calls.
revoke all on function
  public.is_staff(), public.can_write(), public.is_om(), public.my_driver_id(),
  public.driver_owns_assignment(text), public.normalise_mobile(text), public.driver_login_email(text),
  public._create_auth_user(text, text, jsonb),
  public.sync_driver_login(text, text, text), public.create_team_member(text, text, text, text),
  public.remove_team_member(uuid), public.touch_last_active(), public.reset_all_data()
from public, anon;

grant execute on function
  public.is_staff(), public.can_write(), public.is_om(), public.my_driver_id(),
  public.driver_owns_assignment(text), public.normalise_mobile(text), public.driver_login_email(text),
  public.sync_driver_login(text, text, text), public.create_team_member(text, text, text, text),
  public.remove_team_member(uuid), public.touch_last_active(), public.reset_all_data()
to authenticated;
-- _create_auth_user stays internal: only the definer functions above can call it.

-- ────────────────────────────────────────────────────────────────────────────
-- 6. STORAGE — private bucket; signed URLs are created by the signed-in user
--    Paths the app uses:  photos/<assignmentId>/...   docs/<assignmentId>/...
--    (storage.foldername(name))[2] is therefore the assignment id.
-- ────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('make-ee4d169c-media', 'make-ee4d169c-media', false)
on conflict (id) do nothing;

create policy media_select on storage.objects for select to authenticated
  using (
    bucket_id = 'make-ee4d169c-media'
    and (public.is_staff() or public.driver_owns_assignment((storage.foldername(name))[2]))
  );

create policy media_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'make-ee4d169c-media'
    and (storage.foldername(name))[1] in ('photos', 'docs')
    and public.driver_owns_assignment((storage.foldername(name))[2])
  );

-- upsert:true in the client needs UPDATE as well
create policy media_update on storage.objects for update to authenticated
  using (
    bucket_id = 'make-ee4d169c-media'
    and public.driver_owns_assignment((storage.foldername(name))[2])
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 7. LOCK DOWN `anon`
-- Supabase grants table access to anon by default. RLS already blocks it, but
-- removing the grant too means the anon key can't even see the tables exist.
-- ────────────────────────────────────────────────────────────────────────────
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on functions from anon;
