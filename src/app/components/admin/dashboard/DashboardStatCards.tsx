import { Package, CheckCircle, AlertTriangle, FileText, ArrowRight } from 'lucide-react';
import type { Assignment, CompletedTask } from '../../../data/assignmentTypes';
import { parseStoredTimestamp } from '../../../data/assignmentTypes';

interface Props {
  assignments: Assignment[];
  completed: CompletedTask[];
  onNavigate: (page: 'Documents') => void;
}

/* Same rule as KPICards.tsx countDelayed() — copied unchanged so the number matches
   the old dashboard. (Known issue there too: stored dates are "Sep 23, 2026", so the
   "/" split never parses and only delay reports count.) */
function countDelayed(assignments: Assignment[]): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return assignments.filter((a) => {
    const active =
      a.taskStatus === 'Assigned' ||
      a.taskStatus === 'Picked Up' ||
      a.taskStatus === 'In Transit';
    if (!active) return false;
    if (a.delayReports && a.delayReports.length > 0) return true;
    if (a.deliveryDate) {
      const [m, d, y] = a.deliveryDate.split('/').map(Number);
      const due = new Date(y, m - 1, d);
      if (due < today) return true;
    }
    return false;
  }).length;
}

/* Completed deliveries whose completedAt falls on today's local date */
function countCompletedToday(completed: CompletedTask[]): number {
  const now = new Date();
  return completed.filter((c) => {
    const d = c.completedAt ? parseStoredTimestamp(c.completedAt) : null;
    return !!d && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  }).length;
}

export default function DashboardStatCards({ assignments, completed, onNavigate }: Props) {
  const inTransit = assignments.filter((a) => a.taskStatus === 'In Transit').length;
  const pickedUp  = assignments.filter((a) => a.taskStatus === 'Picked Up').length;
  const assigned  = assignments.filter((a) => a.taskStatus === 'Assigned').length;
  const activeDetail = [
    inTransit && `${inTransit} in transit`,
    pickedUp  && `${pickedUp} picked up`,
    assigned  && `${assigned} assigned`,
  ].filter(Boolean).join(' · ');

  const delayed     = countDelayed(assignments);
  const docsPending = assignments.reduce(
    (sum, a) => sum + a.documents.filter((d) => d.uploaded && d.docStatus === 'pending').length, 0
  );

  const cards = [
    {
      label: 'Active Deliveries', value: assignments.length, icon: Package,
      detail: assignments.length > 0 ? activeDetail || 'In progress' : 'No active deliveries',
    },
    {
      label: 'Completed Deliveries', value: completed.length, icon: CheckCircle,
      detail: completed.length > 0 ? `All time · ${countCompletedToday(completed)} today` : 'No completions yet',
    },
    {
      label: 'Delayed Deliveries', value: delayed, icon: AlertTriangle, alert: delayed > 0,
      detail: delayed > 0 ? 'Past due date, still active' : 'No delays right now',
    },
    {
      label: 'Docs Pending Review', value: docsPending, icon: FileText, alert: docsPending > 0,
      detail: docsPending > 0 ? 'Awaiting approval' : 'All documents reviewed',
      link: { label: 'Review', onClick: () => onNavigate('Documents') },
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {cards.map(({ label, value, icon: Icon, detail, alert, link }) => (
        <div key={label} className="bg-white rounded-2xl border border-border shadow-sm px-5 py-4">
          <div className="flex items-center gap-2">
            <Icon className={`w-4 h-4 flex-shrink-0 ${alert ? 'text-amber-600' : 'text-foreground'}`} />
            <p className="text-sm font-medium text-foreground">{label}</p>
          </div>
          {/* items-start: the number stays on the same line in every card even when the
              supporting text on the right wraps to two lines */}
          <div className="flex items-start justify-between gap-3 mt-3">
            <p className={`text-3xl font-semibold leading-none ${alert ? 'text-amber-600' : 'text-foreground'}`}>{value}</p>
            <div className="text-right min-w-0">
              <p className="text-xs text-muted-foreground leading-snug">{detail}</p>
              {link && (
                <button onClick={link.onClick}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 mt-0.5">
                  {link.label} <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
