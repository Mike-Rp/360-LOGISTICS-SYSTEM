import { useState, useRef, useEffect } from 'react';
import { ArrowRight } from 'lucide-react';
import type { Assignment, CompletedTask, TaskStatus } from '../../../data/assignmentTypes';

interface Props {
  assignments: Assignment[];
  completed: CompletedTask[];
  cancelled: Assignment[];
  onViewAll: () => void;
}

/* Same colour families as the shared badges (taskStatusConfig in assignmentTypes.ts).
   Picked Up (light sky) and In Transit (deep blue) are far apart in lightness so they
   stay distinct side by side; Cancelled is a lighter gray than the badge dot.
   Order = bottom of the stack to the top. */
const SERIES: { status: TaskStatus; color: string }[] = [
  { status: 'Delivered',      color: '#22c55e' },   // green-500
  { status: 'In Transit',     color: '#1d4ed8' },   // blue-700 (deep)
  { status: 'Picked Up',      color: '#38bdf8' },   // sky-400 (light)
  { status: 'Assigned',       color: '#a855f7' },   // purple-500
  { status: 'Failed / Issue', color: '#ef4444' },   // red
  { status: 'Cancelled',      color: '#d1d5db' },   // light gray
];

const DAYS = 7;
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

type Counts = Record<TaskStatus, number>;
const emptyCounts = (): Counts =>
  ({ 'Assigned': 0, 'Picked Up': 0, 'In Transit': 0, 'Delivered': 0, 'Failed / Issue': 0, 'Cancelled': 0 });

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/* Bars: the last 7 local days ending today, grouped by created_at — the same
   timestamp (and local-day rule) the Deliveries table sorts and filters by —
   coloured by where each delivery is now: completed → Delivered, cancelled →
   Cancelled, active → its current status. Days with nothing stay as empty bars.
   Deliveries without created_at are skipped. */
function buildDays(assignments: Assignment[], completed: CompletedTask[], cancelled: Assignment[]) {
  const now = new Date();
  const days = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (DAYS - 1 - i));
    return { key: dayKey(d), dayName: DAY_NAMES[d.getDay()], dayNum: d.getDate(), counts: emptyCounts() };
  });
  const byKey = new Map(days.map((d) => [d.key, d]));

  const add = (createdAt: string | undefined, status: TaskStatus) => {
    if (!createdAt) return;
    const d = new Date(createdAt);
    if (isNaN(d.getTime())) return;
    const day = byKey.get(dayKey(d));
    if (day) day.counts[status] += 1;
  };
  assignments.forEach((a) => add(a.createdAt, a.taskStatus));
  completed.forEach((c) => add(c.createdAt, 'Delivered'));
  cancelled.forEach((c) => add(c.createdAt, 'Cancelled'));
  return days;
}

export default function DeliveryOverviewChart({ assignments, completed, cancelled, onViewAll }: Props) {
  const [hovered, setHovered] = useState<number | null>(null);

  /* Draw at the chart area's real size so bars fill it and 12px labels are never scaled.
     Width: always the card's width — 7 bars shrink to fit, so there is no sideways scroll.
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

  const days = buildDays(assignments, completed, cancelled);

  /* Legend totals — the same 7 days as the bars */
  const totals = emptyCounts();
  days.forEach((d) => SERIES.forEach((s) => { totals[s.status] += d.counts[s.status]; }));

  const dayTotal = (c: Counts) => SERIES.reduce((s, x) => s + c[x.status], 0);
  const maxV    = Math.max(...days.map((d) => dayTotal(d.counts)), 1);
  const step    = maxV <= 5 ? 1 : maxV <= 20 ? 5 : maxV <= 60 ? 10 : Math.ceil(maxV / 5 / 10) * 10;
  const gridMax = Math.ceil(maxV / step) * step;
  const ticks   = Array.from({ length: gridMax / step + 1 }, (_, i) => i * step);
  const isEmpty = days.every((d) => dayTotal(d.counts) === 0);

  const VW = Math.max(box.w, 240), VH = Math.max(box.h, 160);
  const P  = { t: 10, r: 4, b: 40, l: 30 };      // bottom fits the two-line day labels
  const pw = VW - P.l - P.r, ph = VH - P.t - P.b;
  const slot = pw / DAYS, barW = Math.min(28, slot * 0.55);
  const Y = (v: number) => P.t + ph * (1 - v / gridMax);

  /* Tooltip: beside the hovered bar, flipped left near the right edge, kept inside the chart */
  const TIP_W = 170;
  const tipLeft = (i: number) => {
    const cx = P.l + slot * i + slot / 2;
    const right = cx + barW / 2 + 8;
    const left  = cx - barW / 2 - 8 - TIP_W;
    return Math.max(0, right + TIP_W <= VW ? right : left);
  };

  return (
    <div className="bg-white rounded-2xl border border-border shadow-sm p-5 sm:p-6 flex flex-col min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <h3 className="text-lg font-semibold text-foreground leading-tight">Delivery Overview</h3>
          <p className="text-sm text-muted-foreground">Status mix by day · last 7 days</p>
        </div>
        <button onClick={onViewAll}
          className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
          View all <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Legend — totals for the same 7 days */}
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
              aria-label="Deliveries per day by status, last 7 days">
              {ticks.map((v) => (
                <g key={v}>
                  <line x1={P.l} y1={Y(v)} x2={VW - P.r} y2={Y(v)} stroke="#f0f0f0" strokeWidth={1} />
                  <text x={P.l - 8} y={Y(v) + 4} textAnchor="end" fontSize={12} fill="#9ca3af">{v}</text>
                </g>
              ))}
              {days.map((d, i) => {
                const cx = P.l + slot * i + slot / 2;
                let acc = 0;
                return (
                  <g key={d.key} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}>
                    <rect x={P.l + slot * i} y={P.t} width={slot} height={ph}
                      fill={hovered === i ? '#f9fafb' : 'transparent'} />
                    {SERIES.map((s) => {
                      const v = d.counts[s.status];
                      if (!v) return null;
                      const y0 = Y(acc), y1 = Y(acc + v);
                      acc += v;
                      return <rect key={s.status} x={cx - barW / 2} y={y1} width={barW}
                        height={Math.max(y0 - y1 - 1, 1)} rx={3} fill={s.color} />;
                    })}
                    <text x={cx} y={VH - 22} textAnchor="middle" fontSize={12} fill="#9ca3af">{d.dayName}</text>
                    <text x={cx} y={VH - 6} textAnchor="middle" fontSize={12} fill="#9ca3af">{d.dayNum}</text>
                  </g>
                );
              })}
            </svg>

            {isEmpty && (
              <p className="absolute inset-x-0 text-center text-sm text-muted-foreground pointer-events-none"
                style={{ top: P.t + ph / 2 - 10 }}>
                No deliveries created in the last 7 days
              </p>
            )}

            {hovered !== null && (
              <div className="absolute top-0 bg-white border border-border rounded-xl shadow-lg px-3 py-2.5 text-xs pointer-events-none z-10"
                style={{ left: tipLeft(hovered), width: TIP_W }}>
                <p className="font-semibold text-foreground mb-1.5">
                  {days[hovered].dayName} {days[hovered].dayNum} · {dayTotal(days[hovered].counts)} deliveries
                </p>
                {SERIES.slice().reverse().map((s) => (
                  <div key={s.status} className="flex items-center gap-1.5 mb-0.5">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="text-muted-foreground">{s.status}</span>
                    <span className="font-semibold text-foreground ml-auto pl-3">{days[hovered].counts[s.status]}</span>
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
