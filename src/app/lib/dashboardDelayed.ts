import type { Assignment } from '../data/assignmentTypes';

/** Keep the Delayed card and its Deliveries destination on the same existing rule. */
export function isDashboardDelayedAssignment(assignment: Pick<Assignment,
  'taskStatus' | 'delayReports' | 'deliveryDate'>, now = new Date()): boolean {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const active = assignment.taskStatus === 'Assigned'
    || assignment.taskStatus === 'Picked Up'
    || assignment.taskStatus === 'In Transit';
  if (!active) return false;
  if (assignment.delayReports && assignment.delayReports.length > 0) return true;
  if (assignment.deliveryDate) {
    const [month, day, year] = assignment.deliveryDate.split('/').map(Number);
    const due = new Date(year, month - 1, day);
    if (due < today) return true;
  }
  return false;
}
