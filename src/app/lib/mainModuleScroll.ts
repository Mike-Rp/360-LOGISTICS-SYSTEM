/** The staff shell keeps one scrollable main element while its modules change. */
export function moveMainModuleScroll<Page extends string>(
  container: { scrollTop: number },
  previousPage: Page,
  nextPage: Page,
  positions: Map<Page, number>,
  restoreHistoryPosition: boolean,
  previousScrollTop = container.scrollTop,
): void {
  if (previousPage === nextPage) return;
  positions.set(previousPage, previousScrollTop);
  container.scrollTop = restoreHistoryPosition ? positions.get(nextPage) ?? 0 : 0;
}
