import { useState } from 'react';
import {
  Activity, FileText, Truck, AlertTriangle, AlertCircle, CheckCircle, Clock,
} from 'lucide-react';
import type { Assignment, CompletedTask, AppNotification } from '../../data/assignmentTypes';
import { parseStoredTimestamp } from '../../data/assignmentTypes';
import { getAssignmentRoute } from '../../data/assignmentRoute';

/* Placeholder Mon–Sun breakdown — not yet computed from real assignment data. */
const weeklyDeliveryData = [
  { day: 'Mon', delivered: 45, inTransit: 18, pending: 8,  delayed: 4,  cancelled: 3 },
  { day: 'Tue', delivered: 52, inTransit: 14, pending: 11, delayed: 6,  cancelled: 2 },
  { day: 'Wed', delivered: 48, inTransit: 21, pending: 7,  delayed: 9,  cancelled: 5 },
  { day: 'Thu', delivered: 58, inTransit: 16, pending: 13, delayed: 3,  cancelled: 1 },
  { day: 'Fri', delivered: 38, inTransit: 22, pending: 9,  delayed: 7,  cancelled: 4 },
  { day: 'Sat', delivered: 25, inTransit: 9,  pending: 5,  delayed: 5,  cancelled: 2 },
  { day: 'Sun', delivered: 15, inTransit: 5,  pending: 3,  delayed: 2,  cancelled: 1 },
];

interface Props {
  assignments?: Assignment[];
  completed?:  CompletedTask[];
  cancelled?:  Assignment[];
  notifications?: AppNotification[];
}

type DataKey = 'delivered' | 'inTransit' | 'pending' | 'delayed' | 'cancelled';

const LINE_SERIES: { key: DataKey; name: string; color: string; dash?: string }[] = [
  { key: 'delivered',  name: 'Delivered',  color: '#10b981'              },
  { key: 'inTransit',  name: 'In Transit', color: '#3b82f6'              },
  { key: 'pending',    name: 'Pending',    color: '#eab308'              },
  { key: 'delayed',    name: 'Delayed',    color: '#ef4444', dash: '5 3' },
  { key: 'cancelled',  name: 'Cancelled',  color: '#6b7280', dash: '3 3' },
];

