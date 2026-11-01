import { useCallback, useEffect, useRef, useState } from 'react';

export type CoverageLookupStatus = 'idle' | 'loading' | 'refreshing' | 'success' | 'error';
interface CoverageSnapshot<T> {
  owner: string;
  status: CoverageLookupStatus;
  data?: T;
}

/** Coverage reads share latest-request and session guards. Cached records are display-only
 * until the latest lookup succeeds; a failed lookup never becomes an empty success. */
export function useCoverageLookup<T>(enabled: boolean, owner: string, lookup: () => Promise<T>, intervalMs: number) {
  const [snapshot, setSnapshot] = useState<CoverageSnapshot<T>>({ owner, status: 'idle' });
  const controls = useRef<{
    owner: string;
    refresh: () => Promise<void>;
    update: (action: () => Promise<void>) => Promise<boolean>;
  } | null>(null);

  useEffect(() => {
    if (!enabled) { setSnapshot({ owner, status: 'idle' }); return; }
    let active = true;
    let sequence = 0;
    let updating = false;
    let verified = false;
    setSnapshot({ owner, status: 'loading' });
    const markUnverified = () => setSnapshot((previous) => ({
      owner, data: previous.owner === owner ? previous.data : undefined,
      status: previous.owner === owner && previous.data !== undefined ? 'refreshing' : 'loading',
    }));
    const refresh = async () => {
      if (!active || updating) return;
      const request = ++sequence;
      verified = false;
      markUnverified();
      try {
        const data = await lookup();
        if (!active || request !== sequence) return;
        verified = true;
        setSnapshot({ owner, status: 'success', data });
      } catch {
        if (!active || request !== sequence) return;
        setSnapshot((previous) => ({ ...previous, owner, status: 'error' }));
      }
    };
    const update = async (action: () => Promise<void>) => {
      if (!active || !verified || updating) throw new Error('coverage_not_verified');
      // A read started before a grant/revoke must not restore the pre-change list.
      updating = true;
      verified = false;
      sequence++;
      markUnverified();
      try { await action(); }
      finally {
        updating = false;
        if (active) await refresh();
      }
      return active;
    };
    controls.current = { owner, refresh, update };
    void refresh();
    const refreshVisible = () => { if (document.visibilityState !== 'hidden') void refresh(); };
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    const interval = window.setInterval(refreshVisible, intervalMs);
    return () => {
      active = false;
      sequence++;
      controls.current = null;
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [enabled, owner, lookup, intervalMs]);

  const refresh = useCallback(async () => {
    if (enabled && controls.current?.owner === owner) await controls.current.refresh();
  }, [enabled, owner]);
  const runUpdate = useCallback(async (action: () => Promise<void>) => {
    if (!enabled || controls.current?.owner !== owner) return false;
    return controls.current.update(action);
  }, [enabled, owner]);
  // Prevent even a one-render flash of the previous account's records/permissions.
  const current = !enabled ? { status: 'idle' as const, data: undefined }
    : snapshot.owner !== owner || snapshot.status === 'idle'
      ? { status: 'loading' as const, data: undefined } : snapshot;
  return { ...current, refresh, runUpdate };
}
