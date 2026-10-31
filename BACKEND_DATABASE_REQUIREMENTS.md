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

## Current status (as of 2026-10-21)

All migrations below were applied by hand in the SQL Editor on 360Logistics DB
and their SQL test files passed (each test rolls itself back).

| Item | Migration | Tests | Status |
|---|---|---|---|
| REQ-001 Destination / delivery location | `20261017000000`–`000003` | — | Implemented |
| REQ-002 Driver stages + photo/status gates | `20261018000000`, `000001`, `20261021000002`, `20261023000011` | `req002_driver_gates` 11/11 | In Progress (gates live; see entry) |
| REQ-003 Cancel: reason + password + Loading cutoff + driver notice | `20261021000000`, `20261018000002`, `20261025000001`, `000002` | `req003_cancel_cutoff` 16/16 | Implemented |
| REQ-004 OPM role | `20261018000003`, `000004`, `20261019000000`, `20261023000004`, `000007`, `000010`, `20261025000006`, `20261026000000`, `000002` | — | Implemented |
| REQ-005 Exact pickup/delivery coordinates | `20261020000000`, `000001` | 20/20 | Completed |
| REQ-006 CSR password reset via OPM link | `20261020000002`, `000003` + Edge Function | `req006` 32/32 | Implemented — live test passed |
| REQ-009 Single active session (newest login wins) | `20261021000001` | `single_active_session` 15/15 | Implemented |
| REQ-010 Store file paths, 1-hour links | `20261021000003` | `store_file_paths` 4/4 | Implemented |
| REQ-011 Dispatch / complete as one database action | `20261021000004`, `20261023000003` (hardening) | `dispatch_complete` 12/12 | Implemented |
| REQ-012 Per-account profile persistence | `20261022000000`, `20261026000001` (name/avatar validation) | — | Implemented |
| REQ-013 Completion/cancellation timestamps | `20261022000001` | — | Implemented |
| REQ-014 Driver notifications (dispatch/cancel/issue resolved) | `20261025000003` | — | Implemented |
| REQ-015 Server-side duplicate operational photo detection | `20261025000004`, `000005` + Edge Function | `logic.test.cjs` 8/8 | Implemented |
| REQ-016 Login lockout (5 failures → 5 min, staff + driver) | `20261031000000`, `000001`, `000002` + Edge Function `login` | `login_lockout` 10/10, `logic.test.cjs` 10/10 | Implemented — live test passed |
| REQ-008 Recoverable delivery issues | `20261023000000`–`20261023000002` | — | Implemented |
| REQ-007 Report ID + QR verification | `20261023000008`, `000009` | — | Implemented |

### Still needed (backend / database)

1. ~~**Activity-log gaps** (REQ-004 follow-up)~~ — **Closed 2026-10-26.** PIN
   reset (2026-10-23), document approve/reject (2026-10-25), truck
   registration and driver registration (2026-10-26) are all now dedicated,
   atomically-logged server-side RPCs. See REQ-004 entry for details.
2. ~~**REQ-006** live test~~ — **Closed 2026-10-26.** Full end-to-end reset
   verified with a throwaway test CSR account, including a successful
   sign-in with the new password. See REQ-006 entry for details.
3. **Optional:** move files copied before REQ-010 so that old 10-year links
    stop working (skipped for now by decision).
4. ~~**Data review**~~ — **Reviewed 2026-10-26, no change made (by decision).**
   `ASN65961`: stale test-era row from early REQ-002 development — Delivered
   but never run through `complete_assignment()`, predates reliable
   `departed_at` stamping. `ASN59379`: cancelled with `operational_stage =
   'loaded'` and no reason, via the old pre-REQ-003 unrestricted cancel
   path — exactly the state the current `cancel_assignment()` would now
   refuse (`loading_completed`), good evidence that fix was solving a real
   problem. (Two other cancelled-with-`operational_stage` rows found during
   this review, `ASN03578`/`ASN61867`, turned out to be false positives —
   both cancelled at `pickup_arrived`, which the current rule already
   explicitly allows.) Neither remaining row is an active bug; both are
   inert historical artifacts, left as-is.

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

## DRIVER OPERATIONAL PHOTO EVIDENCE — BACKEND REQUIREMENTS

