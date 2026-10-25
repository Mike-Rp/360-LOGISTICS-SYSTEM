-- ════════════════════════════════════════════════════════════════════════════
-- Fix: upload-operational-photo's service-role client got "permission denied
-- for table status_photos" on its very first live test.
--
-- Manual SQL Editor application only. Shared/production project.
--
-- Every other Edge Function in this project (complete-csr-password-reset)
-- only ever touches the database through RPCs, each with its own
-- `grant execute ... to service_role`, which is why this gap was never hit
-- before: service_role bypasses RLS, but RLS and raw SQL GRANTs are two
-- separate layers (see db.ts's own header comment) — bypassing one says
-- nothing about the other, and this project apparently never relies on
-- service_role having any ambient table access by default.
-- upload-operational-photo is the first function to query a table directly
-- (it has to see every driver's photo hashes, which no authenticated-role
-- RLS policy should ever allow), so it's the first to need this GRANT.
-- ════════════════════════════════════════════════════════════════════════════
begin;

grant select, insert, update on public.status_photos to service_role;

commit;
