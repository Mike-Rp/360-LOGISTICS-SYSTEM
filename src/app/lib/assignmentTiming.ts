import type { Assignment } from '../data/assignmentTypes';

type TimingAssignment = Pick<Assignment, 'taskStatus' | 'deliveryDate' | 'eta' | 'statusPhotos' | 'unloadingCompletedAt'>;
type PickupTimingAssignment = Pick<Assignment,
  'taskStatus' | 'pickedUpDate' | 'pickupTime' | 'operationalStage' | 'pickupArrivedAt'
  | 'loadingStartedAt' | 'departedAt' | 'statusPhotos'>;

export type DeliveryTimingStatus = {
  kind: 'overdue' | 'delivered_late';
  label: string;
  accessibleLabel: string;
  duration: { value: number; unit: 'minute' | 'hour' | 'day' };
};

export type PickupTimingStatus = {
  kind: 'pickup_overdue' | 'picked_up_late';
  label: string;
  accessibleLabel: string;
  scheduledPickup: string;
};

const DAY_MS = 86_400_000;
// Dispatch schedules deliveries in Philippine local time. The Philippines uses UTC+8 year-round.
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function validCalendarDay(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

function parseDate(value: string): { year: number; month: number; day: number } | null {
  const text = value.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const named = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(text);
  const numeric = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  const year = Number(iso?.[1] ?? named?.[3] ?? numeric?.[3]);
  const month = iso ? Number(iso[2]) : named ? MONTHS.indexOf(named[1].slice(0, 3).toLowerCase()) + 1 : Number(numeric?.[1]);
  const day = Number(iso?.[3] ?? named?.[2] ?? numeric?.[2]);
  return year && validCalendarDay(year, month, day) ? { year, month, day } : null;
}

function parseTime(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(value.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59 || (match[3] ? hour < 1 || hour > 12 : hour > 23)) return null;
  if (match[3]) hour = hour % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0);
  return { hour, minute };
}

function manilaTimestamp(year: number, month: number, day: number, hour: number, minute: number): number {
  return Date.UTC(year, month - 1, day, hour, minute) - MANILA_OFFSET_MS;
}

/** The stored schedule fields are Philippine wall time, regardless of the viewer's timezone. */
export function isScheduledDeliveryToday(deliveryDate: string, now = new Date()): boolean {
  const scheduled = parseDate(deliveryDate);
  if (!scheduled) return false;
  const manilaNow = new Date(now.getTime() + MANILA_OFFSET_MS);
  return scheduled.year === manilaNow.getUTCFullYear()
    && scheduled.month === manilaNow.getUTCMonth() + 1
    && scheduled.day === manilaNow.getUTCDate();
}

export function scheduledPickupTimestamp(pickedUpDate: string, pickupTime: string): number | null {
  const date = parseDate(pickedUpDate);
  const time = parseTime(pickupTime);
  return date && time ? manilaTimestamp(date.year, date.month, date.day, time.hour, time.minute) : null;
}

/** Active assignments scheduled today; only an unstarted, future pickup can be "next". */
export function getDashboardSchedule(assignments: readonly Pick<Assignment,
  'taskStatus' | 'deliveryDate' | 'pickedUpDate' | 'pickupTime' | 'operationalStage' | 'pickupArrivedAt'>[], now = new Date()) {
  const scheduledToday = assignments.filter((assignment) =>
    assignment.taskStatus !== 'Cancelled' && isScheduledDeliveryToday(assignment.deliveryDate, now)).length;
  const upcoming = assignments.flatMap((assignment) => {
    if (assignment.taskStatus !== 'Assigned' || assignment.operationalStage || assignment.pickupArrivedAt
      || !isScheduledDeliveryToday(assignment.pickedUpDate, now)) return [];
    const timestamp = scheduledPickupTimestamp(assignment.pickedUpDate, assignment.pickupTime);
    return timestamp !== null && timestamp > now.getTime() ? [timestamp] : [];
  });
  return { scheduledToday, nextPickupAt: upcoming.length ? Math.min(...upcoming) : null };
}

