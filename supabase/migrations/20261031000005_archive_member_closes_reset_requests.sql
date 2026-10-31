-- ════════════════════════════════════════════════════════════════════════════
-- Archiving a team member now closes their open password-reset / setup requests.
-- Before, an archived member's approved request stayed "Approved" with a
-- "Copy Reset Link" button, and clicking it failed with member_not_eligible
-- (the account is no longer active). Now archiving marks any pending or
-- approved request Expired and wipes its link, so nothing stale is offered.
--
-- archive_team_member() is otherwise exactly the previous version
-- (20261023000006). Restoring a member does not revive old requests — a new
-- one has to be made (the member can use Forgot Password, which OPM approves).
--
-- Manual SQL Editor application only. Shared/production project.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.archive_team_member(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.profiles%rowtype;
begin
  if not public.is_opm() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if not public.signed_in_recently(300) then raise exception 'reauth_required' using errcode = '42501'; end if;
  select * into p from public.profiles where id = p_id and role = 'csr' for update;
  if not found then raise exception 'member_not_found' using errcode = 'P0002'; end if;
  if p.status = 'removed' then raise exception 'already_archived' using errcode = '22023'; end if;

  update public.profiles set status = 'removed' where id = p_id;

  -- Close any open request (link wiped) so no dead "Copy Reset Link" is left behind.
  update public.csr_password_reset_requests
     set status = 'expired', reset_token_hash = null, reset_token_claimed_at = null
   where user_id = p_id and status in ('pending', 'approved');

  insert into public.activity_log (id, type, member_name, member_email)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'member_archived', p.name, p.email);
end $$;

-- One-time cleanup: requests left open by members who were already archived.
update public.csr_password_reset_requests r
   set status = 'expired', reset_token_hash = null, reset_token_claimed_at = null
 where r.status in ('pending', 'approved')
   and exists (select 1 from public.profiles p where p.id = r.user_id and p.status <> 'active');

notify pgrst, 'reload schema';
commit;
