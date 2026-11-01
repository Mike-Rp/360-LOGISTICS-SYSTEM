import { useEffect, useState } from 'react';
import { getMyFleetDelegation } from './db';
import { accessActive, type MyFleetDelegation } from './fleetDelegation';
import { useCoverageLookup, type CoverageLookupStatus } from './useCoverageLookup';

const NONE: MyFleetDelegation = { pinUntil: null, registerUntil: null };

export interface FleetCoverage {
  canResetPin: boolean;
  canRegister: boolean;
  pinUntil: string | null;
  registerUntil: string | null;
  status: CoverageLookupStatus;
  retry: () => void;
}

/* The signed-in CSR's leave coverage (REQ-018). Only guides what the screen offers — every delegated
   database call checks the window again, so a stale value here can never grant anything.
   Reloaded on focus and every minute; the end time is also re-checked every few seconds so the
   buttons disappear when the window closes. */
export function useMyFleetDelegation(enabled: boolean, owner: string): FleetCoverage {
  const { data, status, refresh } = useCoverageLookup(enabled, owner, getMyFleetDelegation, 60_000);
  const mine = data ?? NONE;
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (status === 'success') setNow(Date.now()); }, [data, status]);

  useEffect(() => {
    if (!enabled) return;
    const tick = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(tick);
  }, [enabled]);

  return {
    canResetPin: status === 'success' && accessActive(mine.pinUntil, now),
    canRegister: status === 'success' && accessActive(mine.registerUntil, now),
    pinUntil: mine.pinUntil,
    registerUntil: mine.registerUntil,
    status,
    retry: refresh,
  };
}
