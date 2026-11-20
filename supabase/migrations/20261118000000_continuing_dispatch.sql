-- Continuing Dispatch: a new assignment from one verified Completed source.
-- Apply only to the intended Supabase project after review; do not re-run this file.
-- Normal dispatch_assignment(jsonb) remains unchanged.
begin;

alter table public.assignments
  add column continuation_source_id text,
  add column continuation_reviewed_by uuid references auth.users(id) on delete set null,
  add column continuation_reviewed_at timestamptz,
  -- Deferred NO ACTION preserves history while allowing reset_all_data() to
  -- delete all assignments in one statement.
  add constraint assignments_continuation_source_fk foreign key (continuation_source_id)
    references public.assignments(id) on delete no action deferrable initially deferred,
  add constraint assignments_continuation_not_self check (
    continuation_source_id is null or continuation_source_id <> id
  ),
  add constraint assignments_continuation_review_complete check (
    (continuation_source_id is null and continuation_reviewed_at is null)
    or (continuation_source_id is not null and continuation_reviewed_at is not null)
  );

-- A completed ASN may start one continuation. Later deliveries can themselves
-- become sources once they are officially completed.
create unique index assignments_one_continuation_per_source
  on public.assignments (continuation_source_id)
  where continuation_source_id is not null;

-- The relationship and CSR review record may only be set by the verified RPC.
create function public.guard_assignment_continuation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.continuation_source_id is not null or new.continuation_reviewed_by is not null
       or new.continuation_reviewed_at is not null then
      raise exception 'not_authorized' using errcode = '42501';
    end if;
  elsif exists (select 1 from public.assignments child
       where child.continuation_source_id = old.id)
     and (new.state is distinct from old.state or new.task_status is distinct from old.task_status
       or new.driver_id is distinct from old.driver_id or new.truck_id is distinct from old.truck_id) then
    raise exception 'not_authorized' using errcode = '42501';
  elsif new.continuation_source_id is distinct from old.continuation_source_id
     or new.continuation_reviewed_by is distinct from old.continuation_reviewed_by
     or new.continuation_reviewed_at is distinct from old.continuation_reviewed_at then
    if old.continuation_source_id is not null
       or coalesce(current_setting('app.verified_continuation_id', true), '') <> new.id
       or new.continuation_source_id is null
       or new.continuation_reviewed_by is distinct from auth.uid()
       or new.continuation_reviewed_at is null then
      raise exception 'not_authorized' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger assignments_continuation_guard
  before insert or update of continuation_source_id, continuation_reviewed_by, continuation_reviewed_at,
    state, task_status, driver_id, truck_id
  on public.assignments for each row execute function public.guard_assignment_continuation();

-- The UI asks this read-only capability check before offering submission. A
-- missing RPC means the migration has not been applied to that environment.
create function public.continuing_dispatch_capability() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_write();
$$;

create function public.dispatch_continuing_assignment(
  p_source_id text, p_fields jsonb, p_operational_review_confirmed boolean
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  source public.assignments%rowtype;
  d public.drivers%rowtype;
  t public.trucks%rowtype;
  doc_types text[] := array['Proof of Delivery', 'Receiving Acknowledgement Report', 'Dispatch Slip',
                            'Sales Invoice', 'Bill of Lading', 'Waybill / Delivery Receipt'];
  v_id text;
begin
  if not public.can_write() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if p_operational_review_confirmed is distinct from true then
    raise exception 'operational_review_required' using errcode = '22023';
  end if;
  if p_source_id is null or btrim(p_source_id) = '' then
    raise exception 'source_required' using errcode = '22023';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'invalid_fields' using errcode = '22023';
  end if;

  -- Lock the source before checking reuse. Concurrent attempts for one source
  -- serialize here; the unique index is an additional integrity backstop.
  select * into source from public.assignments where id = p_source_id for update;
  if not found then raise exception 'source_not_found' using errcode = 'P0002'; end if;
  if source.state <> 'completed' or source.task_status <> 'Delivered'
     or source.completed_at_utc is null then
    raise exception 'source_not_completed' using errcode = '22023';
  end if;
  if source.driver_id is null or source.truck_id is null then
    raise exception 'source_pair_missing' using errcode = '22023';
  end if;
  -- Document review updates these same rows. Lock them so their approval state
  -- cannot change between this check and creation of the new assignment.
  perform 1 from public.assignment_documents doc
    where doc.assignment_id = source.id order by doc.type for update;
  if (select count(*) from public.assignment_documents doc
      where doc.assignment_id = source.id and doc.type = any(doc_types)
        and doc.uploaded and doc.doc_status = 'approved') <> array_length(doc_types, 1) then
    raise exception 'source_documents_not_approved' using errcode = '22023';
  end if;
  if coalesce(p_fields ->> 'driver_id', '') <> source.driver_id
     or coalesce(p_fields ->> 'truck_id', '') <> source.truck_id then
    raise exception 'source_pair_mismatch' using errcode = '22023';
  end if;
  if exists (select 1 from public.assignments newer
      where newer.id <> source.id
        and (newer.driver_id = source.driver_id or newer.truck_id = source.truck_id)
        and (newer.created_at >= source.created_at
          or newer.completed_at_utc >= source.completed_at_utc
          or newer.cancelled_at >= source.completed_at_utc))
     or exists (select 1 from public.assignments child
      where child.continuation_source_id = source.id) then
    raise exception 'source_stale' using errcode = '22023';
  end if;

  -- Match the lock order in dispatch_assignment: driver, then truck. Its own
  -- checks and the availability trigger run again inside the same transaction.
  select * into d from public.drivers where id = source.driver_id for update;
  if not found or d.archived_at is not null then
    raise exception 'driver_archived' using errcode = '22023';
  end if;
  select * into t from public.trucks where id = source.truck_id for update;
  if not found or t.archived_at is not null then
    raise exception 'truck_archived' using errcode = '22023';
  end if;
  if public.driver_is_unavailable(d.id) then
    raise exception 'driver_unavailable' using errcode = '22023';
  end if;
  if public.truck_is_in_maintenance(t.id) then
    raise exception 'truck_under_maintenance' using errcode = '22023';
  end if;
  if exists (select 1 from public.assignments a where a.state = 'active' and a.driver_id = d.id) then
    raise exception 'driver_busy' using errcode = '22023';
  end if;
  if t.status <> 'Available'
     or exists (select 1 from public.assignments a where a.state = 'active' and a.truck_id = t.id) then
    raise exception 'truck_unavailable' using errcode = '22023';
  end if;

  -- Reuse the existing atomic creation, document slots, audit and driver notice.
  v_id := public.dispatch_assignment(p_fields);
  perform set_config('app.verified_continuation_id', v_id, true);
  update public.assignments set continuation_source_id = source.id,
    continuation_reviewed_by = auth.uid(), continuation_reviewed_at = now()
    where id = v_id;
  perform set_config('app.verified_continuation_id', '', true);
  return v_id;
end $$;

revoke all on function public.guard_assignment_continuation() from public, anon, authenticated;
revoke all on function public.continuing_dispatch_capability() from public, anon, authenticated;
revoke all on function public.dispatch_continuing_assignment(text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.continuing_dispatch_capability() to authenticated;
grant execute on function public.dispatch_continuing_assignment(text, jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
