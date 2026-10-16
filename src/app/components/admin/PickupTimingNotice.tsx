import { AlertTriangle, Clock } from 'lucide-react';
import type { PickupTimingStatus } from '../../lib/assignmentTiming';

export default function PickupTimingNotice({ timing }: { timing: PickupTimingStatus | null }) {
  if (!timing) return null;
  const active = timing.kind === 'pickup_overdue';
  const Icon = active ? AlertTriangle : Clock;
  return (
    <div role="status" aria-label={timing.accessibleLabel}
      className={`flex min-w-0 items-start gap-2 rounded-lg border px-3 py-2.5 ${active
        ? 'border-red-200 bg-red-50 text-red-700'
        : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
      <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 text-xs leading-snug">
        <p className="font-semibold">{timing.label}</p>
        <p className={`mt-0.5 ${active ? 'text-red-700/80' : 'text-amber-700'}`}>
          Scheduled pickup: {timing.scheduledPickup}
        </p>
      </div>
    </div>
  );
}
