# Backend & Database Requirements

This document tracks features discovered during development that require
backend, API, database, schema, migration, or persistent-storage changes.

## Project Rule

Database/backend changes must not be implemented automatically.
Record the requirement here first and wait for explicit approval.

When a requested feature needs support that the current data model cannot provide:

1. Inspect the current persistence path and check this file for an existing entry.
2. Add or update the requirement without creating a duplicate. Never reuse an ID.
3. Implement only the portions that work correctly with existing data and behavior.
4. Report what remains blocked and the approval needed. Do not add a frontend-only
   field that appears to save but disappears after refresh.

Do not add entries for UI-only changes such as spacing, colors, labels, placeholders,
responsive layout, icons, or typography.

## Status and approval

Use only `Pending`, `Approved`, `In Progress`, `Implemented`, `Rejected`, or
`No Longer Needed` for **Status**. Number entries sequentially as `REQ-001`,
`REQ-002`, and so on. Update an existing entry when a later task concerns the
same requirement.

Set **Approval** to `Approved` and **Status** to `Approved` only after explicit
user approval. When implementation begins, set **Status** to `In Progress`.
After implementation and verification, set **Status** to `Implemented` and
record the migration, affected backend/API/frontend files, and verification.
Do not infer approval from a request for a UI change.

## [REQ-001] Separate Destination and Delivery Location

**Status:** Implemented

**Area:** Dispatch / Deliveries / Driver App / Reports

**Requested change:**
Store and display Origin (general starting area), Pickup Location (specific
pickup point), Destination (general destination area), and Delivery Location
(exact receiving or drop-off point) as distinct assignment values.

**Why backend/database support is required:**
Dispatch Truck currently keeps Origin and Delivery Location in separate form
state, then saves them together as one string in `Assignment.destination`:
`Origin → Delivery Location`. There is no separately persisted general
Destination. Adding another input to the current form would either overwrite
the same value or disappear after refresh.

**System before these local changes:**
- `src/app/components/admin/DriversManagement.tsx` saves `taskFrom` and
  `taskTo` as one `destination` string. The edit flow uses the same format.
- `src/app/data/assignmentTypes.ts` has `destination`, `pickupLocation`, and
  `company`, but no separate origin, destination area, or delivery location.
- `src/app/lib/db.ts` maps `Assignment.destination` to the
  `public.assignments.destination` column. The current repository migration
  defines that column but no separate columns for these three route values.
- Confirm the actual development database schema before planning a migration;
  this entry describes the current repository code and migrations.

**Required backend/database change:**
- Add a general Destination field while preserving the existing combined route
  (`Origin → Delivery Location`) and its exact drop-off value.
- Extend assignment create, update, and read mappings for the new field.
- Derive the displayed general route from the saved origin and new Destination,
  with the legacy route as a fallback for old assignments.

**Suggested data model:**
- `destination_area`: nullable text for general Destination; required for new
  assignments by a database insert check.
- Keep existing `destination` as `Origin → Delivery Location`. This preserves
  old assignments and allows the exact drop-off to be read without a backfill.

**API impact:**
Assignment create/update/read payloads and the active persistence mapper must
carry the separate values. Inspect the actual data path at implementation time;
a new endpoint is not necessarily required.

**Frontend impact:**
- Dispatch Truck Step 1 and assignment edit form.
- Dispatch cards and View Shipment.
- Deliveries and Driver task/details views.
- Reports and exports that show route or delivery location, where applicable.

**Migration required:** Yes

**Risk / considerations:**
Existing `destination` strings combine the route origin with an exact drop-off
point. They do not reliably contain a general destination area, so do not
backfill it automatically. Preserve old assignments and their display during
rollout. The new field is nullable for old rows and validated on new inserts.

**Approval:** Approved — local development only (2026-10-17)

**Implementation status:** Implemented and verified on the development
Supabase project (`yeyfmyojdlqtgoqlwhsv.supabase.co`) on 2026-10-18.

**Applied migrations:** The rollout used the two-part split instead of the
original single file, so the app could go live with no gap:
`supabase/migrations/20261017000002_destination_area_part1.sql` (adds
`public.assignments.destination_area` and extends `edit_assignment` to update
it; safe with the flag off) and
`supabase/migrations/20261017000003_destination_area_part2.sql` (adds the
`assignments_destination_area_required` before-insert trigger). The original
`supabase/migrations/20261017000000_destination_area.sql` was not run and is
superseded by the two-part version — do not run both.

