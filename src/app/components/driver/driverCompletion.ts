export interface DriverCompletionRecord {
  id: string;
  completedAt: string;
}

export interface DriverCompletionSnapshot {
  activeId: string | null;
  completedIds: ReadonlySet<string>;
}

/** The first successful fetch is a baseline, never a new completion. */
export function observeDriverCompletion<T extends DriverCompletionRecord>(
  previous: DriverCompletionSnapshot | null,
  activeId: string | null,
  completed: readonly T[],
): { snapshot: DriverCompletionSnapshot; newlyCompleted: T | null } {
  const completedIds = new Set(completed.map(item => item.id));
  const newlyCompleted = previous?.activeId && !previous.completedIds.has(previous.activeId)
    ? completed.find(item => item.id === previous.activeId) ?? null : null;
  return {
    snapshot: {
      // Keep the last active ID through a brief gap between archive reads.
      activeId: activeId ?? (newlyCompleted ? null : previous?.activeId ?? null),
      completedIds,
    },
    newlyCompleted,
  };
}
