-- ════════════════════════════════════════════════════════════════════════════
-- Merge CSR password-reset-request alerts into the regular staff notification
-- feed, replacing the separate live-polled "Pending Password Reset Requests"
-- section that used to live only in the bell dropdown (Header.tsx). OPM now
-- sees these the same way as every other notification type: in the normal
-- chronological feed, with read/unread state persisted like the rest.
--
-- Manual SQL Editor application only. Shared/production project.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- 1. notifications.assignment_id must become nullable — this new type has no assignment.
alter table public.notifications alter column assignment_id drop not null;

-- 2. Link a notification back to the reset request it's about.
alter table public.notifications
  add column if not exists reset_request_id uuid references public.csr_password_reset_requests(id);

-- 3. Widen the type check to allow the new type.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('doc_upload', 'status_update', 'delay_report', 'issue_report',
                   'driver_dispatched', 'driver_cancelled', 'driver_issue_resolved',
                   'driver_doc_approved', 'driver_doc_rejected',
                   'password_reset_requested'));

-- 4. request_csr_password_reset(): unchanged logic, plus one new idempotent
--    notifications insert capturing the new request's id.
create or replace function public.request_csr_password_reset(p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_profile public.profiles%rowtype;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_request_id uuid;
begin
  if length(v_email) > 320 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then return; end if;
  select p.* into v_profile from public.profiles p
    join auth.users u on u.id = p.id
    where lower(p.email) = v_email and lower(u.email) = v_email
      and p.role = 'csr' and p.status = 'active' limit 1;
  if not found then return; end if;
  update public.csr_password_reset_requests
     set status = 'expired', reset_token_hash = null, reset_token_claimed_at = null
    where user_id = v_profile.id and status = 'approved' and expires_at <= now();
  if exists (select 1 from public.csr_password_reset_requests
    where user_id = v_profile.id and status in ('pending', 'approved')) then return; end if;
  if exists (select 1 from public.csr_password_reset_requests
    where user_id = v_profile.id and requested_at > now() - interval '15 minutes') then return; end if;
  insert into public.csr_password_reset_requests(user_id, requested_email)
    values (v_profile.id, v_email)
    returning id into v_request_id;
  insert into public.activity_log(id, type, ts, member_name, member_email)
    values (gen_random_uuid()::text, 'password_reset_requested', now(), v_profile.name, v_email);
  insert into public.notifications
    (id, type, message, assignment_id, read, time_label, reset_request_id)
  values
    ('notif-resetreq-' || v_request_id, 'password_reset_requested',
     v_email || ' requested a password reset.', null, false,
     to_char(now() at time zone 'Asia/Manila', 'Mon FMDD, HH12:MI AM'), v_request_id)
  on conflict (id) do nothing;
exception when unique_violation then
  return;
end $$;

-- 5. Backfill: any request still pending right now predates this change and
--    would otherwise have no notification row, making it invisible in the
--    merged feed. Give each one a matching notification.
insert into public.notifications (id, type, message, assignment_id, read, time_label, reset_request_id)
select 'notif-resetreq-' || r.id, 'password_reset_requested',
       r.requested_email || ' requested a password reset.', null, false,
       to_char(r.requested_at at time zone 'Asia/Manila', 'Mon FMDD, HH12:MI AM'), r.id
  from public.csr_password_reset_requests r
  where r.status = 'pending'
on conflict (id) do nothing;

notify pgrst, 'reload schema';
commit;
