-- Run ONCE, by hand, in the Supabase SQL editor — AFTER you have created this
-- user in Dashboard → Authentication → Users → "Add user" (tick "Auto Confirm
-- User"). Choose a NEW password there. Passwords never appear in this repo.
--
-- This only attaches the opm role to that Auth user. Safe to re-run.
-- Requires 20261018000003_opm_role.sql (profiles.role allows 'opm').

insert into public.profiles (id, email, name, role)
select u.id, lower(u.email), v.name, v.role
from auth.users u
join (values
  ('operationalmanager@360logistics.ph', 'Gefran Pervera', 'opm')
) as v(email, name, role) on lower(u.email) = v.email
on conflict (id) do update
  set role = excluded.role, status = 'active';

-- Expect 1 row:
select email, role, status from public.profiles where role = 'opm';
