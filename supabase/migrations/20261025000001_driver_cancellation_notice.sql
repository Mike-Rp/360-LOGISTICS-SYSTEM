-- ════════════════════════════════════════════════════════════════════════════
-- Driver-visible cancellation notice — the write side.
--
-- Manual SQL Editor application only. Shared/production project.
--
-- REQ-003's own 20261018000002 migration already did most of this: it added
-- cancel_reason/cancel_acknowledged_at, made cancel_acknowledged_at a
-- driver-writable column in guard_assignment_update()'s allow-list, and
-- dropped the old "state <> 'cancelled'" exclusion from assignments_select —
-- so a driver can already READ their own cancelled assignment and its
-- reason today. What was never fixed: assignments_update's USING clause
-- still requires state = 'active' for a driver, so they can never reach a
-- cancelled row to actually SET cancel_acknowledged_at and dismiss the
-- notice — RLS blocks it before the already-correct column guard even runs.
--
-- Fix: widen the driver branch to also allow state = 'cancelled'. This does
-- NOT widen which columns a driver may change — guard_assignment_update()
-- still restricts them to task_status/issue_reason/driver_acknowledged_at/
-- cancel_acknowledged_at regardless of row state, exactly as it already does
-- for 'active' rows. Nothing else about assignments_update changes.
-- ════════════════════════════════════════════════════════════════════════════
begin;

drop policy if exists assignments_update on public.assignments;
create policy assignments_update on public.assignments for update to authenticated
  using (
    public.can_write()
    or (driver_id is not null and driver_id = public.my_driver_id() and state in ('active', 'cancelled'))
  )
  with check (
    public.can_write()
    or (driver_id is not null and driver_id = public.my_driver_id())
  );

commit;
