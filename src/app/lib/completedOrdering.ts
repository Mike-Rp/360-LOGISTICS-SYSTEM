import { parseStoredTimestamp } from '../data/assignmentTypes';

const zonedTimestamp = (value?: string | null): number | null => {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
};

/** A complete instant, never an inferred year from the legacy completed_at label. */
export function completionTime(record: { completedAt: string; completedEventAt?: string | null }): number | null {
  return zonedTimestamp(record.completedEventAt) ?? zonedTimestamp(record.completedAt);
}

/** Final completion time, not scheduled delivery or assignment creation time. */
export function sortCompletedNewestFirst<T extends { id: string; completedAt: string; completedEventAt?: string | null }>(records: readonly T[]): T[] {
  return [...records].sort((left, right) => {
    const leftTime = completionTime(left);
    const rightTime = completionTime(right);
    if (leftTime === null) return rightTime === null ? right.id.localeCompare(left.id) : 1;
    if (rightTime === null) return -1;
    return rightTime - leftTime || right.id.localeCompare(left.id);
  });
}
/** The same today/yesterday scope used by the Recent Completed Deliveries pop-up. */
export function recentCompletedDeliveries<T extends { id: string; completedAt: string; completedEventAt?: string | null }>(
  records: readonly T[], now = new Date(),
): { assignment: T; date: Date }[] {
  const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const today = dayKey(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const previousDay = dayKey(yesterday);
  return sortCompletedNewestFirst(records).flatMap((assignment) => {
    const date = parseStoredTimestamp(assignment.completedAt);
    return date && (dayKey(date) === today || dayKey(date) === previousDay) ? [{ assignment, date }] : [];
  });
}
