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
