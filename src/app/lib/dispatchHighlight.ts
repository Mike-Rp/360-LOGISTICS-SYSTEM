/** The exact page containing a dispatched assignment after the current filters and sort. */
export function dispatchHighlightPage(id: string, visibleIds: readonly string[], pageSize: number): number | null {
  const index = visibleIds.indexOf(id);
  return index < 0 ? null : Math.floor(index / pageSize) + 1;
}

export type DispatchHighlight = { id: string; phase: 'hold' | 'fade' };

/** A timer can advance only the highlight it started for. */
export function advanceDispatchHighlight(
  current: DispatchHighlight | null,
  expected: DispatchHighlight,
  reducedMotion = false,
): DispatchHighlight | null {
  if (!current || current.id !== expected.id || current.phase !== expected.phase) return current;
  return current.phase === 'hold' && !reducedMotion ? { id: current.id, phase: 'fade' } : null;
}