**Status:** Per-photo metadata done via **DRIVER PHOTO UPLOAD METADATA —
REQ09** below. The group-reference table originally described in this entry
(one independently-measured location per pickup/loading/pretrip/unloading
group, distinct from each photo's own GPS) was discussed with the user and
**deliberately not built** — on review, it would only have added a 5th data
point next to each group's photos with no automatic comparison, so it
wouldn't actually have delivered the transparency/discrepancy-checking the
user was really asking about. Built a smaller, better-targeted alternative
instead — see below. Nothing in this entry is open anymore.

**2026-10-26 — Photo location-mismatch flagging, applied and verified live
(pure frontend, no migration needed):** the real question this entry was
trying to answer — "what if a driver isn't actually where a photo claims?"
— turned out to be answerable entirely from data already captured by REQ09
(each photo's own `lat`/`lng`), with no new table or backend change at all.
`src/app/lib/assignmentOperational.ts` gained `findGroupLocationOutliers()`:
for each operational photo group, compares every photo to its *closest*
neighbor in that same group (not to the group's average — a single lone
outlier would otherwise drag the average far enough to make every normal
photo look wrong too; this bug was caught and fixed during live testing,
see below) and flags any photo more than 500m from its nearest neighbor.
`ShipmentPhotoEvidence.tsx` (shared by both active shipments and completed-
delivery summaries) shows a "Location mismatch" badge on the group header
and a specific "Far from this group's other photos — worth a second look."
note on the flagged photo itself — framed as a soft signal for a human to
check, not an automatic verdict.

Verified live on `ASN26483`'s real pickup-photo group: moved one photo's
coordinates ~30km away via SQL to simulate a mismatch — first attempt
(centroid-based) incorrectly flagged all 4 photos, not just the moved one;
fixed to the nearest-neighbor approach, which correctly flagged only the
moved photo. Reverted the test coordinates and confirmed the flag
disappeared with no false positives on the group's normal, tightly-clustered
real data.

### Current contract and gap

`public.status_photos` has one row per `(assignment_id text, status text)` and
stores `url text`, `taken_at text`, `location text`, `lat double precision`, and
`lng double precision`. The frontend writes the row after uploading to the
private `make-ee4d169c-media` bucket. `taken_at` is currently a client label
created when a file is selected; it is not verified shutter time. The table
does not store GPS accuracy, source provenance, a server upload timestamp, or
a group reference location. There is no reliable way to reconstruct these
values from existing rows. A Gallery selection must not be described as a
fresh camera capture or assigned the device's current location as the image's
original location.

### Data and operations

- Extend `public.status_photos` with nullable reported GPS accuracy in meters
  (`double precision`, nonnegative when present), a constrained source value
  (for example `camera`, `gallery`, `unknown`), a server stamped upload instant
  (`timestamptz`), and separate nullable original capture instant/coordinates
  only when their provenance is verified. Keep legacy `taken_at` and
  `location` readable during migration. Existing `lat`/`lng` must retain their
  documented meaning; do not silently reinterpret them as group coordinates.
- Persist one independently measured reference per assignment/photo group
  (`pickup`, `loading`, `pretrip`, `unloading`) using a dedicated table keyed by
  `assignment_id text` (FK to `public.assignments.id`) and group key, or an
  equivalent guarded model. Store measured latitude/longitude, reported
  accuracy, observation time, optional derived display address, and the actor
  who recorded/refreshed it. A fresh group reference may help presentation;
  it must never overwrite each photo's measured coordinates.
- Provide guarded operations to fetch/create/refresh a group reference and
  upload/replace a photo with its metadata. Return explicit source, upload
  time, verified capture time if available, per-photo coordinates/accuracy,
  and group coordinates/accuracy/observed time to the existing assignment
  fetch paths. The frontend can then show a group reference and photo GPS as
  distinct facts and refresh a stale/poor reference without altering photos.
- Continue using the private media bucket and signed URLs. Validate the
  assignment/slot and caller server side. A Driver may write only evidence for
  their own active assignment; CSR/OPM access stays within existing roles.
  Replacement must preserve the last valid photo until the new object and row
  save succeed. Restrict object paths to the assignment/slot or another
  server validated namespace; do not expose the whole bucket publicly.
- If any slot requires live camera evidence, enforce that policy server side.
  A browser `capture` hint or client supplied `source` value alone cannot
  prove camera provenance. Define an accepted verification mechanism before
  rejecting Gallery for a slot. Keep current stage/photo validation rules
  unchanged until that decision is made.

### Migration and backend tests

Use an additive migration. Leave historical accuracy, source, original capture
time, and group references null/unknown unless a trustworthy audit source
exists. Never infer them from `taken_at` text, current device GPS, dispatch
coordinates, or reverse geocoding. Test authorized reads/writes, cross-driver
and cross-assignment denial, concurrent photo replacement, failed upload
rollback, server upload timestamp, source handling, accuracy bounds, group
refresh/staleness, and legacy rows with unavailable provenance. Frontend
group-reference display and durable per-photo accuracy/source history remain
blocked until this contract is implemented.

---

## DRIVER PHOTO UPLOAD METADATA — REQ09

**Status:** Implemented and verified live (2026-10-25)

**2026-10-25 — Implementation:** `supabase/migrations/20261025000000_status_photo_metadata.sql`.
Fully additive — 5 new nullable columns on `public.status_photos`:
`uploaded_at`, `capture_observed_at`, `gps_observed_at`, `gps_accuracy_m`
(check `>= 0`), `source` (check in `camera`/`gallery`/`unknown`). No RLS
change — the existing `photos_insert`/`photos_update` policies already
authorize exactly the right callers. `uploaded_at` is server-stamped via a
`BEFORE INSERT OR UPDATE` trigger (`stamp_status_photo_upload()`) rather than
a new RPC — simpler than REQ-013's flag-per-RPC pattern since this isn't
"only one function may set it," it's "every write gets stamped," so a plain
trigger suffices. The other 4 columns stay client-reported, same trust level
as the existing `taken_at`/`location`/`lat`/`lng`. Legacy rows keep all 5
null — never backfilled or inferred.

Frontend: the GPS-preview screen (already live, built separately) was
already reading and displaying accuracy/GPS-time/source at confirmation —
none of it previously survived into the saved row. `assignmentTypes.ts`'s
`StatusPhoto` gained `gpsAccuracyM`, `gpsObservedAt`, `source`,
`captureObservedAt`, `uploadedAt` (read-only). `DriverInterface.tsx`'s
`PhotoSheet.confirmPhoto()` now merges the already-captured accuracy/GPS-time
into the submitted object instead of discarding them.
`driverPhotoEvidence.ts`'s `savedPhotoMetadata()` sets `source` and derives
`captureObservedAt` from the existing camera timestamp (no new tracking
needed — reuses data already present). `db.ts` reads/writes all 5 columns in
both write paths (`driverUpdate()`'s upsert and the generic auto-save
`flatten()`).

Verified live on `ASN28950`: retook photos via Gallery — `source: 'gallery'`,
`gps_accuracy_m: 5000`, `gps_observed_at` populated, `uploaded_at`
server-stamped a moment after each save, `capture_observed_at` correctly
null (camera-only field). Camera-specific `capture_observed_at` wasn't
live-tested (no webcam on the test machine) but is a one-line, already
type-checked derivation (`source === 'camera' ? photo.timestamp : null`)
using the exact same data-flow already proven by the Gallery test.

**Original request (superseded by the above):**

### Existing backend support

`public.status_photos` is keyed by `(assignment_id text, status text)` and has
`url text`, `taken_at text`, `location text`, `lat double precision`, and
`lng double precision`. The Driver uploads an image to the private
`make-ee4d169c-media` bucket through `uploadImage`, then `driverUpdate`
upserts the slot row. Both Driver and staff fetch those same rows. Thus a
client-observed Camera event time, a client-observed Gallery upload-success
time, and a fresh device location can be written through today's fields.
The frontend now requests Gallery GPS at confirmation and stamps its legacy
`taken_at` only after Storage upload succeeds. This is a **client-clock**
upload-success time, not a server-confirmed commit time. For Camera,
`taken_at` is when the app received the captured file, not verified shutter
time. `lat`/`lng` are device readings at submission, not original Gallery
image coordinates. Current CSR/OPM reads already receive these legacy fields.

### Missing capabilities and required behavior

- Add a server-stamped `uploaded_at timestamptz` for each successful photo
  replacement/insert. Return it to Driver and CSR/OPM. The stamp must be tied
  to the committed photo row, not to picker opening or a failed Storage upload.
- Add a nullable `capture_observed_at timestamptz` for Camera file-return time.
  This is distinct from `uploaded_at`; do not call it verified shutter time.
- Add a constrained `source` (`camera`, `gallery`, `unknown`) and nullable
  nonnegative `gps_accuracy_m double precision` on `public.status_photos`.
  The browser's camera capture hint is not proof of original image provenance;
  define the trust level of the stored source accordingly.
- Preserve `lat`/`lng` as individual device GPS at submission. Record the
  observation time and clarify whether `location` is a reverse-geocoded device
  reading. Do not equate it with original Gallery EXIF location or the separate
  photo-group reference from the prior section. No EXIF extraction is required
  for upload-event evidence.
- Expose an authorized atomic metadata-save or photo-finalization operation
  for the existing assignment/slot, ideally coordinated with the private
  Storage object. Reject cross-assignment writes. On failed replacement,
  retain the prior row/object; avoid duplicate records and orphaned objects.
  Preserve existing photo quality, GPS, and stage gates.

### Frontend contract, migration, and tests

Return the saved `status_photos` slot with its `url`, `source`,
`capture_observed_at`, `uploaded_at`, `lat`, `lng`, `gps_accuracy_m`,
`location`, and device-location observation time through the existing Driver
and staff assignment fetches. Update `src/app/lib/db.ts` mapping and
`StatusPhoto` only once these fields exist. Photo Details can then label
Camera and Gallery times/locations consistently after reload and in CSR/OPM
views. Until then, saved source and accuracy must display as unavailable;
the client must not infer them from filename, GPS, or `taken_at`.

Use an additive migration. Leave unknown historical source, accuracy, and
capture-event time null. Do not backfill a server upload instant from a
yearless label or current time. Test Camera and Gallery saves with and without
GPS, server timestamp on successful commit, failed replacement retaining old
evidence, concurrent replacement of one slot, legacy rows, staff read access,
and denial of other drivers' assignments.

---

## DRIVER PHOTO GPS PREVIEW — REQ13

**Status:** Implemented and verified live (2026-10-25) — see
**DRIVER PHOTO UPLOAD METADATA — REQ09** above for the full implementation;
this item had no backend task of its own beyond REQ09's contract, which it
now consumes end-to-end (confirmed: accuracy/GPS-time/source shown by this
preview screen now actually persist past the moment of upload).

**Original request (superseded by the above):** durable accuracy, GPS reading
time, source, and server-confirmed upload time. The frontend preview itself uses
the existing browser geolocation API and requires no backend change.

The current `status_photos` row and `driverUpdate()` path persist the assignment
and photo slot, private Storage URL, legacy `taken_at` and `location` text, and
individual device `lat`/`lng`. They do not persist the browser-reported accuracy,
GPS observation time, Camera/Gallery source, or a server-confirmed upload time.
The preview may show those values from the current selection, but a reload or
CSR/OPM viewer cannot truthfully reconstruct them. The Gallery selection time
must not be stored as its original capture or final upload time. Existing
photo-group reference coordinates remain distinct from each photo's GPS.

Implement the additive metadata and guarded photo-finalization contract already
specified in **DRIVER PHOTO UPLOAD METADATA — REQ09**. Return the committed slot
with `uploaded_at`, `capture_observed_at` where applicable, `source`,
`gps_accuracy_m`, device GPS observation time, `lat`/`lng`, and derived display
location to Driver and authorized staff fetches. The server must validate Driver
ownership, assignment and slot, preserve the prior evidence on failed
replacement, and keep the private media bucket private. Test Camera and Gallery
metadata, no-GPS saves under current rules, stale/retried preview readings,
cross-driver denial, failed replacement, and staff reads. Do not infer missing
historical metadata or change existing photo quality and stage gates.

---

## [REQ-014] Driver Notifications

**Status: Implemented and verified live (2026-10-25)** for 3 of the 4 events
described below — dispatch, cancellation, and issue resolution. Document
rejection is deliberately **not** included; see the note at the end of this
entry.

`supabase/migrations/20261025000003_driver_notifications.sql` — applied and
verified. `notifications` gained `recipient_driver_id` (nullable FK to
`drivers`, null = existing staff row, unchanged) and `read_at`. `notifs_select`
RLS now also allows `recipient_driver_id = my_driver_id()`. Two new guarded
RPCs, `mark_driver_notification_read(p_id)` and
`mark_all_driver_notifications_read()`, are the only way a driver can change
`read`/`read_at` — no direct UPDATE grant was added. `dispatch_assignment()`,
`cancel_assignment()`, and `resolve_assignment_issue()` each got one new
idempotent insert (deterministic id, e.g. `'notif-dispatch-'||id`, with
`on conflict do nothing`) — otherwise unchanged from their previously applied
versions. `loadAdminData()`'s notifications query now excludes
`recipient_driver_id is not null` rows so they never surface as staff cards or
get touched by the admin auto-save diff engine. `loadDriverData()` fetches the
driver's own rows in the same call used for everything else (no new polling
interval) as `DriverViewData.notifications`.

Frontend (`DriverInterface.tsx`): the drawer's old "not available yet" banner
is replaced by a real list (`RealNotificationRow`), an unread-count bell badge,
tap-to-mark-read, and "Mark all as read". The sound-on-new-notification logic
reuses the same `newNotificationIds`/`playNotificationSound` pattern already
used for document-review chimes. The pre-existing client-derived document
review section (approve/reject cards, no persistence) is kept underneath,
unchanged, exactly as this entry's original design called for.

**Verified live:** dispatched a test assignment (`ASN14430`) — driver saw an
unread badge and "You have a new delivery: Calamba → Hub"; reported and
resolved an issue on it — "Your reported issue on ASN14430 has been resolved."
appeared; cancelled it — "Your delivery ASN14430 was cancelled." appeared
alongside the separate REQ-003 cancellation dialog (two different, intentional
surfaces from the same `cancel_assignment()` call). Tapped one row to mark it
read (badge count dropped), then "Mark all as read" to clear the rest.
Confirmed via SQL that all 3 rows persisted `read = true` with real `read_at`
timestamps, not just local UI state.

**Deliberately deferred — document review events:** approve/reject now use
dedicated RPCs (`20261025000006_document_review_rpcs.sql`), but those RPCs do
not create Driver-targeted notification records. The Driver Portal still shows
current document status summaries without persisted read state or event time.

### DRIVER UI CHANGES - REQ16 follow-up — persistent document review alerts

**Status: Implemented and verified live (2026-10-27).**
`supabase/migrations/20261027000000_document_review_driver_notifications.sql`.
`approve_document()`/`reject_document()` (unchanged otherwise from
`20261025000006_document_review_rpcs.sql`) each gained one idempotent
`notifications` insert — deterministic id (`'notif-docapproved-'||assignment_id||'-'||doc_type`,
same for rejected), driver-targeted (`recipient_driver_id`), with the review
timestamp and rejection reason where applicable — same pattern as the other
3 driver notification events from REQ-014. `notifications.type` widened for
`driver_doc_approved`/`driver_doc_rejected`. No frontend fetch change needed
(the existing per-driver notification query is type-agnostic); added proper
icons (FileCheck/FileX) and titles instead of the generic fallback, in both
English and Filipino. The existing client-derived "Current document reviews"
section is kept, unchanged, alongside the new real feed — exactly as this
entry originally asked.

Verified live on `ASN58685`: approved "Proof of Delivery" and rejected
"Receiving Acknowledgement Report" — both correctly appeared in the driver's
notification feed with the right icon/title/message/read-state, confirmed
via SQL (`notif-docapproved-ASN58685-Proof of Delivery`,
`notif-docrejected-ASN58685-Receiving Acknowledgement Report`, correct
types/messages/read flags persisted).

### A. Existing implementation (pre-2026-10-25, kept for reference)

The Driver drawer could not truthfully show a persisted notification feed,
unread count, or Mark as Read actions with the previous table, policies, and
client helpers. The Driver UI derives document review summaries from its
active assignment's document statuses; these are useful shortcuts, but are not
notification rows and have no read state or trustworthy event time.

### A. Existing implementation

`public.notifications` has `id text` PK, `type` constrained to `doc_upload`,
`status_update`, `delay_report`, `issue_report`, `message`, `assignment_id text`,
`driver_name`, `truck_plate`, optional `doc_type`/`status_update`/`reason`,
`read boolean default false`, `time_label`, `navigate_to`, and
`created_at timestamptz default now()`. It has no recipient Driver ID. Its
`notifs_select` policy is staff-only; `notifs_update` allows `can_write()`
staff only. Drivers can insert a row for an assignment they own but cannot
read or mark any row. `loadAdminData()` fetches the staff feed;
`markNotificationsRead(ids)` writes its `read` flag as a staff action.
`loadDriverData(driverId)` fetches assignment, documents, photos, and delays,
but no notification rows. Driver login has the stable `drivers.id` and backend
`my_driver_id()` derives that identity from the authenticated user. Current
Driver document-review sound is based on status transitions, not persisted
notification IDs.

`dispatch_assignment` writes `task_assigned` activity, not a Driver
notification. Staff cancellation currently inserts a staff `status_update`
notification via `notifyAssignmentCancelled`; document rejection changes a
document row and activity but has no Driver-targeted notification. Issue
resolution does not create a Driver notification in the inspected path.

### B. Recipient, payload, and event creation

Extend the **existing** `public.notifications` architecture with a nullable
`recipient_driver_id text` FK to `public.drivers(id)` for Driver-targeted
rows. Keep current staff rows distinguishable (null recipient or an explicit
audience) and ensure `loadAdminData()` does not treat Driver rows as staff
cards. Do not derive ownership from `driver_name`, truck plate, or a mutable
assignment relationship after reassignment. Return `id`, recipient ID,
event type, `message`/title data, `assignment_id`, optional `doc_type`,
`created_at`, `read`, and any `read_at` chosen for audit. Use the full
`created_at` instant for Manila grouping; `time_label` is display-only.

Create one idempotent Driver notification for actual supported events:
successful assignment dispatch (inside or after the guarded operation with
reliable retry), authorized assignment cancellation, document rejection, and
issue resolution once that backend workflow exists. Link each row to the
correct Driver at event time. Decide whether document approval is also a
Driver event; current UI shows that review status but no persisted event.
Extend the `type` constraint or add a clear event subtype for the chosen
Driver events. Never create rows from polling or inferred frontend changes.
Keep the existing staff notification/business rules intact.

### C. Read state and authorization

Permit a Driver to **select only** rows with
`recipient_driver_id = public.my_driver_id()` and an active valid session.
Provide guarded operations such as `mark_driver_notification_read(p_id text)`
and `mark_all_driver_notifications_read()` that change only `read` (and
`read_at`, if added) for that caller's rows. Return affected IDs/count and
updated state. Do not grant a Driver unrestricted UPDATE of notification
message, recipient, type, or assignment fields. Staff read/update behavior
must continue as before. The frontend needs a scoped fetch ordered by
`created_at desc` (including read and unread rows) and an unread count from
the same authorized dataset. A persisted read flag must survive polling,
refresh, and sign-in; opening the drawer alone must not mark rows read.

### D. Frontend integration and tests

After deployment, add Driver-scoped fetch and read helpers in
`src/app/lib/db.ts` and include the feed in the existing Driver poll rather
than adding an interval. Gate results by Driver ID and the existing poll
sequence/session checks. Seed observed notification IDs on first successful
load; play the shared sound once for a later batch of new IDs when enabled.
Only show Mark as Read / Mark All as Read after the corresponding backend write
succeeds; derive the bell badge from persisted unread rows. Group by the
existing `Asia/Manila` Today/Yesterday/Earlier helper and route actions only
from an explicit assignment/document target. Keep document review status
shortcuts independent of notification read state.

Backend tests: recipient assignment and cross-driver isolation; event creation
and idempotency for each supported event; correct assignment/doc payload;
ordered fetch and unread count; marking one and all without deleting rows;
read persistence after refresh; denial of another Driver's read/update;
staff feed separation; concurrent duplicate read calls; and old/replaced
session denial. Frontend functional tests remain blocked until these reads,
writes, and persisted event rows exist.

---

## [REQ-015] Server-Side Duplicate Operational Photo Detection

**Status:** Implemented and verified live (2026-10-25)

**Area:** Driver App — operational evidence photos (pickup/loading/pretrip/unloading)

**Requested change (adviser-driven):** A driver should not be able to reuse
the same "stock" photo of their truck as evidence across different
deliveries/reports — e.g. submitting an old undamaged-truck photo when the
truck actually has a new, real problem, masking it from review.

**Why backend/database support is required:** The check has to be genuinely
server-side. If the hash were computed in the browser and only checked before
a normal client write, a tampered client could still pass the check with a
real photo, then write a different/fake hash straight to the row afterward —
defeating the check for every future comparison. A trustworthy check means
the same trusted step that computes the hash also has to be the one that
saves the photo.

**Implemented:**
- New Edge Function `supabase/functions/upload-operational-photo` (service
  role) is now the only path that can write an OPERATIONAL-category
  `status_photos` row (pickup/pretrip/loading/unloading — 12 keys). It:
  verifies the caller is a real signed-in driver who owns the assignment
  (via a client scoped to the caller's own JWT, governed by the existing
  `assignments_select` RLS — never the service role for this check); computes
  SHA-256 of the photo bytes it actually receives (never trusting anything
  the client claims about its own photo); rejects an exact repeat of any
  operational photo ever saved by **any** driver; and only if it's new,
  uploads to Storage and saves the `status_photos` row itself, hash included,
  in one step. Pure decision logic lives in `logic.ts` (unit tested,
  `logic.test.cjs`, 8/8 passing); `index.ts` wires it to Supabase.
- `supabase/migrations/20261025000004_operational_photo_duplicate_guard.sql`
  — adds `status_photos.file_hash` (+ index), and tightens `photos_insert`/
  `photos_update` RLS so a driver's own browser can no longer write one of
  the 12 operational categories directly — only the Edge Function can. The
  **legacy milestone photos** (the older one-photo-per-`Picked Up`/
  `In Transit`/`Delivered` mechanism, a separate code path) and staff
  (`can_write()`) are completely untouched; this is scoped to operational
  evidence photos only, per the actual scenario described.
- `supabase/migrations/20261025000005_grant_service_role_status_photos.sql`
  — fix applied after the first live test failed with "permission denied for
  table status_photos": every other Edge Function in this project only ever
  touches the database through RPCs (each with its own
  `grant execute ... to service_role`), so this project had never needed a
  direct table GRANT for `service_role` before. Granted
  `select, insert, update on status_photos to service_role`.
- Deployed via `npx supabase functions deploy upload-operational-photo`, with
  a new `PHOTO_UPLOAD_ALLOWED_ORIGINS` secret (same origins as
  `RESET_ALLOWED_ORIGINS`) for CORS.

**Deliberate scope limits:**
- Detection is **exact-content hashing only** (SHA-256 of the file bytes),
  not visual/perceptual similarity — this matches the actual scenario
  described (reusing the same stock file), not a driver taking a genuinely
  new photo that happens to look similar.
- Hashing/blocking applies to **operational evidence photos only**, not the
  6 formal documents (`assignment_documents`) and not legacy milestone
  photos — scoped to what was actually asked for.
- Scope is **across all drivers** (a shared stock photo passed around would
  still be caught), per explicit decision.
- On a match, the upload is **blocked outright** (not just flagged for
  review), per explicit decision.

**Frontend:** `db.ts` gained `uploadOperationalPhoto()` (calls the Edge
Function via `supabase.functions.invoke`, re-signs the returned path for
immediate display, same tail as the existing `uploadImage()`) and a
`DuplicatePhotoError` class. `DriverInterface.tsx`'s
`handleOperationalPhotoConfirmed` now calls this instead of
`uploadImage()` + `driverUpdate()` directly; `PhotoSheet`'s `confirmPhoto()`
shows a dedicated message (`photo.duplicateError`, English + Filipino) when
that specific error comes back, instead of the generic save-failed message.

**Verified live (2026-10-25):** uploaded a genuine first-time photo for
`ASN82575`'s `pickup_front` — saved normally, confirmed via SQL with a real
`file_hash`. Re-selected that exact same gallery image for `pickup_left` —
rejected with "This looks like a photo you've used before. Please take a new
one.", confirmed via SQL that **no row was created** for the rejected
attempt. Took a genuinely different photo for `pickup_left` afterward —
saved normally, confirming the check only blocks true duplicates.

**Migration required:** Yes — both applied and verified against the shared
project, plus one Edge Function deployed.

**Approval:** Approved — local development (2026-10-25).

**2026-10-26 — bug found and fixed (frontend only, no new migration):** live
testing surfaced gallery-sourced operational photos saving with a blank
`taken_at`. Cause: a gallery pick's `photo.timestamp` starts empty
(`galleryPhotoMetadata()`) and is normally filled in with "now" by
`savedPhotoMetadata()` before being persisted — but that fill-in happened
*after* the call to `uploadOperationalPhoto()` in `handleOperationalPhotoConfirmed`,
so the Edge Function (which now owns the actual write) received and saved the
still-empty value. Fixed by computing the "now" fallback before sending, so
the Edge Function receives the same corrected value `savedPhotoMetadata()`
uses for the local state. Verified live: a fresh gallery upload after the fix
showed a correct timestamp in the admin preview; photos uploaded before the
fix (while the bug was live) keep showing "Date unavailable" permanently,
since the real capture time was never captured — expected, not fixable after
the fact, same as any other historical-data gap in this project.

**2026-10-26 — separate, pre-existing bug found and fixed while investigating
the one above (unrelated to REQ-015 itself):** `assignment_documents.uploaded_at`
has been server-stamped by a trigger since `20261017000001_document_uploaded_at.sql`,
but `db.ts`'s shared `docFromRow()` — used by every document list in the app
except one — never actually read that column into the frontend's
`AssignmentDoc` objects, so "Date unavailable" showed for every document
everywhere, including ones uploaded seconds earlier, regardless of whether
the database actually had a real timestamp. Only `loadDriverCompletedDelivery()`
had a manual, duplicate patch adding it back in for that one screen. Fixed
`docFromRow()` to include `uploadedAt` (matching how `photoFromRow()` already
did for operational photos), added `uploadedAt` to the `AssignmentDoc` type,
and removed the now-redundant patch. No migration needed — purely a
frontend mapping gap; the server-side timestamp was always being captured
correctly. Verified live: a document uploaded minutes earlier correctly
showed its real timestamp after the fix.

---

## [REQ-002] Persisted Driver Pickup, Loading, Arrival, and Unloading Workflow

**Status:** In Progress

**2026-10-21 — photo and status gates applied:** `20261021000002_driver_workflow_gates.sql`
(tests `supabase/tests/req002_driver_gates.test.sql`, 11/11 passed).
`advance_driver_stage` now requires `loading_before` to start Loading,
`unloading_before` to start Unloading and `unloading_after` to finish it.
`guard_assignment_update` lets a driver change status only Picked Up → In
Transit, In Transit → Delivered (after unloading is finished), or to Failed /
Issue; anything else raises `invalid_status_transition`. Remaining: stage
remarks (see Current status).

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
  **2026-10-23 — implemented and verified live:**
  `supabase/migrations/20261023000011_stage_remarks.sql`. Two nullable
  columns directly on `assignments` (`loading_remark`, `unloading_remark`,
  capped at 300 chars) rather than a separate table, matching this exact
  reasoning REQ-002 already used for its own event timestamps — a remark
  happens at most once per stage per assignment. Set via a new optional
  `p_remark` argument on `advance_driver_stage()`'s `finish_loading`/
  `finish_unloading` transitions only (appended with a default, so the
  function keeps its OID/grants — every existing 2-argument call still
  works unchanged); never required, never blocks progression. Write-once via
  the RPC path (no edit path exists); readable by staff and the owning
  driver through the existing `assignments` SELECT policy, no new RLS
  needed. Frontend: `DriverInterface.tsx` now shows an optional "Add a note"
  box (300 chars) under the required photo at both stages, English +
  Filipino, cleared on assignment change and right after a successful
  submit so a Loading note can never bleed into the Unloading box later in
  the same task. `assignmentTypes.ts`/`db.ts` carry the two fields
  read-only. Verified live: finished a Loading step with a Filipino note
  typed in ("gg tagal magbukas ng gate") — `loading_remark` stored exactly
  as typed, `unloading_remark` correctly still null.

  **Admin display added the same day, after live testing showed there was
  nowhere to view it:** `ShipmentPhotoEvidence.tsx`'s Photos tab now shows
  "Driver's note: ..." under the Loading/Unloading photo group when present;
  `DriversManagement.tsx`'s Activity tab timeline shows the same note inline
  next to that stage's Finished/Duration details. No backend change — purely
  reading the two columns `assignmentFromRow` already carried. Verified live
  in both tabs on the same test delivery.
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

**Status:** Implemented

**2026-10-21 — applied and verified:** the user applied
`20261021000000_csr_cancel_loading_cutoff.sql` on 360Logistics DB;
`supabase/tests/req003_cancel_cutoff.test.sql` passed 16/16 and the cancel flow
was tested on localhost. The note below describes the migration as it was
prepared before it was applied.

**2026-10-21 local follow-up (prepared before applying):** `supabase/migrations/20261021000000_csr_cancel_loading_cutoff.sql`
is prepared for manual review. The existing one- and two-argument
`cancel_assignment` overloads remain live until this migration is applied;
both are insufficient for the new rule. The migration drops those overloads,
adds `cancel_assignment(p_id, p_reason, p_password)`, verifies the current
authenticated staff member's Supabase Auth password on every call, locks the
assignment row, rejects it when Loading has finished or a later stage is
recorded, and reuses `assignments.cancel_reason` plus the activity log for
durable reason/actor/time. It also updates the cancellation guard so a direct
table update cannot bypass the verified RPC and cannot erase completion
evidence. Existing admin/CSR `can_write()` capability is retained; OPM remains
excluded. The frontend calls only the new overload and therefore fails closed
until the migration is reviewed and applied. Do not use the connected project
for cancellation tests without a designated safe test assignment.

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
Previously applied in the Supabase SQL editor against the connected project,
which must now be treated as shared/production data.
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

**Frontend impact — driver side (Implemented and verified, 2026-10-25):**
`supabase/migrations/20261025000001_driver_cancellation_notice.sql` and
`20261025000002_fix_cancel_ack_guard.sql` — applied and verified live.

The two still-missing pieces when this was picked back up turned out not to
be what the note above expected:
- **`assignments_select` RLS had already been fixed** by this very migration
  back on 2026-10-18 (see above) — a driver could already read their own
  cancelled row. The actual remaining gap was `assignments_update`'s `USING`
  clause, in `init.sql`, which still required `state = 'active'` for the
  driver branch — so a driver could never reach a cancelled row to write
  `cancel_acknowledged_at`, even though that column was already in the
  trigger's driver-writable allow-list. `20261025000001` widens the driver
  branch to `state in ('active', 'cancelled')`. No column permissions change.
- **A second, unrelated bug surfaced during live testing**: even after the
  RLS fix, the acknowledge write still silently failed. `guard_assignment_update()`
  (current version as of `20261023000002`) unconditionally rejected any driver
  update where `task_status` wasn't one of `('Assigned', 'Picked Up',
  'In Transit', 'Delivered', 'Failed / Issue')` — with no "is it actually
  changing" guard, unlike every other check in that function. A cancelled
  row's `task_status` is `'Cancelled'`, which isn't in that list, so
  acknowledging (which never touches `task_status`) tripped the exception
  every time. `20261025000002` adds the missing `is distinct from old.task_status`
  guard to that one check, matching the pattern already used elsewhere in the
  same function. Behavior is otherwise identical — a driver still can never
  set `task_status` outside the allowed list.

`loadDriverData()` now derives `cancelledNotice: { id, reason, cancelledAt } | null`
from the assignment rows it already fetches (no new query) — the most recent
`state === 'cancelled' && !cancel_acknowledged_at`. `driverUpdate()` maps
`cancelAcknowledgedAt` to the column. The driver UI
(`src/app/components/driver/DriverInterface.tsx`) shows a dismissible
`CancellationNoticeDialog` (styled like the existing delivery-complete
dialog) on all three driver screens whenever `cancelledNotice` is present;
pressing "Got it" writes `cancel_acknowledged_at` to that specific row (not
necessarily the driver's active assignment) and the notice does not return.
Verified end-to-end live: cancelled a test assignment as admin, confirmed the
notice appeared in the driver app with the correct reason/timestamp, dismissed
it, and confirmed `cancel_acknowledged_at` was persisted in the database.

**Migration required:** Yes — both applied and verified against the shared
project.

**Approval:** Approved — local development (2026-10-18, driver-side completed 2026-10-25).

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
`fromMapboxPosition()` from `lib/assignmentLocation.ts`. **2026-10-23:**
`fromMapboxPosition()` was removed as dead code — no production caller ever
used it (no map-picker UI exists in `src/`, confirmed by a repo-wide search),
only its own unit test did. `db.ts`'s actual, live coordinate path
(`locationFieldsFromRow`/`locationColumnsForRow`/`invalidLocationEdit`) is
untouched and was never Mapbox-specific — it just moves plain lat/lng numbers
between `Assignment` and the table columns.

*Historical / null fallback* — all existing assignments keep NULL in every new
column; nothing is backfilled or derived from `destination`. They keep using
`pickup_location` and `destination` (`getDeliveryLocation()`), unchanged.

*Tests* — `src/app/lib/assignmentLocation.test.cjs` (9 unit tests as of
2026-10-23, after removing the dead `fromMapboxPosition()` test: create/read
round trip, validation, historical rows) and
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

**Status:** Implemented (2026-10-26 — all follow-ups, including the
activity-log gaps, closed)

**Pending Workspace Settings follow-up (2026-10-21; not approved for database changes):**
The current `remove_team_member(p_id)` deletes `auth.users`, which also removes
the member profile. It cannot serve as Archive Member because the account
cannot be restored and its historical identity is lost. `profiles.status`
already permits `active`/`removed`, and sign-in/RLS check `active`, but there
is no dedicated OPM-only archive/restore RPC that atomically changes access,
records the acting OPM and timestamp, and appends one audit row. Implement
that server-side path before enabling Archive/Restore buttons. Existing
member deletion is hidden in the local Workspace UI; no frontend-only archive
flag is used. The audit trail also lacks guaranteed, transactional records
for some OPM actions (notably driver/truck registration and PIN reset) and
document review still logs through the client state sync path. Add safe
server-side audit writes on successful mutations; never include PINs,
passwords, or reset tokens. No migration or RPC has been applied for this
follow-up.

**2026-10-23 — Team member archive/restore applied and verified:**
`supabase/migrations/20261023000004_team_member_archive_restore.sql`.
`remove_team_member(p_id)` no longer deletes `auth.users` — it sets
`profiles.status = 'removed'` instead (refuses an already-removed member)
and logs a `member_removed` activity row. New `restore_team_member(p_id)`
(OPM only) sets `status = 'active'` back (refuses an already-active member)
and logs `member_restored`. No RLS/grant changes needed — `is_staff()`/
`can_write()` already require `status = 'active'`, so a removed member loses
every app-level privilege on their very next request without touching their
Auth login.

Turned out the frontend's Team Members "Active"/"Archived" tabs already
existed in `WorkspaceSettingsPanel.tsx` (`listTeamMembers()` already queried
by role only, no status filter) but had no working buttons — just a note
reading "Member archive and restore require backend support. The existing
Remove action permanently deletes the login," and nothing actually called
`removeTeamMember()` anywhere. Wired real **Remove**/**Restore** buttons into
those existing tabs (`db.ts`: new `restoreTeamMember()`; `assignmentTypes.ts`:
new `'member_restored'` activity type). `create_team_member()` still writes
no server-side activity_log row — left alone, same pre-existing gap as the
other "Activity-log gaps" follow-up below, not expanded here.

Verified live: created a throwaway CSR, removed it (disappeared from Active,
appeared under Archived), restored it (moved back to Active), and confirmed
both "Member Removed" and "Member Restored" entries in the Activity tab.

**2026-10-23 — Renamed remove → archive, and password re-confirmation added:**
Per an explicit project requirement (no "remove" action/function anywhere in
the system — archive only), `remove_team_member()` was renamed to
`archive_team_member()` via `supabase/migrations/20261023000005_rename_remove_to_archive_team_member.sql`
(`alter function ... rename to`, which keeps its existing grants). The
`already_removed` error became `already_archived`, matching
`archive_driver()`'s convention, and the activity type became
`'member_archived'` (`assignmentTypes.ts`, `WorkspaceSettingsPanel.tsx` —
label "Member Archived", button now reads "Archive" not "Remove").
`db.ts`'s wrapper is now `archiveTeamMember()`.

Then, per a follow-up request, both `archive_team_member()` and
`restore_team_member()` were given the same `signed_in_recently(300)` guard
`archive_driver()`/`reset_driver_pin()` already use
(`supabase/migrations/20261023000006_team_member_archive_restore_reauth.sql`).
The frontend's Archive/Restore buttons now open the existing
`ConfirmPasswordDialog` component (the same one already used for driver
archive/PIN reset) instead of acting immediately — it calls
`verifyOwnPassword()` against Supabase Auth first, and only calls the RPC on
success.

Verified live: both the rename (schema check confirmed `remove_team_member`
gone, only `archive_team_member`/`restore_team_member` present) and the
password-confirmation flow (Archive and Restore each now prompt for a
password before taking effect) tested end-to-end in the running app.

**2026-10-23 — Activity-log gap closed for PIN resets (scoped down from the
full follow-up):** investigating the full "Activity-log gaps" item showed
driver/truck add, driver/truck edit, and document approve/reject all share
one architecture — they only update local React state and rely on the
generic auto-save (`syncAdminData`) to diff-and-write whatever
`AdminActivityEntry` the client decided to add via `onLogActivity(...)`,
unlike `archive_driver()`/`dispatch_assignment()`/etc., which log atomically
inside their own transaction. Converting those three to real guarded RPCs is
a large change (on the order of REQ-002/REQ-011), not a quick fix — deferred,
not attempted here. `reset_driver_pin()` was the one true gap (logged
nothing at all, not even through auto-save) and was self-contained to fix:
`supabase/migrations/20261023000007_log_driver_pin_reset.sql` adds one
`activity_log` row (`type = 'driver_pin_reset'`, driver name only — never the
PIN) inside the existing RPC, same pattern as `archive_driver()`. New
activity type added to `assignmentTypes.ts`/`WorkspaceSettingsPanel.tsx`
(label "Driver PIN Reset", `KeyRound` icon). Verified live: resetting a PIN
now shows "Driver PIN Reset · New PIN set for [driver]" with correct
actor/role/timestamp in the Activity tab.

**Still open (not attempted — large scope, separate task):** driver/truck
add/edit and document approve/reject converted to dedicated server-side RPCs
instead of the client-driven auto-save path.

**2026-10-25 — Document approve/reject converted (1 of 3), applied and
verified live:** `supabase/migrations/20261025000006_document_review_rpcs.sql`.
New `approve_document(assignment_id, doc_type)` / `reject_document(assignment_id,
doc_type, reason)` validate the document is uploaded and still `pending`,
change `doc_status`, and write the `activity_log` row (actor resolved
server-side from `auth.uid()`, never trusted from the client) in one
transaction. A new guard trigger (`guard_document_review()`, same
transaction-local-flag technique as `guard_assignment_cancel()`) blocks any
direct `doc_status`/`reject_reason` change outside these two functions — the
driver's own document re-upload path (`file_url`/`uploaded`/`uploaded_at`
only) is untouched, since it was never part of this guard.
`db.ts` gained `approveDocument()`/`rejectDocument()`; `DriversManagement.tsx`'s
`handleApproveDoc`/`handleRejectDoc` now go through the same `onServerChange()`
pattern already used for issue resolution/cancellation, with real busy/error
states on the Approve/Reject buttons (previously these had none at all).
`AssignmentActionErrorCode` gained `already_reviewed`/`not_uploaded`.

Verified live: approved one document and rejected another (with a reason) on
`ASN82575` — both actions correctly updated `doc_status` and produced
"Document Approved"/"Document Rejected" entries in the Activity tab with the
real actor's name/role/email and timestamp. Confirmed the guard actually
blocks a bypass: a raw `supabase.from('assignment_documents').update({...})`
call from the live, signed-in app's browser console correctly failed with
`42501: doc_status may only change through approve_document()/reject_document()`
(a first attempt via the Supabase SQL editor had misleadingly appeared to
succeed — the SQL editor runs as an unauthenticated system connection, which
every guard trigger in this project deliberately exempts, so it was never a
valid way to test this; re-tested from an actual authenticated session instead).

**2026-10-26 — Truck registration converted (2 of 3), applied and verified
live:** `supabase/migrations/20261026000000_register_truck_rpc.sql`. New
`register_truck(plate_number, classification, capacity)` assigns the truck's
ID server-side (same loop-until-unique pattern `dispatch_assignment()` uses),
validates the plate format, and checks for a duplicate plate against live
(non-archived) data in the same transaction — closing the race condition the
old client-side-only check couldn't. Writes a `truck_added` activity_log row.
`trucks_insert` RLS already required `is_opm()` (from REQ-004's own
`20261018000003_opm_role.sql`) — nothing newly restricted, just moved off
the client-driven path. `db.ts` gained `registerTruck()`; `RegisterTruckModal`
now calls it through the existing `onServerChange()` pattern instead of
mutating local state directly — the early plate-duplicate warning at step 1
stays as a soft client-side check, the server is now the real authority.
Verified live: registered `EFG 6578` — confirmed via SQL with a real
server-generated id (`T25568`), correct classification/capacity, and the
matching "Truck Added" entry in the Activity tab.

**2026-10-26 — Driver registration converted (3 of 3), applied and verified
live — this REQ-004 follow-up is now fully closed:**
`supabase/migrations/20261026000002_register_driver_rpc.sql`. New
`register_driver(first_name, surname, phone, pin)` is the most involved of
the three: it validates and duplicate-checks name/phone against live active
drivers, assigns the ID server-side, inserts the driver row, and calls the
**existing, unmodified** `sync_driver_login()` inside the same transaction to
create the Auth account and store the PIN. Previously these were two
separate steps with no atomicity guarantee — a failure between them left a
driver who exists in the fleet list but can never sign in, with nothing
flagging it. Now a failure anywhere rolls back the whole transaction.
`db.ts` gained `registerDriver()` and three new error codes
(`duplicate_phone`, `duplicate_name`, `invalid_name` — kept distinct from
`duplicate_plate` since Postgres reuses the same `23505` code for all of
them and the generic fallback would otherwise show the wrong message).
`RegisterDriverModal` wired the same way as the truck modal.

Also fixes a separately reported bug along the way, in both this RPC and
`update_own_display_name()` (the staff profile name field, same day): driver
and staff names had no format validation at all — e.g. `--` or `K1 Alas`
were both accepted. Both now require starting with a letter and containing
only letters/spaces/apostrophes/hyphens/periods, enforced server-side (the
real gate) with matching client-side checks for instant feedback. Existing
invalid names already in the database are left as-is, per this project's
convention of never silently backfilling historical data.

Verified live end-to-end: registered driver "Charles Panelo" through the
normal form — confirmed via SQL a real server-generated id (`DR79988`) and a
populated `auth_user_id`, then **signed in as that driver on the actual
driver login screen** to confirm the Auth account genuinely works, not just
that a row exists. Confirmed the matching "Driver Added" Activity tab entry.
Separately confirmed the name-format rejection live on both the driver
registration form and the staff "edit your name" field.

**Frontend Activity Log presentation note:** Team Member Archive/Restore
already writes server-side audit entries, so the client no longer adds
duplicate entries. Existing `issue_reported` and `issue_resolved` events now
have readable labels and details in the Activity tab. These presentation
changes were checked in code, not retested against the live database here.

**2026-10-23 — CSR setup link applied and verified (closes the "CSR setup
link" backlog item):** `supabase/migrations/20261023000010_csr_setup_link.sql`.
Previously, adding a CSR meant OPM typed or "Suggest"-generated a temporary
password that was shown once on screen and had to be relayed to the new CSR
out-of-band (chat, verbally, email) — a real password exposed in plaintext
outside Auth. Closed by reusing REQ-006's reset-link machinery for the
*first* password too, since `claim_csr_password_reset()`/
`release_csr_password_reset_claim()`/`finish_csr_password_reset()` and the
`complete-csr-password-reset` Edge Function were already fully generic (they
only check that a `csr_password_reset_requests` row is `approved`/unexpired/
unclaimed/matching an active CSR — they don't know or care *why* it's
approved) — **zero changes needed to any of that downstream machinery.**

`create_team_member(p_name, p_email, p_role)` dropped the `p_password`
argument entirely (old 4-arg overload explicitly `DROP FUNCTION`'d, not left
reachable): creates the Auth user with a random, never-returned, never-logged
throwaway password; inserts the profile; inserts one `approved`
`csr_password_reset_requests` row with a fresh one-time token (same
generation technique as `create_csr_password_reset_link()` — 32 random
bytes, SHA-256 hash stored, raw token returned once); returns `setupToken`
instead of a password. Expiry is 7 days, not the 45-minute reset window —
onboarding isn't security-urgent the way a reset is, and a new hire may not
open the link same-day.

Frontend: `AddMemberModal` (`WorkspaceSettingsPanel.tsx`) no longer has a
password field at all — the success screen shows a **"Copy Setup Link"**
button (same clipboard-with-fallback pattern as "Copy Reset Link") instead
of a visible password. The link opens the exact same `/reset-password` page
REQ-006 already built — its copy ("Create New Password" / "Enter a new
password for your CSR account") already worked for first-time setup without
any wording changes. `TeamMember.password` removed from `assignmentTypes.ts`
(no longer meaningful — Auth never lets a password be read back).

Verified live: added a test CSR, confirmed no password was shown anywhere,
copied the setup link, opened it in an incognito window, set a password
there, and confirmed login works with that password.

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

**Status:** Implemented — live end-to-end test passed (2026-10-26).

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

**Verified live end-to-end (2026-10-26):** using a throwaway test CSR account
(`testaccount123@email.ph`, created via the Add Team Member setup-link flow,
which reuses this same request table). Submitted "Forgot Password" →
approved as OPM → Copy Reset Link → opened the link and set a new password
→ **signed in with the new password successfully**. One real bug/behavior
surfaced and explained, not fixed (working as designed): `request_csr_password_reset()`'s
15-minute-per-user rate limit (any PRIOR request, regardless of status,
blocks a new one) silently refused the first "Forgot Password" attempt,
because the account's own setup-link completion from minutes earlier counted
as a prior request. Confirmed via the `csr_password_reset_requests` table
directly (only the old row existed, no new one), waited out the window, and
the second attempt succeeded normally. Confirmed the full audit trail in
`activity_log`: `password_reset_requested` → `password_reset_approved` →
`password_reset_link_generated` → `password_changed`, each with a real
timestamp and the correct actor.

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

**ADMIN NOTIFICATIONS CHANGES - REQ01 follow-up (native notification):**

**Status: IMPLEMENTED (2026-10-27).** CSR password-reset requests now generate
a real, server-side notification with a stable reset-request reference and the
same persisted read state as every other notification type — merged into the
regular chronological bell feed rather than kept as a separate, live-polled
review queue.

**Implementation:** `supabase/migrations/20261027000001_csr_reset_request_notifications.sql`
(applied) — `notifications.assignment_id` is now nullable (this notification
type has no assignment); added `notifications.reset_request_id uuid references
csr_password_reset_requests(id)`; widened `notifications_type_check` to allow
`'password_reset_requested'`. `request_csr_password_reset()` now captures the
new request's id (`returning id into v_request_id`) and inserts one idempotent
notification row (`'notif-resetreq-' || v_request_id`, same deterministic-id/
`on conflict (id) do nothing` pattern as every other notification insert in
this project) in the same transaction as the request itself. A one-time backfill
in the same migration inserts a matching notification for every request that
was still `pending` at migration time, so nothing already in OPM's queue
silently disappeared.

**Frontend:** `AppNotification['type']` gained `'password_reset_requested'`
plus an optional `resetRequestId`; `db.ts`'s `loadAdminData()` maps
`reset_request_id`. `Header.tsx` removed the dedicated "Pending Password Reset
Requests" section, its 30-second poll trigger, and the amber dot/title variant
on the bell — replaced by a `KeyRound`-icon row in the ordinary notification
feed, special-cased only in its action (calls the existing `onReviewResetRequest`
callback directly — unchanged, still opens Workspace Settings — instead of
going through `notificationDestination()`/`adminHref()`, which are built around
assignment navigation and don't fit a request with no assignment).
`AdminDashboard.tsx` removed the now-redundant `pendingResetRequests`/
`resetRequestLoadError` state and its 30-second polling `useEffect`; the
existing 12-second `loadAdminData()` poll in `App.tsx` already refreshes all
staff notifications more often, so nothing lost freshness. `listCsrPasswordResetRequests()`
and `pageForPasswordResetRequest()` were kept — `WorkspaceSettingsPanel.tsx`
still uses both independently for its own request list and pagination; only
the now-unused `pendingPasswordResetRequests()` filter helper (and its test)
were removed. **Verification:** `npm run typecheck` clean, all 140 existing
unit tests pass (including the Charts.tsx fleet-activity feed, whose
`notifToEvent` helper was narrowed to exclude this new type, since password
resets have no driver/truck/assignment and don't belong in that widget); live
test as OPM, applied migration, backfilled request appeared in the merged bell
feed, "Review Request →" opened Workspace Settings on the right row.

**Bug found and fixed during this live test (pre-existing, not new to this
feature):** clicking the merged notification threw `Auto-save failed:
notifications: new row violates row-level security policy`. Root cause:
`notifs_update`'s RLS requires `can_write()` (admin/csr only; OPM is
deliberately excluded), and `App.tsx` already has a correctly role-gated path
for persisting read-state (`persistNotificationReads` → `flushNotificationReads`,
which explicitly skips the server write for OPM, relying on local storage).
But the generic auto-save `useEffect` also had `notifications` in its
dependency array, so *any* read-state toggle — by any role — separately
re-triggered `saveToServer()` → `syncAdminData()` → `syncTable('notifications', ...)`,
which attempts the same forbidden direct-table write for OPM. This was already
latent before today; OPM simply had no prior reason to click into a
notification's action. Fixed in `App.tsx` by dropping `notifications` from
that effect's dependencies (it already reads the always-current
`notificationsRef.current` instead) — read-state changes alone no longer
re-trigger this generic sync, since the dedicated path already covers it.

**LOGIN PAGE CHANGES - forgot-password feedback for unknown emails — IMPLEMENTED
(2026-10-31).** The Forgot Password screen used to show "Request Submitted" for any
email, including ones with no account. `20261031000003_reset_request_reports_unknown_email.sql`
re-creates `request_csr_password_reset()` (dropped and recreated — the return type changed)
to return a boolean: `true` = the email belongs to an active CSR (a request was created, or one
is already pending/approved/within the 15-minute window), `false` = no eligible CSR account
(no such email, not a CSR, or not active). All request and notification logic is unchanged and
the grant stays `anon`-only. `requestCsrPasswordReset()` (`db.ts`) now returns that boolean and
`LoginScreen.tsx` shows "No active CSR account was found for that email." on `false`; the success
text now reads "Your request is now available for OPM review…". **Trade-off (deliberate):** the
anonymous screen can reveal whether an email is an active CSR account; no reset link or other
data is exposed and OPM approval is still required. **Verification:** applied; live — a
non-existent address gets the error, `kevin@360logistics.ph` (real CSR) is accepted. The existing
SQL tests call the RPC with `perform`, so the new return value does not affect them.

### LOGIN PAGE CHANGES - REQ03 — Prevent Reusing Current Password During CSR Reset

**Status: IMPLEMENTED (2026-10-26).** The backend now refuses the account's
current password and returns `password_reused`; the frontend shows the message
under New Password.

**Implementation:** `supabase/migrations/20261026000003_csr_reset_password_reuse.sql`
adds `csr_password_reset_password_matches(request_id, token_hash, password)`
(service_role only; answers only for an approved, unexpired request claimed with
that exact token hash; bcrypt compare via `extensions.crypt()`; never returns or
stores the hash or password). The `complete-csr-password-reset` Edge Function
(`logic.ts`, `index.ts`) calls it right after the claim: on a match it releases
the claim and replies `password_reused` without touching the password, so the
same link works until its original expiry; if the check itself fails it also
releases the claim and replies `reset_failed`. The CSR setup link uses the same
path. **Verification:** `supabase/tests/csr_reset_password_reuse.test.sql` 5/5
passed; `logic.test.cjs` 14/14; Edge Function deployed 2026-10-26; the user
tested live (same password refused, different password accepted on the same
link). The text below is the original requirement, kept for history.

**Current gap:** `complete-csr-password-reset` validates the submitted token and
password length, atomically calls `claim_csr_password_reset`, then calls the
service-role Auth Admin `updateUserById` before finishing the request. Its
`logic.ts`/`index.ts` do not verify whether `newPassword` matches the claimed
CSR account's existing password. Auth may accept the same value, returning a
misleading success and consuming the one-time link.

**Required backend contract:** After a valid, eligible, unexpired token is
claimed and bound to its canonical `target_user_id`, compare the proposed
password with that user's current password verifier using a trusted server-side
mechanism. The backend developer must confirm a supported and suitably
restricted verification method; do not assume the Auth Admin API returns a
password hash. Never accept an arbitrary email or user ID from the caller for
this comparison. If identical, return a non-success response with
`{ "error": "password_reused" }`, leave the password and request status
unchanged, and release the claim through the existing
`release_csr_password_reset_claim` operation so the same link can be retried
until its original expiry. Do not extend that expiry. Only update the Auth
password and call `finish_csr_password_reset` after a different valid password
passes verification. Preserve the current one-time claim and concurrent-use
protections. Release a claim only when verification or password rejection is
definitive and the password certainly has not changed; retain the existing
conservative handling of uncertain Auth/network outcomes.

Keep the verifier, any hash, service-role credentials, plaintext password, and
raw reset token out of browser responses and logs. Do not add a public endpoint
that tests arbitrary passwords or ask the CSR for their previous password.
Keep the existing OPM approval, link generation, request statuses, and audit
history. The client must show its reuse message only for an explicit
`password_reused` response from this trusted flow.

**Backend verification required:** same password is rejected without changing
the password or completing the request; the original unexpired link then
succeeds with a different valid password; old credentials stop working and new
credentials work after success; invalid/expired/replayed tokens and parallel
attempts cannot bypass the check; weak-password and uncertain-update paths
preserve their existing claim behavior; no verifier, password, token, or key is
exposed or logged. This requirement has not been implemented or tested against
the connected Supabase project in this frontend task.

---

## [REQ-007] Persistent verification for generated reports

**Status:** Implemented

**Approval:** Approved 2026-10-23 — design decisions made explicitly before
implementation: Weekly period = current ISO calendar week (Mon-Sun);
verification is metadata-only (type/period/generator/generated-at/row count,
never raw delivery data, never live-recomputed — the `issued_reports` row is
immutable and is the sole source of truth for its own page).

**2026-10-23 — Implemented and verified live:**
`supabase/migrations/20261023000008_issued_reports.sql` and
`20261023000009_list_issued_reports.sql`.

- New `public.issued_reports` table: `id` (random `RPT-xxxxxxxxxxxx`, 48 bits
  — never sequential, since it's a *public* lookup key reachable by anyone
  holding the printed report; a guessable/sequential ID would let someone
  enumerate every issued report), `report_type`, `generated_by_user_id`/
  `generated_by_name`, `generated_at` (server-stamped), `report_period_start`/
  `end` (nullable — Delay/Utilization reports have no natural period),
  `row_count`, `row_digest` (a frozen forensic artifact — a hash of the
  included assignment IDs, computed client-side from the exact rows the PDF
  rendered; never live-compared against anything). RLS has no SELECT policy
  for anyone — every read goes through the two RPCs below.
- `issue_report(...)`: admin/CSR only (`can_write()`; OPM stays view-only per
  REQ-004). Generates the ID, inserts the row, returns it.
- `verify_report(id)`: **public** — granted to `anon`, no session required,
  since the QR code must be scannable by anyone. Returns only the safe
  fields.
- `list_issued_reports(limit)`: staff-only (`is_staff()` — read access, not
  `can_write()`, so OPM can view history even though only CSR/admin can
  generate) — backs the admin-facing "Recent Reports" list.

All 4 of Reports.tsx's report types (weekly, monthly, delay, utilization)
share this one mechanism, not just the 2 the original request named — scoping
it to 2 of the 4 types the same screen generates would have been visibly
inconsistent to an admin printing a Delay or Utilization report.

**Frontend:** new public route `/verify-report?id=...`
(`VerifyReportScreen.tsx`, wired into `App.tsx` the same way `/reset-password`
already bypasses the authenticated app shell). `Reports.tsx`'s Weekly report
now actually filters to the current ISO week — it previously had no date
filter at all, including every active + completed assignment regardless of
date. `handlePrint()` calls `issue_report()` before `window.print()`
(printing is blocked if issuance fails — the QR is only created after a
record exists), generates a QR via the new `qrcode` dependency, and passes
the real Report ID/QR into a new shared `ReportVerificationBox.tsx` that all
4 print components now render in place of the "Verification unavailable"
placeholder that was already sitting there. The "Recent Reports" table (which
had its own placeholder: *"Report history is unavailable. This system
downloads reports without saving a generated-report record."*) now lists via
`list_issued_reports()`, with a Verify link per row opening that report's
public page.

**Bugs found and fixed during live testing:**
- A `toISOString()`-based date formatter shifted the stored week/month period
  back one calendar day for Philippine time (UTC+8) — `toISOString()`
  converts to UTC first, which crosses the date boundary whenever local
  midnight hasn't yet reached UTC midnight. Fixed by building the `YYYY-MM-DD`
  string from local date components directly.
- The printed Weekly report's header separately re-derived its displayed date
  span from each row's own (inconsistently-formatted, sometimes yearless)
  date string, defaulting to the year 2001 for yearless input — a longstanding
  JS `new Date("Oct 19")` quirk. Fixed by passing the same deterministic week
  boundary already used to filter the rows, instead of re-inferring it.
- The QR image rendered blank in the print output the first time —
  `window.print()` can snapshot the page before a freshly-set `data:` URL
  image has finished decoding. Fixed by forcing `Image.decode()` to resolve
  before printing.

Verified live end-to-end: generated multiple Weekly reports, confirmed the
Report ID + QR render correctly on the printed PDF, confirmed the period
reads "Oct 19 – Oct 25, 2026" (not Oct 18 or 2001), scanned/opened the QR's
target URL in an incognito window (no session) and got the correct
metadata, confirmed an unknown ID shows "not found" rather than erroring,
and confirmed "Recent Reports" lists all previously issued reports with
working Verify links.

**Area:** Reports / formal Print-PDF output

**Requested change:** Give a generated report a real persistent Report ID and a QR
link to a verification page that can confirm its type, period, generator, and
generation time.

**Current limitation:** `Reports.tsx` builds previews and CSV downloads from
current assignment data and uses browser `window.print()` for PDF. It does not
save a generated-report record, assign a Report ID, or expose a verification
route. Its Weekly preview currently includes all active and completed
assignments, without a weekly date filter, so a seven-day reporting period
cannot be asserted from the present query.

**Required backend/data support:** Persist an immutable issued-report record
with `report_id`, `report_type`, `generated_by_user_id`, `generated_by_name`,
`generated_at`, `report_period_start`, and `report_period_end`. Define what
report snapshot or digest is verified so later assignment edits do not make an
old PDF appear to describe current data. Add an authorized issuance endpoint
and a verification lookup/route that returns only safe public metadata. Create
the QR only after a record has been issued successfully. Define the Weekly
date-range selection/inclusion rule before storing a weekly period.

**Migration required:** Yes, once the design is approved. No SQL or backend
change is included in the local print-layout task.

**Approval:** Pending. Do not infer backend approval from the UI request.

---

## [REQ-008] Recoverable delivery issues and incident history

**Status:** Implemented — all 4 phases applied and verified live

**2026-10-23 — Phase 1 (schema only) prepared, not yet applied:**
`supabase/migrations/20261023000000_assignment_issues_schema.sql`. New
`public.assignment_issues` table per the data model this entry already
specified, with two adjustments from the original draft:
- `resolved_by_user_id -> profiles(id)` uses `ON DELETE SET NULL`, not
  `RESTRICT` as originally suggested — `remove_team_member()` does a real
  delete of the CSR's auth user (unlike drivers, which are archived, never
  row-deleted), so `RESTRICT` would make it impossible to ever remove a CSR
  who resolved an issue. Paired with a new `resolved_by_name` snapshot
  column (same "copy identity onto the row" convention already used for
  `assignments.driver_name`/`truck_plate`) so history stays readable after
  the account is gone.
- Added `reported_by_name` the same way, for the same reason, even though
  `reported_by_driver_id` itself stays `RESTRICT` (drivers are archived, not
  deleted, so this is mostly a safety rail rather than an expected path).

Also includes the partial unique index preventing duplicate open blocking
issues per assignment, and the idempotency-key unique index for phase 2's
double-submit protection. RLS allows SELECT only (staff see everything,
a driver sees only their own assignment's issues) — no insert/update/delete
policy or grant for anyone; every write will go through phase 2's two
SECURITY DEFINER RPCs, same pattern as every other guarded RPC in this
schema. Zero behavior change — nothing writes to this table yet.

**Applied and verified (2026-10-23):** Ran in the Supabase SQL editor; all
18 columns confirmed present with correct types via `information_schema`.

**2026-10-23 — Phase 2 (RPCs) applied and verified:**
`supabase/migrations/20261023000001_assignment_issues_rpcs.sql`. Adds
`report_assignment_issue(assignment_id, issue_type, reason, idempotency_key)`
and `resolve_assignment_issue(issue_id, resolution_note)`, both `SECURITY
DEFINER`, plus a nullable `activity_log.issue_id bigint` column (no check
constraint needed — `activity_log.type` was already free text).

- `report_assignment_issue`: owning Driver only (`driver_owns_assignment`
  pre-check, re-checked against the locked row). Validates `issue_type`
  against the exact set `src/app/lib/issueWorkflow.ts` uses — the 6 named
  `BLOCKING_ISSUE_REASONS` strings plus the frontend's literal `'Other...'`
  sentinel (with the ellipsis) — rejecting anything else. All 7 currently
  classify as blocking, matching what the existing UI already assumes (see
  the open item below — still not an operations-reviewed decision, just
  isolated to one `in (...)` list for easy revision later). Requires
  `assignments.state = 'active'`. Inserts one `assignment_issues` row, one
  `activity_log` row (`type='issue_reported'`), one staff notification
  (`type='issue_report'`, same shape the old path already produced).
  Idempotency-key replay returns the existing row rather than erroring or
  duplicating. **Does not set `task_status`/`operational_stage`** — this
  path only records the issue; the gate that stops driver progression is
  phase 3, not this.
- `resolve_assignment_issue`: `can_write()` only (CSR/admin; **not** OPM,
  consistent with REQ-004's view-only-in-shipment-screens rule). Locks
  assignment then issue — same order `report_assignment_issue` uses, so the
  two can never deadlock. Requires the issue to be `open` and the assignment
  `active`; sets `status='resolved'`, `resolved_at`, `resolved_by_user_id`/
  `resolved_by_name` (looked up from `profiles`), `resolution_note`; inserts
  one `activity_log` row (`type='issue_resolved'`). Also leaves
  `task_status`/`operational_stage` untouched.

Still inert in practice: the driver app's "Report a problem" button still
calls the old `driverUpdate`/`issue_reason` path, not this RPC — nothing
calls either function until phase 4 rewires the frontend. Retiring the old
path is a phase 3/4 concern (coordinated client rollout), not this one.

Verified live end-to-end on assignment `ASN54196`: reported as the owning
driver via console (`error: null`, row inserted with `is_blocking: true`,
`status: open`, correct `reported_by_name`/stage snapshot); resolved as CSR
via console (`status: resolved`, `resolved_by_name`, `resolved_at`,
`resolution_note` all correct); both `activity_log` rows present and linked
via `issue_id`; the `issue_report` notification present with the right
message/`navigate_to`; confirmed `assignments.task_status` for ASN54196
never changed (stayed `Delivered` throughout) — proving the new path is
fully side-effect-free on the legacy columns, as designed.

**2026-10-23 — Phase 3 (progression gate) applied and verified:**
`supabase/migrations/20261023000002_assignment_issues_progression_gate.sql`.
Adds `has_open_blocking_issue(assignment_id)` — a one-line `sql stable
security definer` helper matching the exact style of `is_staff()`/
`can_write()`/`driver_owns_assignment()` — then re-declares (`create or
replace`) the two existing gates with one addition each, bodies otherwise
unchanged from `20261021000002_driver_workflow_gates.sql`:

- `advance_driver_stage()`: every transition now fails with
  `open_blocking_issue` if the assignment has an open blocking issue,
  checked once right after the existing `not_active` check, before any
  transition-specific logic. Applies to both driver- and staff-initiated
  calls (this RPC is callable by `can_write()` staff too) — the rule is
  about the physical state of the delivery, not who's operating it.
- `guard_assignment_update()`: the two forward moves a driver makes via a
  direct `task_status` update outside the RPC (`Picked Up -> In Transit`,
  `In Transit -> Delivered`) now also fail with `open_blocking_issue` under
  the same condition, raised as a distinct error rather than folded into the
  existing generic `invalid_status_transition`. The `-> Failed / Issue`
  transition (legacy report path) stays ungated — it's a stop, not an
  advance, and reporting through it while a new-table issue is open is
  expected/harmless during this transitional period. Staff are already
  exempted from this entire trigger by a pre-existing early return, untouched
  here.

Verified live end-to-end on a fresh test dispatch (`ASN03578`): reported a
blocking issue as the driver (`error: null`); attempted `arrive_pickup` —
failed with `open_blocking_issue` as the driver (`error: null`); retried the
same `arrive_pickup` as the driver — succeeded (`error: null`), confirming
the gate opens again immediately on resolution.

**2026-10-23 — Phase 4 (frontend wiring) written, not yet verified live:**
No new migration — code only.

- `assignmentTypes.ts`: `Assignment.openIssue` (read-only: `id`, `reason`,
  `reportedByName`, `reportedAt`) — the real table's current open blocking
  issue, parallel to the existing `issueReason` legacy field.
- `db.ts`: `assignmentFromRow` now takes an `issues` row array and derives
  `openIssue` from it (the row with `status='open' && is_blocking`, matching
  what the phase-1 unique index already caps at one). `loadAdminData` fetches
  `assignment_issues` for everyone; `loadDriverData` fetches it for the
  driver's own chosen assignment; `loadDriverCompletedDelivery` passes none
  (completed deliveries can't have one open, per the phase-3 gate). Two new
  wrappers: `reportAssignmentIssue()` (driver, raw-throw like
  `advanceDriverStage`) and `resolveAssignmentIssue()` (CSR, routed through
  the existing `actionFailure()`/`AssignmentActionError` typing — added
  `already_resolved` and `assignment_not_active` as new codes, both mapped to
  plain-language text in `DriversManagement.tsx`'s `actionMessage`).
- `issueWorkflow.ts`: `hasOpenBlockingIssue()` now checks `openIssue` first,
  falling back to the old issueReason heuristic only for reports made before
  this table existed — single source of truth for both old and new data.
- `DriverInterface.tsx`: `handleIssueSubmit` now calls
  `reportAssignmentIssue()` directly instead of `driverUpdate({ issueReason
  })` — no more `driverUpdate`/manual notification call, the RPC does both
  server-side in one transaction. Maps the sheet's single returned string to
  `issueType`/`reason` itself: a canned `BLOCKING_ISSUE_REASONS` match passes
  through as its own type; anything else (the "Other..." free-text branch)
  is classified `issueType: 'Other...'`, matching the phase-2 RPC's
  validation exactly. The two "delivery paused" reason displays now read
  `openIssue?.reason ?? issueReason` so both new and legacy-reported issues
  show correctly.
- `DriversManagement.tsx`: the View Details issue banner now shows real
  reporter/timestamp from `openIssue` when present (falling back to the old
  notification-matching lookup only for legacy rows with no table row), and
  renders a working **Resolve & Continue** button (optional 300-char note)
  for CSR/admin — hidden under `isViewOnly` (OPM stays view-only, per
  REQ-004). A legacy issue with no `openIssue` row still shows the original
  "cannot be safely cleared from this screen" message, since there's no real
  `issue_id` to act on for those.

`pnpm typecheck` passes clean.

**Verified live (2026-10-23) on ASN03578, end-to-end through the real UI (no
console):** reported an issue as the driver via the "Report a problem"
button — the "Delivery paused · Issue under review" banner appeared with the
correct reason, slider disabled. On the admin side, View Details showed the
"Open Issue · Blocking" banner with the correct reporter name and a real
timestamp (not the old "Not recorded" fallback), plus a working **Resolve &
Continue** button with the resolution-note field in place of the old static
"cannot be safely cleared" message. Resolving it cleared the banner
immediately; back on the driver tab, the paused banner was gone and the
delivery could continue normally.

**2026-10-23 — Password re-confirmation added to resolve_assignment_issue():**
Same `signed_in_recently(300)` guard as `archive_driver()`/`reset_driver_pin()`,
added in the same migration as the team member archive/restore reauth change
(`supabase/migrations/20261023000006_team_member_archive_restore_reauth.sql`).
The **Resolve & Continue** button no longer acts immediately — it opens the
existing `ConfirmPasswordDialog` component (`verifyOwnPassword()` against
Supabase Auth first, RPC called only on success), same pattern now shared by
driver archive, team member archive/restore, and this. Verified live: Resolve
now prompts for a password before clearing the issue.

**REQ-008 is complete — all 4 phases implemented and verified live.**

**Open item carried over from the original handoff, not yet resolved:** the
doc's own text flags that issue-type blocking classification (all 6 named
types + Other are currently all blocking) needs review with operations
before being treated as final. Phase 2 will implement it exactly matching
what the existing frontend prototype already assumes, as a single,
clearly-isolated, easily-revisable mapping — not a business decision made
here.

### Existing data path and failure

The current relational schema is in `supabase/migrations/20260919000000_init.sql`
with later workflow migrations. `public.assignments.id` and
`public.drivers.id` are `text`; `public.profiles.id` is the authenticated
`uuid`. `assignments.task_status` allows `Failed / Issue` and
`assignments.issue_reason` is one nullable `text` field. Later migrations add
`operational_stage` and event timestamps, but no issue lifecycle or saved
stage-at-report. `public.delay_reports` has `bigint` identity IDs, `pickup`/
`delivery` type, reason, and a Driver-formatted *text* `reported_at`; it is
not the Report a Problem lifecycle. `public.notifications` has `text` IDs,
`issue_report` type, and `timestamptz created_at`. `public.activity_log` has
`text` IDs, `timestamptz ts`, `admin_user_id uuid`, `admin_email`,
`admin_role`, `assignment_id text`, and `reason`, but no issue ID.

`DriverInterface.handleIssueSubmit` currently calls `driverUpdate` with only
`issueReason`; `db.ts` updates `assignments.issue_reason` and then separately
inserts a notification. A previous bundle/record can have raw
`task_status='Failed / Issue'`. `assignmentFromRow` maps those two columns
directly. `getAdminOperationalProgress` treats that status as terminal, while
`hasOpenBlockingIssue` deliberately excludes it because its prior stage is
unknown. Hence View Shipment says `Progress ended` and hides Open Issue.
An earlier local Resolve prototype cleared `issue_reason` via a client update.
That was removed: it was not an atomic resolution, erased the only open marker,
and stored no resolver or resolution time. The current frontend can show the
legacy recorded reason and a matching notification timestamp if present, but
cannot truthfully call it recoverable. Existing stage timestamps may hint at
progress; they do not prove the exact stage at report time.

### Recommended data model (proposed names, not SQL)

Add `public.assignment_issues`, distinct from `delay_reports` unless a deliberate
unification/migration of both reporting workflows is designed. Keep one row per
incident; never overwrite an earlier resolved issue. Proposed columns:

| Column | Type / nullability / default | Purpose |
|---|---|---|
| `id` | `bigint generated always as identity`, primary key | Stable issue identity, matching `delay_reports` ID convention |
| `assignment_id` | `text not null` | FK to `public.assignments(id)`; preserve assignment and issue history; no cascade deletion |
| `issue_type` | `text not null` | Exact selected Report a Problem choice; for Other, store `Other` separately from details |
| `reason` | `text not null` | Driver-entered details/selected reason; do not rewrite with AI |
| `is_blocking` | `boolean not null` | Server-derived classification, never trust a client boolean |
| `status` | `text not null default 'open'` | Constrained to `open`, `resolved` |
| `reported_by_driver_id` | `text not null` | FK to `public.drivers(id)`; owning Driver at report time |
| `reported_at` | `timestamptz not null default now()` | Server time, not the Driver's display string |
| `task_status_at_report` | `text not null` | Exact `assignments.task_status` while row is locked |
| `operational_stage_at_report` | `text null` | Exact nullable `assignments.operational_stage` while locked |
| `resolved_by_user_id` | `uuid null` | FK to `public.profiles(id)` / `auth.uid()` for staff resolver |
| `resolved_at` | `timestamptz null` | Server time, only when resolved |
| `resolution_note` | `text null` | Optional real staff note |
| `created_at` | `timestamptz not null default now()` | Conventional creation metadata |
| `updated_at` | `timestamptz not null default now()` | Maintain server-side on lifecycle update |

Prefer `ON DELETE RESTRICT`/`NO ACTION` for assignment and actor relationships,
or a deliberate archival strategy that never erases incident history. If
accounts/drivers may be removed, retain immutable actor display snapshots in
addition to nullable FKs; never substitute current names for historical ones.
Check `status` values and enforce that resolved rows have resolver/time and
open rows do not. Add indexes on `(assignment_id, reported_at desc)`,
`(status, reported_at desc)`, and issue type for the Delay & Issues Report.
Add a partial unique index on `assignment_id` where `status='open' and
is_blocking=true` to prevent contradictory simultaneous blocking issues;
allow multiple historical resolved issues and nonblocking issues. Define an
idempotency key or equivalent request deduplication for double submit.

The current Report a Problem choices are Cargo damaged in transit, Wrong
delivery address, Customer refused delivery, Vehicle breakdown, Cargo lost or
missing, Accident / road incident, and Other. The local prototype classifies
all six named choices as blocking and treats Other conservatively as blocking.
Pickup/delivery delay reports are a separate nonblocking workflow. Review the
classification with operations before enforcing it; keep one versioned,
server-owned mapping shared with the frontend.

### Required server operations, authorization, and concurrency

1. `report_assignment_issue(assignment_id, issue_type, reason, idempotency_key)`:
   authenticated owning Driver only (`driver_owns_assignment`), current active
   assignment only. Lock assignment row, validate type and text, derive blocking
   on server, capture both stage columns, insert issue, audit/activity and one
   persisted staff `issue_report` notification in one transaction. Do **not**
   set `task_status='Failed / Issue'`. Return issue plus unchanged assignment.
2. `resolve_assignment_issue(issue_id, resolution_note?)`: authorized CSR
   initially, matching current `can_write()`/View Shipment permission. OPM is
   currently view-only in shipment screens; granting OPM resolve requires an
   explicit product decision and dedicated backend permission, not general
   assignment write rights. Lock assignment then issue in a consistent order;
   require active assignment and an open blocking issue; set resolved state,
   `resolved_at=now()`, `resolved_by_user_id=auth.uid()`, audit/activity; leave
   `task_status` and `operational_stage` untouched. Reject a concurrent second
   resolve with an explicit already-resolved result. Return refreshed state.
3. Update `public.advance_driver_stage` and the `guard_assignment_update`
   direct-status path: after locking the assignment, reject every Driver
   progression transition while an open blocking issue exists. The current
   trigger explicitly allows a Driver to set `Failed / Issue`; remove that
   automatic report path only with a coordinated client rollout. Gate
   completion/other stage-changing RPCs consistently. Nonblocking issues do
   not block. Do not rely on a disabled slider.
4. Provide authorized read paths for one open issue and full issue history:
   staff sees operational details; owning Driver sees their assignment's issue
   state in the existing poll. RLS and RPCs must use the current authenticated
   session checks; no anonymous direct writes. Do not expose other drivers'
   incidents. Return persisted timestamps in ISO form.
5. Keep `cancel_assignment(p_id,p_reason,p_password)` as the only cancellation
   action, with its current password, reason, loading cutoff, lock, release and
   audit rules. Preserve linked issues after cancellation and mark their
   lifecycle consistently (e.g. resolve with explicit cancellation outcome),
   without deleting them. Current rules disallow cancellation after Loading;
   that policy may need a separately approved safe terminal path for a later
   blocking incident. Never bypass it from Resolve & Continue.

The existing `activity_log` and the shipment Activity timeline are separate.
Store issue ID (proposed nullable `activity_log.issue_id bigint` FK), actor ID,
role, assignment/ASN, type, reason where appropriate, and server timestamp for
`issue_reported`, `delivery_paused`, `issue_resolved`, and `delivery_resumed`.
Use distinct rows only if those are distinct operational events; avoid duplicate
poll-generated activity. Cancellation already writes `task_cancelled`; link
the issue if cancellation is issue-related. Never log password/PIN/secrets.
The existing `notifications` feed is staff-facing. Create exactly one
`issue_report` staff notification transactionally; for resolution, expose the
updated issue to Driver polling and add a Driver notification only through an
existing or explicitly designed Driver-visible persisted channel. Never
notify on polling itself.

### Frontend contract and migration

Both `loadAdminData()` and `loadDriverData()` need the same canonical issue
shape, e.g. assignment `openIssue` and `issueHistory` with `id`, `type`,
`reason`, `blocking`, `status`, `reportedAt`, `reportedByDriverId/name`,
`taskStatusAtReport`, `operationalStageAtReport`, `resolvedAt`,
`resolvedByUserId/name`, `resolutionNote`. Include a server error code for
open-blocking-stage, already-resolved, stale/terminal assignment and
not-authorized. The Driver UI must show pause from that state; View Shipment
may show Resolve & Continue only after the atomic operation exists. The
Delay & Issues Report should read retained open/resolved incidents, types,
reason, Driver/truck/ASN, timestamps and blocking flag. Duration is only
derived when a real start/end pair exists; do not infer from completion.

For legacy `assignments.task_status='Failed / Issue'`, preserve the raw row
and reason, label it legacy/read-only, and do not guess its prior stage from
photos or timestamps. Backfill issue history only where a real source proves
type, actor, time, stage and lifecycle; otherwise leave those fields unknown.
Resolve legacy recovery through case-by-case authorized review, not a blanket
migration. If the business later needs a deliberate terminal Failed state,
design a separate authorized operation with reason, failed_by/at, resource
release and audit; the current `Failed / Issue` is not that operation.

Backend tests must cover blocking/nonblocking report, unchanged stage, the
server progression gate (including direct update), duplicate submission,
atomic notification/activity, CSR and OPM/Driver authorization, resolution
without advancing, concurrent double resolve, cancellation race, report while
another stage update runs, resolved history retention, Driver poll visibility,
and legacy rows without a provable prior stage.

**Migration required:** Yes, pending backend approval/design. No SQL, Edge
Function, database or Supabase change is part of this local frontend task.

---

## [REQ-009] Single active session for Driver, CSR and OPM

**Status:** Implemented

**Area:** Auth / Login / all screens

**Requested change:** One account may be signed in on one device at a time.
The newest login wins; the older device is signed out automatically (an upload
interrupted on the old device is acceptable).

**Implementation (2026-10-21):** `20261021000001_single_active_session.sql`.
`session_is_current()` checks that the request's JWT `session_id` is the
user's newest row in `auth.sessions`; `is_staff()`, `can_write()`, `is_opm()`,
`my_driver_id()` and the `profiles_select` / `drivers_select` /
`csr_password_reset_owner_read` policies require it. `my_session_status()`
returns current / replaced / signed_out and removes older sessions.
`sync_driver_login` ends a driver's sessions when the PIN or phone changes.
Frontend: `db.ts` (`endOlderSessions`, `checkSessionStatus`, sign-out of this
device only), `App.tsx`, `LoginScreen.tsx`, `DriverInterface.tsx`.

**Verification:** `supabase/tests/single_active_session.test.sql` 15/15 passed;
tested on localhost; live since commit `5278468`.

---

## [REQ-010] Store file paths instead of 10-year signed links

**Status:** Implemented

**Area:** Storage / Photos / Documents / Notifications

**Requested change:** Photos and documents must not be stored as signed links
valid for 10 years. Store only the path inside the private bucket and create a
short-lived link when the data is loaded.

**Implementation (2026-10-21):** `20261021000003_store_file_paths.sql` rewrote
155 stored links to paths in `status_photos.url`,
`assignment_documents.file_url` and `notifications.photo_url` (document upload
times preserved) and added CHECK constraints so a link can never be stored
again. Frontend: `src/app/lib/storageRefs.ts` and `db.ts` sign paths in batches
for 1 hour, cache them and renew 10 minutes before expiry.

**Verification:** before/after fingerprints matched (paths, document times,
statuses, row counts); `supabase/tests/store_file_paths.test.sql` 4/4 passed;
`storageRefs.test.cjs` 6/6. Links copied before the change keep working until
they expire (moving the files was skipped by decision).

---

## [REQ-011] Dispatch and completion as one database action

**Status:** Implemented

**Area:** Dispatch / Deliveries / Activity log

**Requested change:** Assigning and completing a delivery must save fully or
not at all, must not double-book a driver or truck, and must always write its
activity-log row.

**Why backend/database support is required:** the screens saved each step
(assignment, 6 document slots, driver status, truck status, log row) as
separate requests through `syncAdminData`. A dropped connection could leave
half a delivery, and nothing re-checked that the driver/truck were still free
at the moment of saving.

**Implementation (2026-10-21):** `20261021000004_dispatch_complete_rpcs.sql`
(additive, nothing dropped):
- `dispatch_assignment(p_fields jsonb) → id` — admin/CSR only; locks driver then
  truck, refuses `driver_busy` / `truck_unavailable` / archived, creates the
  assignment (database-generated `ASN#####` id) and its 6 document slots, marks
  driver/truck Assigned, logs `task_assigned`.
