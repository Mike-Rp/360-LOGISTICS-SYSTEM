import type { AppNotification } from '../data/assignmentTypes';

export const MILESTONE_NOTIFICATIONS = {
  arrive_pickup: { activityKey: 'at_pickup', message: 'arrived at pickup' },
  finish_loading: { activityKey: 'loading_completed', message: 'Loading completed' },
  depart: { activityKey: 'in_transit', message: 'started the trip' },
  arrive_destination: { activityKey: 'arrived', message: 'arrived at destination' },
  finish_unloading: { activityKey: 'unloading_completed', message: 'Unloading completed' },
  delivered: { activityKey: 'delivered', message: 'Delivery completed' },
} as const;

export type ActivityKey = typeof MILESTONE_NOTIFICATIONS[keyof typeof MILESTONE_NOTIFICATIONS]['activityKey'] | 'cancelled';

export function isActivityKey(value: string | null | undefined): value is ActivityKey {
  return value === 'cancelled' || Object.values(MILESTONE_NOTIFICATIONS).some(event => event.activityKey === value);
}

export function notificationDestination(notification: AppNotification) {
  const activityKey = isActivityKey(notification.statusUpdate) ? notification.statusUpdate : undefined;
  return {
    page: 'Monitor' as const,
    target: {
      assignmentId: notification.assignmentId,
      docType: notification.type === 'doc_upload' ? notification.docType : undefined,
      review: notification.type === 'doc_upload',
      activityKey,
    },
    actionLabel: notification.type === 'doc_upload' ? 'Review' : activityKey ? 'View Activity' : 'View shipment',
  };
}

/** Existing historical records stay in the bell; only current action items become popups. */
export function isToastEligible(notification: AppNotification): boolean {
  if (!notification.id || !notification.assignmentId) return false;
  if (notification.type === 'status_update') return isActivityKey(notification.statusUpdate);
  if (notification.type === 'issue_report' || notification.type === 'delay_report') return true;
  return notification.type === 'doc_upload' &&
    (/Documents ready for review/.test(notification.message) || /Corrected .+ uploaded/.test(notification.message));
}

export const MAX_VISIBLE_NOTIFICATION_TOASTS = 2;
export const NOTIFICATION_TOAST_DURATION = 6000;

export interface ActionFeedbackToast {
  id: string;
  type: 'feedback';
  message: string;
  tone: 'success' | 'error' | 'warning' | 'info';
  presentation?: 'solid';
}

export type TemporaryToast = AppNotification | ActionFeedbackToast;

export function collectNewOperationalToasts(
  notifications: AppNotification[], knownIds: ReadonlySet<string>, enabled: boolean,
): { knownIds: Set<string>; toasts: AppNotification[] } {
  const nextKnown = new Set(knownIds);
  const toasts: AppNotification[] = [];
  for (const notification of notifications) {
    if (nextKnown.has(notification.id)) continue;
    nextKnown.add(notification.id);
    if (enabled && !notification.read && isToastEligible(notification)) toasts.push(notification);
  }
  return { knownIds: nextKnown, toasts };
}

export interface NotificationToastQueue<T extends { id: string } = TemporaryToast> {
  visible: T[];
  pending: T[];
}

export function enqueueNotificationToasts<T extends { id: string }>(queue: NotificationToastQueue<T>, incoming: T[]): NotificationToastQueue<T> {
  const known = new Set([...queue.visible, ...queue.pending].map(item => item.id));
  const distinct = incoming.filter(item => {
    if (known.has(item.id)) return false;
    known.add(item.id);
    return true;
  });
  const slots = Math.max(0, MAX_VISIBLE_NOTIFICATION_TOASTS - queue.visible.length);
  return {
    visible: [...queue.visible, ...distinct.slice(0, slots)],
    pending: [...queue.pending, ...distinct.slice(slots)],
  };
}

export function dismissNotificationToast<T extends { id: string }>(queue: NotificationToastQueue<T>, id: string): NotificationToastQueue<T> {
  const visible = queue.visible.filter(notification => notification.id !== id);
  const pending = queue.pending.filter(notification => notification.id !== id);
  if (visible.length === queue.visible.length) return { visible, pending };
  const slots = MAX_VISIBLE_NOTIFICATION_TOASTS - visible.length;
  return { visible: [...visible, ...pending.slice(0, slots)], pending: pending.slice(slots) };
}

export function filterNotificationToasts<T extends { id: string }>(queue: NotificationToastQueue<T>, keep: (item: T) => boolean): NotificationToastQueue<T> {
  return enqueueNotificationToasts({ visible: queue.visible.filter(keep), pending: [] }, queue.pending.filter(keep));
}
