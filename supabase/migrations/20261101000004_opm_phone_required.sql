-- ════════════════════════════════════════════════════════════════════════════
-- REQ-018 follow-up — there is no built-in help number any more, and the OPM's number
-- cannot be emptied.
--
-- The driver's "Forgot your PIN?" screen used to fall back to a number written into the app's
-- code. That is removed: the screen now shows the covering coverage's number, else the OPM's
-- profile number, and if neither exists it shows plain wording with no number.
--
-- So the OPM's number must not be blank once set: set_own_phone() now refuses an empty value
-- ('phone_required'). Everything else in it is exactly 20261101000003 (OPM only, fresh password,
-- 09XXXXXXXXX format, logged as 'driver_help_phone_changed'). The one-off "Cleared" log wording
-- goes with the clearing feature. driver_help_phone() is unchanged.
--
-- Manual SQL Editor application only. Shared/production project.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.set_own_phone(p_phone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_raw   text := btrim(coalesce(p_phone, ''));
  v_phone text;
begin
  if not public.is_opm() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if not public.signed_in_recently(300) then raise exception 'reauth_required' using errcode = '42501'; end if;

  if v_raw = '' then raise exception 'phone_required' using errcode = '22023'; end if;

  v_phone := public.normalise_mobile(v_raw);
  if v_phone !~ '^09\d{9}$' then raise exception 'invalid_phone' using errcode = '22023'; end if;

  update public.profiles set phone = v_phone where id = auth.uid();

  insert into public.activity_log (id, type, reason)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'driver_help_phone_changed', 'Now ' || v_phone);

  return jsonb_build_object('id', auth.uid(), 'phone', v_phone);
end $$;

notify pgrst, 'reload schema';
commit;
