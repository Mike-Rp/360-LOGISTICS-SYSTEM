-- ════════════════════════════════════════════════════════════════════════════
-- Team member archive / restore, instead of a hard delete.
--
-- Manual SQL Editor application only. Shared/production project.
--
-- remove_team_member() currently does `delete from auth.users where id = p_id`,
-- which cascades to `profiles` (profiles.id references auth.users(id) on delete
-- cascade) — irreversible, and it erases whatever attribution that account had
-- on past activity_log rows. Unlike drivers (a separate row from their auth
-- user, linked by a nullable FK, so archive_driver() can delete the login while
-- keeping the driver row), a team member's profile IS the auth user's row, so
-- it can't be deleted without losing the profile too.
--
-- profiles.status already allows 'active' / 'removed' (unused by this path
-- until now) and every staff privilege check (is_staff(), can_write()) already
-- requires status = 'active' — so flipping status alone immediately revokes
-- all app-level access on the member's next request, without touching their
-- Supabase Auth login. The frontend's Team Members "Active" / "Archived" tabs
-- already exist and already expect exactly this (WorkspaceSettingsPanel.tsx
-- filters `members` by `member.status`, and listTeamMembers() already queries
-- by role only, no status filter) — they've just had nothing to show, since
-- nothing ever left a 'removed' row behind.
--
--   remove_team_member(p_id)  — OPM only. Sets status = 'removed'. Refuses an
--                                already-removed member. Logs 'member_removed'.
--   restore_team_member(p_id) — OPM only (new). Sets status = 'active'. Refuses
--                                an already-active member. Logs 'member_restored'.
--
-- Not in scope here: create_team_member() still writes no activity_log row at
-- all (a pre-existing gap, same category as the "Activity-log gaps" backlog
-- item) — left alone rather than expanding this change.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.remove_team_member(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.profiles%rowtype;
begin
  if not public.is_opm() then raise exception 'not_authorized' using errcode = '42501'; end if;
  select * into p from public.profiles where id = p_id and role = 'csr' for update;
  if not found then raise exception 'member_not_found' using errcode = 'P0002'; end if;
  if p.status = 'removed' then raise exception 'already_removed' using errcode = '22023'; end if;

  update public.profiles set status = 'removed' where id = p_id;

  insert into public.activity_log (id, type, member_name, member_email)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'member_removed', p.name, p.email);
end $$;

create function public.restore_team_member(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.profiles%rowtype;
begin
  if not public.is_opm() then raise exception 'not_authorized' using errcode = '42501'; end if;
  select * into p from public.profiles where id = p_id and role = 'csr' for update;
  if not found then raise exception 'member_not_found' using errcode = 'P0002'; end if;
  if p.status = 'active' then raise exception 'already_active' using errcode = '22023'; end if;

  update public.profiles set status = 'active' where id = p_id;

  insert into public.activity_log (id, type, member_name, member_email)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'member_restored', p.name, p.email);
end $$;

revoke all on function public.restore_team_member(uuid) from public, anon;
grant execute on function public.restore_team_member(uuid) to authenticated;

commit;
