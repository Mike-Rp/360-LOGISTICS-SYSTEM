import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, FileText, Info, Truck, X } from 'lucide-react';
import type { AppNotification } from '../../data/assignmentTypes';
import { adminHref, followAdminLink } from '../../lib/adminNavigation';
import { playNotificationSound } from '../../lib/notificationSound';
import {
  collectNewOperationalToasts, dismissNotificationToast, enqueueNotificationToasts, filterNotificationToasts,
  notificationDestination,
  NOTIFICATION_TOAST_DURATION, type ActionFeedbackToast, type NotificationToastQueue, type TemporaryToast,
} from '../../lib/notificationEvents';

interface Props {
  notifications: AppNotification[];
  ready: boolean;
  enabled: boolean;
  soundEnabled: boolean;
  onOpen: (notification: AppNotification) => void;
  feedback: ActionFeedbackToast[];
  modalOpen: boolean;
}

const EMPTY_QUEUE: NotificationToastQueue = { visible: [], pending: [] };

function NotificationToast({ item, onOpen, onDismiss, suspended }: {
  item: TemporaryToast;
  onOpen: (notification: AppNotification) => void;
  onDismiss: (id: string) => void;
  suspended: boolean;
}) {
  const [closing, setClosing] = useState(false);
  const remaining = useRef(item.type === 'feedback'
    ? item.tone === 'success' ? 4500 : item.tone === 'info' ? 5000 : 9000
    : NOTIFICATION_TOAST_DURATION);
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
      exitTimer.current = window.setTimeout(() => dismiss.current(item.id), reducedMotion ? 0 : 180);
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
  }, [item.id]);

  const pause = () => {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
    remaining.current = Math.max(0, remaining.current - (performance.now() - started.current));
  };
  useEffect(() => {
    if (suspended) pause();
    else schedule.current();
  }, [suspended]);

  const feedback = item.type === 'feedback';
  const solidSuccess = feedback && item.presentation === 'solid' && item.tone === 'success';
  const destination = feedback ? null : notificationDestination(item);
  const identifier = feedback ? '' : item.truckPlate || item.assignmentId;
  const prefix = feedback ? '' : `[${item.truckPlate}] `;
  const message = !feedback && item.message.startsWith(prefix)
    ? item.message.slice(prefix.length) : item.message;
  const [title, ...detailParts] = message.split(' · ');
  const detail = detailParts.join(' · ');
  const attention = !feedback && (item.statusUpdate === 'cancelled' || item.type === 'issue_report');
  const Icon = feedback
    ? item.tone === 'success' ? CheckCircle2 : item.tone === 'warning' ? AlertTriangle : item.tone === 'info' ? Info : AlertCircle
    : item.type === 'doc_upload' ? FileText
      : attention ? AlertCircle : item.type === 'delay_report' ? AlertTriangle : Truck;
  const iconStyle = solidSuccess ? 'text-white' : feedback
    ? item.tone === 'success' ? 'bg-green-50 text-green-700' : item.tone === 'warning' ? 'bg-amber-50 text-amber-700' : item.tone === 'info' ? 'bg-sky-50 text-sky-700' : 'bg-red-50 text-red-600'
    : attention ? 'bg-red-50 text-red-600' : item.type === 'doc_upload' ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-sky-700';

  return (
    <article onMouseEnter={pause} onMouseLeave={() => schedule.current()}
      onFocusCapture={pause} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) schedule.current(); }}
      className={`pointer-events-auto min-w-0 rounded-[13px] border p-3.5 transition-all duration-200 motion-reduce:transition-none motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-2 motion-safe:duration-200 ${solidSuccess ? 'border-green-600 bg-green-600 shadow-xl' : 'border-border bg-white shadow-lg'} ${closing ? 'translate-x-2 opacity-0' : 'translate-x-0 opacity-100'}`}
      role={feedback && item.tone === 'error' ? 'alert' : 'status'}
      aria-label={feedback ? undefined : `New notification for ${identifier}`}>
      <div className="flex min-w-0 items-start gap-2.5">
        <span className={`mt-0.5 flex shrink-0 items-center justify-center rounded-lg ${solidSuccess ? 'h-5 w-5' : 'h-8 w-8'} ${iconStyle}`}>
          <Icon aria-hidden="true" className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          {identifier && <p className="break-words text-sm font-semibold leading-5 text-foreground">{identifier}</p>}
          <p className={`${feedback ? '' : 'mt-0.5 '}break-words text-sm ${feedback ? 'font-medium' : ''} leading-5 ${solidSuccess ? 'text-white' : 'text-foreground/90'}`}>{title}</p>
          {!feedback && <p className="mt-0.5 break-words text-xs leading-4 text-muted-foreground">{detail ? `${detail} · ` : ''}Just now</p>}
        </div>
        <button type="button" onClick={() => beginClose.current()} aria-label={feedback ? 'Dismiss message' : `Dismiss notification for ${identifier}`}
          className={`-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-1 ${solidSuccess ? 'text-white/90 hover:bg-white/15 hover:text-white focus-visible:outline-white' : 'text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-primary'}`}>
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
      {destination && <div className="mt-1 flex justify-end">
        <a href={adminHref(destination.page, destination.target)}
          onClick={event => followAdminLink(event, () => { onDismiss(item.id); onOpen(item as AppNotification); })}
          className="inline-flex min-h-9 items-center rounded-lg px-2 text-sm font-semibold text-primary hover:bg-green-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary">
          {destination.actionLabel} →
        </a>
      </div>}
    </article>
  );
}

