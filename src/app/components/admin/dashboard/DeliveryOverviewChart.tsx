import { useState, useRef, useEffect } from 'react';
import type { Assignment, CompletedTask, TaskStatus } from '../../../data/assignmentTypes';

interface Props {
  assignments: Assignment[];
  completed: CompletedTask[];
  cancelled: Assignment[];
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

const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const PERIODS = [
  { value: 'today', label: 'Today', subtitle: 'today' },
  { value: 'week', label: 'This Week', subtitle: 'this week' },
  { value: 'month', label: 'This Month', subtitle: 'this month' },
  { value: 'year', label: 'This Year', subtitle: 'this year' },
] as const;
type Period = (typeof PERIODS)[number]['value'];

type Counts = Record<TaskStatus, number>;
const emptyCounts = (): Counts =>
  ({ 'Assigned': 0, 'Picked Up': 0, 'In Transit': 0, 'Delivered': 0, 'Failed / Issue': 0, 'Cancelled': 0 });

type ManilaParts = { year: number; month: number; day: number; hour: number };
type Bar = { key: string; label: string; detail: string; title: string; counts: Counts };
type Event = { date: ManilaParts; status: TaskStatus };

const manilaFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', hourCycle: 'h23',
});
const manilaParts = (date: Date): ManilaParts => {
  const parts = Object.fromEntries(manilaFormatter.formatToParts(date).map(part => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour) };
};
const dayKey = ({ year, month, day }: ManilaParts) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const utcDay = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day));
const mondayOffset = (date: Date) => (date.getUTCDay() + 6) % 7;
const makeBar = (key: string, label: string, detail: string, title: string): Bar =>
  ({ key, label, detail, title, counts: emptyCounts() });

/* Keep the card's existing createdAt source and status mapping. Calendar boundaries
   are calculated in Manila; UTC is used only for date arithmetic, never grouping. */
function buildBars(
  assignments: Assignment[], completed: CompletedTask[], cancelled: Assignment[],
  period: Period, now: ManilaParts, compactMonth: boolean,
): Bar[] {
  const events: Event[] = [];
  const add = (createdAt: string | undefined, status: TaskStatus) => {
    if (!createdAt) return;
    const date = new Date(createdAt);
    if (!Number.isNaN(date.getTime())) events.push({ date: manilaParts(date), status });
  };
  assignments.forEach(a => add(a.createdAt, a.taskStatus));
  completed.forEach(c => add(c.createdAt, 'Delivered'));
  cancelled.forEach(c => add(c.createdAt, 'Cancelled'));

  let bars: Bar[];
  let bucketKey: (event: Event) => string;
  if (period === 'today') {
    const today = dayKey(now);
    const todayEvents = events.filter(event => dayKey(event.date) === today);
    if (todayEvents.length <= 3) {
      bars = [makeBar(today, 'Today', '', 'Today')];
      bucketKey = event => dayKey(event.date);
    } else {
      const hours = [...new Set(todayEvents.map(event => event.date.hour))].sort((a, b) => a - b);
      bars = hours.map(hour => makeBar(String(hour), String(hour).padStart(2, '0'), 'h', `${String(hour).padStart(2, '0')}:00`));
      bucketKey = event => String(event.date.hour);
    }
    events.splice(0, events.length, ...todayEvents);
  } else if (period === 'week') {
    const first = utcDay(now.year, now.month, now.day);
    first.setUTCDate(first.getUTCDate() - mondayOffset(first));
    bars = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(first);
      date.setUTCDate(first.getUTCDate() + index);
      const parts = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: 0 };
      return makeBar(dayKey(parts), DAY_NAMES[date.getUTCDay()], String(parts.day), `${DAY_NAMES[date.getUTCDay()]} ${MONTH_NAMES[parts.month - 1]} ${parts.day}`);
    });
    bucketKey = event => dayKey(event.date);
  } else if (period === 'month') {
    const daysInMonth = utcDay(now.year, now.month + 1, 0).getUTCDate();
    const firstOffset = mondayOffset(utcDay(now.year, now.month, 1));
    if (compactMonth && daysInMonth >= 30) {
      const weekCount = Math.ceil((firstOffset + daysInMonth) / 7);
      bars = Array.from({ length: weekCount }, (_, index) => {
        const firstDay = Math.max(1, index * 7 + 1 - firstOffset);
        const lastDay = Math.min(daysInMonth, (index + 1) * 7 - firstOffset);
        return makeBar(String(index), `W${index + 1}`, `${firstDay}–${lastDay}`, `${MONTH_NAMES[now.month - 1]} ${firstDay}–${lastDay}`);
      });
      bucketKey = event => String(Math.floor((firstOffset + event.date.day - 1) / 7));
    } else {
      bars = Array.from({ length: daysInMonth }, (_, index) => {
        const date = utcDay(now.year, now.month, index + 1);
        return makeBar(String(index + 1), DAY_NAMES[date.getUTCDay()], String(index + 1), `${MONTH_NAMES[now.month - 1]} ${index + 1}`);
      });
      bucketKey = event => String(event.date.day);
    }
  } else {
    bars = MONTH_NAMES.map((name, index) => makeBar(String(index + 1), name, '', `${name} ${now.year}`));
    bucketKey = event => String(event.date.month);
  }

  const byKey = new Map(bars.map(bar => [bar.key, bar]));
  for (const event of events) {
    if (period === 'week' && !byKey.has(dayKey(event.date))) continue;
    if (period === 'month' && (event.date.year !== now.year || event.date.month !== now.month)) continue;
    if (period === 'year' && event.date.year !== now.year) continue;
    const bar = byKey.get(bucketKey(event));
    if (bar) bar.counts[event.status] += 1;
  }
  return bars;
}

export default function DeliveryOverviewChart({ assignments, completed, cancelled }: Props) {
  const [period, setPeriod] = useState<Period>('today');
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

  const bars = buildBars(assignments, completed, cancelled, period, manilaParts(new Date()), window.innerWidth < 640 && box.w < 480);

  /* Legend totals — the same selected period as the bars */
  const totals = emptyCounts();
  bars.forEach((bar) => SERIES.forEach((s) => { totals[s.status] += bar.counts[s.status]; }));

  const dayTotal = (c: Counts) => SERIES.reduce((s, x) => s + c[x.status], 0);
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
  const TIP_W = 170;
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
          <p className="text-sm text-muted-foreground">Status mix by day · {PERIODS.find(option => option.value === period)?.subtitle}</p>
        </div>
        <select aria-label="Delivery overview time range" value={period}
          onChange={(event) => { setPeriod(event.target.value as Period); setHovered(null); }}
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
