import { useEffect } from 'react';

let activeLocks = 0;
let originalOverflow = '';

/** Keep the page still while one or more staff dialogs are open. */
export function useModalBodyLock(open: boolean) {
  useEffect(() => {
    if (!open) return;
    if (activeLocks++ === 0) {
      originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    return () => {
      if (--activeLocks === 0) document.body.style.overflow = originalOverflow;
    };
  }, [open]);
}
