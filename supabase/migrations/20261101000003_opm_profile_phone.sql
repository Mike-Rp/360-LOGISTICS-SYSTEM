-- ════════════════════════════════════════════════════════════════════════════
-- REQ-018 follow-up — the driver's "Forgot your PIN?" number is the OPM's profile number.
--
-- The usual number was written into the app's code (LoginScreen.tsx), so if the OPM changed
-- their phone, drivers kept seeing the old one until a developer redeployed. Now the OPM keeps
-- it in their own profile settings:
--
--   • profiles.phone — local format '09XXXXXXXXX', optional.
--   • set_own_phone() — OPM only, needs a password entered in the last 5 minutes (it decides
--     what every driver is told to dial, so a hijacked session must not be able to swap it
--     silently). An empty value clears it. Logged as 'driver_help_phone_changed'.
--   • driver_help_phone() (public, used before login) now returns, in this order:
--       1. the number of the newest active PIN-reset leave coverage, else
--       2. the active OPM's profile number, else
--       3. null — the login screen then keeps its built-in number as a last resort.
--     Still only a phone number: no names, no account details.
--
-- Manual SQL Editor application only. Shared/production project.
-- ════════════════════════════════════════════════════════════════════════════
begin;

alter table public.profiles add column phone text;
alter table public.profiles
  add constraint profiles_phone_format check (phone is null or phone ~ '^09\d{9}$');

create function public.set_own_phone(p_phone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_raw   text := btrim(coalesce(p_phone, ''));
  v_phone text;
begin
  if not public.is_opm() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if not public.signed_in_recently(300) then raise exception 'reauth_required' using errcode = '42501'; end if;

  if v_raw = '' then
    v_phone := null;                                       -- clearing it: drivers fall back to the built-in number
  else
    v_phone := public.normalise_mobile(v_raw);
    if v_phone !~ '^09\d{9}$' then raise exception 'invalid_phone' using errcode = '22023'; end if;
  end if;

  update public.profiles set phone = v_phone where id = auth.uid();

  insert into public.activity_log (id, type, reason)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'driver_help_phone_changed',
          case when v_phone is null then 'Cleared — drivers see the built-in number' else 'Now ' || v_phone end);

  return jsonb_build_object('id', auth.uid(), 'phone', v_phone);
end $$;

-- ── What the public Forgot-PIN screen should show: coverage number, else the OPM's own ──
create or replace function public.driver_help_phone() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select d.contact_phone
       from public.fleet_delegations d
       join public.profiles p on p.id = d.csr_id
      where d.can_reset_pin
        and d.contact_phone is not null
        and d.revoked_at is null
        and d.starts_at <= now() and now() < d.ends_at
        and p.role = 'csr' and p.status = 'active'
      order by d.starts_at desc, d.id
      limit 1),
    (select o.phone
       from public.profiles o
      where o.role = 'opm' and o.status = 'active' and o.phone is not null
      order by o.invited_at, o.id
      limit 1));
$$;

revoke all on function public.set_own_phone(text) from public, anon;
grant execute on function public.set_own_phone(text) to authenticated;

notify pgrst, 'reload schema';
commit;
