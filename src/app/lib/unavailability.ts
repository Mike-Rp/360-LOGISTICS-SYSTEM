import { parsePhilippineInputValue, persistedTimestamp, philippineDateKey, toPhilippineInputValue, PHILIPPINE_TIME_ZONE } from './philippineTime';

/* Drivers can be marked Unavailable and trucks Under maintenance (REQ-019). The database decides who is
   unavailable (current_unavailability) and refuses to dispatch them; these helpers only shape what the
   screens show and check the form before it is sent. */

export type DriverUnavailableReason = 'sick' | 'leave' | 'emergency' | 'no_show' | 'other';
export type UnavailableReason = DriverUnavailableReason | 'maintenance';

export interface Unavailability {
  id: string;
  reason: UnavailableReason;
  note: string;
  /** null = until the OPM marks them back. */
  expectedReturnAt: string | null;
  since: string;
}

export type UnavailabilityKind = 'driver' | 'truck';

export const NOTE_MAX_LENGTH = 200;

export const DRIVER_REASONS: ReadonlyArray<{ value: DriverUnavailableReason; label: string }> = [
  { value: 'sick', label: 'Sick' },
  { value: 'leave', label: 'Vacation / Leave' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'no_show', label: 'No-show' },
  { value: 'other', label: 'Other' },
];

const REASON_LABELS: Record<UnavailableReason, string> = {
  sick: 'Sick', leave: 'Vacation / Leave', emergency: 'Emergency', no_show: 'No-show', other: 'Other', maintenance: 'Maintenance',
};
export const reasonLabel = (reason: UnavailableReason): string => REASON_LABELS[reason] ?? 'Unavailable';

export type FleetState = 'available' | 'onDelivery' | 'unavailable';

/* Unavailable wins: the database never lets a driver or truck with a delivery be marked, so the two
   cannot both be true for long. A driver's `status` is 'Assigned' while on a delivery; a truck's too. */
export const driverState = (d: { status: string; unavailable?: Unavailability }): FleetState =>
  d.unavailable ? 'unavailable' : d.status === 'Assigned' ? 'onDelivery' : 'available';
export const truckState = (t: { status: string; unavailable?: Unavailability }): FleetState =>
  t.unavailable ? 'unavailable' : t.status === 'Assigned' ? 'onDelivery' : 'available';

const monthDay = (date: Date) => date.toLocaleDateString('en-US', { timeZone: PHILIPPINE_TIME_ZONE, month: 'short', day: 'numeric' });
const monthDayTime = (date: Date) => date.toLocaleString('en-US', { timeZone: PHILIPPINE_TIME_ZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** "until Nov 3, 5:00 PM" / "until end of today" / "return date not set". A return at exactly midnight is shown as
    the end of the previous day, which is how a no-show is stored. */
export function describeReturn(expectedReturnAt: string | null, now: Date = new Date()): string {
  if (!expectedReturnAt) return 'return date not set';
  const at = persistedTimestamp(expectedReturnAt);
  if (!at) return 'return date not set';
  if (toPhilippineInputValue(at).endsWith('T00:00') && at.getUTCSeconds() === 0 && at.getUTCMilliseconds() === 0) {
    const day = new Date(at.getTime() - 60_000);
    return philippineDateKey(day) === philippineDateKey(now) ? 'until end of today (PHT)' : `until end of ${monthDay(day)} (PHT)`;
  }
  return `until ${monthDayTime(at)} PHT`;
}

/** One line for a badge or row: "Sick · until Nov 3, 5:00 PM". */
export function describeUnavailability(u: Pick<Unavailability, 'reason' | 'expectedReturnAt'>, now: Date = new Date()): string {
  return `${reasonLabel(u.reason)} · ${describeReturn(u.expectedReturnAt, now)}`;
}

/** "5 days" once an open-ended period has run for a day or more, so nobody stays blocked by accident; else null. */
export function openEndedFor(u: Pick<Unavailability, 'expectedReturnAt' | 'since'>, nowMs: number): string | null {
  if (u.expectedReturnAt) return null;
  const since = persistedTimestamp(u.since)?.getTime() ?? NaN;
  if (!Number.isFinite(since)) return null;
  const days = Math.floor((nowMs - since) / 86_400_000);
  return days >= 1 ? `${days} ${days === 1 ? 'day' : 'days'}` : null;
}

export interface UnavailabilityFormInput {
  kind: UnavailabilityKind;
  reason: string;
  note: string;
  /** Philippine wall time `YYYY-MM-DDTHH:mm`, or '' for "until I mark them back". */
  returnValue: string;
  /** Retain a saved instant's seconds/milliseconds when only the note is edited. */
  originalReturnAt?: string | null;
  nowMs: number;
}
export interface UnavailabilityFormErrors { reason?: string; note?: string; returnAt?: string }
export type UnavailabilityFormCheck =
  | { ok: true; reason: UnavailableReason; note: string; expectedReturn: Date | null }
  | { ok: false; errors: UnavailabilityFormErrors };

/** Mirrors the database rules so the form can explain a problem before sending. */
export function checkUnavailabilityForm(input: UnavailabilityFormInput): UnavailabilityFormCheck {
  const errors: UnavailabilityFormErrors = {};
  const note = input.note.trim();

  let reason: UnavailableReason = 'maintenance';
  if (input.kind === 'driver') {
    const match = DRIVER_REASONS.find((r) => r.value === input.reason);
    if (!match) errors.reason = 'Choose a reason.';
    else reason = match.value;
  }
  if (note.length > NOTE_MAX_LENGTH) errors.note = `The note can be at most ${NOTE_MAX_LENGTH} characters.`;
  else if (reason === 'other' && !note) errors.note = 'Add a short note for "Other".';

  let expectedReturn: Date | null = null;
  if (input.returnValue) {
    const original = persistedTimestamp(input.originalReturnAt);
    const at = original && toPhilippineInputValue(original) === input.returnValue
      ? original : parsePhilippineInputValue(input.returnValue);
    if (!at) errors.returnAt = 'Enter a valid return date and time.';
    else if (at.getTime() <= input.nowMs) errors.returnAt = 'The return time must be in the future.';
    else expectedReturn = at;
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, reason, note, expectedReturn };
}
