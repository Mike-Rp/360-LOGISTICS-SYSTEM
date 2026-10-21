import type { AppNotification } from '../data/assignmentTypes';

const manilaDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
});

function eventTime(notification: AppNotification): number {
  // The display label can omit the year; only use a full persisted timestamp.
  const timestamp = notification.createdAt ?? notification.timestamp;
  if (!/\d{4}/.test(timestamp)) return Number.NEGATIVE_INFINITY;
  const time = Date.parse(timestamp);
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

export function groupNotifications(notifications: AppNotification[], now: Date, limit = 12) {
  const today = manilaDay.format(now);
  const yesterday = manilaDay.format(new Date(now.getTime() - 86_400_000));
  const groups = [
    { label: 'Today', items: [] as AppNotification[] },
    { label: 'Yesterday', items: [] as AppNotification[] },
    { label: 'Earlier', items: [] as AppNotification[] },
  ];

  const newest = notifications
    .map((notification, index) => ({ notification, index, time: eventTime(notification) }))
    .sort((a, b) => b.time - a.time || a.index - b.index)
    .slice(0, limit);

  for (const { notification, time } of newest) {
    const day = Number.isFinite(time) ? manilaDay.format(new Date(time)) : '';
    groups[day === today ? 0 : day === yesterday ? 1 : 2].items.push(notification);
  }

  return groups.filter((group) => group.items.length > 0);
}
