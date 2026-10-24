-- ════════════════════════════════════════════════════════════════════════════
-- Driver Photo Upload Metadata (REQ09) / Driver Photo GPS Preview (REQ13).
--
-- Manual SQL Editor application only. Shared/production project.
--
-- The GPS-preview screen (already live) reads and displays accuracy, GPS
-- reading time, and Camera/Gallery source at confirmation time, but none of
-- it survives into the saved status_photos row — only url/taken_at/location/
-- lat/lng do. A reload, or a CSR/OPM viewing the same photo later, cannot
-- reconstruct any of it.
--
-- Fully additive: 5 new nullable columns, no RLS change needed (the existing
-- photos_insert/photos_update policies already authorize exactly the right
-- callers — can_write() staff or the owning driver). uploaded_at is the one
-- column that must be trustworthy regardless of who writes the row, so it's
-- server-stamped via a trigger (not client-supplied) rather than a new RPC —
-- same "server owns the timestamp" principle as REQ-013, just simpler since
-- this isn't "only one function may set it," it's "every write gets stamped."
-- capture_observed_at/gps_observed_at/gps_accuracy_m/source stay client-
-- reported, same trust level as the existing taken_at/location/lat/lng.
--
-- Legacy rows keep all 5 columns null — never backfilled or inferred from
-- taken_at, current GPS, or anything else.
-- ════════════════════════════════════════════════════════════════════════════
begin;

alter table public.status_photos
  add column if not exists uploaded_at          timestamptz,
  add column if not exists capture_observed_at  timestamptz,
  add column if not exists gps_observed_at       timestamptz,
  add column if not exists gps_accuracy_m        double precision,
  add column if not exists source                text,
  add constraint status_photos_source_check
    check (source is null or source in ('camera', 'gallery', 'unknown')),
  add constraint status_photos_gps_accuracy_check
    check (gps_accuracy_m is null or gps_accuracy_m >= 0);

create function public.stamp_status_photo_upload() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.uploaded_at := now();
  return new;
end $$;

create trigger status_photos_stamp_upload before insert or update on public.status_photos
  for each row execute function public.stamp_status_photo_upload();

notify pgrst, 'reload schema';
commit;
