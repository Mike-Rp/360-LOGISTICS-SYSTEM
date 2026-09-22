import { Plus } from 'lucide-react';
import type { Assignment, CompletedTask } from '../../../data/assignmentTypes';

interface Props {
  assignments: Assignment[];
  completed: CompletedTask[];
  adminName?: string;
  isViewOnly: boolean;
  onNavigate: (page: 'Deliveries' | 'Documents') => void;
  onDispatch: () => void;     // opens Monitor's existing Dispatch Truck form
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/* Same rule as the Delayed Deliveries stat card (DashboardStatCards.tsx, itself copied
   from KPICards.tsx) so the two numbers always agree — including its known limitation:
   stored dates are "Sep 23, 2026", so the "/" split never parses and only delay
   reports count. */
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

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/* The live summary line: "Wednesday, Sep 23 · 3 deliveries scheduled today · 1 delayed
   · 2 documents waiting for review" — only the parts that apply. Used by this header
   and by the welcome banner (DashboardHome.tsx). */
export function WelcomeSummary({ assignments, completed, onNavigate }: Pick<Props, 'assignments' | 'completed' | 'onNavigate'>) {
  const now = new Date();
  const dateLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  /* Delivery dates are stored as display text, e.g. "Sep 23, 2026" (isoToDisplay in
     DriversManagement.tsx) — build today's in the same format and compare. */
  const todayStored = `${MONTHS[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
  /* Scheduled today = active + completed deliveries due today (cancelled excluded) */
  const scheduledToday = [...assignments, ...completed].filter((a) => a.deliveryDate === todayStored).length;
  const delayed        = countDelayed(assignments);
  /* Same count as the Docs Pending Review stat card */
  const docsPending    = assignments.reduce(
    (sum, a) => sum + a.documents.filter((d) => d.uploaded && d.docStatus === 'pending').length, 0
  );

  const linkCls = 'font-medium text-foreground underline decoration-dotted underline-offset-4 hover:text-primary transition-colors';
  const parts: React.ReactNode[] = [];
  if (scheduledToday > 0) parts.push(plural(scheduledToday, 'delivery', 'deliveries') + ' scheduled today');
  if (delayed > 0) parts.push(
    /* Deliveries has no "Delayed" filter — this opens its Active tab, which includes them */
    <button key="delayed" onClick={() => onNavigate('Deliveries')} className={linkCls}>{delayed} delayed</button>
  );
  if (docsPending > 0) parts.push(
    <button key="docs" onClick={() => onNavigate('Documents')} className={linkCls}>
      {plural(docsPending, 'document', 'documents')} waiting for review
    </button>
  );

  return (
    <p className="text-sm text-muted-foreground mt-2">
      {dateLabel}
      {parts.length === 0
        ? " · No deliveries scheduled today. Everything's up to date."
        : parts.map((p, i) => <span key={i}> · {p}</span>)}
    </p>
  );
}

export default function DashboardHeader({ assignments, completed, adminName, isViewOnly, onNavigate, onDispatch }: Props) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl sm:text-3xl font-semibold text-foreground leading-tight">
          Welcome back, {adminName ?? 'Admin User'}
        </h1>
        <WelcomeSummary assignments={assignments} completed={completed} onNavigate={onNavigate} />
      </div>
      {!isViewOnly && (
        <button onClick={onDispatch}
          className="w-full sm:w-auto flex-shrink-0 inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors shadow-sm text-sm font-semibold">
          <Plus className="w-4 h-4" /> Dispatch Truck
        </button>
      )}
    </div>
  );
}
