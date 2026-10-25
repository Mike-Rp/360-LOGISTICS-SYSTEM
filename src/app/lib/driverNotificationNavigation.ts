export type DriverNotificationDestination = 'task' | 'completed' | 'cancelled' | 'unavailable';

/** Resolve against rows already returned for this signed-in driver, never against message text. */
export function driverNotificationDestination(
  type: string,
  assignmentId: string | null | undefined,
  activeAssignmentId: string | null | undefined,
  completedIds: readonly string[],
  cancelledIds: readonly string[],
): DriverNotificationDestination {
  if (!assignmentId) return 'unavailable';
  if (type === 'driver_cancelled') return cancelledIds.includes(assignmentId) ? 'cancelled' : 'unavailable';
  if (activeAssignmentId === assignmentId) return 'task';
  if (completedIds.includes(assignmentId)) return 'completed';
  if (cancelledIds.includes(assignmentId)) return 'cancelled';
  return 'unavailable';
}

/** Derived review cards may only focus a reviewed document on the matching current job. */
export function canOpenDocumentReview(
  currentAssignmentId: string | null | undefined,
  requestedAssignmentId: string,
  docType: string,
  documents: readonly { type: string; uploaded: boolean; docStatus: string }[],
): boolean {
  return !!currentAssignmentId && currentAssignmentId === requestedAssignmentId
    && documents.some((doc) => doc.type === docType && doc.uploaded
      && (doc.docStatus === 'approved' || doc.docStatus === 'rejected'));
}
