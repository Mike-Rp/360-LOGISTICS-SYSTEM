import { parseStoredTimestamp } from '../data/assignmentTypes';

/** Final completion time, not scheduled delivery or assignment creation time. */
export function sortCompletedNewestFirst<T extends { id: string; completedAt: string }>(records: readonly T[]): T[] {
  return [...records].sort((left, right) => {
    const leftTime = parseStoredTimestamp(left.completedAt)?.getTime() ?? null;
    const rightTime = parseStoredTimestamp(right.completedAt)?.getTime() ?? null;
    if (leftTime === null) return rightTime === null ? right.id.localeCompare(left.id) : 1;
    if (rightTime === null) return -1;
    return rightTime - leftTime || right.id.localeCompare(left.id);
  });
}
