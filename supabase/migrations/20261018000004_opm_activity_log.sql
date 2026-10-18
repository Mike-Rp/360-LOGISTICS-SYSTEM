-- ════════════════════════════════════════════════════════════════════════════
-- Fix for REQ-004: OPM couldn't write to activity_log.
--
-- create_team_member() and the other OPM-exclusive functions (archive_driver,
-- archive_truck, reset_driver_pin) are SECURITY DEFINER and already insert
-- their own activity_log row directly, bypassing RLS entirely — those were
-- never affected. The bug is the FRONTEND's generic activity logger
-- (syncAdminData() in db.ts, used for actions without a dedicated backend
-- function, e.g. "member_added" after create_team_member succeeds): it does
-- a plain table insert, gated by activity_log's own RLS policy, which only
-- allowed can_write() (admin/csr) — not opm. The account itself was created
-- successfully; only the audit-log write afterward failed.
--
-- This only widens WHO may INSERT an audit-log row (still append-only, no
-- update/delete policy exists) — it does not grant OPM any new operational
-- access anywhere else.
-- ════════════════════════════════════════════════════════════════════════════
begin;

drop policy if exists activity_insert on public.activity_log;
create policy activity_insert on public.activity_log for insert to authenticated
  with check (public.can_write() or public.is_opm());

commit;
