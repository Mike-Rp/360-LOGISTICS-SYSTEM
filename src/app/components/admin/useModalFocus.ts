import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/* Focus handling for a centred modal (Settings, Help & Guide):
   - on open, remembers what had focus and moves focus into the modal
   - Tab / Shift+Tab wrap around inside the modal
   - on close, focus goes back to whatever opened it

   Focus moves after one tick: the bell popover (Radix) hands focus back to the bell
   in a timeout when it closes, and without waiting that would pull focus out of the
   modal. By then document.activeElement is also the real opener to return to. */
export function useModalFocus(open: boolean, modalRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    let opener: HTMLElement | null = null;

    const focusables = () =>
      Array.from(modalRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
        .filter((el) => el.offsetParent !== null);

    const timer = setTimeout(() => {
      opener = document.activeElement as HTMLElement | null;
      if (modalRef.current?.contains(opener)) return;
      focusables()[0]?.focus();
    }, 0);

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !modalRef.current) return;
      const els = focusables();
      if (els.length === 0) { e.preventDefault(); return; }
      const first = els[0];
      const last  = els[els.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = !!active && modalRef.current.contains(active);
      if (e.shiftKey && (active === first || !inside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !inside)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      if (opener && opener !== document.body && opener.isConnected) opener.focus();
    };
  }, [open, modalRef]);
}