**Verification performed:**
- `assignments.destination_area` column confirmed in the Table Editor;
  historical rows remain NULL, new dispatched rows (e.g. "Iloilo", "Makati
  City") carry real values.
- `assignments_destination_area_required` trigger confirmed present and
  enabled (`Origin` mode) via Database → Triggers.
- `VITE_DESTINATION_AREA_ENABLED=true` set in local `.env.local`; `pnpm dev`
  restarted.
- Dispatched a test assignment with distinct Origin, Pickup Location,
  Destination, and Delivery Location; the Route & Client card renders all four
  as separate values, and Destination persisted correctly after editing
  (re-auth password prompt on edit is expected `edit_assignment` behavior, not
  a defect).

**Frontend files touched:** `src/app/data/assignmentTypes.ts`,
`src/app/data/assignmentRoute.ts`, `src/app/lib/db.ts`,
`src/app/components/admin/DriversManagement.tsx`,
`src/app/components/admin/DeliveryTable.tsx`,
`src/app/components/admin/Reports.tsx`, `src/app/components/admin/Charts.tsx`,
`src/app/components/driver/DriverInterface.tsx`,
`src/app/components/driver/driverI18n.tsx`, and `.env.example`.

---

## [REQ-002] Persisted Driver Pickup, Loading, Arrival, and Unloading Workflow

**Status:** In Progress

**Area:** Driver App / Dispatch / Deliveries / Dashboard / Photos / Reports

**Requested change:**
Extend the physical-delivery flow from Assigned → Picked Up → In Transit →
Delivered to include arrival at pickup, four pickup truck-condition photos,
loading start and finish, four pre-trip truck-condition photos, arrival at the
delivery location, unloading start and finish, and the required/optional photo
rules. Keep the existing six-document review flow after physical delivery.
Updated client requirement (2026-10-19): both `unloading_before` and
`unloading_after` photos are required before finishing unloading. Loading and
Unloading do not need separate location fields; the assignment's pickup and
delivery locations provide that context.
Updated Loading requirement (2026-10-19): `loading_before` is now required
before starting Loading, alongside the already-required `loading_after` photo
before finishing Loading. Existing photo categories and storage remain usable.

**Why backend/database support is required:**
`public.assignments.task_status` and `guard_assignment_update()` currently allow
only the existing physical statuses. The assignment has no trusted timestamps
for pickup arrival, loading, destination arrival, or unloading. React-only
steps would disappear after refresh and could disagree with Admin. A sequence
of separate photo, status, and notification writes cannot enforce the new
required photos and transitions atomically.

**Current system:**
- `src/app/components/driver/DriverInterface.tsx` slides through Assigned →
  Picked Up → In Transit → Delivered. Each of the latter three transitions
  uses one status photo.
- `public.status_photos` stores one row per `(assignment_id, status)` with a
  free-text `status` key, URL, display timestamp, and optional GPS. This can
  represent distinct photo slots, but no database rule currently ties a
  category or count to a workflow transition.
- `public.assignments` has `assigned_at`, `created_at`, and a physical status,
  but no server-stamped timestamps for the requested new events. The existing
  `taken_at` photo value comes from the device and is not a trusted event time.
- Driver updates call Supabase directly through `src/app/lib/db.ts`; the admin
  reads assignments and notifications from the same project. The six formal
  documents live in `assignment_documents` and must remain separate.

**Required backend/database change:**
- Define one canonical, persisted operational stage model for pickup arrival,
  loading (before/in progress/complete), departure, destination arrival,
  unloading (before/in progress/complete), and delivery. Decide whether to
  extend `task_status` or add a separate stage field while preserving existing
  statuses and historical assignments.
- Save server-generated event times for pickup arrival, loading start/end,
  departure/In Transit, destination arrival, unloading start/end, and physical
  delivery. Reuse an existing equivalent timestamp if one is verified.
- Add an authorized transition function/API that checks current stage,
  ownership, required persisted photo slots, and transition order; stamps the
  event on the server; and updates status/activity together. Make retries safe
  and reject duplicate or out-of-order slides.
- Define stable photo category keys for pickup front/left/right/rear, required
  before loading and after loading, pre-trip front/left/right/rear,
  and required before and after unloading. Reuse
  `status_photos` and the private Storage bucket if their permissions and
  replacement behavior suffice; add storage/schema support only if inspection
  during implementation proves necessary. A photo counts only after its row
  and file persist successfully.
- Expose the same canonical stage and event times to Admin Dispatch,
  Deliveries, Dashboard/Recent Activity, Driver, and Delay Reports.
- Update `advance_driver_stage('finish_unloading')` to reject the transition
  unless both persisted `unloading_before` and `unloading_after` photo rows
  exist. The current function only checks the stage, so the new rule is **not
  enforced yet**. This RPC change requires separate backend approval and
  application to the development project; no new photo columns are needed.
- Update `advance_driver_stage('start_loading')` to require a persisted
  `loading_before` photo in addition to the four pickup truck photos. The
  applied function currently checks only the four pickup photos. The local
  Driver UI blocks its Start Loading slider until `loading_before` is saved,
  but that client-side gate is not server enforcement. This RPC change needs
  separate backend approval and application to development; no new photo
  columns are needed.
- Add durable, stage-specific Loading and Unloading driver remarks only after
  a storage model and authorized read/write path are approved. The existing
  assignment `remarks` field is admin-created and must stay separate.

**Suggested data model:**
- A persisted stage field or expanded `task_status` constraint, with a safe
  legacy mapping for existing Assigned/Picked Up/In Transit/Delivered records.
- Server-stamped `timestamptz` events or an append-only workflow-event table
  keyed by assignment and transition. Durations are derived from start/end;
  elapsed seconds need no repeated writes.
- Distinct photo category values on `status_photos.status`, subject to
  server-side validation and a clear retake/replace rule. Keep these rows out
  of `assignment_documents` and its six-document count.

**API impact:**
Replace the multi-request client-side status progression with a protected,
idempotent transition operation and read support for the current stage, event
times, and photo-slot completion. Preserve existing auth and driver ownership
checks. Do not treat a notification write as proof of a completed transition.

**Frontend impact:**
- Driver task stages, slide controls, photo grids, required/optional labels,
  progress indicator, loading/unloading elapsed displays, and Delivered CTA.
- Shared workflow/status helpers, Admin Dispatch/View Shipment, Deliveries,
  Dashboard Overview/Recent Activity, and Delay Reports.
- English/Filipino driver strings and legacy-assignment fallback screens.

**Migration required:** Yes

**Risk / considerations:**
Existing active assignments must resume at a valid stage without fabricated
event times or photos. The current one-photo status keys must remain readable.
Storage uploads and database changes need a retry/cleanup strategy; a failed
transition must leave the previous stage visible. The driver's offline demo
mode must never appear to persist a real transition. Do not introduce the new
stages in React before server persistence and validation exist.

**Approval:** Approved — schema and transition function for local development
(2026-10-18); Driver UI integration approved for local development
(2026-10-19); Admin Dispatch/View Shipment UI integration approved for local
development (2026-10-19). The revised before-loading and unloading photo
enforcement and stage-specific remarks persistence are **not approved for
backend changes**.

**Design decisions made (2026-10-18):**
- Stages are tracked in a new, separate `operational_stage` column rather than
  extending `task_status` — this keeps every existing place that
  filters/colors/groups by `task_status` unchanged.
- Event times are individual nullable `timestamptz` columns on `assignments`
  (matching the existing `assigned_at`/`created_at` style) rather than a
  separate append-only event table, since each event happens at most once per
  assignment and `activity_log` already serves as this project's audit trail.
- `depart` automatically flips `task_status` to `Picked Up` in the same
  server call — the driver's next visible action stays the existing,
  unchanged In Transit button. The old In Transit and Delivered taps are not
  touched by this requirement.
- Missing required photos hard-block the transition (the function raises
  `missing_required_photo: <key>`) rather than allowing it through with a
  flag for admin follow-up.
- No admin override/force-reset of a stuck `operational_stage` in this pass —
  deferred as its own follow-up once the base flow is proven.

**Prepared migration (schema only):**
`supabase/migrations/20261018000000_driver_workflow_stages.sql`. Adds
`operational_stage` (checked against the 6 sub-stage values) and 7 nullable
`timestamptz` columns (`pickup_arrived_at`, `loading_started_at`,
`loading_completed_at`, `departed_at`, `destination_arrived_at`,
`unloading_started_at`, `unloading_completed_at`). Also records the stable
`status_photos` category keys the future transition function and driver UI
must agree on (`pickup_front/left/right/rear`, `loading_before`,
`loading_after`, `pretrip_front/left/right/rear`, `unloading_before`,
`unloading_after`). This migration changes nothing else: `task_status`,
`guard_assignment_update()`, and the existing driver flow are untouched, and
no code path writes the new columns yet, so it is safe to run at any time with
zero behavior change.

**Verification performed (2026-10-18):** `20261018000000_driver_workflow_stages.sql`
applied in the Supabase SQL editor against the development project; all 8 new
columns confirmed present on `public.assignments` in the Table Editor, NULL on
every existing row. Dispatch, Deliveries, and Driver views checked afterward
with no behavior change, as expected for a schema-only, unused-column
migration.

**Prepared migration (transitions):**
`supabase/migrations/20261018000001_driver_workflow_transitions.sql`. Adds
`public.advance_driver_stage(assignment_id, transition)`, a `SECURITY
DEFINER` function covering the 7 new transitions (`arrive_pickup`,
`start_loading`, `finish_loading`, `depart`, `arrive_destination`,
`start_unloading`, `finish_unloading`), each locking the row, checking the
current stage, checking required photos where applicable, and stamping the
one relevant timestamp. Also updates `guard_assignment_update()` with a
narrow, transaction-scoped bypass flag so this one validated function can
write the new columns despite the trigger's existing driver column
allow-list — a direct client `.update()` call still cannot touch them.
**Applied and verified (2026-10-18):** Ran in the Supabase SQL editor against
the development project. Exercised from the running app's browser console,
signed in as admin, against a real test assignment (`ASN66661`):
`arrive_pickup` succeeded and correctly stamped `operational_stage` /
`pickup_arrived_at`; a duplicate `arrive_pickup` call correctly failed with
`wrong_stage`; `start_loading` with no photos uploaded correctly failed with
`missing_required_photo: pickup_front`; inserting the 4 required
`status_photos` rows and retrying `start_loading` then succeeded. Order
validation, the photo gate (both block and unblock), and server-side
timestamp stamping were confirmed for those initial transitions. The other
five transitions were exercised later through the Driver UI as recorded below.

**Local Driver UI verification (2026-10-19):**
- On 2026-10-19, a signed-in development driver advanced test assignment
  `ASN65961` from In Transit through `arrive_destination`, `start_unloading`,
  and `finish_unloading`. The Arrived stage survived refresh, optional
  unloading photos were skipped, and Delivered persisted after refresh.
- A second development assignment, `ASN95221`, passed the complete flow from
  Assigned through Delivered in the Driver UI. Four pickup and four pre-trip
  image slots, plus the required after-loading slot, were uploaded through
  the existing photo flow using clearly synthetic project truck artwork.
  The photo gates unlocked only after the corresponding files and rows saved.
  Loading and unloading timestamps/durations and In Transit survived refresh.
  Before-loading and unloading photos were skipped under the rules in effect
  during that earlier test; before-loading is now required for new UI flows.
  Driver Home then showed Awaiting Documents with 0 of 6 formal documents.

**Admin Dispatch integration prepared (2026-10-19):**
- `src/app/lib/assignmentOperational.ts` derives the admin physical-stage
  progress, compact card badge, Manila timestamps, durations, photo groups,
  and a visible warning for the two non-atomic status handoffs from the
  persisted assignment fields. It creates no new workflow state.
- `src/app/components/admin/DriversManagement.tsx` now shows seven-stage
  progress, a Delivery Activity timeline, and categorized operational photo
  evidence in View Shipment. Dispatch cards display the active physical stage
  where applicable. Formal documents remain in their separate six-item section.
  Older records do not receive fabricated event timestamps or completed dots.
- `src/app/lib/assignmentOperational.test.cjs` covers stage derivation,
  unsynchronized status handoffs, timestamp/duration formatting, and photo keys.
  Admin Dispatch was visually checked against `ASN95221` after refresh: all
  seven real event times, pickup/loading/pre-trip photos, Delivered milestone,
  and independent 0/6 documents remained visible. No database write or
  migration was made in this UI phase.
- View Shipment was later reorganized into Overview, Activity, Photos,
  and Documents tabs in a centered desktop panel and full-screen mobile sheet.
  The Photos tab shows both unloading slots as required and marks missing
  evidence. It does **not** claim that the current backend enforces this new
  rule. No stage-specific driver remark text is displayed because none is
  persisted. The assignment's own Remarks remain in Overview.

**Remaining backend and test gaps:**
- The Delivered gate (require `operational_stage = 'unloaded'` before
  `task_status` can become `Delivered`) is intentionally not included — adding
  it now would break Delivered for every assignment immediately, since
  nothing writes `operational_stage` until the driver UI ships. It is a
  deliberate follow-up migration once that UI is live for everyone.
- The Driver UI integration was tested in development. Failure/retry paths for
  a rejected photo upload or the second status write after `depart` or
  `finish_unloading` were not force-tested. Deliveries, Dashboard/Recent
  Activity, and Delay Reports still need separate admin UI integration.

**Frontend integration gaps identified (2026-10-19):**
- `depart` persists `operational_stage = NULL`, `departed_at`, and
  `task_status = 'Picked Up'`; `finish_unloading` persists
  `operational_stage = 'unloaded'` and `unloading_completed_at` but does not
  set `task_status = 'Delivered'`. The Driver UI must make a separate existing
  status update after each RPC. If that second request fails, the saved
  intermediate stage is recoverable after refresh, but the two writes are not
  atomic. A later approved backend follow-up should make these status changes
  part of the validated transition if one-step atomicity is required.
- REQ-002 does not provide a persistent field/table/API for driver-entered
  remarks at Loading or Unloading. No remarks input is being added as
  temporary React state. Add optional, stage-scoped remarks persistence only
  after its data model and authorization are approved.
- The applied `20261018000001_driver_workflow_transitions.sql` checks only
  `operational_stage = 'unloading'` for `finish_unloading`. It does not require
  `unloading_before` or `unloading_after`. The local Driver UI now labels both
  photos Required and checks each saved photo before enabling its next slide.
  A direct RPC call can still bypass that UI gate. The updated client rule
  needs a reviewed RPC change. Existing delivered assignments that lack these
  photos must remain readable and must not be retroactively invalidated.
- The same applied transition function allows `start_loading` without
  `loading_before`. The local Driver UI now labels it Required and checks its
  persisted photo row before enabling the slider; Admin Photos and Activity
  show Loading as complete only with both `loading_before` and `loading_after`.
  A direct RPC call can still bypass that UI gate. Add the server check only
  after backend approval, without retroactively invalidating older assignments.

---

## [REQ-003] Cancel Assignment: Required Reason, Password Re-auth, Driver Notice

**Status:** In Progress

**Area:** Dispatch / Driver App

**Requested change:**
Before an admin can cancel a dispatch: require typing a reason, then confirm
with password, before the cancellation completes. Save the reason to the
audit log. The driver whose assignment was cancelled should see on their
dashboard that it was cancelled.

**Why backend/database support is required:**
`cancel_assignment()` took no reason and no re-auth, unlike `edit_assignment()`
which requires both. Separately, `assignments_select` RLS explicitly excludes
`state = 'cancelled'` for drivers — a cancelled assignment simply vanishes
from what a driver can query, with no error and no notice. A frontend-only
"cancelled" message would have nothing real to read, since the row is
unreachable under the old policy.

**Applied and verified (2026-10-18):**
`supabase/migrations/20261018000002_cancel_reason_and_driver_notice.sql`.
Applied in the Supabase SQL editor against the development project.
`assignments.cancel_reason` and `cancel_acknowledged_at` confirmed present
(NULL on existing rows). Verified from the running app: the existing admin
Cancel button (still calling the 1-argument path) cancelled a test assignment
successfully with no password prompt — unchanged behavior, confirming the
non-breaking design held. The new 2-argument path, called directly via the
browser console, correctly refused with `reauth_required` without a recent
password confirmation — proving it is genuinely gated, unlike the old path.
- Adds `cancel_assignment(p_id, p_reason)` — requires a non-blank reason
  (same validation as `edit_assignment`) and `signed_in_recently(300)`
  re-auth (the same password-prompt pattern already used for editing). The
  reason is stored in `activity_log.reason` and a new
  `assignments.cancel_reason` column.
- **Keeps the original `cancel_assignment(p_id)` unchanged, coexisting
  alongside it** — deliberately non-breaking, since this project shares one
  Supabase project between two developers and a migration affects the other
  person's running app immediately, before any git push/pull. The current
  admin Cancel button keeps working exactly as today until its UI is updated
  to call the 2-argument version. `db.ts`'s `cancelAssignment(id, reason?)`
  now supports both: omit `reason` for the old path, pass it for the new one.
- `assignments_select` RLS no longer excludes `state = 'cancelled'` for
  drivers — symmetric with how they can already read their own `completed`
  rows.
- New `assignments.cancel_acknowledged_at` (nullable timestamptz), added to
  `guard_assignment_update()`'s driver-writable allow-list alongside the
  existing `driver_acknowledged_at`, so a future driver UI can show the
  cancellation notice once and let the driver dismiss it (stamped
  client-side, same as `driver_acknowledged_at` today — a low-stakes "seen
  it" flag, not a trusted event time).

**Follow-up (deliberately deferred):** once `DriversManagement.tsx`'s cancel
flow is updated to always call the 2-argument version with a real reason +
password step, a later cleanup migration should drop the original
1-argument `cancel_assignment(p_id)` so an old reason-less cancel path can't
silently remain callable.

**Frontend impact — admin side (ready to build):** `db.ts`'s
`cancelAssignment(id, reason)` already calls the new, reason-requiring RPC —
no further data-layer work needed. The admin cancel flow just needs a reason
text field plus the existing password-confirm pattern (the
`EditAssignmentModal` password step is the closest existing reference), then
call `cancelAssignment(id, reasonText)` with both arguments instead of just
`id`.

**Frontend impact — driver side (BLOCKED, data layer not ready yet):**
`loadDriverData()` in `src/app/lib/db.ts` does not currently read or return
anything about a cancellation — `DriverViewData` has no field for it. Before
any driver-side UI for this can be built, `loadDriverData()` needs a change
to query the driver's own assignments for the most recent row where
`state = 'cancelled' and cancel_acknowledged_at is null`, and return it as a
new field (e.g. `cancelledNotice: { id, reason, cancelledAt } | null`) on
`DriverViewData`. Only after that exists can the driver screen display
`cancel_reason` and call `driverUpdate` with `cancelAcknowledgedAt` set (now,
client-stamped, same as the existing `driver_acknowledged_at` pattern) to
dismiss it. Whoever does this `db.ts` change first unblocks the other.

**Migration required:** Yes — applied and verified against the development
project.

**Approval:** Approved — local development (2026-10-18).

---

## [REQ-005] Verified dispatch location selection and route-area derivation

**Status:** Completed — backend persistence applied to 360Logistics DB and verified (2026-10-20)

**Area:** Dispatch location entry / Driver navigation / route summaries

**Requested change:** Allow dispatchers to select verified pickup and delivery
places, then derive the general Origin and Destination areas from structured
place data rather than typing those areas separately.

**Current implementation:** Dispatch saves an exact `pickup_location`, a
general `destination_area`, and a combined `destination` string containing
`Origin → exact Delivery Location`. The development frontend now uses Mapbox
Geocoding API v6 address autocomplete for pickup and delivery. Every request
uses `permanent=true`; Search Box and temporary geocoding are not used. A
selected result supplies a formatted address, structured city when available,
and coordinates. Dispatch now sends selected coordinate pairs with the exact
pickup and delivery addresses, and edit reloads persisted pairs for map
verification. If city is absent, manual route-area entry remains available.
No provider place ID is stored. Driver
photo capture has reverse geocoding, but those GPS readings describe where
evidence was taken; they cannot validate planned pickup or delivery places.

**Required integration:** Select a real place/address through a provider and
obtain a formatted address plus structured city/area for each stop. Define how
the selected data is validated and persisted before removing manual Origin and
Destination inputs. Preserve the existing route representation and historical
assignments, or migrate them under a reviewed compatibility plan. Store planned
coordinates for both stops after the backend change is reviewed; never infer coordinates or
city names by splitting free-form address text. Protect any provider key that
requires a server-side secret.

**Frontend impact:** Dispatch create/edit forms show a read-only route preview
when both selected results include structured cities, and omit routine manual
Origin/Destination entry in that case. Mapbox map verification opens only
when the dispatcher clicks the icon. Driver route preview uses persisted
coordinates first, then resolves a historical exact address through Mapbox
on explicit request. Typed text without selecting a provider result is not
treated as a verified location.

**Mapbox option chosen (2026-10-20):** [Mapbox Geocoding v6](https://docs.mapbox.com/api/search/geocoding/)
allows permanent results to be stored, but permanent access requires a credit
card on file or an enterprise contract. Geocoding v6 does not return POIs.
[Mapbox's Geocoding documentation](https://docs.mapbox.com/mapbox-search-js/api/core/geocoding/)
requires feature suggestions to be displayed with Mapbox map services, so
development map verification and Driver route preview use Mapbox. The public
`VITE_MAPBOX_ACCESS_TOKEN` should be restricted to approved origins. The web
route preview does not provide live voice-guided navigation.

**Backend implementation (2026-10-20):**

*Database* — extends the existing `public.assignments` table (no new table):

| Column | Type | Status |
|---|---|---|
| `pickup_location` | text | **reused**, unchanged — exact pickup address |
| `pickup_latitude`, `pickup_longitude` | double precision, nullable | new |
| `delivery_location` | text, nullable | new — exact delivery address |
| `delivery_latitude`, `delivery_longitude` | double precision, nullable | new |

`destination` (`Origin → exact delivery location`) and `destination_area` are
unchanged; there is no separate `origin` column — the origin stays inside
`destination`. `double precision` matches the existing `status_photos.lat/lng`.
Optional `pickup_mapbox_id` / `delivery_mapbox_id` were **not** added (not required).

*Validation (database, every write path):* CHECK constraints
`assignments_pickup_coords_check` / `assignments_delivery_coords_check` —
latitude −90…90, longitude −180…180, NaN/±Infinity rejected, latitude and
longitude both set or both null, and coordinates only alongside a non-empty
address. A reversed Philippine pair (latitude ≈ 121) fails the latitude range.

*Stale-coordinate rule:* trigger `assignments_location_consistency`
(`clear_stale_assignment_coordinates()`) clears a stop's coordinates when its
address changes without new coordinates. Drivers cannot change any of these
columns (`guard_assignment_update` already rejects all but status/acknowledgement).

*Create* — Dispatch create is the existing `syncAdminData()` insert into
`assignments` (`db.ts`). The row now also carries `pickup_latitude`,
`pickup_longitude`, `delivery_location`, `delivery_latitude`,
`delivery_longitude` **only when present and valid** (`locationColumnsForRow`),
so rows without exact stops are written exactly as before.

*Edit* — `edit_assignment(p_id, p_changes, p_reason)` now also accepts
`delivery_location`, `pickup_latitude`, `pickup_longitude`,
`delivery_latitude`, `delivery_longitude`. Coordinates must be JSON numbers
(or both null to clear), in range, and sent as a pair; otherwise it raises
`invalid_coordinates` (22023 → the app's `invalid` error). An address change
without coordinates clears the old ones and records that in the audit diff;
re-sending the same point with a relabelled address keeps it. Everything else
(authorization, password re-check, Assigned-only lock, swaps, audit) is unchanged.
App side: `editAssignment(id, changes, reason)` takes the new fields through a
separate `AssignmentLocationEdit` type and rejects NaN / half pairs before sending.

*Read / response* — `assignmentFromRow()` (`db.ts`), used by the admin lists,
View Shipment, Driver Current Task and driver history detail, returns
`pickupLatitude`, `pickupLongitude`, `deliveryLocation`, `deliveryLatitude`,
`deliveryLongitude` alongside `pickupLocation`, `destination`, `destinationArea`.

*Field names for the frontend* (`Assignment` in `data/assignmentTypes.ts`):
`pickupLocation`, `pickupLatitude`, `pickupLongitude`, `deliveryLocation`,
`deliveryLatitude`, `deliveryLongitude` (numbers; null when absent).
Convert Mapbox `geometry.coordinates` `[longitude, latitude]` with
`fromMapboxPosition()` from `lib/assignmentLocation.ts`.

*Historical / null fallback* — all existing assignments keep NULL in every new
column; nothing is backfilled or derived from `destination`. They keep using
`pickup_location` and `destination` (`getDeliveryLocation()`), unchanged.

*Tests* — `src/app/lib/assignmentLocation.test.cjs` (10 unit tests: create/read
round trip, Mapbox order, validation, historical rows) and
`supabase/tests/req005_assignment_locations.test.sql` (create, read, edit,
stale clearing, relabel, validation, historical, driver lock; rolls itself back).

**Verification (2026-10-20, 360Logistics DB):** after both migrations were
applied, `req005_assignment_locations.test.sql` passed all **20 checks**
("REQ-005 TESTS PASSED (20 checks)"), with the driver check run against a real
driver login (not skipped). Confirmed:
- pickup/delivery addresses and coordinates persist on create and come back
  unchanged on read; pickup and delivery edits replace only their own stop;
- invalid coordinates are rejected — out of range, NaN/Infinity, strings,
  reversed pairs, coordinates without an address, and half pairs (latitude
  without longitude or vice versa), both by `edit_assignment` and by the table
  constraints on any write path;
- historical assignments without the new fields still save and edit as before;
- drivers cannot modify assignment coordinates (rejected with 42501).
The test rolled back: 0 test rows or audit entries remained, and 0 live rows
hold a half coordinate pair.

**Search Box excluded:** The previously requested Search JS React/Search
Box approach conflicts with this app's planned storage. [Mapbox Search Box API
documentation](https://docs.mapbox.com/api/search/search-box/) says returned
data is for temporary use and to contact Mapbox sales when position data must
be stored. Do not use Search Box results for assignments. Confirm account
eligibility, expected costs and the Mapbox map/route behavior before deployment.
The development token and permanent-geocoding API were verified locally.

**Migration:** Yes — both applied to 360Logistics DB (2026-10-20):
- `supabase/migrations/20261020000000_assignment_location_coordinates.sql` —
  columns, constraints, stale-coordinate trigger, `edit_assignment` update.
- `supabase/migrations/20261020000001_assignment_location_coords_pair_fix.sql` —
  replaces only the two coordinate-pair constraints so a half pair is rejected
  (the original `... or (lat between ... and lng between ...)` evaluated to NULL,
  which a CHECK accepts). The original file was corrected the same way for
  fresh databases.
The new columns are nullable, so existing inserts are unaffected; the frontend
may now send the new fields.

**Approval:** Development-only frontend provider integration authorized.
Backend persistence requested by the user on 2026-10-20, implemented,
applied to 360Logistics DB and verified (20/20 database checks) on 2026-10-20.

---

## [REQ-004] OPM Role: Fleet/PIN/Account Management Becomes Exclusive

**Status:** In Progress

**Area:** Accounts / Drivers / Trucks / Auth & Roles

**Requested change:**
Replace the 3-role staff model (`admin`, `csr`, `viewer` + an `is_om` flag on
one viewer) with `admin`, `csr`, `opm`. `admin` is kept only because an
existing account already has it — `admin` and `csr` are fully equivalent
everywhere from this point on, nothing admin-exclusive remains. OPM
(Operational Manager) is a real role, not a flag, and is the **only** role —
not even `admin`/`csr` — that may:
- Register, edit, or archive drivers and trucks
- View or reset a driver's PIN
- Create a new staff account (narrowed to CSR only; Viewer accounts can no
  longer be created, since `viewer` is dropped as a role entirely)

Everything else (dispatch, edit/cancel assignments, approve/reject
documents, reading every screen) is untouched. `is_staff()` already covers
any active role, so OPM can still read everything — "view-only in other
modules" per the request.

**Why backend/database support is required:**
`can_write()` (`admin`/`csr`) previously gated drivers/trucks/PIN writes
alongside everything else; narrowing those three specific things to a new
role while leaving the rest of `can_write()`'s scope untouched requires a
dedicated authorization check (`is_opm()`) used only in the policies/
functions this requirement names, not a blanket role-check change — widening
`can_write()` itself would have accidentally handed OPM full write access to
assignments, documents, etc., which was explicitly not wanted.

**Applied migration (2026-10-18):**
`supabase/migrations/20261018000003_opm_role.sql`.
- `profiles.role` check constraint: `admin | csr | opm` (was `admin | csr |
  viewer`). No existing rows used `viewer`, so no data migration needed.
- New `is_opm()` function (role-based) replaces the old `is_om()` flag-based
  one; `is_om` boolean column dropped.
- RLS changed to `is_opm()`-only: `drivers`/`trucks` insert/update/delete,
  `driver_pins` select, `profiles` select (OPM reads all staff; others read
  only their own row) and update (OPM may edit CSR accounts only).
- Functions changed to `is_opm()`-only: `archive_driver`, `archive_truck`,
  `reset_driver_pin`, `sync_driver_login` (also used when first registering
  a driver), `create_team_member` (role check narrowed to `p_role = 'csr'`),
  `remove_team_member` (narrowed to removing CSR accounts).
- Bootstrapped one OPM account directly in the migration
  (`operationalmanager@360logistics.ph`), since OPM-exclusive account
  creation means nothing could create the first OPM through the app.

**Known breaking change (by design):** the single existing `admin` account
immediately loses the ability to register/edit/archive drivers or trucks,
view/reset PINs, or create team members the moment this migration is
applied — those are now exclusively the bootstrapped OPM account's. This
is the explicit intent, not a regression.

**Applied and verified (2026-10-18):** Ran in the Supabase SQL editor.
`profiles` confirmed with both rows (`admin`, `opm`). Logged in as the new
OPM account: Workspace Settings reachable, creating a CSR account
succeeded, registering/editing drivers & trucks and viewing/resetting PINs
all worked.

**Follow-up fix — `20261018000004_opm_activity_log.sql`:** creating the CSR
account succeeded but the frontend's generic activity-log write afterward
failed (`activity_log` RLS only allowed `can_write()`, not `is_opm()` —
`create_team_member` itself is SECURITY DEFINER and logs its own row fine;
this was specifically `syncAdminData()`'s direct table insert used for
actions without a dedicated backend function). Fixed by widening
`activity_insert`'s policy to `can_write() OR is_opm()` — audit-log write
access only, no change to OPM's operational scope anywhere else. Written,
not yet applied.

**Second follow-up fix (2026-10-19) —
`20261019000000_opm_fix_dispatch_status.sql`:** locking `drivers_update`/
`trucks_update` to `is_opm()`-only in the original migration broke ordinary
dispatching for CSR/admin — assigning, completing, and cancelling a
delivery only ever change `drivers.status`/`trucks.status`
(`DriversManagement.tsx` confirmed to touch no other column for these
flows), but to the database that UPDATE looked identical to "edit a
driver/truck's details." Fixed with the same column-guard pattern
`guard_assignment_update()` already uses elsewhere in this schema: RLS
restored to `can_write() OR is_opm()` at the row level, and a new trigger
(`guard_driver_update`/`guard_truck_update`) restricts a non-OPM caller to
changing only the `status` column — OPM remains unrestricted. Written, not
yet applied.

**Frontend impact (partially implemented):**
Verified 2026-10-18 that the backend correctly enforces both directions —
confirmed by reproducing each failure live, not just inferred:
- Logged in as CSR before the frontend follow-up: Register Driver, Register
  Truck, New PIN, and Archive buttons were visible in Drivers & Trucks, and
  each failed with a raw RLS error when used. Resolved by the page change below.
- Logged in as OPM: Approve/Reject buttons are still visible on pending
  documents (Dispatch/View Shipment document review), and fail the same way
  — `assignment_documents` RLS correctly refuses the write, since document
  review stays CSR-only and OPM is view-only there. Same fix needed: hide/
  disable for non-CSR/admin accounts.
- The "invite" flow's role picker already had its Viewer option removed
  (`WorkspaceSettingsPanel.tsx`) as part of this requirement; CSR is the
  only creatable role now.
- Driver-PIN display previously showed "No PIN"/PIN value to CSR in the
  Drivers & Trucks list. Resolved by the page change below;
  `driver_pins_select` already refused CSR's read at the database level.

**Drivers & Trucks frontend follow-up (2026-10-20):** The page now uses the
session role to expose a single `canManageFleetAccounts` capability. Only OPM
sees registration, PIN, and archive controls or dialogs. CSR/admin instead
see a driver table with the active assignment's truck in place of PIN and no
Action column; truck archive actions are also hidden. The loading skeleton
follows the same capability. The existing `is_opm()` RLS policies and RPC
checks remain the server-side enforcement. The document-review visibility
follow-up above remains separate and is not addressed by this page change.

**CSR Dispatch synchronization discovered (2026-10-19; further backend work not approved):**
- `DriversManagement.handleAssignTask()` appends the assignment locally and
  also sets `drivers.status` and `trucks.status` to `Assigned`. The debounced
  `App.saveToServer()` calls `syncAdminData()`, which writes `trucks` and
  `drivers` before `assignments`. Under the OPM-only policies, CSR's truck
  update fails with the reported RLS error before this save reaches the
  assignment insert. Deliveries can still show the unsaved local assignment
  because it reads the same React array; that alone does not prove persistence.
- The new status-only migration above is intended to permit the resource
  status writes again, but it has not been applied or verified. It does not
  make the multi-table dispatch save atomic or prevent duplicate active
  assignments by itself.
- Availability is not purely derived today: `trucks.status` and
  `drivers.status` are stored, the fleet screens and truck picker read them,
  and `edit_assignment()` checks the stored truck status. The assignments
  table has no unique active-driver or active-truck constraint. Merely
  removing the frontend status writes would leave the database saying the
  resources are Available and could permit duplicate dispatches.
- A separate, approved development migration should add a narrowly granted,
  transactional `create_dispatch_assignment` operation. It must authorize
  CSR/admin, lock and validate the selected active driver/truck, reject any
  existing active assignment for either resource, insert the assignment and
  its required document rows, set resource statuses using definer privileges,
  and return the persisted assignment/ASN. Make retries or duplicate submits
  safe.
- Once that operation is available, the frontend should call it directly,
  avoid the local truck/driver master-record writes, refresh from
  `loadAdminData()` after success, and show an assignment-specific error only
  when creation fails. The generic auto-save must not be used as proof that
  a dispatch was created. Review completion/release paths before claiming
  end-to-end CSR availability works.
- The local Dispatch display was adjusted to keep active assignments visible
  even when a linked master record is absent; it does not solve the CSR
  creation transaction.
- Completing a delivery still uses the multi-table `syncAdminData()` path.
  The View Shipment UI can wait for that save before closing, but the server
  does not yet atomically verify `Delivered` plus all six approved documents
  and update assignment state, resource availability, and activity together.
  The local frontend now keeps a six-approved assignment in the active
  Delivered state until the explicit completion save moves it to the persisted
  completed archive; approval alone no longer displays it as Completed.
  A future approved completion operation must enforce those checks server-side
  and make the related writes transactional. Until then, a save error can leave
  partial resource updates, and the UI must not claim completion on failure.

**CSR Dispatch transaction approval:** Not approved. Do not prepare or apply
it until explicitly authorized. The status-only migration above is present
in Git but remains unapplied to development.

**Migration required:** The OPM role migration was applied. The activity-log
follow-up and the status-only Dispatch follow-up are written but not yet
applied to development. The separate CSR Dispatch transaction described
above has no SQL yet.

**Approval:** Approved — local development (2026-10-18).

---

## [REQ-006] CSR password-reset requests with OPM review

**Status:** Backend applied; frontend wired. Live CSR reset test pending.

**Area:** Supabase Auth / Profiles / Workspace Settings / Login

**Approval:** The user reported on 2026-10-20 that both REQ-006 migrations were applied, the SQL suite passed 32/32 checks, and the `complete-csr-password-reset` Edge Function was deployed. The frontend is wired to those existing services.

**Requested change:** CSR submits a reset request, OPM approves or rejects it,
and only an approved CSR can set their own new password — through a one-time
reset link that OPM copies and sends manually. CSR login identifiers look like
email addresses but may have no real inbox, so **no email is involved**. Keep
requests and audit events persistent. OPM never sees or sets the password.

**Final architecture (revised 2026-10-20):**

```text
CSR Forgot Password → request 'pending'
→ OPM approves (Workspace Settings) → 'approved', valid 45 min from approval
→ OPM clicks Copy Reset Link → fresh one-time token; earlier link stops working
→ OPM sends ${origin}/reset-password?token=… to the CSR
→ CSR opens it and chooses a new password
→ Edge Function complete-csr-password-reset → 'completed'; link unusable
```

*Database* — `20261020000002_csr_password_reset_requests.sql` (applied) created
the table, the generic anonymous request RPC, OPM review, 45-minute approval,
RLS and audit events. `20261020000003_csr_password_reset_link_flow.sql` (reported applied)
revises it:
- narrows the existing deferred trigger `enforce_csr_password_reset_at_commit`
  on `auth.users`: its function no longer accepts approvals and instead always
  refuses (`csr_password_reset_requires_opm_link`) an **active CSR's** password
  change made from a Supabase recovery / magic-link / OTP session, so
  Supabase's own reset email cannot bypass OPM. Allowed: the Copy Reset Link
  Admin API path, OPM/admin/service-role Admin API sets, a CSR signed in with
  their current password, other staff, drivers, sign-in. Nothing else on
  `auth.users` is touched;
- adds `reset_token_hash` (SHA-256 hex only — the raw token is never stored),
  `reset_token_created_at`, `reset_token_claimed_at`; "used at" is
  `completed_at` and link expiry is the request's `expires_at`;
- the hash and claim columns are not readable through the API (column grants);
- `create_csr_password_reset_link(request_id)` — OPM only; approved,
  unexpired, eligible active CSR; returns the raw token once, stores its hash,
  replaces any previous link, never extends the 45-minute window, refuses
  (`reset_in_progress`) for 5 minutes while a link is being used;
- `review_csr_password_reset` can now also reject an **approved** request,
  which revokes its link; expiring a request wipes its token;
- `claim_csr_password_reset` / `release_csr_password_reset_claim` /
  `finish_csr_password_reset` — service_role only, used by the Edge Function.

*Edge Function* — `supabase/functions/complete-csr-password-reset/`
(`index.ts` wiring, `logic.ts` rules). Receives `{ token, newPassword }`,
validates (6–72 bytes, matching `create_team_member` and Auth's minimum),
hashes the token, claims it atomically (one caller wins; replays and
parallel requests get `reset_link_invalid_or_expired`), changes the password
with the Auth Admin API `updateUserById` (which also signs the CSR out
everywhere), then completes the request and logs `password_changed`. If Auth
refuses the password (4xx) the claim is released so the CSR can try another
password; if the result is unknown (network/5xx) the link stays used and OPM
copies a new one. The service-role key exists only inside the function.

*Statuses for Workspace Settings:* Pending, Approved (show **Copy Reset Link**;
`reset_token_created_at` tells whether a link was already copied), Rejected,
Completed, Expired (an approved request past `expires_at` displays as
Expired; it is stored as `expired` the next time that CSR submits a request).
There is no Resend concept and no recovery email, `resetPasswordForEmail`,
redirect allow-list entry or recovery session in this workflow — and a CSR
password change from such a session is actively refused (see above).

*Activity log:* `password_reset_requested`, `password_reset_approved`,
`password_reset_link_generated` (one per Copy click — kept, since each click
creates a new valid link), `password_reset_rejected`, `password_changed`.
Never the token, hash, password or keys.

*Tests:* `supabase/tests/req006_csr_password_reset.test.sql` (32 checks, rolls
itself back) and `node --test supabase/functions/complete-csr-password-reset/logic.test.cjs`
(11 tests).

**Verification still required:** A live end-to-end reset with a designated test
CSR account. The frontend now uses Copy Reset Link and `/reset-password`; the
old recovery-email helpers were removed. The SQL suite and Edge Function health
were reported as passed by the user, not rerun by Codex against the shared project.

**Current local connection:** The user confirmed on 2026-10-20 that localhost
connects to a production/shared Supabase project. Codex must not apply SQL or
exercise the reset flow there. The user applies SQL manually in the SQL Editor.
The frontend no longer has a development-only feature gate, because the user
reported the backend as ready and requested the changes be pushed. Backend RLS
and the Edge Function remain the security boundaries.

**Existing onboarding limitation:** The separate Add Team Member flow still
asks OPM to set an initial CSR password and displays it once. This reset work
does not expose a reset password to OPM, but meeting the broader goal that OPM
never sets any CSR password requires converting member creation to an Auth
invitation where the CSR chooses the initial password. Keep that work in this
entry rather than adding a duplicate requirement.

---
