import { useState, useRef, useEffect } from 'react';
import type { Assignment, CompletedTask, AppNotification, AdminActivityEntry } from '../../../data/assignmentTypes';
import type { AssignmentDisplayStatus } from '../../../lib/assignmentWorkflow';
import { buildOverviewBars, emptyOverviewCounts, type OverviewPeriod } from '../../../lib/deliveryOverview';

interface Props {
  assignments: Assignment[];
  completed: CompletedTask[];
  cancelled: Assignment[];
  notifications: AppNotification[];
  activityLog: AdminActivityEntry[];
}

const GROUPS = [
  { label: 'Completed', statuses: ['Completed'], color: '#03624C' },
  { label: 'Active', statuses: ['Assigned', 'Picked Up', 'In Transit', 'Delivered'], color: '#2CC295' },
  { label: 'Documents', statuses: ['Awaiting Documents', 'Under Review', 'Needs Correction'], color: '#00DF81' },
  { label: 'Issues', statuses: ['Failed / Issue'], color: '#DC2626' },
  { label: 'Cancelled', statuses: ['Cancelled'], color: '#707D7D' },
] as const satisfies readonly { label: string; statuses: readonly AssignmentDisplayStatus[]; color: string }[];
const BAR_WIDTH = 16;
const NEGATIVE_GAP = 5;

const PERIODS = [
  { value: 'today', label: 'Today', subtitle: 'today' },
  { value: 'week', label: 'This Week', subtitle: 'this week' },
  { value: 'month', label: 'This Month', subtitle: 'this month' },
  { value: 'year', label: 'This Year', subtitle: 'this year' },
  { value: 'all', label: 'All Time', subtitle: 'at any time' },
] as const;

