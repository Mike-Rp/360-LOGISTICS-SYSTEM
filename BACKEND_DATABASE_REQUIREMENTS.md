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

**Status:** In Progress

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

**Implementation status:** Prepared locally; database and end-to-end verification pending

**Blocked:** Development Supabase migration requires authorized Supabase access.

**Prepared migration:** `supabase/migrations/20261017000000_destination_area.sql`.
It adds nullable `public.assignments.destination_area`, requires a nonblank
value on new assignment inserts, and extends the existing protected
`edit_assignment` function to update that field. It leaves the current
`destination` route and historical rows unchanged.

**Local activation after an authorized developer applies the migration:**
1. Confirm the SQL editor is connected to the development project used by
   `.env.local`, then execute the complete migration file there. Do not run it
   against production. The repository's `supabase/config.toml` may name a
   different project, so verify the target explicitly.
2. Verify the `destination_area` column, insert trigger, and updated
   `edit_assignment` function exist. Existing rows should retain NULL in the
   new column.
3. Set `VITE_DESTINATION_AREA_ENABLED=true` in local `.env.local` and restart
   `pnpm dev`. The default is false, so the local app keeps using its existing
   form and write payload until this step. The migration requires Destination
   on new inserts, so pause assignment creation between applying the SQL and
   enabling this setting. Old clients with the setting off cannot create new
   assignments after the migration.
4. Create and read back a development test assignment with distinct Origin,
   Destination, and Delivery Location. Verify Dispatch, Deliveries, Driver
   details, editing, and refresh before marking this requirement Implemented.

**Local files prepared:** `src/app/data/assignmentTypes.ts`,
`src/app/data/assignmentRoute.ts`, `src/app/lib/db.ts`,
`src/app/components/admin/DriversManagement.tsx`,
`src/app/components/admin/DeliveryTable.tsx`,
`src/app/components/admin/Reports.tsx`, `src/app/components/admin/Charts.tsx`,
`src/app/components/driver/DriverInterface.tsx`,
`src/app/components/driver/driverI18n.tsx`, and `.env.example`.

---

## [REQ-002] Persisted Driver Pickup, Loading, Arrival, and Unloading Workflow

**Status:** Pending

**Area:** Driver App / Dispatch / Deliveries / Dashboard / Photos / Reports

**Requested change:**
Extend the physical-delivery flow from Assigned → Picked Up → In Transit →
Delivered to include arrival at pickup, four pickup truck-condition photos,
loading start and finish, four pre-trip truck-condition photos, arrival at the
delivery location, unloading start and finish, and the required/optional photo
rules. Keep the existing six-document review flow after physical delivery.

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
- Define stable photo category keys for pickup front/left/right/rear, optional
  before loading, required after loading, pre-trip front/left/right/rear,
  optional before unloading, and optional/recommended after unloading. Reuse
  `status_photos` and the private Storage bucket if their permissions and
  replacement behavior suffice; add storage/schema support only if inspection
  during implementation proves necessary. A photo counts only after its row
  and file persist successfully.
- Expose the same canonical stage and event times to Admin Dispatch,
  Deliveries, Dashboard/Recent Activity, Driver, and Delay Reports.

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

**Approval:** Not approved

**Implementation status:** New stages not started. Current-schema driver UI
improvements in `DriverInterface.tsx` clarify the dashboard back action and
next step, provide a direct document action after delivery, and wait for real
status-photo writes before showing a successful transition. These do not
activate pickup arrival, loading, destination arrival, or unloading stages.

**Blocked:** New persistent stages, trusted event times, transition validation,
and required photo gates need explicit development-backend/schema approval and
an authorized Supabase migration. The separate REQ-001 Destination migration
also remains unapplied, so its local feature flag stays off.

---
