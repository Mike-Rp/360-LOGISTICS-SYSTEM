-- ════════════════════════════════════════════════════════════════════════════
-- Table privileges for signed-in users.
--
-- Found by testing 20260919000000_init.sql on a fresh project: new Supabase
-- projects no longer auto-grant table access to `authenticated`, so even a
-- valid admin got "permission denied for table ...".
--
-- Two layers guard every request:
--   GRANT  = may this role touch this table/column at all?   (this file)
--   RLS    = which ROWS may it touch?                        (init.sql policies)
-- Both must allow it. `anon` gets nothing, on purpose.
--
-- profiles / drivers / driver_pins already have narrower column-level grants
-- from init.sql (e.g. nobody can write drivers.auth_user_id) — only the
-- missing SELECT / DELETE privileges are added for those.
-- ════════════════════════════════════════════════════════════════════════════

-- Supabase leaves TRUNCATE / TRIGGER / REFERENCES on every table for `authenticated`.
-- TRUNCATE bypasses RLS entirely and the app never needs any of the three.
revoke truncate, trigger, references on all tables in schema public from authenticated;

grant select                         on public.profiles             to authenticated;

grant select, delete                 on public.drivers              to authenticated;
grant select                         on public.driver_pins          to authenticated;

grant select, insert, update, delete on public.trucks               to authenticated;
grant select, insert, update, delete on public.assignments          to authenticated;
grant select, insert, update, delete on public.assignment_documents to authenticated;
grant select, insert, update, delete on public.status_photos        to authenticated;
grant select, insert,         delete on public.delay_reports        to authenticated;
grant select, insert, update, delete on public.notifications        to authenticated;

-- append-only audit log: no update, no delete
grant select, insert                 on public.activity_log         to authenticated;
