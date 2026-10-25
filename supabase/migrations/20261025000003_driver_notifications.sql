-- ════════════════════════════════════════════════════════════════════════════
-- Driver Notifications (REQ10) — persisted, driver-targeted notification feed.
--
-- Manual SQL Editor application only. Shared/production project.
--
-- `public.notifications` has always been staff-only: notifs_select requires
-- is_staff(), and a driver can only INSERT one for their own assignment, never
-- read or mark any row. The driver drawer currently shows a literal
-- "not available yet" banner. This adds a real, persisted feed for 3 events
-- that already go through trustworthy SECURITY DEFINER RPCs: dispatch,
-- cancellation, and issue resolution. Document rejection is deliberately
-- NOT included here — it still goes through the generic syncAdminData()
-- diff-sync path rather than a dedicated RPC (see the separate, already-
-- tracked "convert doc approve/reject to RPCs" backlog item); bolting a
-- trustworthy driver notification onto that untrusted path would be the
-- wrong order of operations. It stays a known, documented gap.
--
-- Design:
--   - recipient_driver_id (nullable) distinguishes a driver-targeted row from
--     the existing staff rows (null recipient, unchanged). Existing staff
--     notification code paths are completely untouched.
--   - A driver may SELECT only their own recipient rows (RLS). They get NO
--     direct UPDATE grant — read state changes only through the two new
--     guarded RPCs below, which touch only read/read_at on the caller's own
--     rows. This mirrors the cancel_acknowledged_at / driver_acknowledged_at
--     reasoning already used elsewhere: let a narrow, validated function own
--     the one safe mutation instead of widening raw table access.
--   - Each of the 3 event-creating RPCs uses a deterministic row id
--     ('notif-dispatch-'||id, etc.) so a retry can never double-insert; the
--     same on-conflict-do-nothing safety net REQ-008's issue_report() uses.
-- ════════════════════════════════════════════════════════════════════════════
begin;

alter table public.notifications
  add column if not exists recipient_driver_id text references public.drivers(id),
  add column if not exists read_at timestamptz;

create index if not exists notifications_recipient_driver_idx
  on public.notifications (recipient_driver_id, created_at desc);

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('doc_upload', 'status_update', 'delay_report', 'issue_report',
                   'driver_dispatched', 'driver_cancelled', 'driver_issue_resolved'));

-- ── 1. RLS: a driver may now also read their own targeted rows ──
drop policy if exists notifs_select on public.notifications;
create policy notifs_select on public.notifications for select to authenticated
  using (
    public.is_staff()
    or (recipient_driver_id is not null and recipient_driver_id = public.my_driver_id())
  );

