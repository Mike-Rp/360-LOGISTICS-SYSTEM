-- ════════════════════════════════════════════════════════════════════════════
-- Activity-log gap: reset_driver_pin() currently writes no log row at all —
-- not even through the client's auto-save, unlike archive_driver()/
-- archive_truck(), which already log atomically in the same transaction.
--
-- Manual SQL Editor application only. Shared/production project.
--
-- Adds one activity_log row ('driver_pin_reset', driver_name only) inside the
-- existing RPC, same pattern as archive_driver()/archive_truck(). Never logs
-- the PIN itself — same rule this project has followed everywhere else PINs/
-- passwords/tokens are involved.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.reset_driver_pin(p_driver_id text, p_pin text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_phone text; v_name text;
begin
  if not public.is_opm() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if not public.signed_in_recently(300) then raise exception 'reauth_required' using errcode = '42501'; end if;
  select phone, name into v_phone, v_name from public.drivers where id = p_driver_id and archived_at is null;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.sync_driver_login(p_driver_id, v_phone, p_pin);

  insert into public.activity_log (id, type, driver_name)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'driver_pin_reset', v_name);
end $$;

commit;
