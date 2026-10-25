import type { Assignment } from '../data/assignmentTypes';

export const OPERATIONAL_STEPS = [
  'Assigned', 'At Pickup', 'Loading', 'In Transit', 'Arrived', 'Unloading', 'Delivered',
] as const;

/** Admin presentation derived from the persisted physical stage and legacy status. */
export function getAdminOperationalProgress(assignment: Assignment) {
  const status = assignment.taskStatus;
  const stage = assignment.operationalStage;
  const departureNeedsSync = !!assignment.departedAt && status === 'Picked Up';
  const deliveryNeedsSync = stage === 'unloaded' && status !== 'Delivered' && status !== 'Cancelled';
  const terminal = status === 'Cancelled' || status === 'Failed / Issue';

  let index = 0;
  let label: string = 'Assigned';
  if (status === 'Delivered') { index = 6; label = 'Delivered'; }
  else if (stage === 'unloaded' || stage === 'unloading') { index = 5; label = 'Unloading'; }
  else if (stage === 'destination_arrived') { index = 4; label = 'Arrived'; }
  else if (status === 'In Transit' || assignment.departedAt) { index = 3; label = 'In Transit'; }
  else if (stage === 'loaded' || stage === 'loading') { index = 2; label = 'Loading'; }
  else if (stage === 'pickup_arrived') { index = 1; label = 'At Pickup'; }
  else if (status === 'Picked Up') { index = 1; label = 'Picked Up'; }

  return {
    index, label,
    badge: terminal || departureNeedsSync || deliveryNeedsSync || status === 'Delivered'
      ? null : index === 1 && stage === 'pickup_arrived' ? 'At Pickup'
        : index === 2 ? 'Loading' : index === 4 ? 'Arrived'
          : index === 5 ? 'Unloading' : null,
    syncWarning: !terminal && departureNeedsSync
      ? 'Trip departed, but the In Transit status has not synced yet.'
      : !terminal && deliveryNeedsSync
        ? 'Unloading finished, but the Delivered status has not synced yet.'
        : null,
    terminal,
  };
}

/** Presentation hint only. The cancellation RPC locks and checks the row again. */
export function canCancelBeforeLoadingCompletes(assignment: Assignment): boolean {
  return assignment.taskStatus === 'Assigned'
    && !assignment.loadingCompletedAt
    && !assignment.departedAt
    && !assignment.destinationArrivedAt
    && !assignment.unloadingStartedAt
    && !assignment.unloadingCompletedAt
    && (assignment.operationalStage == null
      || assignment.operationalStage === 'pickup_arrived'
      || assignment.operationalStage === 'loading');
}

export function formatOperationalStamp(value?: string | null): string | null {
  if (!value) return null;
  // Older display stamps have no year or timezone; show them as stored.
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(date).replace(/, (\d{4}) at /, ', $1 · ');
}

export function formatOperationalDuration(start?: string | null, end?: string | Date | null): string | null {
  if (!start || !end) return null;
  const from = Date.parse(start);
  const to = end instanceof Date ? end.getTime() : Date.parse(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  const minutes = Math.floor((to - from) / 60_000);
  if (minutes === 0) return '<1 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr${hours === 1 ? '' : 's'}${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
}

export const OPERATIONAL_PHOTO_GROUPS = [
  { title: 'At Pickup', slots: [['pickup_front', 'Front'], ['pickup_left', 'Left Side'], ['pickup_right', 'Right Side'], ['pickup_rear', 'Rear']] },
  { title: 'Loading', slots: [['loading_before', 'Before Loading'], ['loading_after', 'After Loading']] },
  { title: 'Pre-trip', slots: [['pretrip_front', 'Front'], ['pretrip_left', 'Left Side'], ['pretrip_right', 'Right Side'], ['pretrip_rear', 'Rear']] },
  { title: 'Unloading', slots: [['unloading_before', 'Before Unloading'], ['unloading_after', 'After Unloading']] },
] as const;

/** Great-circle distance between two lat/lng points, in meters. */
function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Flags any photo in a group whose own GPS has no other photo in that group
 * nearby (default 500m — generous enough for walking around a large
 * truck/yard, but catches "somewhere else entirely"). Compares each photo to
 * its CLOSEST neighbor, not to the group's average — a single lone outlier
 * would otherwise drag the average far enough to make every normal photo
 * look wrong too. Pure derivation from GPS data each photo already carries
 * (REQ09) — no new data or table needed. Fewer than 2 located photos means
 * nothing to compare, so nothing is flagged. */
export function findGroupLocationOutliers(
  photos: Array<{ key: string; coords?: { lat: number; lng: number } }>,
  thresholdMeters = 500,
): Set<string> {
  const located = photos.filter((p): p is { key: string; coords: { lat: number; lng: number } } => !!p.coords);
  if (located.length < 2) return new Set();
  const flagged = new Set<string>();
  for (const p of located) {
    const nearest = Math.min(...located.filter((o) => o.key !== p.key).map((o) => haversineMeters(p.coords, o.coords)));
    if (nearest > thresholdMeters) flagged.add(p.key);
  }
  return flagged;
}

export type ActivityStageState = 'completed' | 'in_progress' | 'not_reached';

/** Display state only; the driver workflow remains the authority for transitions. */
export function getDeliveryActivityStates(assignment: Assignment): ActivityStageState[] {
  const photos = assignment.statusPhotos ?? {};
  const evidenceComplete = (groupIndex: number) => OPERATIONAL_PHOTO_GROUPS[groupIndex].slots
    .every(([key]) => !!photos[key]?.url);
  const progress = getAdminOperationalProgress(assignment);
  const completed = [
    true,
    !!assignment.pickupArrivedAt && evidenceComplete(0),
    !!assignment.loadingCompletedAt && evidenceComplete(1),
    !!assignment.departedAt && !!assignment.destinationArrivedAt && evidenceComplete(2),
    !!assignment.destinationArrivedAt,
    !!assignment.unloadingCompletedAt && evidenceComplete(3),
    assignment.taskStatus === 'Delivered',
  ];
  const reached = [
    true,
    !!assignment.pickupArrivedAt || progress.index >= 1,
    !!assignment.loadingStartedAt || progress.index >= 2,
    !!assignment.departedAt || progress.index >= 3,
    !!assignment.destinationArrivedAt || progress.index >= 4,
    !!assignment.unloadingStartedAt || progress.index >= 5,
    assignment.taskStatus === 'Delivered',
  ];
  return completed.map((done, index) => done ? 'completed' : reached[index] ? 'in_progress' : 'not_reached');
}
