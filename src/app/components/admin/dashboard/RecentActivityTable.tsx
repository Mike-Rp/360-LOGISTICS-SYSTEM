import { Activity } from 'lucide-react';
import ASNWithCopy from '../ASNWithCopy';
import type { AppNotification, CompletedTask, TaskStatus } from '../../../data/assignmentTypes';
import { parseStoredTimestamp, taskStatusConfig } from '../../../data/assignmentTypes';

interface Props {
  notifications: AppNotification[];
  completed: CompletedTask[];
}

/* Same events as the old dashboard's Recent activity (Charts.tsx buildFleetEvents):
   every driver notification, plus a completion for delivered tasks that have no
   notification, newest first — top 6 here (the old card showed 9) so the card stays
   short and sets the row height shared with Delivery Overview. */
const MAX_ROWS = 6;

type Row = {
  id: string;
  assignmentId: string;
  driverName: string;
  truckPlate: string;
  badge: { label: string; cls: string };
  timestamp: string;
};

const EVENT_BADGE = {
  doc:    { label: 'Document', cls: 'bg-amber-100 text-amber-700 border-amber-200' },   // waiting for review
  delay:  { label: 'Delay',    cls: 'bg-red-100 text-red-700 border-red-200' },         // problem
  issue:  { label: 'Issue',    cls: 'bg-red-100 text-red-700 border-red-200' },
  status: { label: 'Status update', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
};

const statusBadge = (status?: string) => {
  const cfg = status ? taskStatusConfig[status as TaskStatus] : undefined;
  return cfg ? { label: cfg.label, cls: cfg.badge } : EVENT_BADGE.status;
};

function buildRows(notifications: AppNotification[], completed: CompletedTask[]): Row[] {
  const notifRows: Row[] = notifications.map((n) => ({
    id: n.id, assignmentId: n.assignmentId, driverName: n.driverName, truckPlate: n.truckPlate, timestamp: n.timestamp,
    badge:
      n.type === 'doc_upload'   ? EVENT_BADGE.doc :
      n.type === 'delay_report' ? EVENT_BADGE.delay :
      n.type === 'issue_report' ? EVENT_BADGE.issue :
                                  statusBadge(n.statusUpdate),
  }));

  const notifAssignmentIds = new Set(notifications.map((n) => n.assignmentId));
  const completionRows: Row[] = completed
    .filter((c) => c.completedAt && !notifAssignmentIds.has(c.id))
    .map((c) => ({
      id: `comp-${c.id}`, assignmentId: c.id, driverName: c.driverName, truckPlate: c.truckPlate,
      timestamp: c.completedAt!, badge: statusBadge('Delivered'),
    }));

  return [...notifRows, ...completionRows]
    .sort((a, b) => (parseStoredTimestamp(b.timestamp)?.getTime() ?? 0) - (parseStoredTimestamp(a.timestamp)?.getTime() ?? 0))
    .slice(0, MAX_ROWS);
}

/* Same relative-time rules as Charts.tsx fmtRelative */
function fmtRelative(ts: string): string {
  try {
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
    if (days  < 30) return `${days}d ago`;
    return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return ts; }
}

export default function RecentActivityTable({ notifications, completed }: Props) {
  const rows = buildRows(notifications, completed);

  return (
    <div className="bg-white rounded-2xl border border-border shadow-sm p-5 sm:p-6 flex flex-col min-w-0">
      <div>
        <h3 className="text-lg font-semibold text-foreground leading-tight">Recent Activity</h3>
        <p className="text-sm text-muted-foreground">Driver fleet events</p>
      </div>

      {rows.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
          <Activity className="w-8 h-8 text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground">No fleet events yet</p>
          <p className="text-xs text-muted-foreground/70 mt-0.5">
            Driver pickups, deliveries, and document uploads will appear here.
          </p>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto -mx-1">
          <table className="w-full min-w-[360px] text-left">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="font-normal px-1 pb-2">Delivery</th>
                <th className="font-normal px-1 pb-2">Driver</th>
                <th className="font-normal px-1 pb-2">Event</th>
                <th className="font-normal px-1 pb-2 text-right">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-1 py-2.5 text-sm text-muted-foreground"><ASNWithCopy value={r.assignmentId} /></td>
                  <td className="px-1 py-2.5 max-w-[180px]">
                    <p className="text-sm text-foreground truncate">{r.driverName || '—'}</p>
                    {r.truckPlate && <p className="text-xs text-muted-foreground truncate">{r.truckPlate}</p>}
                  </td>
                  <td className="px-1 py-2.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-xs font-medium whitespace-nowrap ${r.badge.cls}`}>
                      {r.badge.label}
                    </span>
                  </td>
                  <td className="px-1 py-2.5 text-xs text-muted-foreground text-right whitespace-nowrap">{fmtRelative(r.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(notifications.length + completed.length) > MAX_ROWS && (
        <p className="text-xs text-muted-foreground text-center mt-3 pt-3 border-t border-border/60">
          Showing most recent {MAX_ROWS} events
        </p>
      )}
    </div>
  );
}
