/** Reveal a selected tab by scrolling the strip only, keeping the page still. */
export function revealSelectedDeliveryTab(strip: HTMLElement | null) {
  const selected = strip?.querySelector<HTMLElement>('[aria-pressed="true"]');
  if (!strip || !selected) return;
  const container = strip.getBoundingClientRect();
  const item = selected.getBoundingClientRect();
  if (item.left < container.left) strip.scrollBy({ left: item.left - container.left, behavior: 'auto' });
  else if (item.right > container.right) strip.scrollBy({ left: item.right - container.right, behavior: 'auto' });
}
