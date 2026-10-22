-- ════════════════════════════════════════════════════════════════════════════
-- REQ-013 — Canonical completion/cancellation timestamps.
--
-- Manual SQL Editor application only. Shared/production project.
--
-- `completed_at` is stored as "Mon DD, HH:MI AM" text with NO YEAR, and there
-- is no `cancelled_at` at all — neither can reliably sort, filter by date
-- range, or display correctly across a year boundary. Adds two nullable,
-- additive columns, each stamped with the SERVER's own now() inside the one
-- guarded RPC that causes that transition, in the same update as the state
-- change:
--   completed_at_utc timestamptz — stamped in complete_assignment()
--   cancelled_at      timestamptz — stamped in cancel_assignment()
-- The legacy `completed_at` text is untouched for backward compatibility.
-- Historical rows stay NULL — never backfilled from the yearless label,
-- delivery_date, or created_at, none of which are trustworthy event times.
--
-- Both new columns are protected from being set any other way: each RPC sets
-- a transaction-local flag right before its own update (same technique
-- cancel_assignment already used for cancel_reason), and guard_assignment_cancel()
-- (which already fires on every assignments update, not just cancellations)
-- refuses any OTHER attempt to change either column — including by a
-- can_write() caller going around the RPC with a direct table update.
-- ════════════════════════════════════════════════════════════════════════════
begin;

alter table public.assignments
  add column if not exists completed_at_utc timestamptz,
  add column if not exists cancelled_at      timestamptz;

-- ── 1. complete_assignment: stamp completed_at_utc, flagged for the guard below ──
create or replace function public.complete_assignment(p_id text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  doc_types text[] := array['Proof of Delivery', 'Receiving Acknowledgement Report', 'Dispatch Slip',
                            'Sales Invoice', 'Bill of Lading', 'Waybill / Delivery Receipt'];
  a       public.assignments%rowtype;
  v_label text := to_char(now() at time zone 'Asia/Manila', 'Mon FMDD, HH12:MI AM');
begin
  if not public.can_write() then raise exception 'not_authorized' using errcode = '42501'; end if;

  select * into a from public.assignments where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if a.state = 'completed' then raise exception 'already_completed' using errcode = '42501'; end if;
  if a.state <> 'active' or a.task_status <> 'Delivered' then
    raise exception 'not_completable' using errcode = '42501';
  end if;
  if (select count(*) from public.assignment_documents x
      where x.assignment_id = p_id and x.type = any(doc_types) and x.uploaded and x.doc_status = 'approved')
     <> array_length(doc_types, 1) then
    raise exception 'documents_not_approved' using errcode = '42501';
  end if;

  perform set_config('app.verified_completion_id', p_id, true);
  update public.assignments
    set state = 'completed', completed_at = v_label, completed_at_utc = now()
    where id = p_id;
  perform set_config('app.verified_completion_id', '', true);

  if not exists (select 1 from public.assignments x where x.state = 'active' and x.driver_id = a.driver_id) then
    update public.drivers set status = 'Complete' where id = a.driver_id;
  end if;
  if not exists (select 1 from public.assignments x where x.state = 'active' and x.truck_id = a.truck_id) then
    update public.trucks set status = 'Available' where id = a.truck_id;
  end if;

  insert into public.activity_log (id, type, driver_name, truck_plate, assignment_id, destination, company)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'task_completed', a.driver_name, a.truck_plate, p_id, a.destination, a.company);
  return v_label;
end $$;

-- ── 2. cancel_assignment: stamp cancelled_at in the same update ──
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
end $$;

-- ── 3. Protect both new columns from being set outside their one verified RPC ──
create or replace function public.guard_assignment_cancel() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;

  if old.loading_completed_at is not null and new.loading_completed_at is distinct from old.loading_completed_at
     or old.departed_at is not null and new.departed_at is distinct from old.departed_at
     or old.destination_arrived_at is not null and new.destination_arrived_at is distinct from old.destination_arrived_at
     or old.unloading_started_at is not null and new.unloading_started_at is distinct from old.unloading_started_at
     or old.unloading_completed_at is not null and new.unloading_completed_at is distinct from old.unloading_completed_at
     or old.operational_stage in ('loaded', 'destination_arrived', 'unloading', 'unloaded')
        and new.operational_stage is distinct from old.operational_stage
        and coalesce(current_setting('app.bypass_driver_guard', true), '') <> 'on'
     or old.task_status in ('Picked Up', 'In Transit', 'Delivered')
        and new.task_status = 'Assigned'
  then
    raise exception 'loading_completed' using errcode = '42501';
  end if;

  if (new.state = 'cancelled' and old.state <> 'cancelled')
     or (new.task_status = 'Cancelled' and old.task_status <> 'Cancelled') then
    if coalesce(current_setting('app.verified_cancellation_id', true), '') <> old.id then
      raise exception 'not_authorized' using errcode = '42501';
    end if;
    if old.loading_completed_at is not null or old.departed_at is not null
       or old.operational_stage in ('loaded', 'destination_arrived', 'unloading', 'unloaded')
       or old.task_status in ('Picked Up', 'In Transit', 'Delivered', 'Cancelled') then
      raise exception 'loading_completed' using errcode = '42501';
    end if;
  end if;

  if old.state = 'cancelled' and new.cancel_reason is distinct from old.cancel_reason then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- REQ-013: cancelled_at / completed_at_utc may only change inside their own
  -- verified RPC (same flag-per-transaction technique as cancel_reason above).
  if new.cancelled_at is distinct from old.cancelled_at
     and coalesce(current_setting('app.verified_cancellation_id', true), '') <> new.id then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if new.completed_at_utc is distinct from old.completed_at_utc
     and coalesce(current_setting('app.verified_completion_id', true), '') <> new.id then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  return new;
end $$;

commit;
