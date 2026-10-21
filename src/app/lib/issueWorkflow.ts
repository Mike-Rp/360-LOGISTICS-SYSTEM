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

/** Existing issue_reason is the only persisted open marker for new reports.
 * Legacy Failed / Issue rows have no trustworthy pre-issue stage to resume. */
export function hasOpenBlockingIssue(assignment: Pick<Assignment, 'issueReason' | 'taskStatus'>): boolean {
  return assignment.taskStatus !== 'Failed / Issue' && assignment.taskStatus !== 'Cancelled'
    && !!assignment.issueReason?.trim();
}
