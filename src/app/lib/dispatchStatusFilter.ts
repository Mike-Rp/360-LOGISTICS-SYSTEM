import type { Assignment } from '../data/assignmentTypes';
import { OPERATIONAL_STEPS, getAdminOperationalProgress } from './assignmentOperational';
import { ASSIGNMENT_DISPLAY_STATUSES, getAssignmentDisplayStatus, type AssignmentDisplayStatus } from './assignmentWorkflow';

export type DispatchStatus = AssignmentDisplayStatus | (typeof OPERATIONAL_STEPS)[number];

// Match the status rendered on Dispatch cards. The operational badge takes
// precedence over the legacy task status when it describes a more exact stage.
export function getDispatchCardStatus(assignment: Assignment): DispatchStatus {
  return (getAdminOperationalProgress(assignment).badge ?? getAssignmentDisplayStatus(assignment)) as DispatchStatus;
}

const dispatchStatusOrder: readonly DispatchStatus[] = [
  'Assigned', 'At Pickup', 'Picked Up', 'Loading', 'In Transit', 'Arrived',
  'Unloading', 'Delivered', 'Awaiting Documents', 'Under Review',
  'Needs Correction', 'Failed / Issue',
];

export const DISPATCH_STATUS_OPTIONS = dispatchStatusOrder.filter((status) =>
  (OPERATIONAL_STEPS as readonly string[]).includes(status)
  || (ASSIGNMENT_DISPLAY_STATUSES as readonly string[]).includes(status));

export function matchesDispatchStatus(assignment: Assignment, status: DispatchStatus | ''): boolean {
  return !status || getDispatchCardStatus(assignment) === status;
}
