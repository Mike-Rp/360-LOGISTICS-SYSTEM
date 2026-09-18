-- Run ONCE, by hand, in the Supabase SQL editor — AFTER you have created these three
-- users in Dashboard → Authentication → Users → "Add user" (tick "Auto Confirm User").
-- Choose NEW passwords there. Passwords never appear in this repo.
--
-- This only attaches a role to each Auth user. Safe to re-run.

insert into public.profiles (id, email, name, role, is_om, is_demo)
select u.id, lower(u.email), v.name, v.role, v.is_om, v.is_demo
from auth.users u
join (values
  ('360logistics@email.ph',            'Admin User',         'admin',  false, false),
  ('operationmanager@360logistics.ph', 'Operation Manager',  'viewer', true,  false),
  ('adminabuse@360logistics.ph',       'Admin (Demo)',       'admin',  false, true)
) as v(email, name, role, is_om, is_demo) on lower(u.email) = v.email
on conflict (id) do update
  set role = excluded.role, is_om = excluded.is_om, is_demo = excluded.is_demo, status = 'active';

-- Expect 3 rows:
select email, role, is_om, is_demo from public.profiles order by email;