- `complete_assignment(p_id) → completed_at` — admin/CSR only; locks the
  assignment, requires Delivered and all 6 documents approved, archives it,
  frees driver/truck, logs `task_completed`.
Frontend: `db.ts` (`dispatchAssignment`, `completeAssignment`, new error codes),
`DriversManagement.tsx` (Assign Task and Mark Complete call these through
`onServerChange`; no local copy or client log row).

**Verification:** `supabase/tests/dispatch_complete.test.sql` 12/12 passed,
including the all-or-nothing check; TypeScript and 74 Node tests pass.
Tested on localhost by the user (2026-10-21): no problems found.

**2026-10-23 — Hardening applied and verified:**
`supabase/migrations/20261023000003_req011_direct_write_guards.sql`. Found
live: `assignments_insert`/`assignments_update` RLS let any `can_write()`
staff member raw-INSERT or raw-UPDATE `state = 'completed'` directly,
skipping every check `dispatch_assignment()`/`complete_assignment()` make
(driver/truck availability, the 6 document slots, documents-approved,
driver/truck release, the activity-log row). Closed with the same
transaction-local-flag technique cancellation already used:
- `dispatch_assignment()` now sets `app.verified_dispatch_id` right before
  its own insert; a new `guard_assignment_insert()` trigger (`before insert`)
  refuses any insert whose id doesn't match.
