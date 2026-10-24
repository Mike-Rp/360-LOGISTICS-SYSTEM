import { AlertTriangle } from 'lucide-react';
import type { DeliveryTimingStatus } from '../../lib/assignmentTiming';

export default function DeliveryTimingBadge({ timing, readable = false }: { timing: DeliveryTimingStatus | null; readable?: boolean }) {
  if (!timing) return null;
  const colors = timing.kind === 'overdue'
    ? 'border-red-200 bg-red-50 text-red-700'
    : 'border-amber-200 bg-amber-50 text-amber-800';
  return (
    <span aria-label={timing.accessibleLabel} className={`inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 font-semibold leading-snug ${readable ? 'text-sm' : 'text-xs'} ${colors}`}>
      <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 break-words">{timing.label}</span>
    </span>
  );
}
