-- ════════════════════════════════════════════════════════════════════════════
-- REQ-004 follow-up (1 of 3) — Document approve/reject as atomic RPCs.
--
-- Manual SQL Editor application only. Shared/production project.
--
-- Previously, clicking Approve/Reject in View Shipment only updated local
-- React state; a separate generic auto-save process (syncAdminData) later
-- diffed and wrote whatever changed, including a client-built activity_log
-- row. Nothing guaranteed the status change and its log entry happened
-- together, and nothing re-checked server-side that the document was still
-- pending at the moment of review.
--
-- approve_document()/reject_document() change doc_status and write the
-- activity_log row in one transaction. A guard trigger (same transaction-
-- local-flag technique used throughout this project — see
-- guard_assignment_cancel(), guard_assignment_insert()) then closes the old
-- direct-write path: doc_status/reject_reason can no longer change except
-- through these two functions. The driver's own document re-upload path
-- (file_url/uploaded/uploaded_at only) is completely untouched — it was
-- never part of this guard and still works exactly as before.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create function public.approve_document(p_assignment_id text, p_doc_type text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.assignment_documents%rowtype;
  a public.assignments%rowtype;
  v_admin_email text;
  v_admin_role  text;
begin
  if not public.can_write() then raise exception 'not_authorized' using errcode = '42501'; end if;

  select * into d from public.assignment_documents
    where assignment_id = p_assignment_id and type = p_doc_type for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not d.uploaded then raise exception 'not_uploaded' using errcode = '42501'; end if;
  if d.doc_status <> 'pending' then raise exception 'already_reviewed' using errcode = '42501'; end if;

  select * into a from public.assignments where id = p_assignment_id;
  select p.email, p.role into v_admin_email, v_admin_role from public.profiles p where p.id = auth.uid();

  perform set_config('app.verified_doc_review_id', p_assignment_id || ':' || p_doc_type, true);
  update public.assignment_documents set doc_status = 'approved', reject_reason = null
    where assignment_id = p_assignment_id and type = p_doc_type;
  perform set_config('app.verified_doc_review_id', '', true);

  insert into public.activity_log (id, type, admin_email, admin_role, driver_name, truck_plate, assignment_id, doc_type)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'doc_approved', v_admin_email, v_admin_role, a.driver_name, a.truck_plate, p_assignment_id, p_doc_type);
end $$;

create function public.reject_document(p_assignment_id text, p_doc_type text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.assignment_documents%rowtype;
  a public.assignments%rowtype;
  v_reason      text := btrim(coalesce(p_reason, ''));
  v_admin_email text;
  v_admin_role  text;
begin
  if not public.can_write() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if v_reason = '' then raise exception 'invalid_reason' using errcode = '22023'; end if;
  if char_length(v_reason) > 300 then raise exception 'invalid_reason' using errcode = '22023'; end if;

  select * into d from public.assignment_documents
    where assignment_id = p_assignment_id and type = p_doc_type for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not d.uploaded then raise exception 'not_uploaded' using errcode = '42501'; end if;
  if d.doc_status <> 'pending' then raise exception 'already_reviewed' using errcode = '42501'; end if;

  select * into a from public.assignments where id = p_assignment_id;
  select p.email, p.role into v_admin_email, v_admin_role from public.profiles p where p.id = auth.uid();

  perform set_config('app.verified_doc_review_id', p_assignment_id || ':' || p_doc_type, true);
  update public.assignment_documents set doc_status = 'rejected', reject_reason = v_reason
    where assignment_id = p_assignment_id and type = p_doc_type;
  perform set_config('app.verified_doc_review_id', '', true);

  insert into public.activity_log (id, type, admin_email, admin_role, driver_name, truck_plate, assignment_id, doc_type, reject_reason)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'doc_rejected', v_admin_email, v_admin_role, a.driver_name, a.truck_plate, p_assignment_id, p_doc_type, v_reason);
end $$;

-- ── Guard: doc_status/reject_reason can only change through the two functions above ──
create function public.guard_document_review() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  if (new.doc_status is distinct from old.doc_status or new.reject_reason is distinct from old.reject_reason)
     and coalesce(current_setting('app.verified_doc_review_id', true), '') <> (new.assignment_id || ':' || new.type) then
    raise exception 'doc_status may only change through approve_document()/reject_document()' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger assignment_documents_guard_review before update on public.assignment_documents
  for each row execute function public.guard_document_review();

grant execute on function public.approve_document(text, text) to authenticated;
grant execute on function public.reject_document(text, text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
