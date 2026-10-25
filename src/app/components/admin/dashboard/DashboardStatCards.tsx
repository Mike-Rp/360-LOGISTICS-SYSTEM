import { Package, CheckCircle, AlertTriangle, FileText, ArrowRight } from 'lucide-react';
import type { Assignment, CompletedTask } from '../../../data/assignmentTypes';
import { parseStoredTimestamp } from '../../../data/assignmentTypes';
import { adminHref, followAdminLink, pushAdminNavigation, pendingDocumentReviewTarget } from '../../../lib/adminNavigation';
import { isDashboardDelayedAssignment } from '../../../lib/dashboardDelayed';
import CountUp from './CountUp';

interface Props {
  assignments: Assignment[];
  completed: CompletedTask[];
}

/* Completed deliveries whose completedAt falls on today's local date */
function countCompletedToday(completed: CompletedTask[]): number {
  const now = new Date();
  return completed.filter((c) => {
    const d = c.completedAt ? parseStoredTimestamp(c.completedAt) : null;
    return !!d && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  }).length;
}

export default function DashboardStatCards({ assignments, completed }: Props) {
  const inTransit = assignments.filter((a) => a.taskStatus === 'In Transit').length;
  const pickedUp  = assignments.filter((a) => a.taskStatus === 'Picked Up').length;
  const assigned  = assignments.filter((a) => a.taskStatus === 'Assigned').length;
  const activeDetail = [
    inTransit && `${inTransit} in transit`,
    pickedUp  && `${pickedUp} picked up`,
    assigned  && `${assigned} assigned`,
  ].filter(Boolean).join(' · ');

  const delayed     = assignments.filter((assignment) => isDashboardDelayedAssignment(assignment)).length;
  const docsPending = assignments.reduce(
    (sum, a) => sum + a.documents.filter((d) => d.uploaded && d.docStatus === 'pending').length, 0
  );
  const reviewTarget = pendingDocumentReviewTarget(assignments);

  const cards = [
    {
      label: 'Active Deliveries', value: assignments.length, icon: Package,
      detail: assignments.length > 0 ? activeDetail || 'In progress' : 'No active deliveries',
      link: { label: 'View active', href: adminHref('Deliveries', undefined, 'active'), onClick: () => pushAdminNavigation('Deliveries', undefined, 'active') },
    },
    {
      label: 'Completed Deliveries', value: completed.length, icon: CheckCircle,
      detail: completed.length > 0 ? `All time · ${countCompletedToday(completed)} today` : 'No completions yet',
      link: { label: 'View completed', href: adminHref('Deliveries', undefined, 'completed'), onClick: () => pushAdminNavigation('Deliveries', undefined, 'completed') },
    },
    {
      label: 'Delayed Deliveries', value: delayed, icon: AlertTriangle, alert: delayed > 0,
      detail: delayed > 0 ? 'Past due date, still active' : 'No delays right now',
      link: { label: 'View delayed', href: adminHref('Deliveries', undefined, 'delayed'), onClick: () => pushAdminNavigation('Deliveries', undefined, 'delayed') },
    },
    {
      label: 'Docs Pending Review', value: docsPending, icon: FileText, alert: docsPending > 0,
      detail: docsPending > 0 ? 'Awaiting approval' : 'All documents reviewed',
      link: { label: 'Review documents', href: adminHref('Monitor', reviewTarget), onClick: () => pushAdminNavigation('Monitor', reviewTarget) },
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
            <p className={`text-3xl font-semibold leading-none ${alert ? 'text-amber-600' : 'text-foreground'}`}><CountUp value={value} /></p>
            <div className="text-right min-w-0">
              <p className="text-sm text-muted-foreground leading-tight">{detail}</p>
              <a href={link.href} onClick={(event) => followAdminLink(event, link.onClick)}
                className="mt-0.5 inline-flex min-h-7 items-center gap-1 rounded-md px-2 py-1 text-sm font-medium leading-tight text-primary transition-colors hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                {link.label} <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              </a>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
