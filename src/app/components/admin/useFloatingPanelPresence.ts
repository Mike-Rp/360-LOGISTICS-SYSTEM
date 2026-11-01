import { useEffect, useState } from 'react';

/** Keep the mobile panel mounted for its exit transition; never persist its contents. */
export function useFloatingPanelPresence(open: boolean) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const frame = window.requestAnimationFrame(() => setVisible(true));
      return () => window.cancelAnimationFrame(frame);
    }
    setVisible(false);
    const immediate = window.matchMedia('(prefers-reduced-motion: reduce), (min-width: 640px)').matches;
    const timer = window.setTimeout(() => setMounted(false), immediate ? 0 : 200);
    return () => window.clearTimeout(timer);
  }, [open]);

  return { mounted, visible: open && visible };
}
