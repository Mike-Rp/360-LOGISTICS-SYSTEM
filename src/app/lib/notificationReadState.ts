import type { AppNotification } from '../data/assignmentTypes';

// Keep only IDs, scoped to the signed-in account. Also retain them in memory if storage fails.
const rememberedIds = new Map<string, Set<string>>();

function updateReadIds(account: string, update: (ids: Set<string>) => Set<string>) {
  const key = `360_notification_read_ids:${encodeURIComponent(account.trim().toLowerCase())}`;
  const ids = new Set(rememberedIds.get(key));
  let storageError = false;
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (Array.isArray(stored)) {
      stored.forEach((id) => { if (typeof id === 'string') ids.add(id); });
    }
  } catch {
    storageError = true;
  }
  const next = update(ids);
  rememberedIds.set(key, next);
  try {
    if (next.size) localStorage.setItem(key, JSON.stringify([...next]));
    else localStorage.removeItem(key);
  } catch {
    storageError = true;
  }
  return { ids: next, storageError };
}

export function rememberNotificationReads(account: string, notificationIds: string[]) {
  return updateReadIds(account, (ids) => {
    notificationIds.forEach((id) => ids.add(id));
    return ids;
  });
}

export function restoreNotificationReads(account: string, notifications: AppNotification[]) {
  const currentIds = new Set(notifications.map((notification) => notification.id));
  // This is called only after a successful full load, never on logout or a failed fetch.
  const { ids, storageError } = updateReadIds(account,
    (remembered) => new Set([...remembered].filter((id) => currentIds.has(id))));
  const pendingIds = notifications.filter((notification) => !notification.read && ids.has(notification.id))
    .map((notification) => notification.id);
  return {
    notifications: notifications.map((notification) => ids.has(notification.id) && !notification.read
      ? { ...notification, read: true } : notification),
    pendingIds,
    storageError,
  };
}
