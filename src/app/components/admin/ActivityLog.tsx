import { useMemo, useState } from 'react';
import {
  LogIn, ClipboardList, CheckCircle, XCircle,
  FileCheck, FileX, Search, X, Activity, Clock, UserX,
} from 'lucide-react';
import type { AdminActivityEntry, AdminActivityType } from '../../data/assignmentTypes';

type FilterType = 'all' | AdminActivityType;

interface Props {
  activityLog: AdminActivityEntry[];
}

function formatTs(ts: string): string {
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleString('en-PH', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return ts; }
}

const CONFIG: Record<AdminActivityType, {
  label: string; icon: React.ElementType; iconColor: string; bgColor: string;
}> = {
  login:          { label: 'Admin Login',       icon: LogIn,        iconColor: 'text-blue-600',   bgColor: 'bg-blue-100'   },
  task_assigned:  { label: 'Task Assigned',     icon: ClipboardList, iconColor: 'text-purple-600', bgColor: 'bg-purple-100' },
  task_completed: { label: 'Task Completed',    icon: CheckCircle,  iconColor: 'text-green-600',  bgColor: 'bg-green-100'  },
  task_cancelled: { label: 'Task Cancelled',    icon: XCircle,      iconColor: 'text-gray-600',   bgColor: 'bg-gray-100'   },
  doc_approved:   { label: 'Document Approved', icon: FileCheck,    iconColor: 'text-teal-600',   bgColor: 'bg-teal-100'   },
  doc_rejected:   { label: 'Document Rejected', icon: FileX,        iconColor: 'text-red-600',    bgColor: 'bg-red-100'    },
  driver_deleted: { label: 'Driver Removed',    icon: UserX,        iconColor: 'text-orange-600', bgColor: 'bg-orange-100' },
};

function getDescription(e: AdminActivityEntry): string {
  switch (e.type) {
    case 'login':
      return `${e.adminEmail ?? 'Admin'} signed in${e.adminRole ? ` as ${e.adminRole}` : ''}`;
    case 'task_assigned':
      return `Assigned to ${e.driverName ?? '—'} · Route: ${e.destination ?? '—'} · Client: ${e.company ?? '—'}`;
    case 'task_completed':
      return `Completed by ${e.driverName ?? '—'} · Route: ${e.destination ?? '—'} · Client: ${e.company ?? '—'}`;
    case 'task_cancelled':
      return `Cancelled — ${e.driverName ?? '—'} · Route: ${e.destination ?? '—'} · Client: ${e.company ?? '—'}`;
    case 'doc_approved':
      return `Approved "${e.docType ?? 'Document'}" for ${e.driverName ?? '—'}`;
    case 'doc_rejected':
      return `Rejected "${e.docType ?? 'Document'}" for ${e.driverName ?? '—'}${e.rejectReason ? ` — ${e.rejectReason}` : ''}`;
    case 'driver_deleted':
      return `Driver account "${e.driverName ?? '—'}" was removed from the system`;
  }
}

const FILTERS: { key: FilterType; label: string }[] = [
  { key: 'all',            label: 'All'           },
  { key: 'login',          label: 'Logins'        },
  { key: 'task_assigned',  label: 'Assignments'   },
  { key: 'task_completed', label: 'Completions'   },
  { key: 'task_cancelled', label: 'Cancellations' },
  { key: 'doc_approved',   label: 'Approved'      },
  { key: 'doc_rejected',   label: 'Rejected'      },
  { key: 'driver_deleted', label: 'Deletions'     },
];