- `guard_assignment_cancel()` (already firing on every assignments update,
  not just cancellations) gets one more check: `state → 'completed'` must
  carry `app.verified_completion_id` — the flag `complete_assignment()`
  already set for the `completed_at_utc` guard, so no change was needed
  there.

Verifying this exposed that two existing test fixtures
(`req003_cancel_cutoff.test.sql`, `req005_assignment_locations.test.sql`)
inserted directly into `assignments` while a CSR's `request.jwt.claims` was
still active from an earlier step in the same transaction (PostgreSQL GUCs
persist across `reset role`) rather than with no session — fixed both to
clear claims around those raw inserts, matching the convention
`dispatch_complete.test.sql` already used correctly.
`req005_assignment_locations.test.sql` also turned out to have been broken
independent of this change since REQ-009 shipped: it impersonates a real
staff profile without ever giving it a session row, so `can_write()`'s
newer `session_is_current()` check always failed at setup. Fixed by adding
a throwaway `auth.sessions` row (the whole test rolls back, so nothing
persists).

Verified live: `dispatch_complete.test.sql` 12/12, `req003_cancel_cutoff.test.sql`
16/16, `req005_assignment_locations.test.sql` 20/20 all still pass. A manual
negative test (impersonating a real CSR with a valid session, wrapped in its
own rolled-back transaction) confirmed both a direct insert and a direct
`state = 'completed'` update are now rejected with `not_authorized`.