-- ── 2. Guarded read-state RPCs — the only way a driver can change a row ──
create function public.mark_driver_notification_read(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.my_driver_id() is null then raise exception 'not_authorized' using errcode = '42501'; end if;
  update public.notifications
    set read = true, read_at = coalesce(read_at, now())
    where id = p_id and recipient_driver_id = public.my_driver_id();
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

create function public.mark_all_driver_notifications_read() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  if public.my_driver_id() is null then raise exception 'not_authorized' using errcode = '42501'; end if;
  update public.notifications
    set read = true, read_at = coalesce(read_at, now())
    where recipient_driver_id = public.my_driver_id() and read = false;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

grant execute on function public.mark_driver_notification_read(text) to authenticated;
grant execute on function public.mark_all_driver_notifications_read() to authenticated;

-- ── 3. Event creation — one idempotent insert added to each of the 3 trusted RPCs ──
-- unchanged everywhere else from 20261023000003_req011_direct_write_guards.sql
create or replace function public.dispatch_assignment(p_fields jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare
  allowed  text[] := array['driver_id', 'truck_id', 'destination', 'destination_area', 'company',
                           'pickup_location', 'delivery_location', 'pickup_time', 'picked_up_date',
                           'eta', 'delivery_date', 'remarks'];
  required text[] := array['driver_id', 'truck_id', 'destination', 'destination_area', 'company', 'pickup_location'];
  doc_types text[] := array['Proof of Delivery', 'Receiving Acknowledgement Report', 'Dispatch Slip',
                            'Sales Invoice', 'Bill of Lading', 'Waybill / Delivery Receipt'];
  k        text;
  d        public.drivers%rowtype;
  t        public.trucks%rowtype;
  v_id     text;
  v_label  text := to_char(now() at time zone 'Asia/Manila', 'Mon FMDD, HH12:MI AM');
  f        jsonb;
begin
  if not public.can_write() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'invalid_fields' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_fields) loop
    if not (k = any(allowed)) then raise exception 'field_not_allowed: %', k using errcode = '22023'; end if;
    if jsonb_typeof(p_fields -> k) <> 'string' then raise exception 'invalid_value: %', k using errcode = '22023'; end if;
  end loop;
  foreach k in array required loop
    if btrim(coalesce(p_fields ->> k, '')) = '' then raise exception 'required_field: %', k using errcode = '22023'; end if;
  end loop;
  if char_length(coalesce(p_fields ->> 'remarks', '')) > 150 then
    raise exception 'remarks_too_long' using errcode = '22023';
  end if;
  select jsonb_object_agg(key, btrim(value)) into f from jsonb_each_text(p_fields);

  select * into d from public.drivers where id = f ->> 'driver_id' for update;
  if not found then raise exception 'driver_not_found' using errcode = '22023'; end if;
  select * into t from public.trucks where id = f ->> 'truck_id' for update;
  if not found then raise exception 'truck_not_found' using errcode = '22023'; end if;
  if d.archived_at is not null then raise exception 'driver_archived' using errcode = '22023'; end if;
  if t.archived_at is not null then raise exception 'truck_archived' using errcode = '22023'; end if;
  if exists (select 1 from public.assignments x where x.state = 'active' and x.driver_id = d.id) then
    raise exception 'driver_busy' using errcode = '22023';
  end if;
  if t.status <> 'Available'
     or exists (select 1 from public.assignments x where x.state = 'active' and x.truck_id = t.id) then
    raise exception 'truck_unavailable' using errcode = '22023';
  end if;

  for i in 1..50 loop
    v_id := 'ASN' || lpad(floor(random() * 100000)::int::text, 5, '0');
    exit when not exists (select 1 from public.assignments where id = v_id);
    v_id := null;
  end loop;
  if v_id is null then raise exception 'no_free_id' using errcode = '55000'; end if;

  perform set_config('app.verified_dispatch_id', v_id, true);
  insert into public.assignments
    (id, driver_id, driver_name, truck_id, truck_plate, destination, destination_area, company,
     pickup_location, delivery_location, pickup_time, picked_up_date, eta, ata, delivery_date, remarks,
     task_status, assigned_at, state)
  values
    (v_id, d.id, d.name, t.id, t.plate_number, f ->> 'destination', f ->> 'destination_area', f ->> 'company',
     f ->> 'pickup_location', nullif(f ->> 'delivery_location', ''), coalesce(f ->> 'pickup_time', ''),
     coalesce(f ->> 'picked_up_date', ''), coalesce(f ->> 'eta', ''), '', coalesce(f ->> 'delivery_date', ''),
     coalesce(f ->> 'remarks', ''), 'Assigned', v_label, 'active');
  perform set_config('app.verified_dispatch_id', '', true);

  insert into public.assignment_documents (assignment_id, type, position, uploaded, doc_status)
  select v_id, doc_types[i], i - 1, false, 'pending' from generate_subscripts(doc_types, 1) i;

  update public.drivers set status = 'Assigned' where id = d.id;
  update public.trucks  set status = 'Assigned' where id = t.id;

  insert into public.activity_log (id, type, driver_name, truck_plate, assignment_id, destination, company)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'task_assigned', d.name, t.plate_number, v_id,
          split_part(f ->> 'destination', ' → ', 1) || ' → ' || (f ->> 'destination_area'), f ->> 'company');

  -- added: driver-targeted notification
  insert into public.notifications
    (id, type, message, assignment_id, driver_name, truck_plate, read, time_label, navigate_to, recipient_driver_id)
  values
    ('notif-dispatch-' || v_id, 'driver_dispatched', 'You have a new delivery: ' || (f ->> 'destination'),
     v_id, d.name, t.plate_number, false,
     to_char(now() at time zone 'Asia/Manila', 'Mon FMDD, HH12:MI AM'), null, d.id)
  on conflict (id) do nothing;

  return v_id;
end $$;

