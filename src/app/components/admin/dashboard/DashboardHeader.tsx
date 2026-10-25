import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import type { Assignment } from '../../../data/assignmentTypes';
import { getDashboardSchedule } from '../../../lib/assignmentTiming';
import { adminHref, followAdminLink, pushAdminNavigation } from '../../../lib/adminNavigation';
import WelcomeGreeting from './WelcomeGreeting';

interface Props {
  assignments: Assignment[];
  adminName?: string;
  isViewOnly: boolean;
  onDispatch: () => void;     // opens Monitor's existing Dispatch Truck form
}

/** Only the clock refreshes here; assignment data still arrives through the existing poll. */
export function WelcomeSummary({ assignments }: Pick<Props, 'assignments'>) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const { scheduledToday, nextPickupAt } = getDashboardSchedule(assignments, now);
  const scheduledText = scheduledToday === 0 ? 'No deliveries scheduled today'
    : `${scheduledToday} ${scheduledToday === 1 ? 'delivery' : 'deliveries'} scheduled today`;
  const nextPickup = nextPickupAt === null ? null : new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(nextPickupAt));

  return <p className="mt-2 text-sm text-muted-foreground">
    {scheduledText} <span aria-hidden="true">·</span>{' '}
    {nextPickup ? `Next pickup at ${nextPickup}` :
      <a href={adminHref('Deliveries', undefined, 'active', 'today')}
        onClick={(event) => followAdminLink(event, () => pushAdminNavigation('Deliveries', undefined, 'active', 'today'))}
        className="rounded text-foreground underline decoration-dotted underline-offset-4 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        View today's schedule
      </a>}
  </p>;
}

export default function DashboardHeader({ assignments, adminName, isViewOnly, onDispatch }: Props) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div className="min-w-0">
        <WelcomeGreeting name={adminName} />
        <WelcomeSummary assignments={assignments} />
      </div>
      {!isViewOnly && (
        <a href={adminHref('Monitor')} onClick={(event) => followAdminLink(event, onDispatch)}
          className="w-full sm:w-auto flex-shrink-0 inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors shadow-sm text-sm font-semibold">
          <Plus className="w-4 h-4" /> Dispatch Truck
        </a>
      )}
    </div>
  );
}