export default function DeliveryOverviewChart({ assignments, completed, cancelled, notifications, activityLog }: Props) {
  const [period, setPeriod] = useState<OverviewPeriod>('week');
  const [hovered, setHovered] = useState<number | null>(null);

  /* Use the card width for short ranges. All Time can scroll horizontally so each
     historical month remains legible instead of squeezing every bar together. */
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

  const bars = buildOverviewBars(assignments, completed, cancelled, period, new Date(), window.innerWidth < 640 && box.w < 480, notifications, activityLog);

  /* Each assignment contributes once to a period, under its current status. */
  const totals = emptyOverviewCounts();
  bars.forEach((bar) => Object.keys(totals).forEach((status) => {
    totals[status as AssignmentDisplayStatus] += bar.counts[status as AssignmentDisplayStatus];
  }));

  const dayTotal = (c: ReturnType<typeof emptyOverviewCounts>) => Object.values(c).reduce((sum, count) => sum + count, 0);
  const groupTotal = (c: ReturnType<typeof emptyOverviewCounts>, statuses: readonly AssignmentDisplayStatus[]) =>
    statuses.reduce((sum, status) => sum + c[status], 0);
  const maxV    = Math.max(...bars.map((bar) => dayTotal(bar.counts)), 1);
  const step    = maxV <= 5 ? 1 : maxV <= 20 ? 5 : maxV <= 60 ? 10 : Math.ceil(maxV / 5 / 10) * 10;
  const gridMax = Math.ceil(maxV / step) * step;
  const ticks   = Array.from({ length: gridMax / step + 1 }, (_, i) => i * step);
  const isEmpty = bars.every((bar) => dayTotal(bar.counts) === 0);
  const maxNegative = Math.max(...bars.map((bar) =>
    GROUPS.slice(3).reduce((sum, group) => sum + groupTotal(bar.counts, group.statuses), 0)), 0);

  const VW = Math.max(box.w, 240, period === 'all' ? bars.length * 44 + 34 : 0), VH = Math.max(box.h, 160);
  const P  = { t: 10, r: 4, b: 40, l: 30 };      // bottom fits the two-line day labels
  const pw = VW - P.l - P.r, ph = VH - P.t - P.b;
  const slot = pw / bars.length, barW = Math.min(BAR_WIDTH, slot * 0.62);
  const labelEvery = Math.max(1, Math.ceil(bars.length / Math.max(1, Math.floor(pw / 42))));
  const gap = maxNegative > 0 ? NEGATIVE_GAP : 0;
  const pixelsPerDelivery = (ph - gap) / (gridMax + maxNegative);
  const baselineY = P.t + gridMax * pixelsPerDelivery;
  const Y = (v: number) => baselineY - v * pixelsPerDelivery;
  const negativeY = (v: number) => baselineY + gap + v * pixelsPerDelivery;

  /* Tooltip: beside the hovered bar, flipped left near the right edge, kept inside the chart */
  const TIP_W = 200;
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
          <p className="text-sm text-muted-foreground">Delivery activity for the selected period</p>
        </div>
        <select aria-label="Delivery overview time range" value={period}
          onChange={(event) => { setPeriod(event.target.value as OverviewPeriod); setHovered(null); }}
          className="self-start shrink-0 max-w-full rounded-lg border border-border bg-white px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30">
          {PERIODS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>

      {/* Five grouped totals for the selected period */}
      <div className="mt-3 flex flex-wrap gap-x-1.5 gap-y-1.5 sm:gap-x-3">
        {GROUPS.map((group) => (
          <span key={group.label} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <span className="h-[11px] w-[11px] shrink-0 rounded-[3px]" style={{ backgroundColor: group.color }} />
            {group.label} <span className="font-semibold text-foreground">{groupTotal(totals, group.statuses)}</span>
          </span>
        ))}
      </div>

      <div className="relative mt-3 h-[220px] xl:h-auto xl:flex-1 xl:min-h-[190px]">
        {/* Absolute, so the chart adds no height of its own to the card */}
        <div ref={boxRef} className="absolute inset-0 overflow-x-auto overflow-y-hidden">
          <div className="relative" style={{ width: VW, height: VH }}>
            <svg viewBox={`0 0 ${VW} ${VH}`} width={VW} height={VH} role="img"
              aria-label={`Deliveries stacked by status group for ${PERIODS.find(option => option.value === period)?.label}`}>
              {ticks.map((v) => (
                <g key={v}>
                  <line x1={P.l} y1={Y(v)} x2={VW - P.r} y2={Y(v)} stroke={v === 0 ? '#cbd5e1' : '#edf0ef'} strokeWidth={1} />
                  <text x={P.l - 4} y={Y(v) + 4} textAnchor="end" fontSize={14} fill="#8b959c">{v}</text>
                </g>
              ))}
              {bars.map((bar, i) => {
                const cx = P.l + slot * i + slot / 2;
                let positiveStacked = 0;
                let negativeStacked = 0;
                const lastPositive = GROUPS.reduce((last, group, index) =>
                  index < 3 && groupTotal(bar.counts, group.statuses) > 0 ? index : last, -1);
                const lastNegative = GROUPS.reduce((last, group, index) =>
                  index >= 3 && groupTotal(bar.counts, group.statuses) > 0 ? index : last, -1);
                return (
                  <g key={bar.key} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}>
                    <rect x={P.l + slot * i} y={P.t} width={slot} height={ph}
                      fill="transparent" />
                    {GROUPS.map((group, index) => {
                      const count = groupTotal(bar.counts, group.statuses);
                      if (!count) return null;
                      const isNegative = index >= 3;
                      const top = isNegative ? negativeY(negativeStacked) : Y(positiveStacked + count);
                      const height = count * pixelsPerDelivery;
                      if (isNegative) negativeStacked += count;
                      else positiveStacked += count;
                      return <rect key={group.label} x={cx - barW / 2} y={top} width={barW}
                        height={height} rx={index === lastPositive || index === lastNegative ? Math.min(2, height / 2) : 0}
                        fill={group.color} />;
                    })}
                    {i % labelEvery === 0 && (
                      <>
                        <text x={cx} y={VH - 22} textAnchor="middle" fontSize={14} fill="#9ca3af">{bar.label}</text>
                        <text x={cx} y={VH - 6} textAnchor="middle" fontSize={14} fill="#9ca3af">{bar.detail}</text>
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
              <div className="absolute top-0 bg-white border border-border rounded-xl shadow-lg px-3 py-2.5 text-sm pointer-events-none z-10"
                style={{ left: tipLeft(hovered), width: TIP_W }}>
                <p className="font-semibold text-foreground">{bars[hovered].title}</p>
                <p className="mb-1.5 text-muted-foreground">{dayTotal(bars[hovered].counts)} deliveries</p>
                {GROUPS.map((group) => (
                  <div key={group.label} className="mb-0.5 flex items-center gap-1.5">
                    <span className="h-[11px] w-[11px] shrink-0 rounded-[3px]" style={{ backgroundColor: group.color }} />
                    <span className="text-muted-foreground">{group.label}</span>
                    <span className="ml-auto pl-3 font-semibold text-foreground">{groupTotal(bars[hovered].counts, group.statuses)}</span>
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
