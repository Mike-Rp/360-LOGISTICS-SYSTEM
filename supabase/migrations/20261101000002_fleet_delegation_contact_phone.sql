-- ════════════════════════════════════════════════════════════════════════════
-- REQ-018 follow-up — the driver's "Forgot your PIN?" screen follows the leave coverage.
--
-- The login screen shows one built-in hotline (the OPM's). While the OPM is away and
-- unreachable that number is useless. Now the OPM states, when granting PIN-reset
-- coverage, the number drivers should call (normally the covering CSR's mobile or a
-- shared dispatch line). While that coverage is active the Forgot-PIN screen shows it;
-- when it ends or is revoked the screen falls back to the built-in number by itself.
--
--   • fleet_delegations.contact_phone — local format '09XXXXXXXXX', optional in general,
--     but grant_fleet_delegation() requires it whenever the grant includes PIN reset.
--     (Grants made before this migration have none and simply keep the built-in number.)
--   • grant_fleet_delegation() gains p_contact_phone. The old 5-argument version is
--     dropped so a grant can never skip the number by calling it.
--   • driver_help_phone() — callable before login (the login screen is public). Returns
--     ONLY a phone number: the newest active PIN-reset coverage that has one and whose CSR
--     is still active, or null. No names, no account details. That number is already
--     public on this screen today.
--
-- Manual SQL Editor application only. Shared/production project.
-- ════════════════════════════════════════════════════════════════════════════
begin;

alter table public.fleet_delegations add column contact_phone text;
alter table public.fleet_delegations
  add constraint fleet_delegations_contact_phone_format check (contact_phone is null or contact_phone ~ '^09\d{9}$');

drop function public.grant_fleet_delegation(uuid, timestamptz, timestamptz, boolean, boolean);

create function public.grant_fleet_delegation(
  p_csr_id uuid, p_starts_at timestamptz, p_ends_at timestamptz,
  p_can_reset_pin boolean, p_can_register boolean, p_contact_phone text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  p       public.profiles%rowtype;
  v_id    uuid;
  v_scope text;
  v_phone text;
begin
  if not public.is_opm() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if not public.signed_in_recently(300) then raise exception 'reauth_required' using errcode = '42501'; end if;

  select * into p from public.profiles where id = p_csr_id and role = 'csr' and status = 'active';
  if not found then raise exception 'member_not_found' using errcode = 'P0002'; end if;

  -- No maximum length: the OPM sets the window to match the leave. It only has to be
  -- a real window that has not already ended.
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at or p_ends_at <= now() then
    raise exception 'invalid_window' using errcode = '22023';
  end if;
  if not (coalesce(p_can_reset_pin, false) or coalesce(p_can_register, false)) then
    raise exception 'no_scope' using errcode = '22023';
  end if;

  -- The number drivers call while PIN reset is covered. Required then; ignored otherwise.
  if coalesce(p_can_reset_pin, false) then
    v_phone := public.normalise_mobile(coalesce(p_contact_phone, ''));
    if v_phone !~ '^09\d{9}$' then raise exception 'invalid_phone' using errcode = '22023'; end if;
  end if;

  insert into public.fleet_delegations (csr_id, granted_by, starts_at, ends_at, can_reset_pin, can_register, contact_phone)
  values (p_csr_id, auth.uid(), p_starts_at, p_ends_at,
          coalesce(p_can_reset_pin, false), coalesce(p_can_register, false), v_phone)
  returning id into v_id;

  v_scope := concat_ws(' + ',
    case when p_can_reset_pin then 'Reset driver PINs' end,
    case when p_can_register  then 'Register drivers & trucks' end);

  insert into public.activity_log (id, type, member_name, member_email, reason)
  values ('act-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4),
          'delegation_granted', p.name, p.email,
          v_scope || ' · '
            || to_char(p_starts_at at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') || ' to '
            || to_char(p_ends_at   at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') || ' (PHT)'
            || case when v_phone is not null then ' · drivers call ' || v_phone else '' end);

  return v_id;
end $$;

-- ── What the public Forgot-PIN screen should show ──
create function public.driver_help_phone() returns text
language sql stable security definer set search_path = '' as $$
  select d.contact_phone
    from public.fleet_delegations d
    join public.profiles p on p.id = d.csr_id
   where d.can_reset_pin
     and d.contact_phone is not null
     and d.revoked_at is null
     and d.starts_at <= now() and now() < d.ends_at
     and p.role = 'csr' and p.status = 'active'
   order by d.starts_at desc, d.id
   limit 1;
$$;

-- ── Execute rights ──
revoke all on function public.grant_fleet_delegation(uuid, timestamptz, timestamptz, boolean, boolean, text) from public, anon;
grant execute on function public.grant_fleet_delegation(uuid, timestamptz, timestamptz, boolean, boolean, text) to authenticated;

revoke all on function public.driver_help_phone() from public;
grant execute on function public.driver_help_phone() to anon, authenticated;

notify pgrst, 'reload schema';
commit;
