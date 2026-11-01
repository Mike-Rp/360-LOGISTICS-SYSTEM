import { scheduledPickupTimestamp } from './assignmentTiming';

export const PHILIPPINE_TIME_ZONE = 'Asia/Manila';
export const PHILIPPINE_TIME_LABEL = 'Philippine Time (PHT, UTC+08:00)';

/** Zone-less form values are Philippine wall time, not the device's local time.
 * Reuse the established Manila schedule parser and its real calendar-date checks. */
export function parsePhilippineInputValue(value: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const timestamp = scheduledPickupTimestamp(match[1], match[2]);
  return timestamp === null ? null : new Date(timestamp);
}

/** A database timestamptz must identify an instant. Never interpret date-only or
 * zone-less strings as device-local timestamps. Calendar inputs keep date strings. */
export function persistedTimestamp(value?: string | null): Date | null {
  const match = value && /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i.exec(value);
  if (!match || scheduledPickupTimestamp(match[1], match[2]) === null) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** The string consumed by datetime-local (or separate date/time controls), in PHT. */
export function toPhilippineInputValue(date: Date): string {
  if (!Number.isFinite(date.getTime())) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: PHILIPPINE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export const philippineDateKey = (date: Date): string => toPhilippineInputValue(date).slice(0, 10);

export function formatPhilippineTimestamp(value?: string | null): string {
  const date = persistedTimestamp(value);
  if (!date) return 'Not available';
  return `${new Intl.DateTimeFormat('en-US', {
    timeZone: PHILIPPINE_TIME_ZONE, month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(date)} PHT`;
}
