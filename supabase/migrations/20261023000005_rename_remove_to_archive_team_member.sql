-- ════════════════════════════════════════════════════════════════════════════
-- Rename remove_team_member() -> archive_team_member().
--
-- Manual SQL Editor application only. Shared/production project.
--
-- Project requirement: the system must never expose a "remove" action/function
-- for team members, only "archive" (matches the archive_driver()/archive_truck()
-- naming this schema already uses). The function already only archives
-- (profiles.status = 'removed', never a delete — see
-- 20261023000004_team_member_archive_restore.sql) — this migration is a rename
-- plus matching the error code to the existing already_archived convention,
-- not a behavior change.
--
-- ALTER FUNCTION ... RENAME TO keeps the existing grants, so no new
-- revoke/grant is needed. The body is then replaced only to swap its two
-- string literals (activity_log type, and the already-X error code).
-- ════════════════════════════════════════════════════════════════════════════
begin;

alter function public.remove_team_member(uuid) rename to archive_team_member;

create or replace function public.archive_team_member(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.profiles%rowtype;
begin
  if not public.is_opm() then raise exception 'not_authorized' using errcode = '42501'; end if;
  select * into p from public.profiles where id = p_id and role = 'csr' for update;
  if not found then raise exception 'member_not_found' using errcode = 'P0002'; end if;
  if p.status = 'removed' then raise exception 'already_archived' using errcode = '22023'; end if;

  update public.profiles set status = 'removed' where id = p_id;

  insert into public.activity_log (id, type, member_name, member_email)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'member_archived', p.name, p.email);
end $$;

commit;
