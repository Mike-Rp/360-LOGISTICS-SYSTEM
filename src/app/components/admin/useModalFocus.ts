import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Only the topmost custom modal handles keys. Radix portals keep their own focus scope.
const modalStack: { modalRef: RefObject<HTMLElement | null> }[] = [];

/* Focus handling for a centred modal (Settings, Help & Guide):
   - on open, remembers what had focus and moves focus into the modal
   - Tab / Shift+Tab wrap around inside the modal
   - on close, focus goes back to whatever opened it

   Focus moves after one tick: the bell popover (Radix) hands focus back to the bell
   in a timeout when it closes, and without waiting that would pull focus out of the
   modal. By then document.activeElement is also the real opener to return to. */
export function useModalFocus(open: boolean, modalRef: RefObject<HTMLElement | null>, onEscape?: () => void) {
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;
  useEffect(() => {
    if (!open) return;
    const token = { modalRef };
    modalStack.push(token);
    let opener: HTMLElement | null = null;
    const activeModal = () => modalStack.reduce((top, next) => {
      if (!top?.modalRef.current) return next;
      if (!next.modalRef.current) return top;
      const position = top.modalRef.current.compareDocumentPosition?.(next.modalRef.current);
      // React commits child effects before parent effects. DOM order, rather than
      // effect order, identifies the overlay rendered last (including portals).
      return position === undefined || (position & 4) ? next : top;
    }, undefined as typeof token | undefined) === token;
    const radixLayerOpen = () => !!document.querySelector('[data-slot="popover-content"][data-state="open"], [role="alertdialog"]');

    const focusables = () =>
      Array.from(modalRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
        .filter((el) => el.offsetParent !== null && !el.closest('[inert], [aria-hidden="true"]'));

    const timer = setTimeout(() => {
      opener = document.activeElement as HTMLElement | null;
      if (!activeModal() || modalRef.current?.contains(opener)) return;
      (focusables()[0] ?? modalRef.current)?.focus();
    }, 0);

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !activeModal() || !modalRef.current || radixLayerOpen()) return;
      if (e.key === 'Escape' && escapeRef.current) {
        e.preventDefault();
        e.stopPropagation();
        escapeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const els = focusables();
      if (els.length === 0) { e.preventDefault(); modalRef.current.focus(); return; }
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
      const wasTop = activeModal();
      const index = modalStack.indexOf(token);
      if (index >= 0) modalStack.splice(index, 1);
      if (wasTop && opener && opener !== document.body && opener.isConnected) opener.focus();
    };
  }, [open, modalRef]);
}