export function statusPhotoTimestamp(value?: string): number | null {
  if (!value) return null;
  // New driver photo evidence stores a year-bearing local display stamp without an offset.
  const local = /^(.+\d{4}),?\s+(.+)$/.exec(value.trim());
  if (local) {
    const date = parseDate(local[1]);
    const time = parseTime(local[2]);
    if (date && time) return manilaTimestamp(date.year, date.month, date.day, time.hour, time.minute);
  }
  // Accept an unambiguous ISO timestamp if older/imported evidence has one.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim())) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Physical delivery evidence time, shared by schedule and document-age displays. */
export function getPhysicalDeliveryTimestamp(assignment: Pick<Assignment, 'taskStatus' | 'statusPhotos' | 'unloadingCompletedAt'>): number | null {
  if (assignment.taskStatus !== 'Delivered') return null;
  const serverTime = assignment.unloadingCompletedAt ? Date.parse(assignment.unloadingCompletedAt) : NaN;
  return Number.isFinite(serverTime) ? serverTime
    : statusPhotoTimestamp(assignment.statusPhotos?.Delivered?.timestamp);
}

const unitText = (value: number, unit: 'minute' | 'hour' | 'day') =>
  `${value} ${unit}${value === 1 ? '' : 's'}`;

function historicalPickupDuration(lateMs: number): string {
  const days = Math.floor(lateMs / DAY_MS);
  if (days) return unitText(days, 'day');
  const hours = Math.floor(lateMs / 3_600_000);
  const minutes = Math.floor((lateMs % 3_600_000) / 60_000);
  if (hours) return [unitText(hours, 'hour'), ...(minutes ? [unitText(minutes, 'minute')] : [])].join(' ');
  return unitText(Math.max(1, minutes), 'minute');
}

/** Delay reports explain lateness; only physical progress can end an active pickup warning. */
export function getPickupTimingStatus(assignment: PickupTimingAssignment, now = new Date()): PickupTimingStatus | null {
  if (assignment.taskStatus === 'Cancelled' || assignment.taskStatus === 'Failed / Issue') return null;
  const date = parseDate(assignment.pickedUpDate ?? '');
  const time = parseTime(assignment.pickupTime ?? '');
  if (!date || !time) return null;
  const scheduledAt = manilaTimestamp(date.year, date.month, date.day, time.hour, time.minute);
  const scheduledPickup = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }).format(new Date(scheduledAt));

  const arrivedAt = statusPhotoTimestamp(assignment.pickupArrivedAt ?? undefined);
  // Older records may have progressed without an arrival timestamp. Their stage or
  // saved pickup photo proves the pickup is no longer pending, but cannot supply
  // an accurate historical duration.
  const pickupReached = !!assignment.pickupArrivedAt || !!assignment.operationalStage
    || !!assignment.loadingStartedAt || !!assignment.departedAt
    || assignment.taskStatus === 'Picked Up' || assignment.taskStatus === 'In Transit'
    || assignment.taskStatus === 'Delivered'
    || !!assignment.statusPhotos?.['Picked Up']?.url
    || ['pickup_front', 'pickup_left', 'pickup_right', 'pickup_rear']
      .some((key) => !!assignment.statusPhotos?.[key]?.url);

  if (!pickupReached && assignment.taskStatus === 'Assigned') {
    const lateMs = now.getTime() - scheduledAt;
    if (lateMs <= 0) return null;
    const duration = durationParts(lateMs, false);
    const text = unitText(duration.value, duration.unit);
    return {
      kind: 'pickup_overdue', label: `Pickup overdue · ${text}`,
      accessibleLabel: `Pickup overdue by ${text}. Scheduled pickup: ${scheduledPickup}`,
      scheduledPickup,
    };
  }

  if (arrivedAt === null || arrivedAt <= scheduledAt) return null;
  const text = historicalPickupDuration(arrivedAt - scheduledAt);
  return {
    kind: 'picked_up_late', label: `Arrived late · ${text}`,
    accessibleLabel: `Arrived at pickup ${text} late. Scheduled pickup: ${scheduledPickup}`,
    scheduledPickup,
  };
}

function durationParts(lateMs: number, dateOnly: boolean): DeliveryTimingStatus['duration'] {
  if (dateOnly) {
    const days = Math.floor(lateMs / DAY_MS) + 1;
    return { value: days, unit: 'day' };
  }
  if (lateMs >= DAY_MS) {
    const days = Math.floor(lateMs / DAY_MS);
    return { value: days, unit: 'day' };
  }
  if (lateMs >= 3_600_000) {
    const hours = Math.floor(lateMs / 3_600_000);
    return { value: hours, unit: 'hour' };
  }
  const minutes = Math.max(1, Math.floor(lateMs / 60_000));
  return { value: minutes, unit: 'minute' };
}

/** A display-only schedule condition; never changes the assignment workflow status. */
export function getDeliveryTimingStatus(assignment: TimingAssignment, now = new Date()): DeliveryTimingStatus | null {
  if (assignment.taskStatus === 'Cancelled' || assignment.taskStatus === 'Failed / Issue') return null;
  const date = parseDate(assignment.deliveryDate ?? '');
  if (!date) return null;
  const time = parseTime(assignment.eta ?? '');
  const dateOnly = !time;
  // Without an ETA, the scheduled date remains on time until the next Manila calendar day.
  const deadline = dateOnly
    ? manilaTimestamp(date.year, date.month, date.day + 1, 0, 0)
    : manilaTimestamp(date.year, date.month, date.day, time.hour, time.minute);
  const delivered = assignment.taskStatus === 'Delivered';
  if (!delivered && !['Assigned', 'Picked Up', 'In Transit'].includes(assignment.taskStatus)) return null;
  const actual = delivered ? getPhysicalDeliveryTimestamp(assignment) : now.getTime();
  if (actual === null || !Number.isFinite(actual) || (dateOnly ? actual < deadline : actual <= deadline)) return null;
  const duration = durationParts(actual - deadline, dateOnly);
  const durationText = `${duration.value} ${duration.unit}${duration.value === 1 ? '' : 's'}`;
  return delivered
    ? { kind: 'delivered_late', label: `Delivered late · ${durationText}`, accessibleLabel: `Delivery was ${durationText} late`, duration }
    : { kind: 'overdue', label: `Overdue · ${durationText}`, accessibleLabel: `Delivery overdue by ${durationText}`, duration };
}

/** Dispatch shows one active red deadline at a time; delivery takes precedence. */
export function getDispatchTimingNotices(assignment: TimingAssignment & PickupTimingAssignment, now = new Date()) {
  const delivery = getDeliveryTimingStatus(assignment, now);
  const pickup = delivery?.kind === 'overdue' ? null : getPickupTimingStatus(assignment, now);
  return { delivery, pickup };
}
