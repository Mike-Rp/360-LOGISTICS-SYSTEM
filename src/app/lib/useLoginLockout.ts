import { useEffect, useRef, useState } from 'react';

export interface ConfirmedLockout { retryAt: number | null }

/** The existing login contract reports remaining seconds for a five-minute lock.
 * Reject missing, non-finite, expired and out-of-contract values; never substitute a duration. */
export function loginRetrySeconds(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 300 ? value : undefined;
}

export function confirmedLockout(seconds: unknown, requestedAt: number): ConfirmedLockout {
  const valid = loginRetrySeconds(seconds);
  // Count from the request, conservatively excluding time spent waiting for its response.
  return { retryAt: valid === undefined ? null : requestedAt + valid * 1000 };
}

export function lockoutFeedback(record: ConfirmedLockout | undefined, now: number) {
  if (!record || (record.retryAt !== null && record.retryAt <= now)) return null;
  return { blocked: record.retryAt !== null, minutes: record.retryAt === null ? null : Math.ceil((record.retryAt - now) / 60000) };
}

/** In-memory presentation only. Credentials and lockouts are never stored across refreshes. */
export function useLoginLockout(account: string) {
  const records = useRef(new Map<string, ConfirmedLockout>());
  const [, update] = useState(0);
  const key = account.trim().toLowerCase();
  const record = records.current.get(key);
  const now = Date.now();
  const feedback = lockoutFeedback(record, now);

  useEffect(() => {
    if (!record || record.retryAt === null || record.retryAt <= Date.now()) return;
    const refresh = () => update((value) => value + 1);
    const remaining = record.retryAt - Date.now();
    const timer = window.setTimeout(refresh, Math.max(1, remaining % 60000 || 60000));
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [key, record, feedback?.minutes]);

  return {
    feedback,
    isBlocked: () => !!lockoutFeedback(records.current.get(key), Date.now())?.blocked,
    confirm: (submittedAccount: string, seconds: unknown, requestedAt: number) => {
      records.current.set(submittedAccount.trim().toLowerCase(), confirmedLockout(seconds, requestedAt));
      update((value) => value + 1);
    },
    clear: (submittedAccount: string) => {
      records.current.delete(submittedAccount.trim().toLowerCase());
      update((value) => value + 1);
    },
  };
}