-- unchanged everywhere else from 20261022000001_assignment_event_timestamps.sql
create or replace function public.cancel_assignment(p_id text, p_reason text, p_password text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.assignments%rowtype;
  v_hash text;
  v_actor_name text;
begin
  if not public.can_write() or auth.uid() is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10
     or char_length(btrim(p_reason)) > 150 then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  if nullif(p_password, '') is null then
    raise exception 'wrong_password' using errcode = '42501';
  end if;

  select * into a from public.assignments where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if a.state <> 'active' then raise exception 'not_cancellable' using errcode = '42501'; end if;
  if a.loading_completed_at is not null or a.departed_at is not null
     or a.destination_arrived_at is not null or a.unloading_started_at is not null
     or a.unloading_completed_at is not null
     or a.operational_stage in ('loaded', 'destination_arrived', 'unloading', 'unloaded')
     or a.task_status in ('Picked Up', 'In Transit', 'Delivered') then
    raise exception 'loading_completed' using errcode = '42501';
  end if;
  if a.task_status <> 'Assigned'
     or a.operational_stage is not null and a.operational_stage not in ('pickup_arrived', 'loading') then
    raise exception 'not_cancellable' using errcode = '42501';
  end if;

  select u.encrypted_password into v_hash from auth.users u where u.id = auth.uid();
  if v_hash is null or extensions.crypt(p_password, v_hash) is distinct from v_hash then
    raise exception 'wrong_password' using errcode = '42501';
  end if;
  select p.name into v_actor_name from public.profiles p where p.id = auth.uid();

  perform set_config('app.verified_cancellation_id', p_id, true);
  update public.assignments
    set state = 'cancelled', task_status = 'Cancelled', cancel_reason = btrim(p_reason), cancelled_at = now()
    where id = p_id;
  perform set_config('app.verified_cancellation_id', '', true);

  if not exists (select 1 from public.assignments x
                 where x.state = 'active' and x.driver_id = a.driver_id) then
    update public.drivers set status = 'Pending' where id = a.driver_id;
  end if;
  if not exists (select 1 from public.assignments x
                 where x.state = 'active' and x.truck_id = a.truck_id) then
    update public.trucks set status = 'Available' where id = a.truck_id;
  end if;

  insert into public.activity_log
    (id, type, driver_name, truck_plate, assignment_id, destination, company, reason, member_name)
  values
    ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-'
       || substr(md5(random()::text), 1, 4),
     'task_cancelled', a.driver_name, a.truck_plate, p_id, a.destination, a.company, btrim(p_reason), v_actor_name);

  -- added: driver-targeted notification
  if a.driver_id is not null then
    insert into public.notifications
      (id, type, message, assignment_id, driver_name, truck_plate, reason, read, time_label, navigate_to, recipient_driver_id)
    values
      ('notif-cancel-' || p_id, 'driver_cancelled', 'Your delivery ' || p_id || ' was cancelled.',
       p_id, a.driver_name, a.truck_plate, btrim(p_reason), false,
       to_char(now() at time zone 'Asia/Manila', 'Mon FMDD, HH12:MI AM'), null, a.driver_id)
    on conflict (id) do nothing;
  end if;
end $$;

-- unchanged everywhere else from 20261023000006_team_member_archive_restore_reauth.sql
create or replace function public.resolve_assignment_issue(p_issue_id bigint, p_resolution_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  iss             public.assignment_issues%rowtype;
  a               public.assignments%rowtype;
  v_resolver_name text;
  v_note          text := nullif(btrim(coalesce(p_resolution_note, '')), '');
begin
  if not public.can_write() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if not public.signed_in_recently(300) then raise exception 'reauth_required' using errcode = '42501'; end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'note_too_long' using errcode = '22023';
  end if;

  select * into iss from public.assignment_issues where id = p_issue_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;

  select * into a from public.assignments where id = iss.assignment_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if a.state <> 'active' then raise exception 'assignment_not_active' using errcode = '42501'; end if;
  if iss.status <> 'open' then raise exception 'already_resolved' using errcode = '42501'; end if;

  select name into v_resolver_name from public.profiles where id = auth.uid();

  update public.assignment_issues
    set status = 'resolved', resolved_at = now(), resolved_by_user_id = auth.uid(),
        resolved_by_name = v_resolver_name, resolution_note = v_note, updated_at = now()
    where id = p_issue_id;

  insert into public.activity_log (id, type, driver_name, truck_plate, assignment_id, reason, issue_id)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'issue_resolved', a.driver_name, a.truck_plate, iss.assignment_id, v_note, p_issue_id);

  -- added: driver-targeted notification
  if a.driver_id is not null then
    insert into public.notifications
      (id, type, message, assignment_id, driver_name, truck_plate, reason, read, time_label, navigate_to, recipient_driver_id)
    values
      ('notif-issue-resolved-' || p_issue_id, 'driver_issue_resolved',
       'Your reported issue on ' || iss.assignment_id || ' has been resolved.',
       iss.assignment_id, a.driver_name, a.truck_plate, v_note, false,
       to_char(now() at time zone 'Asia/Manila', 'Mon FMDD, HH12:MI AM'), null, a.driver_id)
    on conflict (id) do nothing;
  end if;

  return jsonb_build_object(
    'id', iss.id, 'assignmentId', iss.assignment_id, 'status', 'resolved',
    'resolvedAt', now(), 'resolvedBy', v_resolver_name, 'resolutionNote', v_note
  );
end $$;

notify pgrst, 'reload schema';
commit;
