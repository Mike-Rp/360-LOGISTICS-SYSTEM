-- ════════════════════════════════════════════════════════════════════════════
-- REQ-002 — Driver pickup/loading/arrival/unloading workflow — SCHEMA ONLY
--
-- This is deliberately the safe, additive half of REQ-002, the same two-step
-- pattern used for REQ-001 (destination_area part1/part2): add the columns
-- first with zero behavior change, design and ship the enforcement separately.
--
-- What this does:
--   - Adds `operational_stage`, a nullable sub-stage marker that sits BETWEEN
--     the existing task_status values without changing them. task_status keeps
--     its current 5 values untouched, so every existing place that filters,
--     colors, or groups by task_status (DeliveryTable, Reports, status badges,
--     the guard_assignment_update() trigger) keeps working exactly as before.
--   - Adds one nullable timestamptz column per new workflow event, matching
--     REQ-002's event list: pickup arrival, loading start/end, departure,
--     destination arrival, unloading start/end. These are meant to be
--     SERVER-stamped (via now()), never written from the client as a value,
--     once the transition function exists.
--
-- What this deliberately does NOT do yet:
--   - No transition function/RPC. Nothing validates stage order, ownership,
--     or required photos, and nothing stamps these new columns. They sit
--     unused and NULL on every assignment until that function exists.
--   - No change to guard_assignment_update(). Its allow-list still covers
--     only task_status / issue_reason / driver_acknowledged_at, so a driver
--     cannot write these new columns directly even by accident — the table
--     grant in 20260919000001_grants.sql is table-wide, so the trigger is the
--     only thing restricting columns, and it is intentionally left as-is here.
--   - No new status_photos rows or constraint. status_photos.status has no
--     check constraint, so the stable category keys below don't need a schema
--     change — they're recorded here so the eventual transition function and
--     the driver UI agree on exact spelling before either is built:
--       pickup_front, pickup_left, pickup_right, pickup_rear   (required)
--       loading_before                                         (optional)
--       loading_after                                          (required)
--       pretrip_front, pretrip_left, pretrip_right, pretrip_rear (required)
--       unloading_before                                       (optional)
--       unloading_after                                        (optional/recommended)
--
-- Safe to run more than once. Existing assignments keep every new column NULL.
-- ════════════════════════════════════════════════════════════════════════════
begin;

alter table public.assignments
  add column if not exists operational_stage text
    check (operational_stage is null or operational_stage in (
      'pickup_arrived',       -- driver has arrived at the pickup location
      'loading',               -- loading in progress
      'loaded',                 -- loading finished; pre-trip photos next, then departs
      'destination_arrived',  -- driver has arrived at the delivery location
      'unloading',              -- unloading in progress
      'unloaded'                 -- unloading finished; ready to mark Delivered
    ));

alter table public.assignments add column if not exists pickup_arrived_at       timestamptz;
alter table public.assignments add column if not exists loading_started_at     timestamptz;
alter table public.assignments add column if not exists loading_completed_at   timestamptz;
alter table public.assignments add column if not exists departed_at            timestamptz;
alter table public.assignments add column if not exists destination_arrived_at timestamptz;
alter table public.assignments add column if not exists unloading_started_at   timestamptz;
alter table public.assignments add column if not exists unloading_completed_at timestamptz;

comment on column public.assignments.operational_stage is
  'REQ-002: sub-stage between task_status values. NULL except while a driver is mid pickup/loading/unloading. Not yet written by any code path.';
comment on column public.assignments.pickup_arrived_at is
  'REQ-002: server-stamped time the driver arrived at the pickup location. Not yet written by any code path.';
comment on column public.assignments.loading_started_at is
  'REQ-002: server-stamped time loading began. Not yet written by any code path.';
comment on column public.assignments.loading_completed_at is
  'REQ-002: server-stamped time loading finished. Not yet written by any code path.';
comment on column public.assignments.departed_at is
  'REQ-002: server-stamped time the truck departed the pickup location. Not yet written by any code path.';
comment on column public.assignments.destination_arrived_at is
  'REQ-002: server-stamped time the driver arrived at the delivery location. Not yet written by any code path.';
comment on column public.assignments.unloading_started_at is
  'REQ-002: server-stamped time unloading began. Not yet written by any code path.';
comment on column public.assignments.unloading_completed_at is
  'REQ-002: server-stamped time unloading finished. Not yet written by any code path.';

commit;