---

## [REQ-012] REQ — PER-ACCOUNT PROFILE PERSISTENCE

**Status:** Implemented (2026-10-22)

**2026-10-22 — migration prepared, not yet applied:**
`supabase/migrations/20261022000000_profile_persistence.sql`. Adds
`profiles.avatar_path`; two self-service `SECURITY DEFINER` RPCs
(`update_own_display_name(p_name)`, `set_own_avatar_path(p_avatar_path)`),
both scoped to `auth.uid()` only, so neither `profiles_update_opm` nor the
existing column grants needed any change (avoids the cross-account-write
risk this entry itself flagged). Extends `media_insert`/`media_update` to
allow a staff member to write only under their own
`profiles/<their uuid>/...` path in the existing private bucket; extends
`media_delete` (previously `can_write()`-only, which would have wrongly
blocked OPM from removing their own avatar) with the same owner-match
branch. `media_select` needed no change — `is_staff()` already grants any
signed-in staff member read access to the whole bucket. Server-side file
size/type validation is **not** included — flagged, not silently skipped;
validation stays client-side for now, same as existing photo/doc uploads.
**Applied and verified (2026-10-22):** Ran in the Supabase SQL editor against
360Logistics DB; `profiles.avatar_path` confirmed present. Exercised from the
running app's browser console, signed in as staff:
`update_own_display_name` succeeded and persisted the new name on the
caller's own row. `set_own_avatar_path` succeeded for the caller's own
`profiles/<their uuid>/...` path, and correctly refused with `invalid_path`
(22023) for another account's uuid — confirming the ownership check works
both ways, not just the happy path. Storage policy changes
(`media_insert`/`media_update`/`media_delete`) were not independently
exercised with a real file upload in this pass; they follow the identical
ownership-check pattern already proven at the RPC level.

