-- ════════════════════════════════════════════════════════════════════════════
-- Server-side duplicate detection for operational evidence photos.
--
-- Manual SQL Editor application only. Shared/production project.
--
-- Adviser-requested: a driver should not be able to reuse the same stock
-- photo of their truck as "evidence" across different deliveries/reports,
-- which would mask a real, new problem. The check has to be genuinely
-- server-side — if the hash were computed in the browser and merely checked
-- before a normal client write, a tampered client could still write a fake
-- hash straight to the row afterward, defeating future comparisons. So the
-- new upload-operational-photo Edge Function (service role) now owns the
-- ENTIRE write for these photos: it computes the SHA-256 of the bytes it
-- actually receives, rejects an exact repeat of any driver's prior
-- operational photo, and only then uploads to Storage and saves the row
-- itself. This migration:
--   1. Adds status_photos.file_hash (+ an index for the duplicate lookup).
--   2. Removes the driver's own browser's ability to write an OPERATIONAL
--      category row directly through photos_insert/photos_update, so the
--      Edge Function is the only path left for those 12 categories. Legacy
--      milestone photos (keyed by TaskStatus values like 'Picked Up' /
--      'In Transit' / 'Delivered') and staff (can_write()) are untouched —
--      this is scoped to operational evidence photos only, per the actual
--      scenario described (truck condition photos), not every photo.
-- ════════════════════════════════════════════════════════════════════════════
begin;

alter table public.status_photos
  add column if not exists file_hash text;

create index if not exists status_photos_file_hash_idx
  on public.status_photos (file_hash) where file_hash is not null;

drop policy if exists photos_insert on public.status_photos;
create policy photos_insert on public.status_photos for insert to authenticated
  with check (
    public.can_write()
    or (public.driver_owns_assignment(assignment_id) and status <> all (array[
      'pickup_front', 'pickup_left', 'pickup_right', 'pickup_rear',
      'pretrip_front', 'pretrip_left', 'pretrip_right', 'pretrip_rear',
      'loading_before', 'loading_after', 'unloading_before', 'unloading_after'
    ]))
  );

drop policy if exists photos_update on public.status_photos;
create policy photos_update on public.status_photos for update to authenticated
  using (
    public.can_write()
    or (public.driver_owns_assignment(assignment_id) and status <> all (array[
      'pickup_front', 'pickup_left', 'pickup_right', 'pickup_rear',
      'pretrip_front', 'pretrip_left', 'pretrip_right', 'pretrip_rear',
      'loading_before', 'loading_after', 'unloading_before', 'unloading_after'
    ]))
  )
  with check (
    public.can_write()
    or (public.driver_owns_assignment(assignment_id) and status <> all (array[
      'pickup_front', 'pickup_left', 'pickup_right', 'pickup_rear',
      'pretrip_front', 'pretrip_left', 'pretrip_right', 'pretrip_rear',
      'loading_before', 'loading_after', 'unloading_before', 'unloading_after'
    ]))
  );

commit;