function StatCard({ icon: Icon, color, label, value }: {
  icon: React.ElementType; color: string; label: string; value: number;
}) {
  return (
    <div className="bg-white rounded-xl border border-border shadow-sm p-4 flex items-center gap-4">
      <div className={`${color} p-2.5 rounded-lg flex-shrink-0`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-2xl font-bold text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

export default function ActivityLog({ activityLog }: Props) {
  const [filter, setFilter] = useState<FilterType>('all');
  const [search, setSearch]  = useState('');

  const filtered = useMemo(() => {
    let result = activityLog;
    if (filter !== 'all') {
      result = result.filter((e) => e.type === filter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((e) =>
        getDescription(e).toLowerCase().includes(q) ||
        CONFIG[e.type].label.toLowerCase().includes(q) ||
        (e.adminEmail   ?? '').toLowerCase().includes(q) ||
        (e.driverName   ?? '').toLowerCase().includes(q) ||
        (e.truckPlate   ?? '').toLowerCase().includes(q) ||
        (e.assignmentId ?? '').toLowerCase().includes(q) ||
        (e.docType      ?? '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [activityLog, filter, search]);

  const loginCount     = activityLog.filter((e) => e.type === 'login').length;
  const assignCount    = activityLog.filter((e) => e.type === 'task_assigned').length;
  const approvedCount  = activityLog.filter((e) => e.type === 'doc_approved').length;
  const rejectedCount  = activityLog.filter((e) => e.type === 'doc_rejected' || e.type === 'task_cancelled').length;

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Activity Log</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Admin actions — logins, task assignments, document reviews, cancellations
          </p>
        </div>
        <span className="text-xs text-muted-foreground bg-white border border-border rounded-lg px-3 py-1.5">
          {activityLog.length} total events
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={LogIn}        color="bg-blue-100 text-blue-600"     label="Logins"              value={loginCount}    />
        <StatCard icon={ClipboardList} color="bg-purple-100 text-purple-600" label="Tasks Assigned"     value={assignCount}   />
        <StatCard icon={FileCheck}    color="bg-teal-100 text-teal-600"     label="Docs Approved"       value={approvedCount} />
        <StatCard icon={XCircle}      color="bg-red-100 text-red-600"       label="Rejected / Cancelled" value={rejectedCount} />
      </div>

      {/* Log card */}
      <div className="bg-white rounded-xl border border-border shadow-sm">

        {/* Toolbar */}
        <div className="p-4 border-b border-border flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by driver, document, email, plate…"
              className="w-full pl-9 pr-8 py-2 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex gap-1.5 flex-wrap flex-shrink-0">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
                  filter === f.key
                    ? 'bg-primary text-white border-primary'
                    : 'bg-white text-muted-foreground border-border hover:border-primary/40 hover:text-primary'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Empty state */}
        {filtered.length === 0 && (
          <div className="py-16 text-center">
            <Activity className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground">
              {activityLog.length === 0 ? 'No admin activity recorded yet' : 'No matching activities'}
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              {activityLog.length === 0
                ? 'Actions like logins, assignments, and document reviews will appear here.'
                : 'Try a different filter or clear your search.'}
            </p>
          </div>
        )}

        {/* Entries */}
        {filtered.length > 0 && (
          <div className="divide-y divide-border">
            {filtered.map((entry) => {
              const cfg  = CONFIG[entry.type];
              const Icon = cfg.icon;
              return (
                <div key={entry.id} className="p-4 hover:bg-accent/30 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className={`${cfg.bgColor} ${cfg.iconColor} p-2 rounded-lg flex-shrink-0 mt-0.5`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground">{cfg.label}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                            {getDescription(entry)}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0 mt-0.5 whitespace-nowrap">
                          <Clock className="w-3 h-3" />
                          {formatTs(entry.timestamp)}
                        </div>
                      </div>
                      {/* Tags */}
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        {entry.truckPlate && (
                          <span className="px-1.5 py-0.5 bg-teal-50 text-teal-700 border border-teal-200 rounded font-mono text-[10px]">
                            {entry.truckPlate}
                          </span>
                        )}
                        {entry.assignmentId && (
                          <span className="px-1.5 py-0.5 bg-gray-50 text-gray-500 border border-gray-200 rounded font-mono text-[10px]">
                            {entry.assignmentId}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border bg-muted/20 text-xs text-muted-foreground">
          Showing {filtered.length} of {activityLog.length} events
        </div>
      </div>
    </div>
  );
}
