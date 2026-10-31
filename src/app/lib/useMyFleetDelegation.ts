import { useEffect, useState } from 'react';
import { getMyFleetDelegation } from './db';
import { accessActive, type MyFleetDelegation } from './fleetDelegation';

const NONE: MyFleetDelegation = { pinUntil: null, registerUntil: null };

export interface FleetCoverage {
  canResetPin: boolean;
  canRegister: boolean;
  pinUntil: string | null;
  registerUntil: string | null;
}

/* The signed-in CSR's leave coverage (REQ-018). Only guides what the screen offers — every delegated
   database call checks the window again, so a stale value here can never grant anything.
   Reloaded on focus and every minute; the end time is also re-checked every few seconds so the
   buttons disappear when the window closes. */
export function useMyFleetDelegation(enabled: boolean): FleetCoverage {
  const [mine, setMine] = useState<MyFleetDelegation>(NONE);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!enabled) { setMine(NONE); return; }
    let cancelled = false;
    const refresh = () => {
      getMyFleetDelegation()
        .then((next) => { if (!cancelled) { setMine(next); setNow(Date.now()); } })
        .catch(() => { /* keep what we last knew; the server decides on every call */ });
    };
    refresh();
    window.addEventListener('focus', refresh);
    const interval = window.setInterval(refresh, 60_000);
    return () => { cancelled = true; window.removeEventListener('focus', refresh); window.clearInterval(interval); };
  }, [enabled]);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(tick);
  }, []);

  return {
    canResetPin: accessActive(mine.pinUntil, now),
    canRegister: accessActive(mine.registerUntil, now),
    pinUntil: mine.pinUntil,
    registerUntil: mine.registerUntil,
  };
}
