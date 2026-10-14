import { DOCUMENT_TYPES, taskStatusConfig } from '../data/assignmentTypes';
import type { AppNotification, Assignment, TaskStatus } from '../data/assignmentTypes';
import { getPhysicalDeliveryTimestamp } from './assignmentTiming';

export type AssignmentDisplayStatus = TaskStatus | 'Awaiting Documents' | 'Under Review' | 'Needs Correction' | 'Completed';

export const assignmentDisplayStatusConfig = {
  ...taskStatusConfig,
  'Awaiting Documents': { label: 'Awaiting Documents', badge: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-400' },
  'Under Review': { label: 'Under Review', badge: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-400' },
  'Needs Correction': { label: 'Needs Correction', badge: taskStatusConfig['Failed / Issue'].badge, dot: taskStatusConfig['Failed / Issue'].dot },
  'Completed': { label: 'Completed', badge: taskStatusConfig.Delivered.badge, dot: taskStatusConfig.Delivered.dot },
} satisfies Record<AssignmentDisplayStatus, { label: string; badge: string; dot: string }>;

export function getAssignmentDocumentProgress(assignment: Assignment) {
  const slots = DOCUMENT_TYPES.map(type => {
    const uploads = assignment.documents.filter(doc => doc.type === type && doc.uploaded);
    if (!uploads.length) return 'missing';
    if (uploads.some(doc => doc.docStatus === 'rejected')) return 'rejected';
    if (uploads.some(doc => doc.docStatus === 'pending')) return 'pending';
    return uploads.every(doc => doc.docStatus === 'approved') ? 'approved' : 'pending';
  });
  const required = DOCUMENT_TYPES.length;
  const uploaded = slots.filter(status => status !== 'missing').length;
  const approved = slots.filter(status => status === 'approved').length;
  const pending = slots.filter(status => status === 'pending').length;
  const rejected = slots.filter(status => status === 'rejected').length;
  const applicable = assignment.taskStatus === 'Delivered' && required > 0;
  return {
    required, uploaded, approved, pending, rejected, missing: required - uploaded,
    allApproved: required > 0 && approved === required,
    applicable,
    // Previously uploaded files remain useful even before delivery or after cancellation.
    canOpen: applicable || assignment.documents.some(doc => doc.uploaded),
  };
}

export function getAssignmentDocumentSummary(assignment: Assignment) {
  const docs = getAssignmentDocumentProgress(assignment);
  const tone = docs.rejected ? 'rejected' : docs.allApproved ? 'approved'
    : docs.missing ? 'missing' : docs.pending ? 'pending' : 'missing';
  const label = docs.rejected ? `${docs.rejected} rejected` : docs.allApproved ? 'All approved'
    : docs.missing ? [
      ...(docs.approved ? [`${docs.approved} approved`] : []),
      `${docs.missing} awaiting upload`,
    ].join(' · ')
    : docs.pending ? `${docs.pending} pending review` : 'No required documents';
  const total = assignment.documents.filter(doc => doc.uploaded).length;
  const breakdown = [
    `${total} doc${total !== 1 ? 's' : ''}`,
    ...(docs.approved ? [`${docs.approved} approved`] : []),
    ...(docs.pending ? [`${docs.pending} pending review`] : []),
    ...(docs.rejected ? [`${docs.rejected} rejected`] : []),
    ...(docs.missing ? [`${docs.missing} awaiting upload`] : []),
  ].join(' · ');
  return { label, tone, breakdown } as const;
}

export function getAssignmentDisplayStatus(assignment: Assignment): AssignmentDisplayStatus {
  if (assignment.taskStatus !== 'Delivered') return assignment.taskStatus;
  const docs = getAssignmentDocumentProgress(assignment);
  if (!docs.applicable) return 'Delivered';
  if (docs.allApproved) return 'Completed';
  if (docs.rejected) return 'Needs Correction';
  if (docs.missing) return 'Awaiting Documents';
  if (docs.pending) return 'Under Review';
  return 'Delivered';
}

/** Factual age of missing documents after physical delivery; no upload SLA is implied.
 * A Delivered status photo is preferred. Older deliveries can use the matching
 * driver status event's database timestamp, which preserves year and timezone. */
export function getDocumentAgingState(assignment: Assignment, now = new Date(), notifications: readonly AppNotification[] = []) {
  if (getAssignmentDisplayStatus(assignment) !== 'Awaiting Documents') return null;
  const photoTime = getPhysicalDeliveryTimestamp(assignment);
  const eventTimes = notifications
    .filter(event => event.assignmentId === assignment.id && event.type === 'status_update' && event.statusUpdate === 'Delivered')
    .map(event => event.createdAt)
    .filter((value): value is string => !!value && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value))
    .map(value => Date.parse(value))
    .filter(Number.isFinite);
  const deliveredAt = photoTime ?? (eventTimes.length ? Math.max(...eventTimes) : null);
  if (deliveredAt === null || deliveredAt > now.getTime()) return { days: null, deliveredOn: null };
  const manilaOffset = 8 * 60 * 60 * 1000;
  const days = Math.floor((now.getTime() + manilaOffset) / 86_400_000)
    - Math.floor((deliveredAt + manilaOffset) / 86_400_000);
  const deliveredOn = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric',
  }).format(new Date(deliveredAt));
  return { days, deliveredOn };
}
