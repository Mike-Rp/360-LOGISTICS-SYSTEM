import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, FileText, Truck, X } from 'lucide-react';
import type { AppNotification } from '../../data/assignmentTypes';
import { adminHref, followAdminLink } from '../../lib/adminNavigation';
import { playNotificationSound } from '../../lib/notificationSound';
import {
  dismissNotificationToast, enqueueNotificationToasts, isToastEligible,
  notificationDestination, NOTIFICATION_TOAST_DURATION, type NotificationToastQueue,
} from '../../lib/notificationEvents';

interface Props {
  notifications: AppNotification[];
  ready: boolean;
  enabled: boolean;
  soundEnabled: boolean;
  onOpen: (notification: AppNotification) => void;
}

const EMPTY_QUEUE: NotificationToastQueue = { visible: [], pending: [] };

function NotificationToast({ notification, onOpen, onDismiss }: {
  notification: AppNotification;
  onOpen: (notification: AppNotification) => void;
  onDismiss: (id: string) => void;
}) {
  const [closing, setClosing] = useState(false);
  const remaining = useRef(NOTIFICATION_TOAST_DURATION);
  const started = useRef(0);
  const timer = useRef<number | null>(null);
  const exitTimer = useRef<number | null>(null);
  const schedule = useRef<() => void>(() => {});
  const beginClose = useRef<() => void>(() => {});
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    const close = () => {
      if (exitTimer.current !== null) return;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      setClosing(true);
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      exitTimer.current = window.setTimeout(() => dismiss.current(notification.id), reducedMotion ? 0 : 180);
    };
    beginClose.current = close;
    schedule.current = () => {
      if (timer.current !== null || exitTimer.current !== null) return;
      started.current = performance.now();
      timer.current = window.setTimeout(close, Math.max(0, remaining.current));
    };
    schedule.current();
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
    };
  }, [notification.id]);

  const pause = () => {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
    remaining.current = Math.max(0, remaining.current - (performance.now() - started.current));
  };

  const destination = notificationDestination(notification);
  const identifier = notification.truckPlate || notification.assignmentId;
  const prefix = `[${notification.truckPlate}] `;
  const message = notification.message.startsWith(prefix)
    ? notification.message.slice(prefix.length) : notification.message;
  const [title, ...detailParts] = message.split(' · ');
  const detail = detailParts.join(' · ');
  const attention = notification.statusUpdate === 'cancelled' || notification.type === 'issue_report';
  const Icon = notification.type === 'doc_upload' ? FileText
    : attention ? AlertCircle : notification.type === 'delay_report' ? AlertTriangle : Truck;

  return (
    <article onMouseEnter={pause} onMouseLeave={() => schedule.current()}
      className={`pointer-events-auto min-w-0 rounded-[13px] border border-border bg-white p-3.5 shadow-lg transition-all duration-200 motion-reduce:transition-none motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-2 motion-safe:duration-200 ${closing ? 'translate-x-2 opacity-0' : 'translate-x-0 opacity-100'}`}
      aria-label={`New notification for ${identifier}`}>
      <div className="flex min-w-0 items-start gap-2.5">
        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${attention ? 'bg-red-50 text-red-600' : notification.type === 'doc_upload' ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-sky-700'}`}>
          <Icon aria-hidden="true" className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold leading-5 text-foreground">{identifier}</p>
          <p className="mt-0.5 break-words text-sm leading-5 text-foreground/90">{title}</p>
          <p className="mt-0.5 break-words text-xs leading-4 text-muted-foreground">{detail ? `${detail} · ` : ''}Just now</p>
        </div>
        <button type="button" onClick={() => beginClose.current()} aria-label={`Dismiss notification for ${identifier}`}
          className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary">
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-1 flex justify-end">
        <a href={adminHref(destination.page, destination.target)}
          onClick={event => followAdminLink(event, () => { onDismiss(notification.id); onOpen(notification); })}
          className="inline-flex min-h-9 items-center rounded-lg px-2 text-sm font-semibold text-primary hover:bg-green-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary">
          {destination.actionLabel} →
        </a>
      </div>
    </article>
  );
}

export default function NotificationToastContainer({ notifications, ready, enabled, soundEnabled, onOpen }: Props) {
  const initialized = useRef(false);
  const knownIds = useRef(new Set<string>());
  const [queue, setQueue] = useState<NotificationToastQueue>(EMPTY_QUEUE);

  useEffect(() => {
    if (!enabled) setQueue(EMPTY_QUEUE);
  }, [enabled]);

  useEffect(() => {
    if (!ready) {
      initialized.current = false;
      knownIds.current.clear();
      setQueue(EMPTY_QUEUE);
      return;
    }
    if (!initialized.current) {
      knownIds.current = new Set(notifications.map(notification => notification.id));
      initialized.current = true;
      return;
    }
    const incoming = notifications.filter(notification => !knownIds.current.has(notification.id));
    incoming.forEach(notification => knownIds.current.add(notification.id));
    if (soundEnabled && incoming.some(notification => !notification.read && isToastEligible(notification))) {
      void playNotificationSound();
    }
    const actionable = enabled ? incoming.filter(notification => !notification.read && isToastEligible(notification)) : [];
    if (actionable.length) setQueue(current => enqueueNotificationToasts(current, actionable.reverse()));
  }, [notifications, ready, enabled, soundEnabled]);

  const dismiss = useCallback((id: string) => {
    setQueue(current => dismissNotificationToast(current, id));
  }, []);

  if (!queue.visible.length) return null;
  return (
    <div aria-live="polite" aria-relevant="additions" className="pointer-events-none fixed inset-x-3 top-[calc(4.75rem+env(safe-area-inset-top))] z-[80] flex flex-col gap-2.5 md:inset-x-auto md:bottom-[calc(1.5rem+env(safe-area-inset-bottom))] md:right-6 md:top-auto md:w-[min(360px,calc(100vw-3rem))] md:flex-col-reverse">
      {queue.visible.map(notification => <NotificationToast key={notification.id} notification={notification}
        onOpen={onOpen} onDismiss={dismiss} />)}
    </div>
  );
}