/* ── SVG line chart ─────────────────────────────────── */
function SvgLineChart() {
  const [hovered, setHovered] = useState<number | null>(null);
  const data = weeklyDeliveryData;
  const VW = 540, VH = 210;
  const P  = { t: 8, r: 14, b: 28, l: 36 };
  const pw = VW - P.l - P.r;
  const ph = VH - P.t - P.b;
  const n  = data.length;

  const allVals = data.flatMap((d) => LINE_SERIES.map((s) => d[s.key]));
  const maxV    = Math.max(...allVals, 1);
  const step    = maxV <= 20 ? 5 : maxV <= 60 ? 10 : 20;
  const gridMax = Math.ceil(maxV / step) * step;
  const ticks   = Array.from({ length: Math.floor(gridMax / step) + 1 }, (_, i) => i * step);

  const X  = (i: number) => P.l + (i / (n - 1)) * pw;
  const Y  = (v: number) => P.t + ph * (1 - v / gridMax);
  const px = (i: number) => X(i).toFixed(1);
  const py = (v: number) => Y(v).toFixed(1);
  const buildD = (key: DataKey) =>
    data.map((d, i) => `${i === 0 ? 'M' : 'L'}${px(i)},${py(d[key])}`).join(' ');
  const hd = hovered !== null ? data[hovered] : null;

  return (
    <div className="relative" style={{ height: VH }}>
      <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" height="100%" overflow="visible">
        {ticks.map((v) => (
          <g key={`g${v}`}>
            <line x1={P.l} y1={Y(v)} x2={VW - P.r} y2={Y(v)} stroke="#f0f0f0" strokeWidth={1} />
            <text x={P.l - 5} y={Y(v) + 3.5} textAnchor="end" fontSize={9} fill="#9ca3af">{v}</text>
          </g>
        ))}
        {data.map((d, i) => (
          <text key={`x${i}`} x={X(i)} y={VH - 5} textAnchor="middle" fontSize={9.5} fill="#9ca3af">
            {d.day}
          </text>
        ))}
        {LINE_SERIES.map((s) => (
          <path key={s.key} d={buildD(s.key)} fill="none" stroke={s.color}
            strokeWidth={s.key === 'cancelled' ? 2 : 2.5}
            strokeLinecap="round" strokeLinejoin="round" strokeDasharray={s.dash} />
        ))}
        {data.map((_, i) => (
          <rect key={`h${i}`} x={X(i) - pw / (n * 2)} y={P.t} width={pw / n} height={ph}
            fill="transparent" style={{ cursor: 'crosshair' }}
            onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)} />
        ))}
        {hovered !== null && (
          <>
            <line x1={X(hovered)} y1={P.t} x2={X(hovered)} y2={P.t + ph}
              stroke="#e5e7eb" strokeWidth={1.5} strokeDasharray="3 2" />
            {LINE_SERIES.map((s) => (
              <circle key={`dot-${s.key}`} cx={X(hovered)} cy={Y(data[hovered][s.key])}
                r={4} fill={s.color} stroke="white" strokeWidth={2} />
            ))}
          </>
        )}
      </svg>
      {hd !== null && hovered !== null && (
        <div className="absolute top-0 bg-white border border-border rounded-xl shadow-lg px-3 py-2.5 text-xs pointer-events-none z-10 min-w-[130px]"
          style={{
            left: `${((X(hovered) - P.l) / pw) * 100}%`,
            transform: hovered >= Math.floor(n / 2) ? 'translateX(-110%)' : 'translateX(10px)',
          }}>
          <p className="font-semibold text-foreground mb-1.5">{hd.day}</p>
          {LINE_SERIES.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5 mb-0.5">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
              <span className="text-muted-foreground">{s.name}:</span>
              <span className="font-semibold text-foreground ml-auto pl-2">{hd[s.key]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Driver fleet event helpers ─────────────────────── */
type FleetEvent = {
  id: string;
  Icon: React.ElementType;
  iconCls: string;
  driverName: string;
  truckPlate: string;
  description: string;
  timestamp: string;
};

function notifToEvent(n: AppNotification): FleetEvent {
  const base = { id: n.id, driverName: n.driverName, truckPlate: n.truckPlate, timestamp: n.timestamp };
  switch (n.type) {
    case 'doc_upload':
      return { ...base, Icon: FileText, iconCls: 'bg-blue-100 text-blue-600',
        description: n.docType ? `Submitted ${n.docType} for review` : 'Submitted a document for review' };
    case 'status_update':
      return { ...base, Icon: Truck, iconCls: 'bg-teal-100 text-teal-600',
        description: n.message.replace(/^\[[^\]]+\]\s*/, '') || 'Status updated' };
    case 'delay_report':
      return { ...base, Icon: AlertTriangle, iconCls: 'bg-amber-100 text-amber-600',
        description: 'Reported a delivery delay' };
    case 'issue_report':
      return { ...base, Icon: AlertCircle, iconCls: 'bg-red-100 text-red-600',
        description: 'Reported an issue' };
  }
}

function buildFleetEvents(
  notifications: AppNotification[],
  completed: CompletedTask[],
): FleetEvent[] {
  const notifEvents = notifications.map(notifToEvent);

  /* Add completion events for tasks that have no corresponding status_update notification */
  const notifAssignmentIds = new Set(notifications.map((n) => n.assignmentId));
  const completionEvents: FleetEvent[] = completed
    .filter((c) => c.completedAt && !notifAssignmentIds.has(c.id))
    .map((c) => ({
      id: `comp-${c.id}`,
      Icon: CheckCircle,
      iconCls: 'bg-green-100 text-green-600',
      driverName: c.driverName,
      truckPlate: c.truckPlate,
      description: `Delivery completed — ${getAssignmentRoute(c)}`,
      timestamp: c.completedAt!,
    }));

  return [...notifEvents, ...completionEvents]
    .sort((a, b) => (parseStoredTimestamp(b.timestamp)?.getTime() ?? 0) - (parseStoredTimestamp(a.timestamp)?.getTime() ?? 0))
    .slice(0, 9);
}

function fmtRelative(ts: string): string {
  try {
    /* Yearless stamps used to resolve to 2001, which put every event ~25 years in
       the past — so the branches below always fell through to the absolute date
       and printed "Sep 19, 2001" instead of a relative time. */
    const parsed = parseStoredTimestamp(ts);
    if (!parsed) return ts;
    const diff  = Date.now() - parsed.getTime();
    if (diff < 0) return 'just now';
    const mins  = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days  = Math.floor(diff / 86400000);
    if (mins  <  1) return 'just now';
    if (mins  < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    /* Cap at 30d — beyond that show absolute date */
    if (days  < 30) return `${days}d ago`;
    return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return ts; }
}

function RecentActivity({
  notifications, completed,
}: { notifications: AppNotification[]; completed: CompletedTask[] }) {
  const events = buildFleetEvents(notifications, completed);

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm p-5 flex flex-col">
      <div className="mb-3">
        <h3 className="text-lg font-semibold text-foreground">Recent activity</h3>
        <p className="text-sm text-muted-foreground">Driver fleet events</p>
      </div>

      {events.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-10 text-center">
          <Activity className="w-8 h-8 text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground">No fleet events yet</p>
          <p className="text-xs text-muted-foreground/70 mt-0.5">
            Driver pickups, deliveries, and document uploads will appear here.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border/60 flex-1">
          {events.map((ev) => {
            const { Icon } = ev;
            return (
              <div key={ev.id} className="flex items-center gap-2.5 py-2.5 px-1 -mx-1 hover:bg-accent/30 rounded-lg transition-colors">
                <div className={`p-1.5 rounded-md flex-shrink-0 ${ev.iconCls}`}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate leading-tight">{ev.driverName}</p>
                  <p className="text-xs text-muted-foreground truncate leading-tight mt-0.5">{ev.description}</p>
                </div>
                <div className="flex items-center gap-0.5 text-[12px] text-muted-foreground flex-shrink-0 whitespace-nowrap">
                  <Clock className="w-3 h-3" />
                  {fmtRelative(ev.timestamp)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(notifications.length + completed.length) > 9 && (
        <p className="text-xs text-muted-foreground text-center mt-3 pt-3 border-t border-border/60">
          Showing most recent 9 events
        </p>
      )}
    </div>
  );
}

/* ── Main export ────────────────────────────────────── */
export default function Charts({ completed = [], notifications = [] }: Props) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

      {/* Weekly Deliveries */}
      <div className="bg-white rounded-xl border border-border shadow-sm p-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-foreground">Weekly Deliveries</h3>
          <p className="text-sm text-muted-foreground">Day-by-day performance overview</p>
        </div>
        <SvgLineChart />
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 mt-4">
          {LINE_SERIES.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5">
              <svg width="16" height="8" className="flex-shrink-0">
                <line x1="0" y1="4" x2="16" y2="4" stroke={s.color} strokeWidth="2.5" strokeDasharray={s.dash} />
              </svg>
              <span className="text-xs text-muted-foreground">{s.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent activity — driver fleet events */}
      <RecentActivity notifications={notifications} completed={completed} />

    </div>
  );
}
