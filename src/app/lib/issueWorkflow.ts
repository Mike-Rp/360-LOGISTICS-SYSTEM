import type { Assignment } from '../data/assignmentTypes';

/** The existing Report a Problem choices are all safety/fulfilment blockers.
 * Custom "Other" text is treated conservatively as blocking too. Delay reports
 * have their own separate, non-blocking workflow. */
export const BLOCKING_ISSUE_REASONS = [
  'Cargo damaged in transit',
  'Wrong delivery address',
  'Customer refused delivery',
  'Vehicle breakdown',
  'Cargo lost or missing',
  'Accident / road incident',
] as const;

/** REQ-008: openIssue (from assignment_issues, server-derived) is the source of truth
 * for anything reported through report_assignment_issue(). The issueReason heuristic
 * only covers reports made before that table existed and has no row there. */
export function hasOpenBlockingIssue(assignment: Pick<Assignment, 'issueReason' | 'taskStatus' | 'openIssue'>): boolean {
  if (assignment.openIssue) return true;
  return assignment.taskStatus !== 'Failed / Issue' && assignment.taskStatus !== 'Cancelled'
    && !!assignment.issueReason?.trim();
}
