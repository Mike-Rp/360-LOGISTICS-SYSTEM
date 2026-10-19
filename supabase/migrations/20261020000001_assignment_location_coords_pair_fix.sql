-- ════════════════════════════════════════════════════════════════════════════
-- REQ-005 fix — reject a latitude without its longitude (and vice versa).
--
-- 20261020000000_assignment_location_coordinates.sql added the pair checks as
--   (lat is null and lng is null) or (lat between … and lng between … and …)
-- In Postgres a CHECK passes when its expression is NULL, not only when it is
-- true. For lat = 14.5, lng = NULL that expression is `false OR NULL` = NULL, so
-- a half pair was accepted. Found by supabase/tests/req005_assignment_locations
-- .test.sql ("table accepted latitude without longitude").
--
-- This file ONLY replaces the two coordinate-pair constraints so the "set"
-- branch requires both values. Nothing else changes: no columns, no data, no
-- trigger, no edit_assignment(), no workflow logic. Re-adding the constraints
-- re-checks existing rows; it fails (and changes nothing) if a half pair exists.
--
-- Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════
begin;

alter table public.assignments drop constraint if exists assignments_pickup_coords_check;
alter table public.assignments add constraint assignments_pickup_coords_check check (
  (pickup_latitude is null and pickup_longitude is null)
  or (pickup_latitude is not null and pickup_longitude is not null
      and pickup_latitude  between -90  and 90
      and pickup_longitude between -180 and 180
      and btrim(pickup_location) <> '')
);

alter table public.assignments drop constraint if exists assignments_delivery_coords_check;
alter table public.assignments add constraint assignments_delivery_coords_check check (
  (delivery_latitude is null and delivery_longitude is null)
  or (delivery_latitude is not null and delivery_longitude is not null
      and delivery_latitude  between -90  and 90
      and delivery_longitude between -180 and 180
      and btrim(coalesce(delivery_location, '')) <> '')
);

commit;
