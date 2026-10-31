-- ════════════════════════════════════════════════════════════════════════════
-- Password-reset-request notifications are OPM-only at the database level.
-- 20261027000001 put them in the shared `notifications` table, which every
-- staff role could read (notifs_select = is_staff()). The screen hid them from
-- non-OPM roles, but a CSR could still read other members' reset requests
-- straight from the API. Now only the Operation Manager can SELECT them.
--
-- notifs_select is otherwise exactly the previous version
-- (20261025000003): staff read everything else, drivers read their own rows.
--
-- Manual SQL Editor application only. Shared/production project.
-- ════════════════════════════════════════════════════════════════════════════
begin;

drop policy if exists notifs_select on public.notifications;
create policy notifs_select on public.notifications for select to authenticated
  using (
    (public.is_staff() and (type <> 'password_reset_requested' or public.is_opm()))
    or (recipient_driver_id is not null and recipient_driver_id = public.my_driver_id())
  );

notify pgrst, 'reload schema';
commit;
