-- ════════════════════════════════════════════════════════════════════════════
-- Driver notifications for document approve/reject — closes the gap
-- deliberately deferred in REQ-014 (20261025000003_driver_notifications.sql)
-- and independently re-flagged by a collaborator's own backlog entry
-- ("DRIVER UI CHANGES - REQ16 follow-up").
--
-- Manual SQL Editor application only. Shared/production project.
--
-- At the time REQ-014 was built, document approve/reject only existed on
-- the untrusted client-driven auto-save path, so a driver notification was
-- deferred rather than bolted onto it. approve_document()/reject_document()
-- (20261025000006_document_review_rpcs.sql) closed that gap since, so this
-- is now a small, direct extension of them — one more idempotent
-- notifications insert each, same deterministic-id/on-conflict pattern as
-- the other 3 driver notification events. Nothing else about either
-- function changes.
-- ════════════════════════════════════════════════════════════════════════════
begin;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('doc_upload', 'status_update', 'delay_report', 'issue_report',
                   'driver_dispatched', 'driver_cancelled', 'driver_issue_resolved',
                   'driver_doc_approved', 'driver_doc_rejected'));

create or replace function public.approve_document(p_assignment_id text, p_doc_type text) returns void
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

  -- added: driver-targeted notification
  if a.driver_id is not null then
    insert into public.notifications
      (id, type, message, assignment_id, driver_name, truck_plate, doc_type, read, time_label, navigate_to, recipient_driver_id)
    values
      ('notif-docapproved-' || p_assignment_id || '-' || p_doc_type, 'driver_doc_approved',
       'Your "' || p_doc_type || '" document for ' || p_assignment_id || ' was approved.',
       p_assignment_id, a.driver_name, a.truck_plate, p_doc_type, false,
       to_char(now() at time zone 'Asia/Manila', 'Mon FMDD, HH12:MI AM'), null, a.driver_id)
    on conflict (id) do nothing;
  end if;
end $$;

create or replace function public.reject_document(p_assignment_id text, p_doc_type text, p_reason text) returns void
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

  -- added: driver-targeted notification
  if a.driver_id is not null then
    insert into public.notifications
      (id, type, message, assignment_id, driver_name, truck_plate, doc_type, reason, read, time_label, navigate_to, recipient_driver_id)
    values
      ('notif-docrejected-' || p_assignment_id || '-' || p_doc_type, 'driver_doc_rejected',
       'Your "' || p_doc_type || '" document for ' || p_assignment_id || ' was rejected: ' || v_reason,
       p_assignment_id, a.driver_name, a.truck_plate, p_doc_type, v_reason, false,
       to_char(now() at time zone 'Asia/Manila', 'Mon FMDD, HH12:MI AM'), null, a.driver_id)
    on conflict (id) do nothing;
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
