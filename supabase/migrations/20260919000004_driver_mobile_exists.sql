-- ════════════════════════════════════════════════════════════════════════════
-- Lets the LOGIN SCREEN tell "this mobile number is not registered" apart from
-- "that PIN is wrong".
--
-- Why a database function is needed at all: Supabase Auth answers an unknown
-- email and a wrong password with the same 400 invalid_credentials, and the
-- browser cannot read public.drivers before signing in (anon has no table
-- access, and drivers_select only admits staff or the driver themselves).
--
-- ⚠️  TRADE-OFF, ACCEPTED DELIBERATELY
-- The anon key is public and ships inside the JavaScript bundle, so granting
-- execute to anon lets ANYONE check whether a given mobile number belongs to a
-- registered driver, one number at a time. That is the cost of the clearer
-- error message. The function is kept as narrow as possible in exchange:
--   * it returns a bare boolean — never a name, id, PIN or row count,
--   * it takes one number per call, so there is no bulk listing,
--   * it reads nothing but public.drivers.
-- If this is ever judged too leaky, revoke it from anon and the login screen
-- falls back to the previous single combined message.
-- ════════════════════════════════════════════════════════════════════════════

create function public.driver_mobile_exists(p_phone text)
returns boolean
language sql
stable
security definer
set search_path = '' as $$
  -- normalise_mobile() on both sides so "+639171234567", "639171234567" and
  -- "09171234567" are all recognised as the same number.
  select exists (
    select 1
    from public.drivers d
    where public.normalise_mobile(d.phone) = public.normalise_mobile(p_phone)
  );
$$;

-- Functions are executable by PUBLIC by default — close that first, then open
-- only what the login screen needs.
revoke all on function public.driver_mobile_exists(text) from public;
grant execute on function public.driver_mobile_exists(text) to anon, authenticated;
