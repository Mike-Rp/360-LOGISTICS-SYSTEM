import { useState, useRef, useEffect } from 'react';
import type { Assignment, CompletedTask } from '../../../data/assignmentTypes';
import { ASSIGNMENT_DISPLAY_STATUSES, assignmentDisplayStatusChartColors } from '../../../lib/assignmentWorkflow';
import { buildOverviewBars, emptyOverviewCounts, type OverviewPeriod } from '../../../lib/deliveryOverview';

interface Props {
  assignments: Assignment[];
  completed: CompletedTask[];
  cancelled: Assignment[];
}

const SERIES = ASSIGNMENT_DISPLAY_STATUSES.map(status => ({
  status, color: assignmentDisplayStatusChartColors[status],
}));

const PERIODS = [
  { value: 'today', label: 'Today', subtitle: 'today' },
  { value: 'week', label: 'This Week', subtitle: 'this week' },
  { value: 'month', label: 'This Month', subtitle: 'this month' },
  { value: 'year', label: 'This Year', subtitle: 'this year' },
  { value: 'all', label: 'All Time', subtitle: 'at any time' },
] as const;

export default function DeliveryOverviewChart({ assignments, completed, cancelled }: Props) {
  const [period, setPeriod] = useState<OverviewPeriod>('today');
  const [hovered, setHovered] = useState<number | null>(null);

  /* Draw at the chart area's real size so bars fill it and 12px labels are never scaled.
     Width: always the card's width — bars shrink to fit, so there is no sideways scroll.
     Height: 260px when the cards stack; side by side (xl) the area fills whatever the
     card has left — the row height is set by Recent Activity, not by this chart. */
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 560, h: 230 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setBox({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const bars = buildOverviewBars(assignments, completed, cancelled, period, new Date(), window.innerWidth < 640 && box.w < 480);

  /* Legend totals — the same selected period as the bars */
  const totals = emptyOverviewCounts();
  bars.forEach((bar) => SERIES.forEach((s) => { totals[s.status] += bar.counts[s.status]; }));

  const dayTotal = (c: ReturnType<typeof emptyOverviewCounts>) => SERIES.reduce((s, x) => s + c[x.status], 0);
  const maxV    = Math.max(...bars.map((bar) => dayTotal(bar.counts)), 1);
  const step    = maxV <= 5 ? 1 : maxV <= 20 ? 5 : maxV <= 60 ? 10 : Math.ceil(maxV / 5 / 10) * 10;
  const gridMax = Math.ceil(maxV / step) * step;
  const ticks   = Array.from({ length: gridMax / step + 1 }, (_, i) => i * step);
  const isEmpty = bars.every((bar) => dayTotal(bar.counts) === 0);

  const VW = Math.max(box.w, 240), VH = Math.max(box.h, 160);
  const P  = { t: 10, r: 4, b: 40, l: 30 };      // bottom fits the two-line day labels
  const pw = VW - P.l - P.r, ph = VH - P.t - P.b;
  const slot = pw / bars.length, barW = Math.min(28, slot * 0.55);
  const labelEvery = Math.max(1, Math.ceil(bars.length / Math.max(1, Math.floor(pw / 42))));
  const Y = (v: number) => P.t + ph * (1 - v / gridMax);

  /* Tooltip: beside the hovered bar, flipped left near the right edge, kept inside the chart */
  const TIP_W = 205;
  const tipLeft = (i: number) => {
    const cx = P.l + slot * i + slot / 2;
    const right = cx + barW / 2 + 8;
    const left  = cx - barW / 2 - 8 - TIP_W;
    return Math.max(0, right + TIP_W <= VW ? right : left);
  };

  return (
    <div className="bg-white rounded-2xl border border-border shadow-sm p-5 sm:p-6 flex flex-col min-w-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground leading-tight">Delivery Overview</h3>
          <p className="text-sm text-muted-foreground">Current status of assignments created {PERIODS.find(option => option.value === period)?.subtitle}</p>
        </div>
        <select aria-label="Delivery overview time range" value={period}
          onChange={(event) => { setPeriod(event.target.value as OverviewPeriod); setHovered(null); }}
          className="self-start shrink-0 max-w-full rounded-lg border border-border bg-white px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30">
          {PERIODS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>

      {/* Legend — totals for the selected period */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
        {SERIES.slice().reverse().map((s) => (
          <span key={s.status} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
            {s.status} <span className="font-semibold text-foreground">{totals[s.status]}</span>
          </span>
        ))}
      </div>

      <div className="relative mt-4 h-[260px] xl:h-auto xl:flex-1 xl:min-h-[200px]">
        {/* Absolute, so the chart adds no height of its own to the card */}
        <div ref={boxRef} className="absolute inset-0 overflow-hidden">
          <div className="relative" style={{ width: VW, height: VH }}>
            <svg viewBox={`0 0 ${VW} ${VH}`} width={VW} height={VH} role="img"
              aria-label={`Deliveries by status for ${PERIODS.find(option => option.value === period)?.label}`}>
              {ticks.map((v) => (
                <g key={v}>
                  <line x1={P.l} y1={Y(v)} x2={VW - P.r} y2={Y(v)} stroke="#f0f0f0" strokeWidth={1} />
                  <text x={P.l - 8} y={Y(v) + 4} textAnchor="end" fontSize={12} fill="#9ca3af">{v}</text>
                </g>
              ))}
              {bars.map((bar, i) => {
                const cx = P.l + slot * i + slot / 2;
                let acc = 0;
                return (
                  <g key={bar.key} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}>
                    <rect x={P.l + slot * i} y={P.t} width={slot} height={ph}
                      fill={hovered === i ? '#f9fafb' : 'transparent'} />
                    {SERIES.map((s) => {
                      const v = bar.counts[s.status];
                      if (!v) return null;
                      const y0 = Y(acc), y1 = Y(acc + v);
                      acc += v;
                      return <rect key={s.status} x={cx - barW / 2} y={y1} width={barW}
                        height={Math.max(y0 - y1 - 1, 1)} rx={3} fill={s.color} />;
                    })}
                    {i % labelEvery === 0 && (
                      <>
                        <text x={cx} y={VH - 22} textAnchor="middle" fontSize={12} fill="#9ca3af">{bar.label}</text>
                        <text x={cx} y={VH - 6} textAnchor="middle" fontSize={12} fill="#9ca3af">{bar.detail}</text>
                      </>
                    )}
                  </g>
                );
              })}
            </svg>

            {isEmpty && (
              <p className="absolute inset-x-0 text-center text-sm text-muted-foreground pointer-events-none"
                style={{ top: P.t + ph / 2 - 10 }}>
                No deliveries for this period
              </p>
            )}

            {hovered !== null && bars[hovered] && (
              <div className="absolute top-0 bg-white border border-border rounded-xl shadow-lg px-3 py-2.5 text-xs pointer-events-none z-10"
                style={{ left: tipLeft(hovered), width: TIP_W }}>
                <p className="font-semibold text-foreground mb-1.5">
                  {bars[hovered].title} · {dayTotal(bars[hovered].counts)} deliveries
                </p>
                {SERIES.slice().reverse().map((s) => (
                  <div key={s.status} className="flex items-center gap-1.5 mb-0.5">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="text-muted-foreground">{s.status}</span>
                    <span className="font-semibold text-foreground ml-auto pl-3">{bars[hovered].counts[s.status]}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