**`db.ts` wiring (2026-10-22):** `StaffSession` gained `avatarPath`; `toStaff()`
maps it from `avatar_path`. Added `updateOwnDisplayName(name)`,
`uploadOwnAvatar(uid, dataUrl)`, `removeOwnAvatar(path)`, and
`resolveAvatarUrl(path)`. Avatar upload/sign reuses the existing
`uploadImage()`/`signStoredFiles()`/`displayUrl()` infrastructure already
built for REQ-010 (short-lived signed links, 1-hour cache) — no new signing
logic was written. Avatars upload to a fixed `profiles/<uid>/avatar.jpg`
path every time, so a new upload replaces in place (no orphaned-file
cleanup needed); only an explicit removal (no replacement) calls
`storage.remove()`. Compiles cleanly (`pnpm dev` HMR, no errors). **Frontend wiring (2026-10-22):** `SettingsPanel.tsx`'s Profile section
replaced the disabled "editing unavailable" message with real controls: an
inline-editable name (pencil icon → input + Save/Cancel) and an avatar
upload/remove flow (file picker → `uploadOwnAvatar`, "Remove" button →
`removeOwnAvatar`), with the stored path resolved to a display URL via
`resolveAvatarUrl` whenever it changes. `App.tsx` gained
`handleStaffProfileUpdated`, threaded through `AdminDashboard.tsx` as
`onStaffProfileUpdated` → `SettingsPanel`'s `onProfileUpdated`; a successful
save merges the returned fields into the single shared `staffProfile` state,
so the navbar/dropdown/dashboard update together per the requirement's own
contract — no separate refetch. Compiles cleanly (`pnpm dev` HMR, no
errors). **Tested live (2026-10-22), two real bugs found and fixed:**
1. `storageRefs.ts`'s `UPLOAD_FOLDERS` allow-list (`['photos/', 'docs/']`) didn't
   include `'profiles/'`, so `storagePathOf()` rejected the new avatar paths and
   `displayUrl()` fell through to returning the raw path unchanged instead of a
   signed URL — the `<img>` tag's `src` was literally the storage path, not a
   link. Fixed by adding `'profiles/'` to that list.
