import type { Assignment } from '../data/assignmentTypes';
import { creationTime } from './recordOrdering';

export type AssignmentDatePeriod = 'all' | 'today' | 'week' | 'month' | 'last30' | 'year';

// Match Deliveries: use assignment creation time and the browser's local calendar.
export function matchesAssignmentDate(
  assignment: Pick<Assignment, 'id' | 'createdAt'>,
  period: AssignmentDatePeriod,
  now = new Date(),
): boolean {
  if (period === 'all') return true;
  const created = creationTime(assignment.createdAt, assignment.id);
  if (created === null) return false;
  const date = new Date(created);
  const sameYear = date.getFullYear() === now.getFullYear();
  if (period === 'year') return sameYear;
  if (period === 'month') return sameYear && date.getMonth() === now.getMonth();
  if (period === 'today') return sameYear && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();

  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  if (period === 'week') {
    start.setDate(start.getDate() - (start.getDay() + 6) % 7); // Monday through Sunday.
    end.setTime(start.getTime());
    end.setDate(end.getDate() + 7);
  } else {
    start.setDate(start.getDate() - 29); // Thirty calendar days, including today.
    end.setDate(end.getDate() + 1);
  }
  return created >= start.getTime() && created < end.getTime();
}
