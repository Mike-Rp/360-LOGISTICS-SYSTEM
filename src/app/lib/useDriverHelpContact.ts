import { useEffect, useRef, useState } from 'react';
import { getDriverHelpPhone } from './db';

export type DriverHelpContact =
  | { status: 'loading' | 'unavailable' | 'error'; phone: null }
  | { status: 'available'; phone: string };

const LOADING: DriverHelpContact = { status: 'loading', phone: null };
const REFRESH_MS = 30_000;
const TIMEOUT_MS = 15_000;

/** Only watches while the dialog is open. The backend chooses the contact; no coverage
 * dates or fallback numbers are inferred here. Each open has its own request lifetime. */
export function useDriverHelpContact(open: boolean) {
  const [contact, setContact] = useState<DriverHelpContact>(LOADING);
  const refreshRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setContact(LOADING);
    if (!open) return;
    let active = true;
    let requestId = 0;
    let pending = false;
    let timeout: number | undefined;

    const refresh = () => {
      // Focus and visibility often fire together; share their in-flight lookup.
      if (!active || pending) return;
      pending = true;
      const id = ++requestId;
      setContact(LOADING);
      timeout = window.setTimeout(() => {
        if (!active || id !== requestId) return;
        requestId++; // A late response from this timed-out request is obsolete.
        pending = false;
        timeout = undefined;
        setContact({ status: 'error', phone: null });
      }, TIMEOUT_MS);

      void getDriverHelpPhone().then((phone) => {
        if (!active || id !== requestId) return;
        setContact(phone ? { status: 'available', phone } : { status: 'unavailable', phone: null });
      }, () => {
        if (active && id === requestId) setContact({ status: 'error', phone: null });
      }).finally(() => {
        if (!active || id !== requestId) return;
        window.clearTimeout(timeout);
        timeout = undefined;
        pending = false;
      });
    };
    const refreshVisible = () => {
      if (document.visibilityState !== 'hidden') refresh();
    };
    refreshRef.current = refresh;
    refresh();
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    const interval = window.setInterval(refreshVisible, REFRESH_MS);
    return () => {
      active = false;
      requestId++;
      refreshRef.current = null;
      window.clearTimeout(timeout);
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [open]);

  return { contact, retry: () => refreshRef.current?.() };
}
