-- ════════════════════════════════════════════════════════════════════════════
-- Cancel assignment: require a reason + password re-auth, and let the driver
-- actually find out their delivery was cancelled.
--
-- Two separate problems this fixes:
--
--   1. cancel_assignment() today takes no reason and no re-auth check, unlike
--      edit_assignment() which requires both. Bringing it in line: a reason
--      is now required (same validation as edit_assignment's p_reason) and
--      the caller must have signed in with their password in the last 5
--      minutes (signed_in_recently(300), same helper edit_assignment uses —
--      this is what drives the password prompt on the admin screen).
--
--   2. A driver can NEVER see that their delivery was cancelled. The
--      assignments_select policy explicitly excludes state = 'cancelled' for
--      drivers, so the row just vanishes from what they can query — there is
--      no error, no notice, nothing. This adds: a cancel_reason column so the
--      reason is readable on the row itself, drops the 'cancelled' exclusion
--      so a driver can read their own cancelled assignment (symmetric with
--      how they can already read their own 'completed' rows), and a
--      cancel_acknowledged_at column + driver-writable field (same pattern as
--      the existing driver_acknowledged_at "seen this new assignment" flag)
--      so the future driver UI can show a one-time notice and dismiss it,
--      rather than showing it forever on every 5-second poll.
--
-- Nothing here builds the actual notice UI — that's a deliberate follow-up.
--
-- NON-BREAKING ON PURPOSE: this project shares one Supabase dev project
-- between two people, so applying a migration here affects the other
-- person's running app immediately — before anyone pushes or pulls any code.
-- The old cancel_assignment(p_id) is therefore kept EXACTLY as it was
-- (no reason, no re-auth) alongside the new cancel_assignment(p_id, p_reason).
-- The current admin Cancel button keeps working unchanged. Once the admin UI
-- is updated to call the 2-argument version with a real reason + password
-- step, a follow-up migration drops the 1-argument version — same "add the
-- new path first, retire the old path once everyone's switched" shape as
-- destination_area's part1/part2.
-- ════════════════════════════════════════════════════════════════════════════
begin;

alter table public.assignments
  add column if not exists cancel_reason        text,
  add column if not exists cancel_acknowledged_at timestamptz;

-- ── 1. Driver may now also stamp cancel_acknowledged_at (dismiss the notice) ──
create or replace function public.guard_assignment_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.can_write() then
    return new;
  end if;
  if coalesce(current_setting('app.bypass_driver_guard', true), '') = 'on' then
    return new;
  end if;
  if (to_jsonb(new) - array['task_status', 'issue_reason', 'driver_acknowledged_at', 'cancel_acknowledged_at'])
     is distinct from
     (to_jsonb(old) - array['task_status', 'issue_reason', 'driver_acknowledged_at', 'cancel_acknowledged_at']) then
    raise exception 'drivers may only update status, issue reason and acknowledgement' using errcode = '42501';
  end if;
  if new.task_status not in ('Assigned', 'Picked Up', 'In Transit', 'Delivered', 'Failed / Issue') then
    raise exception 'invalid status for a driver update' using errcode = '42501';
  end if;
  return new;
end $$;

-- ── 2. Driver may read their own cancelled assignment (to see the reason) ──
drop policy if exists assignments_select on public.assignments;
create policy assignments_select on public.assignments for select to authenticated
  using (
    public.is_staff()
    or (driver_id is not null and driver_id = public.my_driver_id())
  );

-- ── 3. cancel_assignment: new 2-argument version requires reason + re-auth.
--       The original 1-argument version is untouched below, so the current
--       admin Cancel button keeps working exactly as it does today. ──
create function public.cancel_assignment(p_id text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.assignments%rowtype;
begin
  if not public.can_write() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if not public.signed_in_recently(300) then raise exception 'reauth_required' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) = 0 or char_length(btrim(p_reason)) > 150 then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  select * into a from public.assignments where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if a.state <> 'active' or a.task_status <> 'Assigned' then
    raise exception 'not_cancellable' using errcode = '42501';
  end if;

  update public.assignments
    set state = 'cancelled', task_status = 'Cancelled', cancel_reason = btrim(p_reason)
    where id = p_id;
  update public.drivers set status = 'Pending'   where id = a.driver_id;
  update public.trucks  set status = 'Available' where id = a.truck_id;

  insert into public.activity_log (id, type, driver_name, truck_plate, assignment_id, destination, company, reason)
  values (
    'act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
    'task_cancelled', a.driver_name, a.truck_plate, p_id, a.destination, a.company, btrim(p_reason)
  );
end $$;

revoke all on function public.cancel_assignment(text, text) from public, anon, authenticated;
grant execute on function public.cancel_assignment(text, text) to authenticated;

commit;
