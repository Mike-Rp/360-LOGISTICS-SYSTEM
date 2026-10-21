-- ════════════════════════════════════════════════════════════════════════════
-- Store photo / document PATHS instead of 10-year signed links.
--
-- Manual SQL Editor application only. Shared/production project.
-- Apply ONLY AFTER the frontend that reads paths (src/app/lib/storageRefs.ts +
-- db.ts: short-lived links on load) is deployed — the old frontend cannot show
-- a path.
--
-- What it does:
--   1. Rewrites every stored link
--        https://…/storage/v1/object/sign/make-ee4d169c-media/<path>?token=…
--      to just <path> in status_photos.url, assignment_documents.file_url and
--      notifications.photo_url. Checked on the live data (2026-10-21): 155 links,
--      all in this bucket, none URL-encoded, every path is an existing file.
--   2. Adds CHECK constraints so a signed/storage link can never be stored again
--      (a stale old browser tab gets an error instead of saving a 10-year link).
--
-- Upload times are preserved: documents_stamp_uploaded_at would stamp now() on
-- any file_url change, so it is switched off for the rewrite only and back on in
-- the same transaction. documents_guard does nothing here (no app user in the
-- SQL Editor). Document statuses, photos' times/GPS and everything else are
-- untouched. The files themselves are not moved.
--
-- Not covered (by decision): links already copied before this change keep
-- working until their own expiry.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. links → paths ──
update public.status_photos
   set url = substring(url from '/storage/v1/object/sign/make-ee4d169c-media/([^?]+)')
 where url like '%/storage/v1/object/sign/make-ee4d169c-media/%';

alter table public.assignment_documents disable trigger documents_stamp_uploaded_at;
update public.assignment_documents
   set file_url = substring(file_url from '/storage/v1/object/sign/make-ee4d169c-media/([^?]+)')
 where file_url like '%/storage/v1/object/sign/make-ee4d169c-media/%';
alter table public.assignment_documents enable trigger documents_stamp_uploaded_at;

update public.notifications
   set photo_url = substring(photo_url from '/storage/v1/object/sign/make-ee4d169c-media/([^?]+)')
 where photo_url like '%/storage/v1/object/sign/make-ee4d169c-media/%';

-- ── 2. never store a link again ──
alter table public.status_photos
  add constraint status_photos_url_is_path check (url not like '%/storage/v1/object/%');
alter table public.assignment_documents
  add constraint assignment_documents_file_url_is_path check (file_url is null or file_url not like '%/storage/v1/object/%');
alter table public.notifications
  add constraint notifications_photo_url_is_path check (photo_url is null or photo_url not like '%/storage/v1/object/%');

commit;
