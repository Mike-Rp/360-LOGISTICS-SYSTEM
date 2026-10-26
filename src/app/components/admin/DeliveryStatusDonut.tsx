import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { positionDonutTooltip } from '../../lib/donutTooltipPosition';

interface StatusSlice {
  status: string;
  count: number;
  color: string;
}

interface DonutTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: StatusSlice }>;
  coordinate?: { x?: number; y?: number };
  total: number;
  chartRef: React.RefObject<HTMLDivElement>;
  legendRef: React.RefObject<HTMLDivElement>;
  touchMode: boolean;
  onDismiss: () => void;
}

function DonutTooltip({ active, payload, coordinate, total, chartRef, legendRef, touchMode, onDismiss }: DonutTooltipProps) {
  const item = payload?.[0]?.payload;
  const tooltipRef = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!active || !item || !chartRef.current || !legendRef.current || !tooltipRef.current) {
      setPosition(null);
      return;
    }
    const place = () => {
      const chart = chartRef.current?.getBoundingClientRect();
      const card = chartRef.current?.closest('[data-status-card]')?.getBoundingClientRect();
      const legend = legendRef.current?.getBoundingClientRect();
      const tooltip = tooltipRef.current?.getBoundingClientRect();
      if (!chart || !card || !legend || !tooltip) return;
      setPosition(positionDonutTooltip({
        chart, card, legend,
        anchor: { x: chart.left + (coordinate?.x ?? chart.width / 2), y: chart.top + (coordinate?.y ?? chart.height / 2) },
        tooltip: { width: tooltip.width, height: tooltip.height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      }));
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [active, item?.status, coordinate?.x, coordinate?.y, chartRef, legendRef]);

  useEffect(() => {
    if (!active || !item || !touchMode) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && (chartRef.current?.contains(target) || tooltipRef.current?.contains(target))) return;
      onDismiss();
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [active, item?.status, touchMode, chartRef, onDismiss]);

  if (!active || !item || total === 0) return null;
  return createPortal(
    <article ref={tooltipRef} role="status" aria-live="polite" onClick={event => event.stopPropagation()}
      className="fixed z-40 w-[min(190px,calc(100vw-24px))] rounded-lg border border-border bg-white px-3 py-2.5 text-sm text-foreground shadow-sm"
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}>
      <div className="flex items-center gap-2 font-semibold">
        <span className="h-[11px] w-[11px] shrink-0 rounded-[3px]" style={{ backgroundColor: item.color }} aria-hidden="true" />
        <span className="min-w-0 flex-1 break-words">{item.status}</span>
        {touchMode && <button type="button" onClick={onDismiss} aria-label="Close status details"
          className="-mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary">×</button>}
      </div>
      <p className="mt-1 text-muted-foreground">Assignments: <span className="font-medium text-foreground">{item.count}</span></p>
      <p className="text-muted-foreground">Percentage: <span className="font-medium text-foreground">{Math.round(item.count / total * 100)}%</span></p>
    </article>,
    document.body,
  );
}

export default function DeliveryStatusDonut({ statusCounts, total }: { statusCounts: StatusSlice[]; total: number }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const [touchMode, setTouchMode] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const dismiss = useCallback(() => setDismissed(true), []);

  useEffect(() => {
    const media = window.matchMedia('(hover: none), (pointer: coarse)');
    const update = () => setTouchMode(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const visible = statusCounts.filter(item => item.count > 0);
  return <div className="mt-4 flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-6">
    <div ref={chartRef} className="relative h-48 w-48 shrink-0" role="group" aria-label="Delivery status donut chart"
      onPointerEnter={event => { if (event.pointerType === 'mouse') { setTouchMode(false); setDismissed(false); } }}
      onPointerDown={event => { if (event.pointerType !== 'mouse') setTouchMode(true); }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart accessibilityLayer>
          <Pie data={visible} dataKey="count" nameKey="status" rootTabIndex={0}
            cx="50%" cy="50%" innerRadius={54} outerRadius={88} stroke="#ffffff" strokeWidth={2}
            onClick={(_, __, event) => { event.stopPropagation(); setDismissed(false); }}>
            {visible.map(item => <Cell key={item.status} fill={item.color} />)}
          </Pie>
          <Tooltip trigger={touchMode ? 'click' : 'hover'} active={dismissed ? false : undefined}
            isAnimationActive={false} wrapperStyle={{ pointerEvents: 'none' }}
            content={props => <DonutTooltip active={props.active} payload={props.payload} coordinate={props.coordinate}
              total={total} chartRef={chartRef} legendRef={legendRef}
              touchMode={touchMode} onDismiss={dismiss} />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-semibold leading-none text-foreground">{total}</span>
        <span className="text-xs text-muted-foreground">assignments</span>
      </div>
    </div>
    <div ref={legendRef} className="w-full min-w-0 space-y-2.5">
      {statusCounts.map(item => (
        <div key={item.status} className="flex items-center gap-2 text-xs sm:text-sm">
          <span className="h-[11px] w-[11px] shrink-0 rounded-[3px]" style={{ backgroundColor: item.color }} />
          <span className="min-w-0 flex-1 text-foreground">{item.status}</span>
          <span className="shrink-0 font-medium text-foreground">{item.count}</span>
          <span className="w-9 shrink-0 text-right text-muted-foreground">{Math.round(item.count / total * 100)}%</span>
        </div>
      ))}
    </div>
  </div>;
}
