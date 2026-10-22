-- ════════════════════════════════════════════════════════════════════════════
-- Require a fresh password re-entry before archive_team_member()/
-- restore_team_member()/resolve_assignment_issue() take effect — same
-- signed_in_recently(300) guard archive_driver()/reset_driver_pin() already
-- use.
--
-- Manual SQL Editor application only. Shared/production project.
--
-- The frontend pairs this with the existing ConfirmPasswordDialog (the same
-- one already used for driver archive/PIN reset, now reused for all three):
-- it calls verifyOwnPassword() — a real Supabase Auth sign-in — right before
-- calling the RPC, which refreshes the JWT's password-method timestamp
-- signed_in_recently() reads. So a normal confirm-dialog flow never has to
-- re-type anything twice; this check exists so none of these three RPCs can
-- be called straight from the console without a password re-entered in the
-- last 5 minutes, same as the driver actions.
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

  insert into public.activity_log (id, type, member_name, member_email)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'member_archived', p.name, p.email);
end $$;

create or replace function public.restore_team_member(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.profiles%rowtype;
begin
  if not public.is_opm() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if not public.signed_in_recently(300) then raise exception 'reauth_required' using errcode = '42501'; end if;
  select * into p from public.profiles where id = p_id and role = 'csr' for update;
  if not found then raise exception 'member_not_found' using errcode = 'P0002'; end if;
  if p.status = 'active' then raise exception 'already_active' using errcode = '22023'; end if;

  update public.profiles set status = 'active' where id = p_id;

  insert into public.activity_log (id, type, member_name, member_email)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'member_restored', p.name, p.email);
end $$;

create or replace function public.resolve_assignment_issue(p_issue_id bigint, p_resolution_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  iss             public.assignment_issues%rowtype;
  a               public.assignments%rowtype;
  v_resolver_name text;
  v_note          text := nullif(btrim(coalesce(p_resolution_note, '')), '');
begin
  if not public.can_write() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if not public.signed_in_recently(300) then raise exception 'reauth_required' using errcode = '42501'; end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'note_too_long' using errcode = '22023';
  end if;

  select * into iss from public.assignment_issues where id = p_issue_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;

  select * into a from public.assignments where id = iss.assignment_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if a.state <> 'active' then raise exception 'assignment_not_active' using errcode = '42501'; end if;
  if iss.status <> 'open' then raise exception 'already_resolved' using errcode = '42501'; end if;

  select name into v_resolver_name from public.profiles where id = auth.uid();

  update public.assignment_issues
    set status = 'resolved', resolved_at = now(), resolved_by_user_id = auth.uid(),
        resolved_by_name = v_resolver_name, resolution_note = v_note, updated_at = now()
    where id = p_issue_id;

  insert into public.activity_log (id, type, driver_name, truck_plate, assignment_id, reason, issue_id)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'issue_resolved', a.driver_name, a.truck_plate, iss.assignment_id, v_note, p_issue_id);

  return jsonb_build_object(
    'id', iss.id, 'assignmentId', iss.assignment_id, 'status', 'resolved',
    'resolvedAt', now(), 'resolvedBy', v_resolver_name, 'resolutionNote', v_note
  );
end $$;

commit;
