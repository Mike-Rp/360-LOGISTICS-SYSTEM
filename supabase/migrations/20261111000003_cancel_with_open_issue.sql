-- ════════════════════════════════════════════════════════════════════════════
-- Force cancel: a delivery with an OPEN BLOCKING ISSUE can be cancelled at any stage.
--
-- Manual SQL Editor application only. Shared/production project.
--
-- Until now cancel_assignment() (and the table guard behind it) refused every cancel once loading
-- was complete — so when a driver reported a problem in transit ("Vehicle breakdown", "Accident /
-- road incident", "Customer refused delivery"…) and it could not be fixed, the CSR's only option
-- was "Resolve & Continue". There was no way to end the delivery.
--
-- The ONLY change: both checks that refuse a cancel after loading now skip that refusal when the
-- assignment has an open blocking issue (assignment_issues.status = 'open' and is_blocking).
-- Without an open issue, nothing changes — the loading cutoff still applies exactly as before.
-- Everything else in cancel_assignment() is identical to 20261025000003: who may cancel (an active
-- CSR with write access), the 10–150 character reason, the password re-entry on every call, the
-- driver/truck release, the activity log entry and the driver notification. The issue row is left
-- OPEN on purpose — closing it would falsely say it was resolved; the Reports and Cancelled screens
-- read "cancelled while the issue was still open" as "cancelled because it could not be resolved".
--
-- Safety check first: if either live function is not the version this file replaces, the migration
-- stops and changes nothing.
-- ════════════════════════════════════════════════════════════════════════════
begin;

do $$
begin
  if not exists (select 1 from pg_proc
                  where oid = to_regprocedure('public.cancel_assignment(text,text,text)')
                    and prosrc like '%loading_completed%'
                    and prosrc not like '%assignment_issues%'
                    and prosrc like '%driver_cancelled%') then
    raise exception 'force cancel: live cancel_assignment() is not the expected version — stop and compare it with 20261025000003';
  end if;
  if not exists (select 1 from pg_proc
                  where oid = to_regprocedure('public.guard_assignment_cancel()')
                    and prosrc like '%loading_completed%'
                    and prosrc not like '%assignment_issues%') then
    raise exception 'force cancel: live guard_assignment_cancel() is not the expected version — stop and compare it with 20261023000003';
  end if;
end $$;

-- ── 1. the table guard: the "no cancel after loading" rule steps aside for an open blocking issue ──
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
    -- Already-cancelled or delivered rows are never cancelled again; the loading cutoff applies unless an
    -- open blocking issue is what the cancellation is for.
    if old.task_status in ('Delivered', 'Cancelled') then
      raise exception 'loading_completed' using errcode = '42501';
    end if;
    if (old.loading_completed_at is not null or old.departed_at is not null
        or old.operational_stage in ('loaded', 'destination_arrived', 'unloading', 'unloaded')
        or old.task_status in ('Picked Up', 'In Transit'))
       and not exists (select 1 from public.assignment_issues i
                        where i.assignment_id = old.id and i.status = 'open' and i.is_blocking) then
      raise exception 'loading_completed' using errcode = '42501';
    end if;
  end if;

  -- only complete_assignment() (which sets app.verified_completion_id right before this same
  -- transition) may move an assignment to 'completed'.
  if new.state = 'completed' and old.state <> 'completed' then
    if coalesce(current_setting('app.verified_completion_id', true), '') <> old.id then
      raise exception 'not_authorized' using errcode = '42501';
    end if;
  end if;

  if old.state = 'cancelled' and new.cancel_reason is distinct from old.cancel_reason then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

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

-- ── 2. cancel_assignment(): same as 20261025000003, except the loading cutoff skips an open blocking issue ──
create or replace function public.cancel_assignment(p_id text, p_reason text, p_password text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.assignments%rowtype;
  v_hash text;
  v_actor_name text;
  v_has_issue boolean;
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

  -- An open blocking issue (the driver reported a problem that has not been resolved) lets the delivery be
  -- cancelled at any stage before it is delivered. Without one, the loading cutoff applies as before.
  select exists (select 1 from public.assignment_issues i
                  where i.assignment_id = p_id and i.status = 'open' and i.is_blocking) into v_has_issue;

  if a.task_status in ('Delivered', 'Cancelled') then
    raise exception 'loading_completed' using errcode = '42501';
  end if;
  if not v_has_issue then
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

revoke all on function public.cancel_assignment(text, text, text) from public, anon, authenticated;
grant execute on function public.cancel_assignment(text, text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
