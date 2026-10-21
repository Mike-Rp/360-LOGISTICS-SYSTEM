-- REQ-003 follow-up. REVIEW ONLY: do not apply to the connected shared project
-- without the owner's manual approval. Supersedes both legacy cancellation RPCs.
begin;

-- Older clients must fail closed. Neither legacy overload checks a password on
-- every attempt, and the one-argument overload has no reason at all.
drop function if exists public.cancel_assignment(text);
drop function if exists public.cancel_assignment(text, text);

-- Reuse assignments.cancel_reason and activity_log.reason/admin_user_id/ts.
-- The trigger blocks direct table updates from bypassing the verified RPC.
create or replace function public.guard_assignment_cancel() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;

  -- A completed Loading milestone must never be erased to reopen cancellation.
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
  return new;
end $$;

create function public.cancel_assignment(p_id text, p_reason text, p_password text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.assignments%rowtype;
  v_hash text;
  v_actor_name text;
begin
  -- can_write() covers the existing admin/CSR dispatch capability, not OPM.
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

  -- Same row lock as advance_driver_stage(): whichever transaction obtains it
  -- second observes the first one's committed Loading/cancellation state.
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

  -- Check the current caller's Supabase Auth password in this invocation, not
  -- the age of a previous sign-in. Never persist, return, or audit p_password.
  select u.encrypted_password into v_hash from auth.users u where u.id = auth.uid();
  if v_hash is null or extensions.crypt(p_password, v_hash) is distinct from v_hash then
    raise exception 'wrong_password' using errcode = '42501';
  end if;
  select p.name into v_actor_name from public.profiles p where p.id = auth.uid();

  perform set_config('app.verified_cancellation_id', p_id, true);
  update public.assignments
    set state = 'cancelled', task_status = 'Cancelled', cancel_reason = btrim(p_reason)
    where id = p_id;
  perform set_config('app.verified_cancellation_id', '', true);

  -- Preserve the existing release and audit path. Do not release a resource
  -- that another active assignment is using.
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
  -- stamp_activity fills actor identity and timestamp from auth.uid().
end $$;

revoke all on function public.cancel_assignment(text, text, text) from public, anon, authenticated;
grant execute on function public.cancel_assignment(text, text, text) to authenticated;

commit;
