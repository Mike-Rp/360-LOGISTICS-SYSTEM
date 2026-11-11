-- ════════════════════════════════════════════════════════════════════════════
-- Archiving a truck now needs the OPM's password, exactly like archiving a driver.
--
-- Manual SQL Editor application only. Shared/production project.
--
-- archive_driver() has refused since 20260924000000 unless the caller typed their password in
-- the last 5 minutes (signed_in_recently(300) → 'reauth_required'). archive_truck() was written
-- without that check, and the screen's truck dialog had the password prompt switched off, so
-- a truck could be archived with one click while a driver could not. The screen alone is not a
-- gate (the database function is callable directly), so the rule is added HERE and the dialog
-- is changed to ask for the password.
--
-- The ONLY change from 20261018000003: one added line,
--     if not public.signed_in_recently(300) then raise exception 'reauth_required' …
-- placed right after the OPM check, the same position and wording as archive_driver().
-- Everything else is identical: OPM-only, not_found / already_archived / truck_busy, the
-- archived_at + status update, the activity-log row. Grants are kept by create or replace.
--
-- Safety check first: if the live archive_truck() is not the version this file was written
-- against (or already asks for the password), the migration stops and changes nothing.
-- ════════════════════════════════════════════════════════════════════════════
begin;

do $$
begin
  if not exists (select 1 from pg_proc
                  where oid = to_regprocedure('public.archive_truck(text)')
                    and prosrc like '%is_opm()%' and prosrc like '%truck_busy%' and prosrc like '%truck_archived%') then
    raise exception 'archive truck: live archive_truck() is not the expected version — stop and compare it with 20261018000003';
  end if;
  if exists (select 1 from pg_proc
              where oid = to_regprocedure('public.archive_truck(text)') and prosrc like '%signed_in_recently%') then
    raise exception 'archive truck: archive_truck() already asks for the password';
  end if;
end $$;

create or replace function public.archive_truck(p_truck_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.trucks%rowtype;
begin
  if not public.is_opm() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if not public.signed_in_recently(300) then raise exception 'reauth_required' using errcode = '42501'; end if;

  select * into t from public.trucks where id = p_truck_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if t.archived_at is not null then raise exception 'already_archived' using errcode = '22023'; end if;
  if exists (select 1 from public.assignments a where a.truck_id = p_truck_id and a.state = 'active') then
    raise exception 'truck_busy' using errcode = '22023';
  end if;

  update public.trucks set archived_at = now(), status = 'Available' where id = p_truck_id;

  insert into public.activity_log (id, type, truck_plate)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'truck_archived', t.plate_number);
end $$;

notify pgrst, 'reload schema';
commit;
