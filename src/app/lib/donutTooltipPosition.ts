export interface TooltipRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface TooltipPlacementInput {
  chart: TooltipRect;
  card: TooltipRect;
  legend: TooltipRect;
  anchor: { x: number; y: number };
  tooltip: { width: number; height: number };
  viewport: { width: number; height: number };
}

const EDGE = 12;
const GAP = 10;

const overlaps = (a: TooltipRect, b: TooltipRect) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

/** Keep the detail card outside the donut and legend; favor the hovered side when it has room. */
export function positionDonutTooltip({ chart, card, legend, anchor, tooltip, viewport }: TooltipPlacementInput) {
  const { width, height } = tooltip;
  const fitX = (x: number) => clamp(x, EDGE, viewport.width - EDGE - width);
  const fitY = (y: number) => clamp(y, EDGE, viewport.height - EDGE - height);
  const box = (left: number, top: number): TooltipRect => ({ left, top, right: left + width, bottom: top + height });
  const fits = (rect: TooltipRect) => rect.left >= EDGE && rect.right <= viewport.width - EDGE
    && rect.top >= EDGE && rect.bottom <= viewport.height - EDGE;
  const clear = (rect: TooltipRect) => fits(rect) && !overlaps(rect, chart) && !overlaps(rect, legend);

  const sideY = fitY(anchor.y - height / 2);
  const left = box(chart.left - GAP - width, sideY);
  const right = box(chart.right + GAP, sideY);
  const preferred = anchor.x < (chart.left + chart.right) / 2 ? [left, right] : [right, left];
  for (const candidate of preferred) {
    if (clear(candidate) && candidate.left >= card.left + EDGE && candidate.right <= card.right - EDGE) {
      return { left: candidate.left, top: candidate.top };
    }
  }

  // In the desktop card the space above the legend is normally open.
  if (card.right - card.left >= 500) {
    const cornerTop = Math.min(card.top + EDGE, chart.top - GAP - height, legend.top - GAP - height);
    const corner = box(card.right - EDGE - width, cornerTop);
    if (clear(corner) && corner.left >= card.left + 300) return { left: corner.left, top: corner.top };
  }

  const centeredX = fitX(anchor.x - width / 2);
  const above = box(centeredX, chart.top - GAP - height);
  const below = box(centeredX, chart.bottom + GAP);
  for (const candidate of [above, below]) {
    if (clear(candidate)) return { left: candidate.left, top: candidate.top };
  }

  // A very short viewport may not fit any surrounding slot. Keep the card in view,
  // on the side of the screen farther from the donut's center.
  const fallbackY = chart.top > viewport.height / 2 ? EDGE : viewport.height - EDGE - height;
  return { left: centeredX, top: fitY(fallbackY) };
}