2. Avatars always upload to one fixed path (`profiles/<uid>/avatar.jpg`) so
   replacing doesn't orphan old files — but that means the path string never
   changes on a replace, so a `useEffect` keyed on the path alone never
   re-fires after a second upload, and the navbar/dropdown avatar (a separate
   piece of UI that never displayed a photo at all before this work) wouldn't
   pick up a replacement either. Restructured: the resolved avatar URL now
   lives once in `App.tsx` (shared by the navbar and Settings, both reading
   the same state), and `uploadOwnAvatar`/`onProfileUpdated` pass the fresh
   URL through directly rather than relying solely on the path-changed
   effect. `Header.tsx` now also renders the actual photo (both the pill and
   dropdown), not just a generic icon.

**Live-tested (2026-10-22):** name edit, photo upload, instant replace (no
refresh), removal, and navbar sync all confirmed working by the user.

**Third issue found and fixed — Workspace Settings Team Members list:**
OPM's member list never showed any photo at all, even for a CSR who had one
— `TeamMember` (type + `memberFromRow()` in `db.ts`) never carried
`avatarPath`, so the UI had no way to know one existed. Added `avatarPath`
to `TeamMember`, mapped it in `memberFromRow()`, and added
`resolveAvatarUrls()` (plural) — one batched signing call for every member's
avatar at once, reusing the same `signStoredFiles` infrastructure, instead
of one request per row. `WorkspaceSettingsPanel.tsx`'s member rows now show
the real photo when resolved, falling back to initials otherwise.
**Live-tested and confirmed by the user:** the member with a photo shows it;
members without one still show initials correctly.

**REQ-012 status: all three found issues fixed and live-verified. Backend
and frontend both complete.**

**Blocker:** None — resolved. Backend, `db.ts`, and frontend (own profile +
Workspace Settings member list) all implemented and live-verified.

**Approval:** Not approved for a database/backend change in this frontend task.

**Area:** CSR/OPM account profile, Settings, header, private Storage.

### Current state and database work