export default function NotificationToastContainer({ notifications, ready, enabled, soundEnabled, onOpen, feedback, modalOpen }: Props) {
  const initialized = useRef(false);
  const knownIds = useRef(new Set<string>());
  const knownFeedbackIds = useRef(new Set<string>());
  const [queue, setQueue] = useState<NotificationToastQueue<TemporaryToast>>(EMPTY_QUEUE);

  useEffect(() => {
    if (!enabled) setQueue(current => filterNotificationToasts(current, item => item.type === 'feedback'));
  }, [enabled]);

  useEffect(() => {
    if (!ready) {
      initialized.current = false;
      knownIds.current.clear();
      knownFeedbackIds.current.clear();
      setQueue(EMPTY_QUEUE);
      return;
    }
    if (!initialized.current) {
      knownIds.current = new Set(notifications.map(notification => notification.id));
      initialized.current = true;
      return;
    }
    const { knownIds: nextKnown, toasts: actionable } = collectNewOperationalToasts(
      notifications, knownIds.current, enabled,
    );
    knownIds.current = nextKnown;
    if (soundEnabled && actionable.length) {
      void playNotificationSound();
    }
    if (actionable.length) setQueue(current => enqueueNotificationToasts(current, actionable.reverse()));
  }, [notifications, ready, enabled, soundEnabled]);

  useEffect(() => {
    if (!ready) return;
    const incoming = feedback.filter(item => !knownFeedbackIds.current.has(item.id));
    incoming.forEach(item => knownFeedbackIds.current.add(item.id));
    if (incoming.length) setQueue(current => enqueueNotificationToasts(current, incoming));
  }, [feedback, ready]);

  const dismiss = useCallback((id: string) => {
    setQueue(current => dismissNotificationToast(current, id));
  }, []);

  if (!queue.visible.length) return null;
  return (
    <div aria-live="polite" aria-relevant="additions" aria-hidden={modalOpen ? true : undefined}
      className={`pointer-events-none fixed inset-x-3 bottom-[calc(1rem_+_env(safe-area-inset-bottom))] z-40 flex max-h-[calc(100dvh_-_6rem)] flex-col-reverse gap-2.5 overflow-y-auto sm:inset-x-auto sm:right-6 sm:bottom-[calc(1.5rem_+_env(safe-area-inset-bottom))] sm:w-[min(360px,calc(100vw_-_3rem))] ${modalOpen ? 'invisible' : ''}`}>
      {queue.visible.map(item => <NotificationToast key={item.id} item={item}
        onOpen={onOpen} onDismiss={dismiss} suspended={modalOpen} />)}
    </div>
  );
}
