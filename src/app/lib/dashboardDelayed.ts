import type { Assignment } from '../data/assignmentTypes';
import { getDispatchTimingNotices } from './assignmentTiming';

/** A historical delay report remains visible, but only an unresolved deadline counts as delayed. */
export function isDashboardDelayedAssignment(assignment: Assignment, now = new Date()): boolean {
  const active = assignment.taskStatus === 'Assigned'
    || assignment.taskStatus === 'Picked Up'
    || assignment.taskStatus === 'In Transit';
  if (!active) return false;
  const { delivery, pickup } = getDispatchTimingNotices(assignment, now);
  return delivery?.kind === 'overdue' || pickup?.kind === 'pickup_overdue';
}
