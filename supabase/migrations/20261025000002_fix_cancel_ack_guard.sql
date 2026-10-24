-- ════════════════════════════════════════════════════════════════════════════
-- Fix: guard_assignment_update() blocked cancel_acknowledged_at writes.
--
-- Manual SQL Editor application only. Shared/production project.
--
-- 20261025000001 widened assignments_update's RLS so a driver can reach their
-- own cancelled row, but the write still failed: guard_assignment_update()
-- (from 20261023000002) unconditionally checks
--   new.task_status not in ('Assigned', 'Picked Up', 'In Transit', 'Delivered', 'Failed / Issue')
-- on every driver update, with no "is it actually changing" guard — unlike
-- every other check in this function. A cancelled row's task_status is
-- 'Cancelled', which isn't in that list, so acknowledging the cancellation
-- (which never touches task_status) still tripped the exception and the
-- write silently failed every time.
--
-- Fix: only run that check when task_status is actually changing, matching
-- the "is distinct from" pattern already used by every other check below it
-- in this same function. Behavior is otherwise identical — a driver still
-- cannot ever set task_status to something outside the allowed list.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.guard_assignment_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.can_write() then return new; end if;
  if coalesce(current_setting('app.bypass_driver_guard', true), '') = 'on' then return new; end if;
  if (to_jsonb(new) - array['task_status', 'issue_reason', 'driver_acknowledged_at', 'cancel_acknowledged_at'])
     is distinct from
     (to_jsonb(old) - array['task_status', 'issue_reason', 'driver_acknowledged_at', 'cancel_acknowledged_at']) then
    raise exception 'drivers may only update status, issue reason and acknowledgement' using errcode = '42501';
  end if;
  if new.task_status is distinct from old.task_status
     and new.task_status not in ('Assigned', 'Picked Up', 'In Transit', 'Delivered', 'Failed / Issue') then
    raise exception 'invalid status for a driver update' using errcode = '42501';
  end if;
  -- a forward status move is blocked while an open blocking issue exists;
  -- reporting Failed / Issue through the legacy path is unaffected
  if new.task_status is distinct from old.task_status
     and new.task_status in ('In Transit', 'Delivered')
     and public.has_open_blocking_issue(new.id) then
    raise exception 'open_blocking_issue' using errcode = '42501';
  end if;
  if new.task_status is distinct from old.task_status and not (
       (old.task_status = 'Picked Up'  and new.task_status = 'In Transit')
    or (old.task_status = 'In Transit' and new.task_status = 'Delivered' and old.operational_stage = 'unloaded')
    or (old.task_status in ('Assigned', 'Picked Up', 'In Transit') and new.task_status = 'Failed / Issue')
  ) then
    raise exception 'invalid_status_transition' using errcode = '42501';
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
commit;