`public.profiles` already has `id uuid primary key references auth.users(id)`,
`email text`, `name text`, `role text`, and `status text`. Reuse this table and
`profiles.name`; do not create a second profile table. Add nullable
`avatar_path text` (or an equivalently named Storage path reference) with a
migration. Store the private object path, never a long-lived signed URL or a
browser data URL. Existing names need no backfill. Existing browser-wide
`360_display_name` and `360_avatar` values have no reliable owner and must
not be migrated to arbitrary accounts. A missing avatar means the initials
fallback.

The current `profiles_update_opm` RLS policy only permits OPM updates to CSR
rows, while column grants allow updates to `name`, `role`, and `status`. It
does not provide CSR/OPM self-service profile updates. Add an owner-checked,
current-session-aware operation for name/avatar updates. Its server-side
authorization must bind the row to `auth.uid()` and permit only `name` and
`avatar_path`. Do not accept an arbitrary target user ID from the browser.
Keep `email`, `role`, `status`, and other account fields out of this operation.
Preserve OPM Team Member management, while ensuring that extending column
grants/policies cannot let OPM change another member's avatar or let CSR edit
OPM/another CSR. Recheck the existing `profiles_update_opm` policy and grants
together when choosing an RPC or RLS design; a new column grant combined with
that policy could otherwise broaden OPM writes. Honor the existing
`session_is_current()` single-active-session rule on reads and mutations.

### Private photo Storage

Reuse private bucket `make-ee4d169c-media`. Existing policies cover
`photos/<assignment-id>/...` and `docs/<assignment-id>/...` and do not authorize
profile files. Add narrowly scoped policies/operations for an account-owned
path such as `profiles/<auth-user-uuid>/avatar.<ext>`; verify the path owner on
upload, read, replace, and delete using the authenticated/current session.
Validate file type and size server-side and handle replacement/deletion so
orphaned objects do not accumulate. Do not make the bucket public. Resolve
the stored path to a short-lived signed URL for authorized display; renew it
after expiry. If OPM needs to see CSR photos in Workspace Settings, define
that read permission explicitly without granting cross-account writes.

### Required operations and frontend contract

- **Fetch current profile:** existing `db.ts` `fetchProfile(auth.uid())` is
  private and used by `signInStaff()` / `restoreSession()`. Extend its mapped
  `StaffSession` response to `{ id, email, name, role, avatarPath }` (with
  `avatarPath: null` when absent). `email` and `role` remain server-owned.
- **Update own Display Name:** accept a validated nonempty `name`, identify
  the account from the current session, persist `profiles.name`, and return
  the updated current-profile fields. Reject a replaced/ended session.
- **Upload/change own photo:** accept a real image for an owner-scoped path,
  persist `avatar_path` only after a successful upload, and return the new
  profile fields plus an authorized short-lived display URL. Handle failure
  without falsely reporting a saved profile.
- **Remove own photo:** clear `avatar_path` for the authenticated owner and
  remove or schedule cleanup of the old object. Return the updated profile
  with `avatarPath: null` and `avatarUrl: null`.
- **Resolve image URL:** given the authenticated user's permitted avatar path,
  return an expiring signed URL. Do not persist that URL in `profiles`.

The frontend should extend `src/app/lib/db.ts` with these operations once the
backend is ready. `App.tsx` now retains one `StaffSession` as the canonical
identity; `AdminDashboard.tsx` passes it to Settings and supplies its name to
the navbar, dropdown, dashboard, and Workspace Settings. After a successful
server update, replace that shared profile with the returned profile, so all
surfaces update together. On login/restore, load the current account by ID;
on logout/session replacement, clear profile and signed-URL state. Reject
late responses from a prior account/session. `SettingsPanel.tsx` must only
show success after the operation succeeds. Its name/photo edit controls are
currently disabled in the UI because no authorized server save exists.

**Migration required:** Add `profiles.avatar_path`; add/adjust the secure
self-profile operation, privileges, and RLS; and add private Storage policies
for account-owned avatars. Do not edit prior migrations. Backend tests should
cover CSR/OPM self-update, cross-account and cross-role denial, protected
email/role/status, replaced session denial, upload/replace/remove, signed URL
expiry, and failure consistency. No migration or Supabase operation is applied
by this frontend task.

**2026-10-26 — two reported bugs fixed, applied and verified live:**
`supabase/migrations/20261026000001_profile_name_avatar_validation.sql`.
1. `update_own_display_name()` only checked non-empty / under 100 characters
   — nothing stopped a value like `--`. Added a format check: must start
   with a letter, and contain only letters, spaces, apostrophes, hyphens,
   and periods. Matching client-side check added in `SettingsPanel.tsx`.
2. The original migration's own comment above said Storage RLS "can't
   cleanly inspect an upload's content type" and left file-type validation
   client-side only (`accept="image/*"` on the file input is a browser hint
   a user can bypass via drag-and-drop or "All Files" — `handleAvatarChange`
   never actually checked `file.type`). That assumption was wrong: Supabase
   Storage records each upload's real MIME type in `storage.objects.metadata`
   before the row is ever visible to RLS, so `media_insert`/`media_update`
   now require `metadata->>'mimetype' like 'image/%'` for the `profiles/`
   path specifically — genuinely server-enforced, not just a browser hint.
   Added a matching explicit `file.type` check in `handleAvatarChange` too.

Verified live: tried saving `--` as a display name — rejected with the new
message, both the inline client check and (separately confirmed) the server
rule. Saved a real name — worked normally. Avatar: a non-image file was
rejected by the client-side check before any upload was attempted.

The driver-name equivalent of bug 1 (`register_driver()`) is documented in
the REQ-004 entry above, applied in the same session.

---

## [REQ-013] REQ — DELIVERIES DATE / TIMESTAMP CONSISTENCY

**Status:** Implemented (2026-10-22)

**2026-10-22 — migration prepared, not yet applied:**
`supabase/migrations/20261022000001_assignment_event_timestamps.sql`. Adds
nullable `assignments.completed_at_utc` / `cancelled_at`
(`timestamptz`), stamped with the server's own `now()` inside
`complete_assignment()` / `cancel_assignment()` respectively, in the same
update as the state change. Legacy `completed_at` text untouched; no
backfill of historical rows. Both new columns are additionally protected
from being set any other way — each RPC sets a transaction-local flag right
before its own update (reusing the exact technique `cancel_assignment`
already used for `cancel_reason`), and `guard_assignment_cancel()` (already
firing on every `assignments` update, not just cancellations) refuses any
other attempt to change either column, including a `can_write()` caller
going around the RPC with a direct table update — satisfies this
requirement's own "unauthorized callers cannot set or edit event timestamps
directly" test point for both timestamps, not just one.

**Applied and verified (2026-10-22):** Ran in the Supabase SQL editor;
`completed_at_utc`/`cancelled_at` confirmed present as `timestamptz`.
Protection confirmed: a direct `.update({cancelled_at: ...})` from a logged-in
admin/CSR session correctly failed with `not_authorized` — even a legitimate
staff session cannot bypass the RPC. Functional stamping confirmed: cancelled
a real test assignment (`ASN07474`) through the actual `cancel_assignment`
RPC via the console; `cancelled_at` persisted as a real server timestamp
(`2026-10-22 16:20:24.698584+00`) alongside the correct `state`,
`task_status`, and `cancel_reason`. `completed_at_utc` independently confirmed too: fast-forwarded a second test
assignment (`ASN21884`) to `Delivered` with all 6 documents approved via SQL
(shortcutting the already-separately-tested delivery workflow itself), then
called the real `complete_assignment` RPC via the console —
`completed_at_utc` persisted as `2026-10-22 16:27:40.567096+00`, alongside
the correct `state`/`task_status` and the unchanged legacy `completed_at`
label.

**Both new timestamps fully verified end to end.**

**`db.ts` wiring (2026-10-22):** Turned out the UI already had the full
display/sort contract built and waiting — `DriversManagement.tsx` and
`DeliveryTable.tsx` already read `completedEventAt`/`cancelledAt`, previously
sourced only from an `activity_log` lookup (the doc's own earlier note: "the
frontend now uses that full audit timestamp... where available"). The only
change needed was swapping the source: `completedEventAt` now prefers the
new `completed_at_utc` directly, `cancelledAt` now prefers `cancelled_at`
directly — falling back to the old `activity_log` lookup only for rows that
predate this migration. No other file touched; nothing else consumes these
fields. Compiles cleanly (module re-fetched with no transpile error).
**Confirmed live in the browser by the user:** both `ASN07474` (cancelled)
and `ASN21884` (completed) show the correct date and time in Deliveries.

**REQ-013 complete — backend applied/verified, `db.ts` wired and
live-confirmed.**

### Current problem and fields

`public.assignments.delivery_date text` is the scheduled delivery day, while
`picked_up_date text` and `pickup_time text` are the planned pickup appointment.
`assignments.created_at timestamptz` is creation time. Physical delivery is
recorded by `unloading_completed_at timestamptz` (or historical Delivered
photo evidence). These values are not the final completion or cancellation
event.

`complete_assignment(p_id)` currently writes `assignments.completed_at text`
as `Mon DD, HH:MI AM` in Manila time, **without a year or offset**. In the same
transaction it writes a `public.activity_log` row with
`type = 'task_completed'`, `assignment_id`, and server-stamped `ts
timestamptz`. The frontend now uses that full audit timestamp for the
Completed date where available. The yearless label cannot independently
support reliable historical display, sorting, or date-range filtering.

The authorized `cancel_assignment(p_id, p_reason, p_password)` operation sets
`assignments.state = 'cancelled'` and writes a `task_cancelled` activity row
with server-stamped `activity_log.ts`. There is no `assignments.cancelled_at`
column. The frontend uses the matching audit event. A historical cancellation
without a trustworthy audit timestamp displays `—` and is omitted from
specific date ranges; its scheduled `delivery_date` is never presented as a
cancellation date.

### Required backend behavior and frontend contract

Add a canonical full timestamp for the successful final completion transition
and cancellation transition on `public.assignments`. A safe additive migration
could introduce nullable `completed_at_utc timestamptz` alongside the legacy
`completed_at text`, plus nullable `cancelled_at timestamptz`. Choose final
names after checking connected-project schema. Set each field with server time
inside the corresponding guarded RPC, in the same transaction as the state
change and activity row. Do not reset either timestamp on reload, document
review, or unrelated edits. Retain the current authorization, password check,
reason requirement, document approval gate, and resource release logic.

Return the full ISO timestamp with its timezone/offset through the existing
assignment fetch. The frontend should map it to an explicit completion or
cancellation instant, format it with `Asia/Manila`, and use that same instant
for display, descending order, and date-range filtering. Keep the legacy
display label only for backward compatibility until its consumers are
migrated. A date-only schedule must remain a Philippine calendar date, not be
converted as a UTC instant.

### Historical records and validation

Backfill only when a matching, trustworthy `task_completed` or
`task_cancelled` audit row exists for that assignment. Do not infer a year from
the yearless `completed_at`, use `delivery_date`, or use `created_at` as an
event time. Missing history stays nullable and visibly unavailable. Verify
that duplicate/stale calls do not change a previously recorded timestamp.

Backend tests should cover: authorized completion and cancellation each stamp
the correct field and audit row atomically; blocked transitions stamp nothing;
UTC instants around Manila midnight display on the right local day; records
sort and filter by the event instant rather than schedule; older missing rows
remain null; concurrent/duplicate calls cannot overwrite the original time;
unauthorized callers cannot set or edit event timestamps directly.

---

## [REQ-016] Login lockout — 5 failed attempts lock the account for 5 minutes

**Status: IMPLEMENTED (2026-10-31).** Applies to Admin/CSR/OPM and Driver logins.

| Setting | Behaviour |
|---|---|
| Failed attempts allowed | 5 |
| Lockout starts | on the 5th failed sign-in (that response already says "locked") |
| Duration | 5 minutes, fixed — attempts during a lock are rejected, **not counted, and do not extend it** |
| Successful login | clears the counter |
| During a lock | every attempt is refused, even with the right password |
| After 5 minutes | attempts accepted again; the next failure starts a fresh count of 1 |
| Stale failures | failures older than 15 minutes don't add up |
| Scope | per **account** (lower-cased login email; a driver's is derived from their mobile number). Not per IP — by decision, since Supabase already rate-limits per IP and shared office/mobile IPs would lock out co-workers |
| Unknown addresses | counted and locked like real ones (team decision; also keeps real and fake addresses indistinguishable) |

**Implementation:** `20261031000000_login_lockout.sql` adds `login_attempts` (RLS on, no
policies, all browser access revoked) and three service_role-only functions:
`login_lock_seconds`, `record_login_failure` (atomic, row-locked), `record_login_success`.
`000001` made it count real accounts only; `000002` reversed that by decision. Edge Function
`supabase/functions/login` (`logic.ts` rules, `index.ts` wiring, `--no-verify-jwt` because it is
called before any session exists; also set in `config.toml`) checks the lock, verifies the
password with Auth, records the outcome and returns the session, which `db.ts` `authenticate()`
installs with `auth.setSession()`. `signInStaff`/`signInDriver` both use it; the login screen
shows "Too many failed attempts. Try again in N min." (driver text in English and Filipino).
Fails closed: if the lock cannot be checked the login is refused. Auth rate limits (429) and
outages are not counted as failed attempts.

**Verification:** `supabase/tests/login_lockout.test.sql` 10/10; `logic.test.cjs` 10/10; Edge
Function deployed 2026-10-31; live: 5 wrong passwords locked a staff account and a driver
account, a different account still logged in, and a non-existent address locked too.

**Known limit:** a scripted attacker can still call Supabase Auth's own API directly with the
public anon key and skip this lockout. Closing that needs Supabase's Password Verification
hook, which is Team/Enterprise plan only. Also uncovered: the in-app "confirm your password"
re-checks (change password, cancel-assignment re-auth) still call Supabase directly.
