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

/** A card-sized summary of the same verified blocking state used in Shipment Details. */
export function getBlockingIssueSummary(assignment: Pick<Assignment, 'issueReason' | 'taskStatus' | 'openIssue'>): { reason: string | null } | null {
  if (!hasOpenBlockingIssue(assignment)) return null;
  return { reason: assignment.openIssue?.reason?.trim() || assignment.issueReason?.trim() || null };
}

/** cancel_assignment() never touches assignment_issues, so a cancelled delivery that still has an OPEN issue
 * row was force-cancelled because the issue could not be resolved. Returns that issue (the first one), else null. */
export function getUnresolvedCancelledIssue(assignment: Pick<Assignment, 'taskStatus' | 'issues'>): NonNullable<Assignment['issues']>[number] | null {
  if (assignment.taskStatus !== 'Cancelled') return null;
  return assignment.issues?.find((issue) => issue.status === 'open') ?? null;
}

/** Delay & Issues report status for one issue row: resolved → Resolved; still open on a cancelled delivery →
 * Cancelled (nobody can resolve it any more); otherwise Ongoing. No new status — "Cancelled" already exists. */
export function issueReportStatus(issueStatus: 'open' | 'resolved', deliveryCancelled: boolean): 'Resolved' | 'Ongoing' | 'Cancelled' {
  if (issueStatus === 'resolved') return 'Resolved';
  return deliveryCancelled ? 'Cancelled' : 'Ongoing';
}
