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
