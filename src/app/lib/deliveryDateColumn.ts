import type { Assignment, CompletedTask } from '../data/assignmentTypes';
import { splitDisplayDateTime } from './displayDateTime';
import { completionTime } from './completedOrdering';

export type DeliveryTab = 'active' | 'delayed' | 'completed' | 'cancelled';
export type DeliveryPeriod = 'all' | 'today' | 'month' | 'year';

const MANILA = 'Asia/Manila';
const monthNumbers: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

type Day = { year: number; month: number; date: number };

function scheduledDay(value: string): Day | null {
  const text = value.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const named = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(text);
  const year = Number(iso?.[1] ?? named?.[3]);
  const month = iso ? Number(iso[2]) : monthNumbers[named?.[1].slice(0, 3).toLowerCase() ?? ''];
  const date = Number(iso?.[3] ?? named?.[2]);
  const valid = new Date(Date.UTC(year, month - 1, date));
  return year && month && date && valid.getUTCFullYear() === year && valid.getUTCMonth() + 1 === month && valid.getUTCDate() === date
    ? { year, month, date } : null;
}

function manilaDay(time: number): Day {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MANILA, year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(new Date(time));
  const number = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: number('year'), month: number('month'), date: number('day') };
}

function cancellationTime(assignment: Assignment): number | null {
  const value = assignment.cancelledAt;
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function deliveryDateHeading(tab: DeliveryTab): string {
  return tab === 'active' || tab === 'delayed' ? 'Scheduled Delivery' : tab === 'completed' ? 'Completed Date' : 'Cancelled Date';
}

export function deliveryDateColumn(assignment: Assignment, tab: DeliveryTab): { date: string; time: string | null; scheduled: string | null } {
  if (tab === 'active' || tab === 'delayed') return { date: assignment.deliveryDate?.trim() || '—', time: null, scheduled: null };
  const eventTime = tab === 'completed' ? completionTime(assignment as CompletedTask) : cancellationTime(assignment);
  const stamp = eventTime === null ? null : splitDisplayDateTime(new Date(eventTime).toISOString());
  return {
    date: stamp?.date ?? '—',
    time: stamp?.time ?? null,
    scheduled: assignment.deliveryDate?.trim() || null,
  };
}

export function matchesDeliveryPeriod(assignment: Assignment, tab: DeliveryTab, period: DeliveryPeriod, now = new Date()): boolean {
  if (period === 'all') return true;
  const eventTime = tab === 'completed' ? completionTime(assignment as CompletedTask)
    : tab === 'cancelled' ? cancellationTime(assignment) : null;
  const day = tab === 'active' || tab === 'delayed' ? scheduledDay(assignment.deliveryDate)
    : eventTime === null ? null : manilaDay(eventTime);
  if (!day) return false;
  const current = manilaDay(now.getTime());
  return day.year === current.year && (period === 'year' ||
    day.month === current.month && (period === 'month' || day.date === current.date));
}

/** Newest recorded cancellation first; legacy rows without an audit time remain visible last. */
export function sortCancelledNewestFirst<T extends Assignment>(records: readonly T[]): T[] {
  return [...records].sort((left, right) => {
    const a = cancellationTime(left), b = cancellationTime(right);
    if (a === null) return b === null ? right.id.localeCompare(left.id) : 1;
    if (b === null) return -1;
    return b - a || right.id.localeCompare(left.id);
  });
}
