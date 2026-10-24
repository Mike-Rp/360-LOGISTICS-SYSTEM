import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  LogOut, Package, CheckCircle2, XCircle, Camera, WifiOff,
  Clock, Truck, AlertTriangle, FileText, Building2,
  ChevronRight, ChevronLeft, Lock, ArrowDown, ArrowUp,
  RefreshCw, RotateCcw, X, Phone, Bell, Menu, History, Languages, MapPin, Images, CalendarDays,
} from 'lucide-react';
import type { Assignment, CompletedTask, TaskStatus, StatusPhoto, DocStatus } from '../../data/assignmentTypes';
import { statusColors } from '../../data/statusColors';
import { OPERATIONAL_STEPS } from '../../lib/assignmentOperational';
import { loadDriverData, loadDriverCompletedDelivery, driverUpdate, advanceDriverStage, reportAssignmentIssue, uploadImage } from '../../lib/db';
import { getDeliveryTimingStatus, getPickupTimingStatus, type DeliveryTimingStatus } from '../../lib/assignmentTiming';
import { assignmentDisplayStatusConfig, getAssignmentDisplayStatus, getAssignmentDocumentProgress, getDocumentAgingState } from '../../lib/assignmentWorkflow';
import { DriverLanguageProvider, useDriverI18n, type DriverLanguage } from './driverI18n';
import { destinationAreaEnabled, getAssignmentRoute, getDeliveryLocation } from '../../data/assignmentRoute';
import { checkPhoto, loadVehicleDetector, type PhotoCheckFailure } from '../../lib/photoQuality';
import { MILESTONE_NOTIFICATIONS } from '../../lib/notificationEvents';
import { BLOCKING_ISSUE_REASONS, hasOpenBlockingIssue } from '../../lib/issueWorkflow';
import { newNotificationIds, notificationSoundEnabled, playNotificationSound, setNotificationSoundEnabled } from '../../lib/notificationSound';
import { observeDriverCompletion, type DriverCompletionSnapshot } from './driverCompletion';
import { completedPhotoGroup, getNextRequiredAction, getNextRequiredPhoto, getRequiredPhotoProgress } from './driverPhotoGuidance';
import { galleryPhotoMetadata, gpsAccuracyLevel, savedPhotoMetadata } from './driverPhotoEvidence';
import UploadedFilePreviewModal from '../admin/UploadedFilePreviewModal';

/* ── Types ── */
interface CompletedHistoryItem {
  id: string; destination: string; destinationArea?: string | null; company: string;
  deliveryDate: string; completedAt: string; truckPlate: string; taskStatus: string;
}
interface DriverData {
  driver: { id: string; name: string; phone: string; status: string; currentLocation: string };
  assignment: Assignment | null;
  completedHistory?: CompletedHistoryItem[];
}
interface NormDoc {
  type: string; uploaded: boolean; docStatus: DocStatus; rejectReason?: string; fileUrl?: string;
}
interface DriverNotif {
  id: string; type: 'rejection' | 'approval'; title: string; body: string; docType: string;
}

type HistoryDetail = CompletedTask & { documents: Array<Assignment['documents'][number] & { uploadedAt?: string }> };

const manilaDate = (value?: string, unavailable = 'Not available') => {
  if (!value) return unavailable;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00+08:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric',
  }).format(date);
};

const manilaStamp = (value?: string, unavailable = 'Not available') => {
  if (!value) return unavailable;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return value; // Do not invent a year for legacy display stamps.
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('month')} ${part('day')}, ${part('year')} · ${part('hour')}:${part('minute')} ${part('dayPeriod')}`;
};

/* ── Constants ── */
const OPERATIONAL_PHOTOS = {
  pickup: ['pickup_front', 'pickup_left', 'pickup_right', 'pickup_rear'],
  pretrip: ['pretrip_front', 'pretrip_left', 'pretrip_right', 'pretrip_rear'],
} as const;
type OperationalPhotoKey = typeof OPERATIONAL_PHOTOS.pickup[number] | typeof OPERATIONAL_PHOTOS.pretrip[number]
  | 'loading_before' | 'loading_after' | 'unloading_before' | 'unloading_after';
type DriverPhase = 'assigned' | 'pickup' | 'loading' | 'pretrip' | 'trip_pending'
  | 'in_transit' | 'arrived' | 'unloading' | 'delivery_pending' | 'delivered' | 'legacy_picked_up';

/* Derived only from server-owned columns. Local UI state never advances a stage. */
function getDriverPhase(a: Assignment): DriverPhase {
  if (a.taskStatus === 'Delivered') return 'delivered';
  if (a.operationalStage === 'unloaded') return 'delivery_pending';
  if (a.operationalStage === 'unloading') return 'unloading';
  if (a.operationalStage === 'destination_arrived') return 'arrived';
  if (a.taskStatus === 'In Transit') return 'in_transit';
  if (a.departedAt && a.taskStatus === 'Picked Up') return 'trip_pending';
  if (a.operationalStage === 'loaded') return 'pretrip';
  if (a.operationalStage === 'loading') return 'loading';
  if (a.operationalStage === 'pickup_arrived') return 'pickup';
  if (a.taskStatus === 'Picked Up') return 'legacy_picked_up';
  return 'assigned';
}

function elapsedClock(start?: string | null, end = new Date()): string | null {
  if (!start) return null;
  const seconds = Math.max(0, Math.floor((end.getTime() - new Date(start).getTime()) / 1000));
  if (!Number.isFinite(seconds)) return null;
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((part) => String(part).padStart(2, '0')).join(':');
}

const REQUIRED_DOCS = [
  'Proof of Delivery',
  'Receiving Acknowledgement Report',
  'Dispatch Slip',
  'Sales Invoice',
  'Bill of Lading',
  'Waybill / Delivery Receipt',
];

const PICKUP_DELAY_REASONS   = ['Heavy traffic','Vehicle breakdown','Waiting for cargo','Weather conditions','Driver health issue','Other...'];
const DELIVERY_DELAY_REASONS = ['Heavy traffic','Wrong address / rerouting','Customer unavailable','Vehicle breakdown','Weather conditions','Other...'];
const ISSUE_REASONS          = [...BLOCKING_ISSUE_REASONS, 'Other...'];

/* ── Mock data ── */
/* Demo-preview dates are derived from the current date rather than written in.
   Fixed dates like "2026-04-25" go stale the moment the year turns over and make
   the preview look broken, so these stay relative to whenever it is run. Formats
   match what real data uses: ISO for deliveryDate, a display stamp for completedAt. */
const daysAgoIso = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().split('T')[0];
const daysAgoStamp = (days: number, hour: number, minute: number) => {
  const d = new Date(Date.now() - days * 86_400_000);
  d.setHours(hour, minute, 0, 0);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const MOCK_DATA: DriverData = {
  driver: { id: 'DRIVER-PREVIEW', name: 'Preview Driver', phone: '+1 555-0100', status: 'Active', currentLocation: 'Warehouse A' },
  assignment: {
    id: 'DEL-PREVIEW-0042', truckPlate: 'TRK-8847',
    destination: 'Industrial Compressor Units × 3', company: 'Apex Manufacturing Ltd.',
    pickupLocation: 'Warehouse A — Bay 4, Industrial Park Rd.',
    deliveryDate: new Date(Date.now() + 86_400_000).toISOString().split('T')[0],
    pickupTime: '09:00 AM', ata: '02:30 PM', eta: '01:45 PM',
    remarks: 'Handle with care. Fragile hydraulic seals inside.',
    taskStatus: 'In Transit' as TaskStatus, delayReports: [], statusPhotos: {}, documents: [],
  } as unknown as Assignment,
  completedHistory: [
    { id: 'DEL-PREVIEW-0038', destination: 'Office Furniture Set', company: 'TechCorp Solutions', deliveryDate: daysAgoIso(5),  completedAt: daysAgoStamp(5, 11, 42),  truckPlate: 'TRK-8847', taskStatus: 'Delivered' },
    { id: 'DEL-PREVIEW-0031', destination: 'Medical Supplies × 50 boxes', company: 'City Hospital Group', deliveryDate: daysAgoIso(10), completedAt: daysAgoStamp(10, 15, 15), truckPlate: 'TRK-8847', taskStatus: 'Delivered' },
  ],
};

/* ── Image helpers ── */
function compressImage(dataUrl: string, maxPx = 600, quality = 0.65): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const ratio  = Math.min(maxPx / img.width, maxPx / img.height, 1);
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width  * ratio);
      canvas.height = Math.round(img.height * ratio);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/* Blurry-photo check: downsamples to grayscale, runs a 3x3 Laplacian edge
   filter, and measures the variance of the result. A sharp, in-focus photo
   has lots of high-contrast edges (high variance); a blurry one is smooth
   throughout (low variance). This is a heuristic, not exact science — the
   threshold may need tuning after testing against real phone-camera photos.
   Fails open (never blocks upload) if anything goes wrong reading the image. */
function isBlurryImage(dataUrl: string, threshold = 45): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const maxPx = 300;
        const ratio = Math.min(maxPx / img.width, maxPx / img.height, 1);
        const w = Math.max(1, Math.round(img.width * ratio));
        const h = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(false); return; }
        ctx.drawImage(img, 0, 0, w, h);
        const { data } = ctx.getImageData(0, 0, w, h);

        const gray = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++) {
          gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
        }

        let sum = 0, sumSq = 0, n = 0;
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            const lap = gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
            sum += lap; sumSq += lap * lap; n++;
          }
        }
        if (n === 0) { resolve(false); return; }
        const mean = sum / n;
        resolve((sumSq / n - mean * mean) < threshold);
      } catch { resolve(false); }
    };
    img.onerror = () => resolve(false);
    img.src = dataUrl;
  });
}

function DriverHomeClock() {
  const { language } = useDriverI18n();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const parts = new Intl.DateTimeFormat(language === 'fil' ? 'fil-PH' : 'en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  const date = `${part('weekday')}, ${part('month')} ${part('day')}, ${part('year')}`;
  const time = `${part('hour')}:${part('minute')} ${part('dayPeriod')}`;

  return <time dateTime={now.toISOString()} className="block mt-1 text-xs sm:text-sm leading-snug text-gray-500">
    <span>{date}</span><span className="whitespace-nowrap">{' • '}{time}</span>
  </time>;
}

function DriverOverdueNotice({ timing, deliveryDate, compact = false }: {
  timing: DeliveryTimingStatus | null; deliveryDate: string; compact?: boolean;
}) {
  const { t } = useDriverI18n();
  if (timing?.kind !== 'overdue') return null;
  const { value, unit } = timing.duration;
  const unitText = unit === 'day' ? t(value === 1 ? 'home.day' : 'home.days')
    : unit === 'hour' ? t(value === 1 ? 'home.hour' : 'home.hours')
    : t(value === 1 ? 'home.minute' : 'home.minutes');
  const scheduledDate = /^\d{4}-\d{2}-\d{2}$/.test(deliveryDate) ? manilaDate(deliveryDate) : deliveryDate;
  const title = t('home.overdue', { count: value, unit: unitText });
  const schedule = t('home.scheduledDelivery', { date: scheduledDate });
  return (
    <div role="status" aria-label={`${title}. ${schedule}`}
      className={`${compact ? 'mx-4 mt-3 rounded-xl px-3 py-2.5' : 'rounded-2xl px-5 py-4'} flex min-w-0 items-start gap-2.5 border border-red-200 bg-red-50`}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-bold leading-snug text-red-700 break-words">{title}</p>
        <p className="mt-0.5 text-xs leading-snug text-gray-600 break-words">{schedule}</p>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   SLIDE-TO-CONFIRM CONTROL
   ════════════════════════════════════════════════════════════ */
function SlideToConfirm({ label, completedLabel, onConfirm, disabled = false }: {
  label: string; completedLabel?: string;
  onConfirm: () => boolean | (() => void) | Promise<boolean | (() => void)>; disabled?: boolean;
}) {
  const { t } = useDriverI18n();
  const [dragX,      setDragX]      = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [phase,      setPhase]      = useState<'ready' | 'saving' | 'completed'>('ready');
  const trackRef = useRef<HTMLDivElement>(null);
  const startRef = useRef(0);
  const busyRef = useRef(false);
  const completionTimer = useRef<number | null>(null);
  const pendingStageUpdate = useRef<(() => void) | null>(null);

  useEffect(() => () => {
    if (completionTimer.current !== null) window.clearTimeout(completionTimer.current);
    pendingStageUpdate.current?.();
  }, []);

  const THUMB_W = 64;
  const PAD     = 4;

  const getMax = useCallback(() => (trackRef.current?.offsetWidth ?? 300) - THUMB_W - PAD * 2, []);
  const reset = useCallback(() => {
    setDragX(0);
    setPhase('ready');
    busyRef.current = false;
  }, []);

  const fire = useCallback(async () => {
    if (disabled || busyRef.current) return;
    busyRef.current = true;
    setPhase('saving');
    try {
      const saved = await onConfirm();
      if (saved) {
        pendingStageUpdate.current = typeof saved === 'function' ? saved : null;
        setDragX(getMax());
        setPhase('completed');
        completionTimer.current = window.setTimeout(() => {
          pendingStageUpdate.current?.();
          pendingStageUpdate.current = null;
          reset();
        }, 800);
      } else {
        reset();
      }
    } catch {
      reset();
    }
  }, [disabled, getMax, onConfirm, reset]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || busyRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    startRef.current = e.clientX - dragX;
    setIsDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setDragX(Math.max(0, Math.min(e.clientX - startRef.current, getMax())));
  };
  const onPointerUp = () => {
    if (!isDragging) return;
    setIsDragging(false);
    if (dragX >= getMax() * 0.82) fire();
    else setDragX(0);
  };
  const onPointerCancel = () => { setIsDragging(false); setDragX(0); };
  const visuallyDisabled = disabled && phase === 'ready';

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={visuallyDisabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round((dragX / Math.max(1, getMax())) * 100)}
      aria-disabled={disabled || phase !== 'ready'}
      onKeyDown={(event) => {
        if (disabled || busyRef.current) return;
        if (event.key === 'ArrowRight') { event.preventDefault(); setDragX((x) => Math.min(getMax(), x + getMax() / 4)); }
        if (event.key === 'ArrowLeft') { event.preventDefault(); setDragX((x) => Math.max(0, x - getMax() / 4)); }
        if ((event.key === 'Enter' || event.key === ' ') && dragX >= getMax() * 0.82) { event.preventDefault(); fire(); }
      }}
      className={`relative h-[68px] rounded-2xl overflow-hidden select-none ${
        visuallyDisabled ? 'bg-gray-100' : phase === 'completed' ? 'bg-green-600' : 'bg-green-100'
      }`}
    >
      {/* Fill */}
      {!visuallyDisabled && (
        <div
          className={`pointer-events-none absolute inset-y-0 left-0 ${phase === 'completed' ? 'bg-green-600' : 'bg-green-300'} ${isDragging ? '' : 'transition-[width] duration-300 ease-out motion-reduce:transition-none'}`}
          style={{ width: phase === 'completed' ? '100%' : `${dragX + THUMB_W + PAD}px` }}
        />
      )}
      {!visuallyDisabled && phase === 'ready' && !isDragging &&
        <div aria-hidden="true" className="driver-slide-sweep pointer-events-none absolute inset-0" />}
      {/* Label */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span className={`max-w-full pl-16 pr-3 text-center text-sm sm:text-base font-bold leading-tight ${visuallyDisabled ? 'text-gray-400' : phase === 'completed' ? 'text-white' : 'text-green-950'}`}>
          {phase === 'completed' ? (completedLabel ?? t('slide.confirmed')) : phase === 'saving' ? t('slide.updating') : label}
        </span>
      </div>
      {/* Thumb */}
      {!visuallyDisabled && (
        <div
          className="driver-slide-thumb absolute top-[4px] bottom-[4px] flex items-center justify-center bg-green-700 rounded-xl shadow-md cursor-grab active:cursor-grabbing"
          style={{
            left: `${PAD}px`,
            width: `${THUMB_W}px`,
            touchAction: 'none',
            transform: `translate3d(${dragX}px, 0, 0)`,
            transition: isDragging ? 'none' : undefined,
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          {phase === 'completed'
            ? <CheckCircle2 className="w-7 h-7 text-white" />
            : <span aria-hidden="true" className="flex items-center gap-0.5 text-3xl font-light leading-none text-white">
                {[0, 1, 2].map((index) => <span key={index} className="driver-slide-chevron" style={{ animationDelay: `${index * 160}ms` }}>›</span>)}
              </span>
          }
        </div>
      )}
    </div>
  );
}

function OperationalProgress({ phase }: { phase: DriverPhase }) {
  const { t } = useDriverI18n();
  const labels = [t('status.Assigned'), t('workflow.atPickup'), t('workflow.loading'),
    t('status.In Transit'), t('workflow.arrived'), t('workflow.unloading'), t('status.Delivered')];
  const step = phase === 'assigned' ? 0 : phase === 'pickup' || phase === 'legacy_picked_up' ? 1
    : phase === 'loading' || phase === 'pretrip' ? 2
    : phase === 'trip_pending' || phase === 'in_transit' ? 3
    : phase === 'arrived' ? 4 : phase === 'unloading' || phase === 'delivery_pending' ? 5 : 6;
  const next = phase === 'assigned' ? { stage: labels[1], help: t('task.proceedPickup') }
    : phase === 'pickup' || phase === 'legacy_picked_up' ? { stage: labels[2], help: t('task.nextLoading') }
      : phase === 'loading' || phase === 'pretrip' ? { stage: labels[3], help: t('task.nextTrip') }
        : phase === 'trip_pending' ? { stage: labels[3], help: t('task.nextTripSync') }
          : phase === 'in_transit' ? { stage: labels[4], help: t('task.nextArrival') }
            : phase === 'arrived' ? { stage: labels[5], help: t('task.nextUnloading') }
              : phase === 'unloading' || phase === 'delivery_pending' ? { stage: labels[6], help: t('task.nextDelivery') }
                : { stage: t('task.documents'), help: t('task.deliveryCompletedUploadPrompt') };
  const color = statusColors[OPERATIONAL_STEPS[step]];
  return <section className="rounded-2xl border border-gray-200 bg-white px-4 py-4 shadow-sm sm:px-5" aria-label={t('task.progress')}>
    <p className="text-sm font-bold uppercase tracking-wide text-gray-500">{t('task.progress')}</p>
    <div className="mt-2 flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
      <h2 className={`text-2xl font-bold leading-tight ${color.activeLabel}`}>{labels[step]}</h2>
      <p className="text-sm font-semibold text-gray-600">{t('workflow.stepCount', { step: step + 1 })}</p>
    </div>
    <div className="mt-4 grid grid-cols-7 gap-1.5" aria-label={t('workflow.step', { step: step + 1, stage: labels[step] })}>
      {labels.map((label, index) => {
        const done = phase === 'delivered' || index < step;
        const active = index === step;
        return <span key={label} title={label} aria-label={label}
          className={`flex h-9 min-w-0 items-center justify-center rounded-lg border text-sm font-bold ${done
            ? 'border-green-600 bg-green-600 text-white' : active ? color.activeStep
              : 'border-gray-200 bg-gray-100 text-gray-500'}`}>
          {done ? <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> : index + 1}
        </span>;
      })}
    </div>
    <div className="mt-4 border-t border-gray-100 pt-3">
      <p className="text-base font-bold text-gray-900">{t('task.nextStage', { stage: next.stage })}</p>
      <p className="mt-1 text-sm leading-relaxed text-gray-600">{next.help}</p>
    </div>
  </section>;
}

function TaskLocationsCard({ assignment }: { assignment: Assignment }) {
  const { t } = useDriverI18n();
  const origin = assignment.destination.includes('→') ? assignment.destination.split('→')[0]?.trim() : '';
  const stops = [
    { title: t('home.pickupAt'), location: assignment.pickupLocation, area: origin },
    { title: t('home.deliverTo'), location: assignment.deliveryLocation || getDeliveryLocation(assignment),
      area: assignment.destinationArea },
  ];
  return <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5" aria-label={t('task.route')}>
    {stops.map((stop, index) => <div key={stop.title}>
      {index > 0 && <div className="my-3 ml-5 flex h-7 items-center border-l-2 border-dashed border-gray-300 pl-3">
        <ArrowDown className="h-5 w-5 text-gray-500" aria-hidden="true" />
      </div>}
      <div className="flex min-w-0 items-start gap-3">
        <MapPin className={`mt-1 h-6 w-6 shrink-0 ${index === 0 ? 'text-sky-700' : 'text-emerald-700'}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold uppercase tracking-wide text-gray-500">{stop.title}</p>
          <p className="mt-1 break-words text-lg font-bold leading-snug text-gray-900">{stop.location || '—'}</p>
          {stop.area && !stop.location.toLowerCase().includes(stop.area.toLowerCase()) &&
            <p className="mt-0.5 break-words text-sm leading-snug text-gray-600">{stop.area}</p>}
        </div>
      </div>
    </div>)}
  </section>;
}

function ElapsedTime({ start }: { start?: string | null }) {
  const { t } = useDriverI18n();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <p className="mt-1">{t('workflow.elapsed')}: {elapsedClock(start, now) ?? '—'}</p>;
}

function OperationalPhotos({ assignment, keys, title, help, required, onSelect, highlightKey }: {
  assignment: Assignment; keys: readonly OperationalPhotoKey[]; title: string; help?: string;
  required: boolean; onSelect: (key: OperationalPhotoKey) => void;
  highlightKey?: OperationalPhotoKey | null;
}) {
  const { t } = useDriverI18n();
  const count = keys.filter((key) => !!assignment.statusPhotos?.[key]?.url).length;
  const angle = (key: OperationalPhotoKey) => {
    const suffix = key.split('_').slice(-1)[0];
    return suffix === 'front' ? t('workflow.front') : suffix === 'left' ? t('workflow.left')
      : suffix === 'right' ? t('workflow.right') : suffix === 'rear' ? t('workflow.rear') : title;
  };
  return <section data-driver-photo-section={keys[0]} className={`min-w-0 rounded-2xl border bg-white p-4 shadow-sm transition-colors duration-700 motion-reduce:transition-none ${highlightKey === keys[0] ? 'border-green-500 bg-green-50' : 'border-gray-200'}`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h3 className="text-base font-bold text-gray-900">{title} <span className="text-sm font-semibold text-gray-500">— {t(required ? 'workflow.required' : 'workflow.optional')}</span></h3>
        {help && <p className="mt-1 text-sm text-gray-600">{help}</p>}
      </div>
      {keys.length > 1 && <span className="text-sm font-semibold text-green-800">{t('workflow.captured', { count, total: keys.length })}</span>}
    </div>
    <div className={`mt-4 grid gap-3 ${keys.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {keys.map((key) => {
        const saved = assignment.statusPhotos?.[key];
        const label = angle(key);
        return <button key={key} type="button" data-driver-photo-key={key} onClick={() => onSelect(key)}
          aria-label={saved ? t('workflow.replacePhoto', { angle: label }) : t('workflow.photoSlot', { angle: label, requirement: t(required ? 'workflow.required' : 'workflow.optional') })}
          className={`min-w-0 overflow-hidden rounded-xl border-2 border-dashed bg-gray-50 text-left transition-colors duration-700 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-green-700 ${highlightKey === key ? 'border-green-600 ring-2 ring-green-200' : 'border-gray-200'}`}>
          {saved ? <img src={saved.url} alt={label} className="h-28 w-full object-cover" />
            : <div className="flex h-28 items-center justify-center"><Camera className="h-9 w-9 text-gray-400" aria-hidden="true" /></div>}
          <div className="flex items-center justify-between gap-1 px-3 py-2">
            <span className="min-w-0 break-words text-sm font-bold text-gray-800">{label}</span>
            <span className={`shrink-0 text-sm font-semibold ${saved ? 'text-green-700' : 'text-gray-500'}`}>
              {saved ? '✓' : t(required ? 'workflow.required' : 'workflow.optional')}
            </span>
          </div>
        </button>;
      })}
    </div>
  </section>;
}

/* ════════════════════════════════════════════════════════════
   PHOTO CAPTURE SHEET (redesigned — receipt-style meta)
   ════════════════════════════════════════════════════════════ */
function DriverBottomSheet({ label, onBackdrop, children }: { label: string; onBackdrop: () => void; children: React.ReactNode }) {
  const [viewport, setViewport] = useState<{ top: number; height: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const visual = window.visualViewport;
    if (!visual) return;
    const keepInputVisible = () => {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && panelRef.current?.contains(focused)
        && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA')) {
        window.requestAnimationFrame(() => focused.scrollIntoView({ block: 'nearest' }));
      }
    };
    const update = () => setViewport({ top: visual.offsetTop, height: visual.height });
    const onResize = () => { update(); keepInputVisible(); };
    update();
    visual.addEventListener('resize', onResize);
    visual.addEventListener('scroll', update);
    return () => {
      visual.removeEventListener('resize', onResize);
      visual.removeEventListener('scroll', update);
    };
  }, []);
  return <div className="fixed inset-x-0 z-50 flex items-end" style={{ top: viewport?.top ?? 0, height: viewport?.height ?? '100dvh' }}>
    <div className="absolute inset-0 bg-black/60" onClick={onBackdrop} />
    <div ref={panelRef} role="dialog" aria-modal="true" aria-label={label} className="relative flex max-h-[min(92%,720px)] w-full min-h-0 flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl motion-safe:animate-in motion-safe:slide-in-from-bottom motion-safe:duration-300">
      {children}
    </div>
  </div>;
}

type DevicePhotoLocation = { location: string; coords: { lat: number; lng: number }; accuracy: number | null };

async function readFreshPhotoLocation(): Promise<DevicePhotoLocation> {
  if (!navigator.geolocation) throw new Error('geolocation_unavailable');
  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true, maximumAge: 0, timeout: 12000,
    });
  });
  const { latitude, longitude, accuracy } = position.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error('geolocation_invalid');
  let location = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=16&addressdetails=1`,
      { headers: { 'Accept-Language': 'en' } },
    );
    if (res.ok) {
      const data = await res.json();
      const addr = data.address ?? {};
      const parts = [addr.road || addr.amenity || addr.building,
        addr.suburb || addr.village || addr.neighbourhood,
        addr.city || addr.town || addr.municipality].filter(Boolean);
      if (parts.length) location = parts.join(', ');
    }
  } catch { /* The measured coordinates remain available without an address. */ }
  return { location, coords: { lat: latitude, lng: longitude },
    accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null };
}

function PhotoDetails({ photo, source, accuracy }: { photo: StatusPhoto; source: 'camera' | 'gallery' | 'unknown'; accuracy?: number | null }) {
  const { t } = useDriverI18n();
  const accuracyLevel = gpsAccuracyLevel(accuracy);
  const locationText = photo.location && photo.location !== 'Location unavailable' && photo.location !== 'Location not supported'
    ? photo.location : null;
  const locationAvailable = !!photo.coords || !!locationText;
  return <section className="rounded-xl border border-gray-200 bg-white px-4 py-3">
    <h4 className="text-sm font-bold text-gray-900">{t('photo.details')}</h4>
    <div className="mt-3 flex items-start gap-3">
      <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-gray-500">{source === 'gallery' ? t('photo.uploadedAt')
          : source === 'camera' ? t('photo.appObservedAt') : t('photo.recordedAt')}</p>
        <p className="mt-0.5 text-sm font-semibold text-gray-900">{photo.timestamp ? manilaStamp(photo.timestamp) : t('photo.pendingUpload')}</p>
      </div>
    </div>
    <div className="mt-3 flex items-start gap-3 border-t border-gray-100 pt-3">
      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-gray-500">{source === 'gallery' ? t('photo.deviceLocationAtUpload')
          : source === 'camera' ? t('photo.deviceLocation') : photo.coords ? t('photo.photoGpsLocation') : t('photo.recordedLocation')}</p>
        {locationAvailable && <p className="mt-0.5 break-words text-sm font-semibold text-gray-900">{locationText || `${photo.coords!.lat.toFixed(5)}, ${photo.coords!.lng.toFixed(5)}`}</p>}
        {!locationAvailable && <p className="mt-0.5 text-sm text-gray-600">{t('photo.locationUnavailable')}</p>}
        {photo.coords && accuracyLevel && <p className="mt-1 text-xs text-gray-500">
          {t(`photo.accuracy.${accuracyLevel}`, { meters: Math.round(accuracy!) })}
        </p>}
      </div>
    </div>
    <div className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-600">
      <span className="font-semibold">{t('photo.source')}: </span>
      {source === 'unknown' ? t('photo.sourceUnavailable') : t(source === 'camera' ? 'photo.sourceCamera' : 'photo.sourceGallery')}
    </div>
  </section>;
}

function PhotoSheet({ status, title, instruction, qualityCheck, existingPhoto, onConfirm, onCancel }: {
  status: TaskStatus | null; title?: string; instruction?: string;
  qualityCheck?: 'truck' | 'cargo';
  existingPhoto?: StatusPhoto | null;
  onConfirm: (photo: StatusPhoto, source: 'camera' | 'gallery') => Promise<void>; onCancel: () => void;
}) {
  const { t, status: statusText } = useDriverI18n();
  const [photo,      setPhoto]      = useState<string | null>(null);
  const [meta,       setMeta]       = useState<StatusPhoto | null>(null);
  const [locLoading, setLocLoading] = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [saveError,  setSaveError]  = useState('');
  const [checking,   setChecking]   = useState(false);
  const [qualityError, setQualityError] = useState<PhotoCheckFailure | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<'camera' | 'gallery' | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [locationError, setLocationError] = useState(false);
  const attemptRef = useRef(0);

  useEffect(() => {
    if (qualityCheck === 'truck') void loadVehicleDetector().catch(() => { /* The capture shows the retry error. */ });
    return () => { attemptRef.current++; };
  }, [qualityCheck]);

  const requestDeviceLocation = (imageUrl: string, stamp: string, attempt: number) => {
    const isCurrent = () => attempt === attemptRef.current;
    setLocLoading(true);
    setLocationError(false);
    void readFreshPhotoLocation().then(({ location, coords, accuracy }) => {
      if (isCurrent()) {
        setGpsAccuracy(accuracy);
        setMeta({ url: imageUrl, timestamp: stamp, location, coords });
        setLocLoading(false);
      }
    }).catch(() => {
      if (isCurrent()) {
        setGpsAccuracy(null);
        setMeta({ url: imageUrl, timestamp: stamp, location: '' });
        setLocationError(true);
        setLocLoading(false);
      }
    });
  };

  const handleFile = (file: File, selectedSource: 'camera' | 'gallery') => {
    const attempt = ++attemptRef.current;
    const isCurrent = () => attempt === attemptRef.current;
    setSource(selectedSource);
    setGpsAccuracy(null);
    setLocationError(false);
    setSaveError('');
    setQualityError(null);
    setPhoto(null);
    setMeta(null);
    setLocLoading(false);
    setChecking(!!qualityCheck);
    const observedAt = new Date().toISOString();
    const reader = new FileReader();
    reader.onload = async () => {
      let compressed: string;
      try { compressed = await compressImage(reader.result as string); }
      catch {
        if (isCurrent()) { setChecking(false); setSaveError(t('photo.saveError')); }
        return;
      }
      if (!isCurrent()) return;
      setPhoto(compressed);
      if (qualityCheck) {
        let result: Awaited<ReturnType<typeof checkPhoto>>;
        try { result = await checkPhoto(compressed, { requireTruck: qualityCheck === 'truck' }); }
        catch { result = { ok: false, reason: qualityCheck === 'truck' ? 'detector_unavailable' : 'unreadable' }; }
        if (!isCurrent()) return;
        if (!result.ok) {
          setQualityError(result.reason);
          setChecking(false);
          return;
        }
        setChecking(false);
      }
      if (selectedSource === 'gallery') {
        // The selected image's original time and place are not verified by this app.
        // Do not write current device GPS into its persisted capture fields.
        setMeta(galleryPhotoMetadata(compressed));
      } else requestDeviceLocation(compressed, observedAt, attempt);
    };
    reader.onerror = () => {
      if (isCurrent()) { setChecking(false); setSaveError(t('photo.saveError')); }
    };
    reader.readAsDataURL(file);
  };

  const canConfirm = !!photo && !!meta && meta.url === photo && !checking && !qualityError && !locLoading && !saving;
  const confirmPhoto = async (continueWithoutLocation = false) => {
    if (!canConfirm || !meta || !source) return;
    setSaving(true);
    setSaveError('');
    let submission = meta;
    try {
      if (source === 'gallery' && !continueWithoutLocation) {
        setLocLoading(true);
        setLocationError(false);
        try {
          const { location, coords, accuracy } = await readFreshPhotoLocation();
          submission = { ...meta, location, coords };
          setMeta(submission);
          setGpsAccuracy(accuracy);
        } catch {
          setLocationError(true);
          return;
        } finally { setLocLoading(false); }
      }
      if (source === 'gallery' && continueWithoutLocation) {
        submission = { ...meta, location: '', coords: undefined };
        setGpsAccuracy(null);
      }
      await onConfirm(submission, source);
    }
    catch (err) {
      console.error('[status photo] save failed:', err);
      setSaveError(status === 'Delivered' ? t('photo.deliveryError') : t('photo.saveError'));
    } finally { setSaving(false); }
  };
  const cancelPhoto = () => { if (!saving) { attemptRef.current++; onCancel(); } };
  const retakePhoto = () => {
    attemptRef.current++;
    setReplacing(true);
    setPhoto(null);
    setMeta(null);
    setSource(null);
    setGpsAccuracy(null);
    setLocationError(false);
    setChecking(false);
    setLocLoading(false);
    setQualityError(null);
    setSaveError('');
  };
  const qualityMessage = qualityError ? t(`photo.${qualityError}`) : null;

  return (
    <DriverBottomSheet label={title ?? (status === 'Delivered' ? t('photo.deliveryRequired') : t('photo.take'))} onBackdrop={cancelPhoto}>
        <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mt-3 mb-1 flex-shrink-0" />

        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between border-b border-gray-100 flex-shrink-0">
          <div>
            <h3 className="text-xl font-bold text-foreground">{title ?? (status === 'Delivered' ? t('photo.deliveryRequired') : t('photo.take'))}</h3>
            <p className="text-sm text-gray-500 mt-0.5">{instruction ?? (status === 'Delivered' ? t('photo.deliveryInstruction') : status ? t('photo.requiredToConfirm', { status: statusText(status) }) : '')}</p>
          </div>
          <button onClick={cancelPhoto} disabled={saving} className="w-11 h-11 bg-gray-100 rounded-full flex items-center justify-center disabled:opacity-50" aria-label={t('photo.close')}>
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 space-y-4">
          <input
            ref={cameraInputRef} type="file" accept="image/*" capture="environment" disabled={saving || checking} className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f, 'camera'); e.target.value = ''; }}
          />
          <input
            ref={galleryInputRef} type="file" accept="image/*" disabled={saving || checking} className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f, 'gallery'); e.target.value = ''; }}
          />

          {!photo && existingPhoto && !replacing ? (
            <>
              <img src={existingPhoto.url} alt={title ?? t('photo.captured')} className="max-h-52 w-full rounded-xl bg-gray-50 object-contain" />
              <PhotoDetails photo={existingPhoto} source="unknown" />
              <button type="button" onClick={retakePhoto} disabled={saving}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-2 focus-visible:outline-green-700 disabled:opacity-50">
                <RotateCcw className="h-4 w-4" aria-hidden="true" />{t('photo.retake')}
              </button>
            </>
          ) : !photo ? (
            <div className="space-y-3 text-center">
              <Camera className="mx-auto h-9 w-9 text-green-700" aria-hidden="true" />
              <div>
                <p className="text-lg font-bold text-gray-900">{t('photo.addPhoto', { title: title ?? t('photo.take') })}</p>
                <p className="mt-1 text-sm text-gray-600">{t('photo.chooseSource')}</p>
              </div>
              <button type="button" onClick={() => cameraInputRef.current?.click()} disabled={checking}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-green-700 px-4 py-3 text-base font-bold text-white hover:bg-green-800 focus-visible:outline-2 focus-visible:outline-green-700 disabled:opacity-50">
                <Camera className="h-5 w-5" aria-hidden="true" />{t('photo.openCamera')}
              </button>
              <button type="button" onClick={() => galleryInputRef.current?.click()} disabled={checking}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-3 text-base font-semibold text-gray-800 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-green-700 disabled:opacity-50">
                <Images className="h-5 w-5" aria-hidden="true" />{t('photo.uploadGallery')}
              </button>
            </div>
          ) : (
            <>
              {/* Photo preview */}
              <div className="rounded-2xl overflow-hidden border border-gray-200 bg-black">
                <img src={photo} alt={t('photo.captured')} className="w-full max-h-60 object-contain" />
              </div>

              {/* Retake */}
              <button
                onClick={retakePhoto} disabled={saving}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-2 focus-visible:outline-green-700 disabled:opacity-50"
              >
                <RotateCcw className="w-4 h-4" aria-hidden="true" /> {t('photo.retake')}
              </button>

              {/* Receipt-style meta */}
              {checking ? (
                <div role="status" className="bg-gray-50 border border-gray-200 rounded-2xl px-5 py-5 flex items-center gap-3">
                  <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                  <span className="text-base text-gray-600">{t('photo.checking')}</span>
                </div>
              ) : locLoading ? (
                <div className="bg-gray-50 border border-gray-200 rounded-2xl px-5 py-5 flex items-center gap-3">
                  <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                  <span className="text-base text-gray-500">{t('photo.gettingLocationLong')}</span>
                </div>
              ) : meta && <>
                <PhotoDetails photo={meta} source={source ?? 'unknown'} accuracy={gpsAccuracy} />
                {source === 'camera' && <button type="button" onClick={() => requestDeviceLocation(meta.url, meta.timestamp, attemptRef.current)}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-green-700">
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />{t(locationError ? 'photo.retryLocation' : 'photo.refreshLocation')}
                </button>}
              </>}
            </>
          )}

          {qualityMessage && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{qualityMessage}</p>}
          {locationError && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{t('photo.locationError')}</p>}
          {saveError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{saveError}</p>}

        </div>
        {photo && <div className="shrink-0 border-t border-gray-100 bg-white px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            disabled={!canConfirm}
            onClick={() => void confirmPhoto()}
            className={`w-full py-5 rounded-2xl font-bold text-xl transition-all ${
              canConfirm
                ? 'bg-green-700 text-white active:bg-green-800 shadow-md'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            {checking     ? t('photo.checking') :
             !photo       ? t('photo.takeFirst')  :
             locLoading   ? t('photo.gettingLocation') :
             saving       ? t('photo.saving') :
             source === 'gallery' && locationError ? t('photo.retryLocation') :
             status === 'Delivered' ? t('photo.confirmDelivered') : t('photo.confirm')}
          </button>
          {source === 'gallery' && locationError && <button type="button" disabled={saving}
            onClick={() => void confirmPhoto(true)}
            className="mt-2 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-green-700">
            {t('photo.continueWithoutLocation')}
          </button>}
        </div>}
    </DriverBottomSheet>
  );
}

/* ════════════════════════════════════════════════════════════
   REASON SHEET
   ════════════════════════════════════════════════════════════ */
function ReasonSheet({ title, subtitle, reasons, variant, onSubmit, onCancel }: {
  title: string; subtitle: string; reasons: string[];
  variant: 'amber' | 'red';
  onSubmit: (reason: string) => void; onCancel: () => void;
}) {
  const { t, reason: reasonText } = useDriverI18n();
  const [selected, setSelected] = useState('');
  const [other,    setOther]    = useState('');
  const isOther = selected === 'Other...';
  const canSend = isOther ? other.trim().length > 0 : selected !== '';
  const btn     = variant === 'amber' ? 'bg-amber-500' : 'bg-red-600';

  return (
    <DriverBottomSheet label={title} onBackdrop={onCancel}>
        <div className="w-10 h-1 shrink-0 bg-gray-300 rounded-full mx-auto mt-3 mb-1" />
        <div className="shrink-0 px-5 py-4 border-b border-gray-100">
          <h3 className="text-xl font-bold text-foreground">{title}</h3>
          <p className="text-sm text-gray-400 mt-0.5">{subtitle}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 space-y-3">
          <select value={selected} onChange={(e) => setSelected(e.target.value)}
            className="w-full px-4 py-4 bg-gray-50 border border-gray-200 rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-primary/30">
            <option value="">{t('reason.choose')}</option>
            {reasons.map((r) => <option key={r} value={r}>{reasonText(r)}</option>)}
          </select>
          {isOther && (
            <textarea autoFocus value={other} onChange={(e) => setOther(e.target.value)}
              placeholder={t('reason.describe')} rows={3}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-base resize-none focus:outline-none focus:ring-2 focus:ring-primary/30" />
          )}
        </div>
        <div className="shrink-0 border-t border-gray-100 bg-white px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] flex gap-3">
          <button onClick={onCancel} className="flex-1 py-4 border border-gray-200 rounded-2xl text-base font-semibold text-gray-600">
            {t('common.cancel')}
          </button>
          <button disabled={!canSend} onClick={() => onSubmit(isOther ? other.trim() : selected)}
            className={`flex-1 py-4 text-white rounded-2xl text-base font-bold transition-colors ${canSend ? btn : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>
            {t('common.submit')}
          </button>
        </div>
    </DriverBottomSheet>
  );
}

/* ════════════════════════════════════════════════════════════
   DOCUMENT ROW (redesigned)
   ════════════════════════════════════════════════════════════ */
function DocRow({ doc, onUpload, isDelivered, isBlurry, isFocused }: {
  doc: NormDoc; onUpload: (type: string, file: File) => void; isDelivered: boolean; isBlurry?: boolean; isFocused?: boolean;
}) {
  const { t, document: documentText } = useDriverI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isFocused) return;
    const frame = requestAnimationFrame(() => {
      rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      rowRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [isFocused]);
  const isApproved  = doc.uploaded && doc.docStatus === 'approved';
  const isRejected  = doc.uploaded && doc.docStatus === 'rejected';
  const isPending   = doc.uploaded && doc.docStatus === 'pending';
  const canUpload   = isDelivered && (!doc.uploaded || isRejected);

  return (
    <div ref={rowRef} tabIndex={-1} className={`rounded-2xl border p-4 space-y-3 ${isFocused ? 'ring-2 ring-green-600 ring-offset-2' : ''} ${
      isApproved  ? 'bg-green-50 border-green-200' :
      isRejected  ? 'bg-red-50 border-red-200' :
      isPending   ? 'bg-cyan-50 border-cyan-200' :
      !isDelivered? 'bg-gray-50 border-gray-100 opacity-60' :
                    'bg-white border-gray-200'
    }`}>
      <div className="flex items-start gap-3">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
          isApproved  ? 'bg-green-100' :
          isRejected  ? 'bg-red-100' :
          isPending   ? 'bg-cyan-100' :
          !isDelivered? 'bg-gray-100' :
                        'bg-green-100'
        }`}>
          {!isDelivered ? <Lock className="w-5 h-5 text-gray-300" /> :
           isApproved   ? <CheckCircle2 className="w-6 h-6 text-green-600" /> :
           isRejected   ? <XCircle className="w-6 h-6 text-red-500" /> :
           isPending    ? <Clock className="w-6 h-6 text-cyan-600" /> :
                          <Camera className="w-6 h-6 text-green-600" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-base font-semibold leading-snug ${!isDelivered ? 'text-gray-400' : 'text-foreground'}`}>
            {documentText(doc.type)}
          </p>
          <p className={`text-sm mt-0.5 font-medium ${
            isApproved  ? 'text-green-700' :
            isRejected  ? 'text-red-600' :
            isPending   ? 'text-cyan-800' :
            !isDelivered? 'text-gray-400' :
                          'text-green-700'
          }`}>
            {!isDelivered ? t('doc.availableAfter') :
             isApproved   ? t('doc.approved') :
             isRejected   ? t('doc.rejected') :
             isPending    ? t('doc.pending') :
                            t('doc.tapPhoto')}
          </p>
        </div>
      </div>

      {/* Rejection reason */}
      {isRejected && doc.rejectReason && (
        <div className="bg-red-100 rounded-xl px-4 py-3">
          <p className="text-sm text-red-700 leading-snug">
            <span className="font-bold">{t('common.reason')} </span>{doc.rejectReason}
          </p>
        </div>
      )}

      {/* Blurry-photo warning — shown after a rejected auto-check, before any upload happens */}
      {isBlurry && (
        <div className="bg-red-100 rounded-xl px-4 py-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700 leading-snug">
            <span className="font-bold">{t('doc.tooBlurry')} </span>
            {t('doc.blurInstruction')}
          </p>
        </div>
      )}

      {/* Upload button */}
      {canUpload && (
        <>
          <input
            ref={inputRef} type="file" accept="image/*,application/pdf" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(doc.type, f); e.target.value = ''; }}
          />
          <button
            onClick={() => inputRef.current?.click()}
            className={`w-full py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 ${
              isRejected || isBlurry ? 'bg-red-600 text-white active:bg-red-700' : 'bg-green-700 text-white active:bg-green-800'
            }`}
          >
            <Camera className="w-5 h-5" />
            {isBlurry ? t('photo.retake') : isRejected ? t('doc.retakeUpload') : t('doc.takeUpload')}
          </button>
        </>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   STATUS BADGE
   ════════════════════════════════════════════════════════════ */
function StatusBadge({ status }: { status: TaskStatus | string }) {
  const { status: statusText } = useDriverI18n();
  const cfg = assignmentDisplayStatusConfig[status as keyof typeof assignmentDisplayStatusConfig] ?? { badge: 'bg-gray-100 text-gray-600 border-gray-200', dot: 'bg-gray-400', label: status };
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold border ${cfg.badge}`}>
      <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
      {statusText(status)}
    </span>
  );
}

/* ════════════════════════════════════════════════════════════
   DETAIL ROW (flat, always-visible)
   ════════════════════════════════════════════════════════════ */
function DetailRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="py-4 border-b border-gray-100 last:border-0">
      <p className="text-sm font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="text-lg font-semibold text-foreground mt-1 leading-snug break-words">{value}</p>
    </div>
  );
}

function PastDeliveryRow({ item, onOpen, highlighted = false }: { item: CompletedHistoryItem; onOpen: () => void; highlighted?: boolean }) {
  const { t } = useDriverI18n();
  return (
    <button type="button" onClick={onOpen} data-history-target={highlighted ? 'true' : undefined}
      className={`w-full min-w-0 min-h-20 rounded-2xl border px-4 py-3 text-left flex items-center justify-between gap-3 transition-colors motion-reduce:transition-none active:bg-green-50 focus-visible:outline-2 focus-visible:outline-green-600 ${highlighted ? 'border-green-400 bg-green-50 ring-2 ring-green-200' : 'border-gray-200 bg-white'}`}>
      <span className="min-w-0 flex-1">
        <span className="block font-bold text-foreground break-all">{item.id}</span>
        <span className="block text-sm text-gray-700 break-words">{getAssignmentRoute(item)}</span>
        <span className="block text-sm text-gray-600 break-words">{item.company} · {item.truckPlate}</span>
        <span className="block text-xs text-gray-500 mt-1">{t('history.completedAtShort', { date: manilaStamp(item.completedAt, t('common.notAvailable')) })}</span>
        <span className="inline-block mt-2 text-xs font-bold text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-full">{t('history.completedCheck')}</span>
      </span>
      <ChevronRight className="w-5 h-5 shrink-0 text-gray-400" aria-hidden="true" />
    </button>
  );
}

function DeliveryCompleteDialog({ item, onClose, onViewHistory }: {
  item: CompletedHistoryItem; onClose: () => void; onViewHistory: () => void;
}) {
  const { t } = useDriverI18n();
  const actionRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    actionRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
      previousFocus?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 px-4 py-6 [padding-bottom:max(1.5rem,env(safe-area-inset-bottom))]">
      <div role="dialog" aria-modal="true" aria-labelledby="delivery-complete-title"
        className="w-full max-w-md max-h-[calc(100dvh-3rem)] overflow-y-auto rounded-2xl bg-white px-5 py-6 text-center shadow-xl motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-200 sm:px-7">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-green-700">
          <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
        </span>
        <h2 id="delivery-complete-title" className="mt-4 text-2xl font-bold text-foreground">{t('completion.title')}</h2>
        <p className="mt-2 break-words text-base font-semibold text-foreground">{t('completion.assignment', { id: item.id })}</p>
        <p className="mt-2 text-base leading-relaxed text-gray-600">{t('completion.moved')}</p>
        {item.completedAt && <p className="mt-3 text-sm text-gray-500">{manilaStamp(item.completedAt)}</p>}
        <button ref={actionRef} type="button" onClick={onViewHistory}
          className="mt-6 min-h-12 w-full rounded-xl bg-green-700 px-4 py-3 text-base font-bold text-white hover:bg-green-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700">
          {t('completion.viewHistory')}
        </button>
        <button type="button" onClick={onClose}
          className="mt-2 min-h-11 w-full rounded-xl px-4 text-base font-semibold text-gray-600 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-green-700">
          {t('login.close')}
        </button>
      </div>
    </div>
  );
}

function DriverPageControls({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  const { t } = useDriverI18n();
  if (pages <= 1) return null;
  return (
    <nav aria-label={t('common.pagination')} className="flex items-center justify-center gap-2 py-3 flex-wrap">
      <button type="button" onClick={() => onPage(page - 1)} disabled={page === 1} aria-label={t('common.previousPage')}
        className="h-11 w-11 rounded-xl border border-gray-200 bg-white flex items-center justify-center disabled:opacity-40"><ChevronLeft className="w-5 h-5" /></button>
      {Array.from({ length: pages }, (_, index) => index + 1).filter((number) => number === 1 || number === pages || Math.abs(number - page) <= 1).map((number, index, visible) => (
        <span key={number} className="hidden sm:contents">
          {index > 0 && number - visible[index - 1] > 1 && <span className="text-gray-400">…</span>}
          <button type="button" onClick={() => onPage(number)} aria-current={number === page ? 'page' : undefined}
            className={`h-11 min-w-11 rounded-xl px-2 font-semibold ${number === page ? 'bg-green-700 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>{number}</button>
        </span>
      ))}
      <span className="sm:hidden h-11 min-w-11 px-3 rounded-xl bg-green-700 text-white font-semibold flex items-center justify-center">{page}</span>
      <button type="button" onClick={() => onPage(page + 1)} disabled={page === pages} aria-label={t('common.nextPage')}
        className="h-11 w-11 rounded-xl border border-gray-200 bg-white flex items-center justify-center disabled:opacity-40"><ChevronRight className="w-5 h-5" /></button>
    </nav>
  );
}

function DriverNotificationRow({ notification, index, onOpen }: { notification: DriverNotif; index: number; onOpen?: () => void }) {
  const { t } = useDriverI18n();
  const n = notification;
  const content = (
    <>
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${n.type === 'rejection' ? 'bg-red-100' : 'bg-green-100'}`}>
        {n.type === 'rejection' ? <XCircle className="w-7 h-7 text-red-500" /> : <CheckCircle2 className="w-7 h-7 text-green-500" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-base font-bold text-foreground [overflow-wrap:anywhere]">{n.title}</p>
        <p className="text-sm text-gray-600 mt-1 leading-relaxed [overflow-wrap:anywhere]">{n.body}</p>
      </div>
      {onOpen && <ChevronRight className="w-5 h-5 shrink-0 self-center text-red-500" aria-hidden="true" />}
    </>
  );
  const className = `w-full min-w-0 min-h-20 rounded-2xl border p-4 flex items-start gap-3 text-left motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-300 ${n.type === 'rejection' ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`;
  const style = { animationDelay: `${index * 70}ms` };
  return onOpen ? (
    <button type="button" onClick={onOpen} style={style} className={`${className} focus-visible:outline-2 focus-visible:outline-green-700`} aria-label={t('notifications.openDocuments', { title: n.title })}>{content}</button>
  ) : <div style={style} className={className}>{content}</div>;
}

function DriverDrawer({ title, onClose, children, compact = false }: { title: string; onClose: () => void; children: React.ReactNode; compact?: boolean }) {
  const { t } = useDriverI18n();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !panelRef.current) return;
      const controls = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'));
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', onKey); previousFocus?.focus(); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={title} className={`relative w-full max-w-md min-w-0 max-h-[min(85dvh,720px)] bg-white rounded-3xl shadow-xl flex flex-col overflow-hidden motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200 ${compact ? '' : 'h-[min(85dvh,720px)]'}`}>
        <div className="px-4 py-4 border-b border-gray-200 flex items-center justify-between gap-3 shrink-0">
          <h2 className="text-xl font-bold text-foreground">{title}</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t('common.close', { title })} className="h-11 w-11 rounded-xl border border-gray-200 flex items-center justify-center focus-visible:outline-2 focus-visible:outline-green-700"><X className="w-5 h-5" /></button>
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5">{children}</div>
      </div>
    </div>
  );
}

function HistoryDetailsSheet({ driverId, driverName, assignmentId, onClose, onCheckSession }: { driverId: string; driverName: string; assignmentId: string; onClose: () => void; onCheckSession: () => Promise<boolean> }) {
  const { t, document: documentText, status: statusText } = useDriverI18n();
  const [detail, setDetail] = useState<HistoryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [remarksOpen, setRemarksOpen] = useState(false);
  const [remarksOverflow, setRemarksOverflow] = useState(false);
  const remarksRef = useRef<HTMLParagraphElement>(null);
  const [previewDoc, setPreviewDoc] = useState<{ type: string; url: string; timestamp?: string } | null>(null);

  /* A completed delivery's documents are otherwise read-only (no upload flow
     exists here at all) — this lets a driver fill in a still-missing or
     rejected document after the fact, e.g. one that failed to save earlier. */
  const historyFileRef = useRef<HTMLInputElement>(null);
  const [pendingDocType, setPendingDocType] = useState<string | null>(null);
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState('');

  const handleHistoryDocUpload = async (docType: string, file: File) => {
    setUploadError('');
    setUploadingType(docType);
    try {
      const raw = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
      });
      const compressed = await compressImage(raw);
      const ext = compressed.startsWith('data:application/pdf') ? 'pdf' : 'jpg';
      const safeDocType = docType.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const path = `docs/${assignmentId}/${safeDocType}_${Date.now()}.${ext}`;
      const fileUrl = await uploadImage(compressed, path);
      const nextDocuments = (detail?.documents ?? []).map((d) =>
        d.type === docType ? { ...d, uploaded: true, docStatus: 'pending' as DocStatus, fileUrl } : d);
      // Historical uploads are not individual notification-center action items.
      await driverUpdate(driverName, assignmentId, { documents: nextDocuments });
      setDetail((prev) => prev ? { ...prev, documents: nextDocuments } : prev);
    } catch (err) {
      if (!await onCheckSession()) return;
      console.error('[history document upload] failed:', err);
      setUploadError(t('home.saveError'));
    } finally {
      setUploadingType(null);
    }
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadDriverCompletedDelivery(driverId, assignmentId).then((result) => {
      if (alive) { setDetail(result); setLoading(false); }
    }).catch(() => {
      if (alive) { setError(t('history.loadError')); setLoading(false); }
    });
    return () => { alive = false; };
  }, [driverId, assignmentId, t]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { if (previewDoc) setPreviewDoc(null); else onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', onKey); };
  }, [onClose, previewDoc]);

  useEffect(() => {
    if (!detail?.remarks || remarksOpen || !remarksRef.current) return;
    const measure = () => setRemarksOverflow((remarksRef.current?.scrollHeight ?? 0) > (remarksRef.current?.clientHeight ?? 0) + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(remarksRef.current);
    return () => observer.disconnect();
  }, [detail, remarksOpen]);

  const docs = detail?.documents ?? [];
  const uploaded = docs.filter((doc) => doc.uploaded);
  const approved = uploaded.filter((doc) => doc.docStatus === 'approved').length;
  const docRows = uploaded.length ? [
    ...REQUIRED_DOCS.map((type) => docs.find((doc) => doc.type === type) ?? { type, uploaded: false, docStatus: 'pending' as DocStatus }),
    ...docs.filter((doc) => !REQUIRED_DOCS.includes(doc.type)),
  ] : [];
  const safeUrl = (url?: string) => url && (/^https:\/\//i.test(url) || /^data:(image\/(png|jpeg|webp)|application\/pdf);base64,/i.test(url)) ? url : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={t('history.details')}
        className="relative w-full min-w-0 max-h-[85dvh] sm:max-w-xl bg-white rounded-t-3xl sm:rounded-2xl shadow-xl flex flex-col overflow-hidden">
        <div className="w-10 h-1 rounded-full bg-gray-300 mx-auto mt-2 sm:hidden shrink-0" />
        <div className="px-4 sm:px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-foreground break-words">{detail?.truckPlate ?? t('history.pastDelivery')}</h2>
            <p className="text-xs font-mono text-gray-500 break-all">{assignmentId}</p>
            {detail && <span className="inline-block mt-2 text-xs font-bold text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-full">{t('history.completedCheck')}</span>}
          </div>
          <button type="button" onClick={onClose} aria-label={t('history.closeDetails')} className="w-11 h-11 shrink-0 flex items-center justify-center rounded-xl border border-gray-200"><X className="w-5 h-5" /></button>
        </div>
        <div className="min-w-0 overflow-y-auto overscroll-contain px-4 sm:px-6 py-4 space-y-5">
          {loading ? <p className="text-gray-500 py-8 text-center">{t('history.loading')}</p> : error ? <p className="text-red-600 py-8 text-center">{error}</p> : !detail ? (
            <p className="text-gray-500 py-8 text-center">{t('history.unavailable')}</p>
          ) : <>
            <div className="text-sm space-y-2 break-words">
              <p><span className="font-semibold text-gray-500">{t('history.route')} </span>{getAssignmentRoute(detail)}</p>
              <p><span className="font-semibold text-gray-500">{t('history.customer')} </span>{detail.company}</p>
              <p><span className="font-semibold text-gray-500">{t('history.deliveryDate')} </span>{manilaDate(detail.deliveryDate, t('common.notAvailable'))}</p>
              <p><span className="font-semibold text-gray-500">{t('history.completedAt')} </span>{manilaStamp(detail.completedAt, t('common.notAvailable'))}</p>
              {detail.remarks?.trim() && <div>
                <span className="font-semibold text-gray-500">{t('history.remarks')}</span>
                <p ref={remarksRef} className={`whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${remarksOpen ? '' : 'line-clamp-3'}`}>{detail.remarks}</p>
                {(remarksOverflow || remarksOpen) && <button type="button" onClick={() => setRemarksOpen((open) => !open)} className="min-h-11 text-green-700 font-semibold">{remarksOpen ? t('history.seeLess') : t('history.seeMore')}</button>}
              </div>}
            </div>
            <section>
              <h3 className="font-bold text-foreground">{t('history.documents')}</h3>
              <p className="text-sm text-gray-500 mt-0.5">{t('history.documentsApproved', { count: approved, total: REQUIRED_DOCS.length })}</p>
              {docRows.length ? <div className="mt-3 space-y-2">
                {docRows.map((doc) => {
                  const url = safeUrl(doc.fileUrl);
                  const status = !doc.uploaded ? t('history.awaitingUpload') : statusText(doc.docStatus);
                  const color = !doc.uploaded ? statusColors['Awaiting Documents'].badge
                    : doc.docStatus === 'approved' ? statusColors.Completed.badge
                    : doc.docStatus === 'rejected' ? statusColors['Needs Correction'].badge
                    : statusColors['Under Review'].badge;
                  return <div key={doc.type} className="min-w-0 flex items-center gap-3 rounded-xl border border-gray-200 p-3">
                    <FileText className="w-5 h-5 text-gray-400 shrink-0" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground break-words">{documentText(doc.type)}</p>
                      <span className={`inline-block text-xs rounded-full px-2 py-0.5 ${color}`}>{status}</span>
                      {doc.uploaded && <p className="text-xs text-gray-500">{'uploadedAt' in doc && typeof doc.uploadedAt === 'string' ? manilaStamp(doc.uploadedAt, t('common.notAvailable')) : t('history.uploadTimeUnavailable')}</p>}
                    </div>
                    {url && <button type="button" onClick={() => setPreviewDoc({
                      type: doc.type, url,
                      timestamp: 'uploadedAt' in doc && typeof doc.uploadedAt === 'string' ? doc.uploadedAt : undefined,
                    })} className="shrink-0 min-h-11 px-3 flex items-center text-sm font-semibold text-green-700 focus-visible:outline-2 focus-visible:outline-green-700">{t('common.view')}</button>}
                    {(!doc.uploaded || doc.docStatus === 'rejected') && (
                      <button type="button" disabled={uploadingType === doc.type}
                        onClick={() => { setPendingDocType(doc.type); historyFileRef.current?.click(); }}
                        className="shrink-0 min-h-11 px-3 flex items-center text-sm font-semibold text-green-700 disabled:opacity-50">
                        {uploadingType === doc.type ? t('history.uploading') : t('history.upload')}
                      </button>
                    )}
                  </div>;
                })}
              </div> : <p className="text-sm text-gray-500 mt-3">{t('history.noDocuments')}</p>}
              {uploadError && <p className="text-sm text-red-600 mt-2">{uploadError}</p>}
              <input ref={historyFileRef} type="file" accept="image/*,application/pdf" className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f && pendingDocType) handleHistoryDocUpload(pendingDocType, f);
                  e.target.value = '';
                }} />
            </section>
          </>}
        </div>
      </div>
      {previewDoc && <UploadedFilePreviewModal key={`${previewDoc.type}:${previewDoc.url}`}
        url={previewDoc.url} title={documentText(previewDoc.type)} kind="document"
        timestamp={previewDoc.timestamp} assignmentId={assignmentId} onClose={() => setPreviewDoc(null)}
        labels={{
          close: t('history.closePreview'), dateUnavailable: t('history.previewDateUnavailable'),
          download: t('history.downloadFile'), downloading: t('history.downloadingFile'),
          downloadError: t('history.downloadError'), previewUnavailable: t('history.previewUnavailable'),
          zoomIn: t('history.zoomIn'), zoomOut: t('history.zoomOut'), fit: t('history.fitImage'),
        }} />}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ════════════════════════════════════════════════════════════ */
interface Props { driverId: string; driverName: string; onLogout: () => void; onCheckSession: () => Promise<boolean>; }

export default function DriverInterface(props: Props) {
  return <DriverLanguageProvider key={props.driverId} driverId={props.driverId}><DriverInterfaceContent {...props} /></DriverLanguageProvider>;
}

function DriverInterfaceContent({ driverId, driverName, onLogout, onCheckSession }: Props) {
  const { t, status: statusText, document: documentText, reason: reasonText, language, setLanguage } = useDriverI18n();
  const soundAccount = `driver:${driverId}`;
  const [soundEnabled, setSoundEnabled] = useState(() => notificationSoundEnabled(soundAccount));
  const updateSoundEnabled = (enabled: boolean) => {
    setSoundEnabled(enabled);
    setNotificationSoundEnabled(soundAccount, enabled);
  };
  /* ── Server state ── */
  const [data,     setData]     = useState<DriverData | null>(null);
  const [online,   setOnline]   = useState(true);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [syncing,  setSyncing]  = useState(false);
  const [updating, setUpdating] = useState(false);
  /* Shown when a write failed. Separate from `online`: the "Offline" banner says the
     connection dropped, this says a specific change of theirs did not save. */
  const [actionError, setActionError] = useState('');
  const [timingNow, setTimingNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setTimingNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  /* ── Main screen state ── */
  /* Persisted the same way admin's activeNav is — otherwise a refresh while
     viewing the task screen silently drops the driver back to Dashboard. */
  const [screen, setScreen] = useState<'dashboard' | 'task' | 'history'>(() => {
    const saved = localStorage.getItem('360_driver_screen');
    return saved === 'task' ? 'task' : 'dashboard';
  });

  useEffect(() => {
    localStorage.setItem('360_driver_screen', screen);
  }, [screen]);

  /* ── Overlay sheet state ── */
  const [photoTarget,  setPhotoTarget]  = useState<TaskStatus | null>(null);
  const [operationalPhotoTarget, setOperationalPhotoTarget] = useState<OperationalPhotoKey | null>(null);
  const [delaySheet,   setDelaySheet]   = useState<'pickup' | 'delivery' | null>(null);
  /* Optional note at Loading/Unloading finish — sent once with finish_loading/
     finish_unloading, write-once server-side. Reset whenever the active
     assignment changes so a stale draft never carries into a different task. */
  const [stageRemark, setStageRemark] = useState('');
  const [issueSheet,   setIssueSheet]   = useState(false);
  const [logoutDlg,    setLogoutDlg]    = useState(false);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const [historyHighlightId, setHistoryHighlightId] = useState<string | null>(null);
  const [completionNotice, setCompletionNotice] = useState<CompletedHistoryItem | null>(null);
  const [notificationPage, setNotificationPage] = useState(1);
  const [activeDrawer, setActiveDrawer] = useState<'notifications' | 'menu' | 'language' | null>(null);
  const [languageNotice, setLanguageNotice] = useState<DriverLanguage | null>(null);
  const [statusNotice, setStatusNotice] = useState<TaskStatus | null>(null);
  const [focusedDocType, setFocusedDocType] = useState<string | null>(null);
  const taskScrollRef = useRef<HTMLDivElement>(null);
  const taskHeaderRef = useRef<HTMLElement>(null);
  const stickyActionRef = useRef<HTMLDivElement>(null);
  const photoHighlightTimer = useRef<number | null>(null);
  const scrollHideTimer = useRef<number | null>(null);
  const [highlightPhotoKey, setHighlightPhotoKey] = useState<OperationalPhotoKey | null>(null);
  const [highlightDocuments, setHighlightDocuments] = useState(false);
  const [autoGuide, setAutoGuide] = useState<{ assignmentId: string; phase: DriverPhase; target: OperationalPhotoKey | 'documents' } | null>(null);
  const autoScrollRef = useRef<{ scroller: HTMLElement | Window; timer: number } | null>(null);
  const [scrollTopVisible, setScrollTopVisible] = useState(false);
  const [stickyActionHeight, setStickyActionHeight] = useState(0);
  const completionSnapshot = useRef<DriverCompletionSnapshot | null>(null);
  const reviewNotificationSnapshot = useRef<{ assignmentId: string | null; ids: Set<string> } | null>(null);
  const issueSnapshot = useRef<{ assignmentId: string | null; open: boolean } | null>(null);
  const issueSubmitting = useRef(false);
  const [issueResolvedNotice, setIssueResolvedNotice] = useState(false);
  const fetchSequence = useRef(0);
  const appliedFetchSequence = useRef(0);
  const sessionActiveRef = useRef(true);
  useEffect(() => {
    sessionActiveRef.current = true;
    return () => { sessionActiveRef.current = false; fetchSequence.current += 1; };
  }, []);
  const closeHistoryDetail = useCallback(() => setSelectedHistoryId(null), []);
  const closeDrawer = useCallback(() => setActiveDrawer(null), []);

  const scrollToRequirement = useCallback((targetKey: OperationalPhotoKey | 'documents', section = false) => {
    const content = taskScrollRef.current;
    if (!content) return false;
    const target = targetKey === 'documents' ? content.querySelector<HTMLElement>('#driver-required-documents')
      : content.querySelector<HTMLElement>(section
        ? `[data-driver-photo-section="${targetKey}"]` : `[data-driver-photo-key="${targetKey}"]`);
    if (!target) return false;
    const scroller = content.scrollHeight > content.clientHeight + 1 ? content : window;
    const rect = target.getBoundingClientRect();
    const visual = window.visualViewport;
    const visibleTop = Math.max(taskHeaderRef.current?.getBoundingClientRect().bottom ?? 0, visual?.offsetTop ?? 0) + 12;
    const visibleBottom = (visual ? visual.offsetTop + visual.height : window.innerHeight) - (stickyActionRef.current?.getBoundingClientRect().height ?? 0) - 12;
    const delta = section || targetKey === 'documents' ? rect.top - visibleTop
      : rect.top < visibleTop || rect.bottom > visibleBottom
        ? (rect.top + rect.bottom) / 2 - (visibleTop + visibleBottom) / 2 : 0;
    if (Math.abs(delta) > 8) {
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      scroller.scrollBy({ top: delta, behavior: reducedMotion ? 'instant' : 'smooth' });
      if (autoScrollRef.current) window.clearTimeout(autoScrollRef.current.timer);
      autoScrollRef.current = { scroller, timer: window.setTimeout(() => { autoScrollRef.current = null; }, reducedMotion ? 0 : 900) };
    }
    setHighlightPhotoKey(targetKey === 'documents' ? null : targetKey);
    setHighlightDocuments(targetKey === 'documents');
    if (photoHighlightTimer.current) window.clearTimeout(photoHighlightTimer.current);
    photoHighlightTimer.current = window.setTimeout(() => {
      setHighlightPhotoKey(null);
      setHighlightDocuments(false);
    }, 1800);
    return true;
  }, []);

  const scrollToPhoto = useCallback((key: OperationalPhotoKey, section = false) => {
    scrollToRequirement(key, section);
  }, [scrollToRequirement]);

  useEffect(() => () => {
    if (photoHighlightTimer.current) window.clearTimeout(photoHighlightTimer.current);
    if (scrollHideTimer.current) window.clearTimeout(scrollHideTimer.current);
    if (autoScrollRef.current) window.clearTimeout(autoScrollRef.current.timer);
  }, []);

  useEffect(() => {
    setAutoGuide(null);
    setHighlightPhotoKey(null);
    setHighlightDocuments(false);
  }, [driverId, data?.assignment?.id]);

  useEffect(() => {
    if (screen !== 'task') { setScrollTopVisible(false); return; }
    const content = taskScrollRef.current;
    if (!content) return;
    const onScroll = () => {
      const position = Math.max(content.scrollTop, window.scrollY);
      setScrollTopVisible(position > 400);
      if (scrollHideTimer.current) window.clearTimeout(scrollHideTimer.current);
      if (position > 400) scrollHideTimer.current = window.setTimeout(() => setScrollTopVisible(false), 3000);
    };
    content.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      content.removeEventListener('scroll', onScroll);
      window.removeEventListener('scroll', onScroll);
      if (scrollHideTimer.current) window.clearTimeout(scrollHideTimer.current);
    };
  }, [screen, data?.assignment?.id]);

  useEffect(() => { setStageRemark(''); }, [data?.assignment?.id]);

  useEffect(() => {
    const action = stickyActionRef.current;
    if (!action || screen !== 'task') { setStickyActionHeight(0); return; }
    const observer = new ResizeObserver(() => setStickyActionHeight(action.getBoundingClientRect().height));
    observer.observe(action);
    setStickyActionHeight(action.getBoundingClientRect().height);
    return () => observer.disconnect();
  }, [screen, data?.assignment?.id, data?.assignment?.taskStatus, data?.assignment?.operationalStage]);

  useEffect(() => {
    if (screen !== 'history' || !historyHighlightId) return;
    const frame = window.requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>('[data-history-target="true"]');
      row?.scrollIntoView({ block: 'center' });
      row?.focus({ preventScroll: true });
    });
    const timer = window.setTimeout(() => setHistoryHighlightId(null), 2500);
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(timer); };
  }, [screen, historyHighlightId, historyPage]);

  const openCompletedHistory = (item: CompletedHistoryItem) => {
    const index = data?.completedHistory?.findIndex(delivery => delivery.id === item.id) ?? -1;
    setCompletionNotice(null);
    setHistorySearch('');
    setHistoryPage(index >= 0 ? Math.floor(index / 8) + 1 : 1);
    setHistoryHighlightId(item.id);
    setActiveDrawer(null);
    setScreen('history');
  };

  useEffect(() => {
    if (!languageNotice) return;
    const timer = window.setTimeout(() => setLanguageNotice(null), 1800);
    return () => window.clearTimeout(timer);
  }, [languageNotice]);

  useEffect(() => {
    if (!statusNotice) return;
    const timer = window.setTimeout(() => setStatusNotice(null), 1800);
    return () => window.clearTimeout(timer);
  }, [statusNotice]);

  const selectLanguage = (next: DriverLanguage) => {
    if (next !== language) {
      setLanguage(next);
      setLanguageNotice(next);
    }
    setActiveDrawer('menu');
  };

  useEffect(() => {
    if (!focusedDocType || screen !== 'task') return;
    const timer = window.setTimeout(() => setFocusedDocType(null), 3000);
    return () => window.clearTimeout(timer);
  }, [focusedDocType, screen]);

  /* Per-document "please retake, this looks blurry" message — keyed by doc
     type since more than one document row can exist at once. */
  const [docBlurErrors, setDocBlurErrors] = useState<Record<string, boolean>>({});

  /* ── Delay gate local flags ── */
  const [pickupDelayDone,   setPickupDelayDone]   = useState(false);
  const [deliveryDelayDone, setDeliveryDelayDone] = useState(false);

  /* ── Fetch data ── */
  const fetchData = useCallback(async (quiet = false) => {
    if (!driverId || !sessionActiveRef.current) return;
    const sequence = ++fetchSequence.current;
    if (!quiet) setSyncing(true);
    try {
      if (!await onCheckSession() || !sessionActiveRef.current) return;
      /* Reads only this driver's own rows — the database's row-level security enforces that. */
      const json = await loadDriverData(driverId);
      if (!sessionActiveRef.current || sequence !== fetchSequence.current) return;
      appliedFetchSequence.current = sequence;
      const observation = observeDriverCompletion(completionSnapshot.current,
        json.assignment?.id ?? null, json.completedHistory ?? []);
      completionSnapshot.current = observation.snapshot;
      if (observation.newlyCompleted) {
        setCompletionNotice(observation.newlyCompleted);
        setScreen('dashboard');
      }
      // The Driver bell is derived from persisted document review states, rather than
      // notification rows. Compare its stable assignment/document/status keys after the
      // first successful fetch; a later review change can chime once for this poll.
      const assignmentId = json.assignment?.id ?? null;
      const reviewIds = new Set((json.assignment?.documents ?? [])
        .filter(doc => doc.uploaded && (doc.docStatus === 'approved' || doc.docStatus === 'rejected'))
        .map(doc => `${assignmentId}:${doc.type}:${doc.docStatus}`));
      const previousReviews = reviewNotificationSnapshot.current;
      if (previousReviews?.assignmentId === assignmentId &&
          newNotificationIds(previousReviews.ids, reviewIds).size > 0 && soundEnabled) {
        void playNotificationSound();
      }
      reviewNotificationSnapshot.current = { assignmentId, ids: reviewIds };
      const openIssue = !!json.assignment && hasOpenBlockingIssue(json.assignment);
      const previousIssue = issueSnapshot.current;
      if (previousIssue?.assignmentId === assignmentId && previousIssue.open && !openIssue
          && json.assignment && json.assignment.taskStatus !== 'Cancelled'
          && json.assignment.taskStatus !== 'Failed / Issue') setIssueResolvedNotice(true);
      if (openIssue || previousIssue?.assignmentId !== assignmentId) setIssueResolvedNotice(false);
      issueSnapshot.current = { assignmentId, open: openIssue };
      setData(json); setOnline(true); setLastSync(new Date());
    } catch (err) {
      if (!sessionActiveRef.current || sequence !== fetchSequence.current) return;
      if (!await onCheckSession() || !sessionActiveRef.current) return;
      appliedFetchSequence.current = sequence;
      console.error('[loadDriverData] error:', err);
      /* Do NOT auto-fill fake demo data here — leave `data` untouched so a
         first-load failure correctly falls through to the "No Connection"
         screen (which offers demo data only as an explicit, labeled choice),
         and a later poll failure correctly keeps showing the driver's real
         last-fetched assignment with the "Offline" banner instead of
         silently swapping in a fabricated one. */
      setOnline(false);
    } finally { if (sessionActiveRef.current && sequence >= appliedFetchSequence.current) setSyncing(false); }
  }, [driverId, onCheckSession, soundEnabled]);

  useEffect(() => {
    fetchData();
    const id = setInterval(() => fetchData(true), 5000);
    return () => clearInterval(id);
  }, [fetchData]);

  /* ── Push update ── */
  const pushUpdate = async (updates: Partial<Assignment>, notif?: Record<string, unknown>): Promise<boolean> => {
    const a = data?.assignment;
    if (!a) return false;
    if (!online) { setActionError(t('home.saveError')); return false; }
    setUpdating(true);
    try {
      /* The database triggers only let a driver change status / photos / delay reports / new document
         files (an approved document can't be re-approved or flipped by the driver). */
      await driverUpdate(driverName, a.id, updates);
      if (!sessionActiveRef.current) return false;
      // Show the new state only after the primary write has succeeded.
      setData((prev) => prev?.assignment?.id === a.id
        ? { ...prev, assignment: { ...prev.assignment, ...updates } } : prev);
      if (notif) {
        try { await driverUpdate(driverName, a.id, {}, notif); }
        catch (err) { console.warn('[driverUpdate] notification failed after save:', err); }
      }
      await fetchData(true);
      if (!sessionActiveRef.current) return false;
      setActionError('');
      return true;
    } catch (err) {
      if (!await onCheckSession() || !sessionActiveRef.current) return false;
      console.error('[driverUpdate] error:', err);
      setActionError(t('home.saveError'));
      return false;
    }
    finally { setUpdating(false); }
  };

  const notifyMilestone = async (assignment: Assignment, event: keyof typeof MILESTONE_NOTIFICATIONS) => {
    const milestone = MILESTONE_NOTIFICATIONS[event];
    const message = milestone.message === 'arrived at pickup' || milestone.message === 'started the trip'
      || milestone.message === 'arrived at destination'
      ? `${driverName} ${milestone.message}` : milestone.message;
    try {
      await driverUpdate(driverName, assignment.id, {}, {
        id: `assignment-${assignment.id}-${milestone.activityKey}`,
        type: 'status_update', message: `[${assignment.truckPlate}] ${message}`,
        truckPlate: assignment.truckPlate, statusUpdate: milestone.activityKey, navigateTo: 'Monitor',
      });
    } catch (error) { console.warn('[driver workflow] status saved, notification failed:', error); }
  };

  /* ── Auto-acknowledge: mark the moment this assignment first appears on the
     driver's dashboard, so admin can tell a driver actually saw the task. ── */
  useEffect(() => {
    const a = data?.assignment;
    if (!a || a.driverAcknowledgedAt) return;
    pushUpdate({ driverAcknowledgedAt: new Date().toISOString() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.assignment?.id, data?.assignment?.driverAcknowledgedAt]);

  /* ── Handlers ── */
  const handlePhotoConfirmed = async (photo: StatusPhoto, source: 'camera' | 'gallery') => {
    if (!photoTarget || !data?.assignment) return;
    const status = photoTarget;
    const assignment = data.assignment;
    const path      = `photos/${assignment.id}/${status.replace(/[\s/]+/g, '_')}_${Date.now()}.jpg`;
    if (!online) throw new Error('Cannot save a status photo while offline.');
    setUpdating(true);
    try {
      // Every operational status requires a real Storage upload before its status changes.
      const storedUrl = await uploadImage(photo.url, path);
      if (!sessionActiveRef.current) return;
      const stored = savedPhotoMetadata(photo, source, storedUrl, new Date().toISOString());
      const updates = { taskStatus: status, statusPhotos: { ...(assignment.statusPhotos ?? {}), [status]: stored } };
      await driverUpdate(driverName, assignment.id, updates);
      if (!sessionActiveRef.current) return;
      setData((prev) => prev?.assignment?.id === assignment.id
        ? { ...prev, assignment: { ...prev.assignment, ...updates } } : prev);
      setActionError('');
      setPhotoTarget(null);
      setStatusNotice(status);
      const legacyMilestone = status === 'Picked Up' ? 'arrive_pickup'
        : status === 'In Transit' ? 'depart' : status === 'Delivered' ? 'delivered' : null;
      if (legacyMilestone) await notifyMilestone(assignment, legacyMilestone);
      else {
        // Keep existing notifications for other legacy status-photo transitions.
        try {
          await driverUpdate(driverName, assignment.id, {}, {
            type: 'status_update', message: `[${assignment.truckPlate}] Marked as ${status}`,
            truckPlate: assignment.truckPlate, statusUpdate: status, navigateTo: 'Monitor',
          });
        } catch (error) { console.warn('[driver workflow] status saved, notification failed:', error); }
      }
      await fetchData(true);
    } catch (err) {
      if (!await onCheckSession() || !sessionActiveRef.current) throw err;
      setActionError(t('home.saveError'));
      throw err;
    } finally {
      setUpdating(false);
    }
  };

  const handleOperationalPhotoConfirmed = async (photo: StatusPhoto, source: 'camera' | 'gallery') => {
    const assignment = data?.assignment;
    const category = operationalPhotoTarget;
    if (!assignment || !category) return;
    if (!online) throw new Error(t('workflow.noConnection'));
    setUpdating(true);
    try {
      const pickupGroupCompleted = getDriverPhase(assignment) === 'pickup'
        && completedPhotoGroup(OPERATIONAL_PHOTOS.pickup, assignment.statusPhotos, category)
        && !assignment.statusPhotos?.loading_before?.url;
      const url = await uploadImage(photo.url, `photos/${assignment.id}/${category}_${Date.now()}.jpg`);
      if (!sessionActiveRef.current) return;
      const stored = savedPhotoMetadata(photo, source, url, new Date().toISOString());
      await driverUpdate(driverName, assignment.id, { statusPhotos: { [category]: stored } });
      if (!sessionActiveRef.current) return;
      // The slot counts only after Storage and its status_photos row both saved.
      setData((previous) => previous?.assignment?.id === assignment.id
        ? { ...previous, assignment: { ...previous.assignment,
            statusPhotos: { ...previous.assignment.statusPhotos, [category]: stored } } }
        : previous);
      setOperationalPhotoTarget(null);
      setActionError('');
      await fetchData(true);
      if (pickupGroupCompleted && sessionActiveRef.current) {
        setAutoGuide({ assignmentId: assignment.id, phase: 'pickup', target: 'loading_before' });
      }
    } catch (error) {
      if (!await onCheckSession() || !sessionActiveRef.current) throw error;
      console.error('[operational photo] save failed:', error);
      setActionError(t('workflow.photoFailed'));
      throw error;
    } finally { setUpdating(false); }
  };

  const handleOperationalSlide = async (): Promise<false | (() => void)> => {
    const assignment = data?.assignment;
    if (!assignment) return false;
    if (hasOpenBlockingIssue(assignment)) return false;
    if (!online) { setActionError(t('workflow.noConnection')); return false; }
    const phase = getDriverPhase(assignment);
    const transitions: Partial<Record<DriverPhase, string>> = {
      assigned: 'arrive_pickup', pickup: 'start_loading', loading: 'finish_loading',
      pretrip: 'depart', in_transit: 'arrive_destination',
      arrived: 'start_unloading', unloading: 'finish_unloading',
    };
    const transition = transitions[phase];
    const actions: Partial<Record<DriverPhase, Parameters<typeof t>[0]>> = {
      assigned: 'workflow.arrivePickup', pickup: 'workflow.startLoading',
      loading: 'workflow.finishLoading', pretrip: 'workflow.startTrip',
      trip_pending: 'workflow.finishTripSync', in_transit: 'workflow.arriveDestination',
      arrived: 'workflow.startUnloading', unloading: 'workflow.finishUnloading',
      delivery_pending: 'workflow.finishDeliverySync',
    };
    const actionKey = actions[phase];
    if (!actionKey) return false;
    setUpdating(true);
    try {
      if (transition) {
        const remark = transition === 'finish_loading' || transition === 'finish_unloading' ? stageRemark : undefined;
        await advanceDriverStage(assignment.id, transition, remark);
        if (!sessionActiveRef.current) return false;
        // Clear it now, not just on assignment change — otherwise a leftover Loading
        // note would silently pre-fill the Unloading box much later in the same task.
        if (remark !== undefined) setStageRemark('');
        if (transition in MILESTONE_NOTIFICATIONS && transition !== 'depart') {
          await notifyMilestone(assignment, transition as keyof typeof MILESTONE_NOTIFICATIONS);
          if (!sessionActiveRef.current) return false;
        }
      }
      // REQ-002 deliberately leaves these two physical task_status changes on
      // the existing driver update path. A failed second write is recoverable
      // from the persisted departed/unloaded stage after a refresh.
      const status = phase === 'pretrip' || phase === 'trip_pending' ? 'In Transit'
        : phase === 'unloading' || phase === 'delivery_pending' ? 'Delivered' : null;
      if (status) {
        await driverUpdate(driverName, assignment.id, { taskStatus: status });
        if (!sessionActiveRef.current) return false;
        await notifyMilestone(assignment, status === 'Delivered' ? 'delivered' : 'depart');
        if (!sessionActiveRef.current) return false;
      }
      const fresh = await loadDriverData(driverId);
      if (!sessionActiveRef.current) return false;
      setActionError('');
      // Let the shared slider show its short success state before changing screens.
      return () => {
        if (!sessionActiveRef.current) return;
        setData(fresh);
        if (fresh.assignment?.id !== assignment.id) return;
        const confirmedPhase = getDriverPhase(fresh.assignment);
        if (confirmedPhase === phase) return;
        const target = getNextRequiredAction(confirmedPhase, fresh.assignment.statusPhotos,
          fresh.assignment.documents, REQUIRED_DOCS) as OperationalPhotoKey | 'documents' | null;
        if (target) setAutoGuide({ assignmentId: assignment.id, phase: confirmedPhase, target });
      };
    } catch (error) {
      if (!await onCheckSession() || !sessionActiveRef.current) return false;
      console.error('[driver workflow] transition failed:', error);
      try {
        const latest = await loadDriverData(driverId);
        if (sessionActiveRef.current) setData(latest);
      } catch { /* Keep last confirmed view. */ }
      if (!sessionActiveRef.current) return false;
      const message = error instanceof Error ? error.message : '';
      setActionError(message.includes('missing_required_photo') ? t('workflow.completeFour')
        : message.includes('wrong_stage') ? t('workflow.changedElsewhere')
          : t('workflow.transitionFailed', { action: t(actionKey) }));
      return false;
    } finally { setUpdating(false); }
  };

  const handleDelaySubmit = async (type: 'pickup' | 'delivery', reason: string) => {
    if (!data?.assignment) return;
    setDelaySheet(null);
    const reportedAt = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const saved = await pushUpdate(
      { delayReports: [...(data.assignment.delayReports ?? []), { type, reason, reportedAt }] },
      { type: 'delay_report', message: `[${data.assignment.truckPlate}] ${type === 'pickup' ? 'Pickup' : 'Delivery'} delay: ${reason}`, assignmentId: data.assignment.id, truckPlate: data.assignment.truckPlate, reason, navigateTo: 'Monitor' }
    );
    if (saved) {
      if (type === 'pickup') setPickupDelayDone(true); else setDeliveryDelayDone(true);
    }
  };

  const handleIssueSubmit = async (reason: string) => {
    if (!data?.assignment || hasOpenBlockingIssue(data.assignment) || issueSubmitting.current) return;
    const assignment = data.assignment;
    if (!online) { setActionError(t('home.saveError')); return; }
    // The canned reasons double as their own server-side type; anything else came
    // from the sheet's free-text "Other..." field (see ReasonSheet — it only ever
    // hands back one string, never which branch was taken).
    const issueType = (BLOCKING_ISSUE_REASONS as readonly string[]).includes(reason) ? reason : 'Other...';
    issueSubmitting.current = true;
    setIssueSheet(false);
    setUpdating(true);
    try {
      await reportAssignmentIssue(assignment.id, issueType, reason, `issue-${assignment.id}-${Date.now()}`);
      if (!sessionActiveRef.current) return;
      await fetchData(true);
      if (!sessionActiveRef.current) return;
      setActionError('');
    } catch (err) {
      if (!await onCheckSession() || !sessionActiveRef.current) return;
      console.error('[reportAssignmentIssue] error:', err);
      setActionError(t('home.saveError'));
    } finally {
      issueSubmitting.current = false;
      setUpdating(false);
    }
  };

  const handleDocUpload = async (docType: string, file: File) => {
    if (!data?.assignment) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        if (!online) throw new Error('Cannot upload a document while offline.');
        const raw = reader.result as string;

        /* Only photos can be blurry — PDFs (documents also accept those) skip
           the check entirely. */
        if (file.type.startsWith('image/') && await isBlurryImage(raw)) {
          setDocBlurErrors((p) => ({ ...p, [docType]: true }));
          return;
        }
        setDocBlurErrors((p) => { const { [docType]: _drop, ...rest } = p; return rest; });

        const compressed = await compressImage(raw);
        /* compressImage() only transforms real images; a PDF data URL fails to
           decode as an <img> and passes through unchanged, so this still says
           application/pdf here — use that to store it under the right extension. */
        const ext = compressed.startsWith('data:application/pdf') ? 'pdf' : 'jpg';
        /* Replace every character that isn't a letter/digit, not just whitespace —
           "Waybill / Delivery Receipt" has a literal '/' that previously survived
           into the Storage path and broke it (Storage rejected the resulting key). */
        const safeDocType = docType.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        const path = `docs/${data.assignment!.id}/${safeDocType}_${Date.now()}.${ext}`;
        const fileUrl = await uploadImage(compressed, path);
        if (!sessionActiveRef.current) return;
        const assignment = data.assignment!;
        const corrected = assignment.documents.some((doc) => doc.type === docType && doc.docStatus === 'rejected');
        const uploadedDocument = { type: docType, uploaded: true, docStatus: 'pending' as DocStatus, fileUrl };
        const documents = assignment.documents.some((doc) => doc.type === docType)
          ? assignment.documents.map((doc) => doc.type === docType ? { ...doc, ...uploadedDocument } : doc)
          : [...assignment.documents, uploadedDocument];
        const readyBefore = getAssignmentDisplayStatus(assignment) === 'Under Review';
        const readyAfter = getAssignmentDisplayStatus({ ...assignment, documents }) === 'Under Review';
        const requiredCount = getAssignmentDocumentProgress({ ...assignment, documents }).required;
        const notification = corrected ? {
          type: 'doc_upload', message: `[${assignment.truckPlate}] Corrected ${docType} uploaded`,
          truckPlate: assignment.truckPlate, docType, navigateTo: 'Monitor',
        } : !readyBefore && readyAfter ? {
          id: `assignment-${assignment.id}-documents-ready`, type: 'doc_upload',
          message: `[${assignment.truckPlate}] Documents ready for review · ${requiredCount} documents uploaded`,
          truckPlate: assignment.truckPlate, navigateTo: 'Monitor',
        } : undefined;
        await pushUpdate({ documents }, notification);
      } catch (err) {
        if (!await onCheckSession() || !sessionActiveRef.current) return;
        console.error('[document upload] save failed:', err);
        setActionError(t('home.saveError'));
      }
    };
    reader.onerror = () => { if (sessionActiveRef.current) setActionError(t('home.saveError')); };
    reader.readAsDataURL(file);
  };

  /* ── Derived values ── */
  const a           = data?.assignment ?? null;
  const phase       = a && a.taskStatus !== 'Failed / Issue' && a.taskStatus !== 'Cancelled'
    ? getDriverPhase(a) : null;
  const isDelivered = a?.taskStatus === 'Delivered';
  const isFailed    = a?.taskStatus === 'Failed / Issue';
  const isCancelled = a?.taskStatus === 'Cancelled';
  const issueOpen = !!a && hasOpenBlockingIssue(a);
  const isTerminal  = isDelivered || isFailed || isCancelled;
  const deliveryTiming = a ? getDeliveryTimingStatus(a, timingNow) : null;
  const displayStatus = a ? getAssignmentDisplayStatus(a) : null;
  const documentProgress = a ? getAssignmentDocumentProgress(a) : null;
  const allDocsApproved = documentProgress?.allApproved ?? false;
  const documentAge = a ? getDocumentAgingState(a, timingNow) : null;
  const documentAgeText = documentAge?.days == null ? null : documentAge.days === 0
    ? t('home.deliveredToday') : t(documentAge.days === 1 ? 'home.oneDaySinceDelivery' : 'home.daysSinceDelivery', { count: documentAge.days });
  const postDelivery = isDelivered || displayStatus === 'Awaiting Documents' || displayStatus === 'Under Review'
    || displayStatus === 'Needs Correction' || displayStatus === 'Completed';

  // Only explicit successful actions queue guidance. Polling and refreshes never do.
  useEffect(() => {
    if (!autoGuide) return;
    if (screen !== 'task' || a?.id !== autoGuide.assignmentId || phase !== autoGuide.phase) {
      setAutoGuide(null);
      return;
    }
    if (photoTarget || operationalPhotoTarget || delaySheet || issueSheet || logoutDlg
      || selectedHistoryId || completionNotice || activeDrawer || languageNotice || statusNotice) {
      setAutoGuide(null);
      return;
    }
    const actualTarget = getNextRequiredAction(phase, a.statusPhotos, a.documents, REQUIRED_DOCS);
    if (actualTarget !== autoGuide.target) {
      setAutoGuide(null);
      return;
    }
    // The stage-specific section is rendered in the same commit as the fresh assignment.
    // A frame lets layout settle before measuring its visible area.
    const frame = window.requestAnimationFrame(() => {
      const section = autoGuide.target !== 'documents'
        && (autoGuide.target === 'pickup_front' || autoGuide.target === 'pretrip_front');
      scrollToRequirement(autoGuide.target, section);
      setAutoGuide(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [autoGuide, screen, a, phase, photoTarget, operationalPhotoTarget, delaySheet, issueSheet,
    logoutDlg, selectedHistoryId, completionNotice, activeDrawer, languageNotice, statusNotice, scrollToRequirement]);

  useEffect(() => {
    if (screen !== 'task') return;
    const stopAutomaticNavigation = () => {
      setAutoGuide(null);
      const current = autoScrollRef.current;
      if (!current) return;
      window.clearTimeout(current.timer);
      const scroller = current.scroller;
      scroller.scrollTo({ top: scroller instanceof Window ? scroller.scrollY : scroller.scrollTop, behavior: 'instant' });
      autoScrollRef.current = null;
    };
    window.addEventListener('wheel', stopAutomaticNavigation, { passive: true });
    window.addEventListener('touchstart', stopAutomaticNavigation, { passive: true });
    window.addEventListener('pointerdown', stopAutomaticNavigation, { passive: true });
    window.addEventListener('keydown', stopAutomaticNavigation);
    return () => {
      window.removeEventListener('wheel', stopAutomaticNavigation);
      window.removeEventListener('touchstart', stopAutomaticNavigation);
      window.removeEventListener('pointerdown', stopAutomaticNavigation);
      window.removeEventListener('keydown', stopAutomaticNavigation);
    };
  }, [screen]);

  useEffect(() => {
    if (screen === 'task' && !photoTarget && !operationalPhotoTarget && !delaySheet
      && !issueSheet && !logoutDlg && !selectedHistoryId && !completionNotice
      && !activeDrawer && !languageNotice && !statusNotice) return;
    setAutoGuide(null);
    const current = autoScrollRef.current;
    if (current) {
      window.clearTimeout(current.timer);
      const scroller = current.scroller;
      scroller.scrollTo({ top: scroller instanceof Window ? scroller.scrollY : scroller.scrollTop, behavior: 'instant' });
      autoScrollRef.current = null;
    }
  }, [screen, photoTarget, operationalPhotoTarget, delaySheet, issueSheet, logoutDlg,
    selectedHistoryId, completionNotice, activeDrawer, languageNotice, statusNotice]);

  /* Normalized docs (all 6 required, merged with actual data) */
  const normalizedDocs: NormDoc[] = useMemo(() => {
    if (!a) return [];
    return REQUIRED_DOCS.map((type) => {
      const found = a.documents?.find((d) => d.type === type);
      return found ?? { type, uploaded: false, docStatus: 'pending' as DocStatus };
    });
  }, [a]);

  const uploadedCt = normalizedDocs.filter((d) => d.uploaded).length;
  const approvedCt = normalizedDocs.filter((d) => d.docStatus === 'approved' && d.uploaded).length;

  /* Current document review summaries are useful shortcuts, but they are not
     persisted Driver notification records and have no read state. */
  const driverNotifs = useMemo((): DriverNotif[] => {
    const notifs: DriverNotif[] = [];
    normalizedDocs.forEach((doc) => {
      if (doc.uploaded && doc.docStatus === 'rejected') {
        notifs.push({
          id: `reject-${doc.type}`, type: 'rejection', docType: doc.type,
          title: t('notifications.rejectedTitle', { document: documentText(doc.type) }),
          body: doc.rejectReason
            ? t('notifications.rejectedReason', { reason: doc.rejectReason })
            : t('notifications.rejectedNoReason'),
        });
      }
    });
    normalizedDocs.forEach((doc) => {
      if (doc.uploaded && doc.docStatus === 'approved') {
        notifs.push({
          id: `approve-${doc.type}`, type: 'approval', docType: doc.type,
          title: t('notifications.approvedTitle', { document: documentText(doc.type) }),
          body: t('notifications.approvedBody'),
        });
      }
    });
    return notifs;
  }, [normalizedDocs, t, documentText]);

  const completedHistory = data?.completedHistory ?? [];
  const filteredHistory = completedHistory.filter((item) =>
    `${item.truckPlate} ${item.company}`.toLowerCase().includes(historySearch.trim().toLowerCase()));
  const historyPages = Math.max(1, Math.ceil(filteredHistory.length / 8));
  const shownHistoryPage = Math.min(historyPage, historyPages);
  const historyRows = filteredHistory.slice((shownHistoryPage - 1) * 8, shownHistoryPage * 8);
  const notificationPages = Math.max(1, Math.ceil(driverNotifs.length / 8));
  const shownNotificationPage = Math.min(notificationPage, notificationPages);
  const notificationRows = driverNotifs.slice((shownNotificationPage - 1) * 8, shownNotificationPage * 8);
  const rejectedNotifs = driverNotifs.filter((notification) => notification.type === 'rejection');
  const openDocumentFromNotification = (docType: string) => {
    setActiveDrawer(null);
    setFocusedDocType(docType);
    setScreen('task');
  };

  useEffect(() => { if (historyPage > historyPages) setHistoryPage(historyPages); }, [historyPage, historyPages]);
  useEffect(() => { if (notificationPage > notificationPages) setNotificationPage(notificationPages); }, [notificationPage, notificationPages]);

  /* Delay gates */
  /* Parses a "Mon D, YYYY" display date + "H:MM AM/PM" display time into one
     real Date so lateness is judged against the actual scheduled moment —
     not just today's clock, which would flag every task as late once its
     time-of-day passes, regardless of which day it's actually scheduled for. */
  const isPastScheduled = (dateStr?: string, timeStr?: string) => {
    if (!dateStr || !timeStr) return false;
    const m = timeStr.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
    if (!m) return false;
    const scheduled = new Date(dateStr);
    if (isNaN(scheduled.getTime())) return false;
    let h = parseInt(m[1]);
    if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
    if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
    scheduled.setHours(h, parseInt(m[2]), 0, 0);
    return scheduled < new Date();
  };

  const isPickupLate = a && !isFailed
    ? getPickupTimingStatus(a, timingNow)?.kind === 'pickup_overdue' : false;

  const isDeliveryLate = (() => {
    if (!a || a.taskStatus !== 'In Transit' || isFailed) return false;
    try { return isPastScheduled(a.deliveryDate, a.ata); } catch { return false; }
  })();

  const hasPickupReport   = (a?.delayReports ?? []).some((r) => r.type === 'pickup');
  const hasDeliveryReport = (a?.delayReports ?? []).some((r) => r.type === 'delivery');
  const showPickupDelay   = isPickupLate   && !hasPickupReport   && !pickupDelayDone   && phase === 'assigned';
  const showDeliveryDelay = isDeliveryLate && !hasDeliveryReport && !deliveryDelayDone && phase === 'in_transit';
  const blockSlider       = showPickupDelay || showDeliveryDelay || issueOpen;

  /* ────────────────────────────────────────────────────────
     LOADING / OFFLINE SPLASHES
  ──────────────────────────────────────────────────────── */
  if (!data && syncing) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-50 to-white flex flex-col items-center justify-center gap-5 px-6 text-center">
        <div className="w-14 h-14 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-xl font-bold text-foreground">{t('home.loadingTasks')}</p>
        <p className="text-base text-gray-400">{t('home.welcome', { name: driverName })}</p>
      </div>
    );
  }
  if (!data && !syncing) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-red-50 to-white flex flex-col items-center justify-center gap-5 px-6 text-center">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
          <WifiOff className="w-9 h-9 text-red-500" />
        </div>
        <div>
          <p className="text-xl font-bold text-foreground">{t('home.noConnection')}</p>
          <p className="text-base text-gray-400 mt-1">{t('home.checkInternet')}</p>
        </div>
        <button onClick={() => fetchData()} className="px-8 py-4 bg-green-700 text-white rounded-2xl font-bold text-base">{t('home.tryAgain')}</button>
        <button onClick={() => { setData(MOCK_DATA); setOnline(false); }} className="text-base text-primary underline font-medium">{t('home.previewDemo')}</button>
        <button onClick={onLogout} className="text-base text-gray-400 underline">{t('menu.logout')}</button>
      </div>
    );
  }

  /* ── Shared failed-write banner ── rendered on both screens, like LogoutDialog below.
     Tap to dismiss; also clears by itself as soon as a write succeeds. */
  const ActionErrorBanner = actionError && (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] w-[92%] max-w-sm">
      <button
        onClick={() => setActionError('')}
        className="w-full bg-red-600 text-white text-sm font-semibold px-4 py-3 rounded-2xl shadow-lg flex items-start gap-2 text-left"
      >
        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span className="flex-1">{actionError}</span>
      </button>
    </div>
  );

  const CompletionPopup = completionNotice && (
    <DeliveryCompleteDialog item={completionNotice}
      onClose={() => { setCompletionNotice(null); setScreen('dashboard'); }}
      onViewHistory={() => openCompletedHistory(completionNotice)} />
  );

  /* ── Shared logout dialog ── */
  const LogoutDialog = logoutDlg && (
    <div className="fixed inset-0 z-50 flex items-end">
      <div className="absolute inset-0 bg-black/60" onClick={() => setLogoutDlg(false)} />
      <div className="relative bg-white w-full rounded-t-3xl p-6 space-y-5 animate-in slide-in-from-bottom duration-200">
        <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto -mt-2 mb-2" />
        <p className="text-2xl font-bold text-center text-foreground">{t('logout.title')}</p>
        <p className="text-base text-gray-400 text-center">{t('logout.description')}</p>
        <div className="flex gap-3">
          <button onClick={() => setLogoutDlg(false)} className="flex-1 py-5 border border-gray-200 rounded-2xl font-semibold text-base text-gray-600">{t('logout.stay')}</button>
          <button onClick={onLogout} className="flex-1 py-5 bg-red-600 text-white rounded-2xl font-bold text-base">{t('logout.confirm')}</button>
        </div>
        <div className="h-4" />
      </div>
    </div>
  );

  const menuButton = (expanded = false, fullWidth = false) => (
    <button type="button" onClick={() => setActiveDrawer('menu')} aria-haspopup="dialog"
      className={`${expanded ? 'min-h-12 min-w-28 px-4 text-base' : 'min-h-11 px-2.5 text-sm'} ${fullWidth ? 'w-full' : ''} rounded-xl border border-gray-200 bg-white text-gray-700 font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-green-700`}>
      <Menu className={`${expanded ? 'w-5 h-5' : 'w-4 h-4'} shrink-0`} aria-hidden="true" /> {t('menu.title')}
    </button>
  );

  const DriverDrawers = activeDrawer === 'notifications' ? (
    <DriverDrawer title={t('notifications.title')} onClose={closeDrawer}>
      <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-sm font-semibold text-amber-950">{t('notifications.unavailable')}</p>
        <p className="mt-1 text-sm leading-relaxed text-amber-900">{t('notifications.unavailableDescription')}</p>
      </div>
      {driverNotifs.length > 0 && <section aria-label={t('notifications.documentReview')} className="mt-5">
        <h3 className="mb-3 text-sm font-bold text-gray-700">{t('notifications.documentReview')}</h3>
        <div className="grid min-w-0 grid-cols-1 gap-3">
          {notificationRows.map((notification, index) => <DriverNotificationRow key={notification.id} notification={notification} index={index}
            onOpen={notification.type === 'rejection' ? () => openDocumentFromNotification(notification.docType) : undefined} />)}
        </div>
        <DriverPageControls page={shownNotificationPage} pages={notificationPages} onPage={setNotificationPage} />
      </section>}
    </DriverDrawer>
  ) : activeDrawer === 'menu' ? (
    <DriverDrawer title={t('menu.title')} onClose={closeDrawer} compact>
      <div className="flex flex-col">
        <button type="button" onClick={() => { setHistorySearch(''); setHistoryPage(1); setActiveDrawer(null); setScreen('history'); }}
          className="w-full min-h-16 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-left flex items-center gap-3 focus-visible:outline-2 focus-visible:outline-green-700">
          <History className="w-6 h-6 text-green-700 shrink-0" aria-hidden="true" />
          <span className="flex-1 font-bold text-foreground">{t('history.title')}</span>
          <ChevronRight className="w-5 h-5 text-gray-400 shrink-0" aria-hidden="true" />
        </button>
        <button type="button" onClick={() => setActiveDrawer('language')}
          className="mt-3 w-full min-h-16 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-left flex items-center gap-3 focus-visible:outline-2 focus-visible:outline-green-700">
          <Languages className="w-6 h-6 text-green-700 shrink-0" aria-hidden="true" />
          <span className="flex-1 font-bold text-foreground">{t('menu.language')}</span>
          <span className="text-sm text-gray-500">{language === 'fil' ? t('language.filipino') : t('language.english')}</span>
          <ChevronRight className="w-5 h-5 text-gray-400 shrink-0" aria-hidden="true" />
        </button>
        <div className="mt-4 border-t border-gray-200 pt-4">
          <div className="flex items-center justify-between gap-3 px-1">
            <div className="min-w-0">
              <p className="text-base font-bold text-foreground">{t('notifications.sound')}</p>
              <p className="text-sm text-gray-500">{t('notifications.soundDescription')}</p>
            </div>
            <button type="button" role="switch" aria-label={t('notifications.sound')}
              aria-checked={soundEnabled} onClick={() => updateSoundEnabled(!soundEnabled)}
              className={`relative h-7 w-12 shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700 ${soundEnabled ? 'bg-green-700' : 'bg-gray-300'}`}>
              <span className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${soundEnabled ? 'translate-x-5' : ''}`} />
            </button>
          </div>
          <button type="button" onClick={() => { void playNotificationSound(true); }}
            className="mt-3 min-h-11 rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 focus-visible:outline-2 focus-visible:outline-green-700">
            {t('notifications.testSound')}
          </button>
        </div>
        <div className="mt-8 border-t border-gray-200 pt-5">
          <button type="button" onClick={() => { setActiveDrawer(null); setLogoutDlg(true); }}
            className="w-full min-h-14 rounded-2xl border border-red-200 bg-red-50 px-4 text-left flex items-center gap-3 font-bold text-red-700 focus-visible:outline-2 focus-visible:outline-red-600">
            <LogOut className="w-5 h-5" aria-hidden="true" /> {t('menu.logout')}
          </button>
        </div>
      </div>
    </DriverDrawer>
  ) : activeDrawer === 'language' ? (
    <DriverDrawer title={t('menu.language')} onClose={() => setActiveDrawer('menu')} compact>
      <div className="space-y-3">
        {(['en', 'fil'] as const).map((option) => (
          <button key={option} type="button" onClick={() => selectLanguage(option)}
            aria-pressed={language === option}
            className={`w-full min-h-16 rounded-2xl border px-4 py-3 flex items-center justify-between text-left text-base font-bold focus-visible:outline-2 focus-visible:outline-green-700 ${language === option ? 'border-green-600 bg-green-50 text-green-800' : 'border-gray-200 bg-white text-foreground'}`}>
            {option === 'en' ? t('language.english') : t('language.filipino')}
            {language === option && <CheckCircle2 className="h-6 w-6 text-green-700" aria-hidden="true" />}
          </button>
        ))}
      </div>
    </DriverDrawer>
  ) : null;

  const LanguageNotice = languageNotice && (
    <div role="status" aria-live="polite" className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[70] w-[min(92vw,420px)] rounded-2xl bg-gray-900 px-4 py-3 text-white shadow-xl flex items-center gap-2 text-sm font-semibold">
      <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
      {languageNotice === 'fil' ? t('language.changedFil') : t('language.changedEn')}
    </div>
  );

  const StatusNotice = statusNotice && (
    <div role="status" aria-live="polite" className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[70] w-[min(92vw,420px)] rounded-2xl bg-green-800 px-4 py-3 text-white shadow-xl flex items-center gap-2 text-sm font-semibold">
      <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
      {t('slide.statusSaved', { status: statusText(statusNotice) })}
    </div>
  );

  /* ════════════════════════════════════════════════════════════
     DASHBOARD SCREEN
  ════════════════════════════════════════════════════════════ */
  if (screen === 'dashboard') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {/* Header */}
        <header className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-20 shadow-sm">
          <div className="w-full max-w-2xl mx-auto">
            <div className="flex items-start justify-between gap-3 sm:gap-6">
              <div className="min-w-0 flex-1">
                <p className="text-sm sm:text-base text-green-700 font-extrabold uppercase tracking-wide leading-tight">360 Logistics</p>
                <DriverHomeClock />
              </div>
              <div className="min-w-0 flex-1 text-right">
                <p className="text-base sm:text-lg font-bold text-foreground leading-tight break-words [overflow-wrap:anywhere]">{driverName}</p>
                <p className="mt-1 text-xs sm:text-sm font-medium text-gray-500">{t('home.driver')}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5 mt-3">
              <button type="button" onClick={() => { setNotificationPage(1); setActiveDrawer('notifications'); }} aria-haspopup="dialog"
                aria-label={t('notifications.title')}
                className="min-w-0 min-h-12 px-2 rounded-xl border border-gray-200 bg-white text-gray-700 text-sm sm:text-base font-semibold flex items-center justify-center gap-3 focus-visible:outline-2 focus-visible:outline-green-700">
                <span className="relative shrink-0" aria-hidden="true">
                  <Bell className="w-5 h-5" />
                </span>
                <span className="min-w-0 leading-tight">{t('notifications.title')}</span>
              </button>
              {menuButton(true, true)}
            </div>
          </div>
        </header>

        {updating && <div className="h-1 bg-primary/20"><div className="h-full w-1/2 bg-primary animate-pulse rounded-full" /></div>}

        <div className="flex-1 overflow-y-auto w-full max-w-2xl mx-auto px-4 py-5 space-y-5 pb-10">

          {rejectedNotifs.length > 0 && displayStatus !== 'Needs Correction' && (
            <button type="button" onClick={() => openDocumentFromNotification(rejectedNotifs[0].docType)}
              className="w-full rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-left flex items-center gap-3 focus-visible:outline-2 focus-visible:outline-red-600">
              <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" aria-hidden="true" />
              <span className="flex-1 min-w-0">
                <span className="block font-bold text-red-800">{rejectedNotifs.length === 1 ? t('notifications.correctionOne') : t('notifications.correctionMany', { count: rejectedNotifs.length })}</span>
                <span className="block text-sm text-red-700">{rejectedNotifs.length === 1 ? t('notifications.reviewOne') : t('notifications.reviewMany')}</span>
              </span>
              <ChevronRight className="w-5 h-5 text-red-600 shrink-0" aria-hidden="true" />
            </button>
          )}

          {/* ── TODAY'S TASK ── */}
          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">{t('home.todayTask')}</h2>
            {a ? (
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                {/* Task header */}
                <div className="bg-gray-50 px-4 py-3 flex items-center justify-between gap-2 border-b border-gray-100">
                  <span className="min-w-0 text-sm font-mono font-bold text-gray-600 break-all">{a.id}</span>
                  <StatusBadge status={displayStatus ?? a.taskStatus} />
                </div>
                {issueOpen && <div className="flex items-start gap-2 border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <div><p className="font-bold">{t('task.deliveryPaused')} · {t('task.issueUnderReview')}</p>
                    <p className="mt-0.5 break-words">{reasonText(a.openIssue?.reason ?? a.issueReason!)}</p></div>
                </div>}
                <DriverOverdueNotice timing={deliveryTiming} deliveryDate={a.deliveryDate} compact />
                {postDelivery && documentProgress && (
                  <div className="px-4 pt-3 space-y-3">
                    {displayStatus === 'Awaiting Documents' && (
                      <div className={`flex min-w-0 items-start gap-2 rounded-xl border px-3 py-2.5 ${statusColors['Awaiting Documents'].badge}`}>
                        <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        <div className="min-w-0 text-sm leading-snug">
                          <p className="font-bold">{t('home.documentsNeeded')}{documentAgeText ? ` · ${documentAgeText}` : ''}</p>
                          {documentAge?.deliveredOn && <p className="mt-0.5 text-yellow-800">{t('home.deliveredOn', { date: documentAge.deliveredOn })}</p>}
                        </div>
                      </div>
                    )}
                    {displayStatus === 'Needs Correction' && (
                      <div className="flex min-w-0 items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-red-800">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        <div className="min-w-0 text-sm leading-snug">
                          <p className="font-bold">{t(documentProgress.rejected === 1 ? 'home.reuploadOne' : 'home.reuploadMany', { count: documentProgress.rejected })}</p>
                          <p className="mt-0.5">{t('home.reuploadInstruction')}</p>
                        </div>
                      </div>
                    )}
                    {(displayStatus === 'Under Review' || allDocsApproved) && (
                      <div className={`flex min-w-0 items-start gap-2 rounded-xl border px-3 py-2.5 ${allDocsApproved ? statusColors.Completed.badge : statusColors['Under Review'].badge}`}>
                        {allDocsApproved ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
                        <p className="min-w-0 text-sm font-bold leading-snug">{t(allDocsApproved ? 'home.allApproved' : 'home.allSubmitted')}</p>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-1 text-sm">
                      <span className="font-semibold text-gray-600">{t('task.documents')}</span>
                      <span className="font-bold text-gray-800">{documentProgress.uploaded} {t('home.of')} {documentProgress.required}</span>
                    </div>
                    {displayStatus !== 'Needs Correction' && <p className="text-xs text-gray-600">
                      {allDocsApproved
                        ? t('home.approvedCount', { count: documentProgress.approved })
                        : displayStatus === 'Awaiting Documents'
                          ? t('home.uploadCount', { uploaded: documentProgress.uploaded, remaining: documentProgress.missing })
                          : t('home.pendingCount', { count: documentProgress.pending })}
                    </p>}
                  </div>
                )}
                {/* Route */}
                <div className="px-4 py-4 space-y-3">
                  {!postDelivery && <>
                    <div>
                      <p className="text-sm font-bold text-gray-400 uppercase tracking-wide">{t('home.pickupAt')}</p>
                      <p className="text-lg font-bold text-foreground mt-1 leading-snug break-words [overflow-wrap:anywhere]">{a.pickupLocation}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-px bg-gray-200" />
                      <ArrowDown className="w-5 h-5 text-gray-400 flex-shrink-0" />
                      <div className="flex-1 h-px bg-gray-200" />
                    </div>
                  </>}
                  <div>
                    <p className="text-sm font-bold text-gray-400 uppercase tracking-wide">{t(postDelivery ? 'home.deliveredTo' : 'home.deliverTo')}</p>
                    <p className="text-lg font-bold text-green-700 mt-1 leading-snug break-words [overflow-wrap:anywhere]">{getDeliveryLocation(a)}</p>
                  </div>
                </div>
                {/* View task button */}
                <div className="px-4 pb-4">
                  <button
                    onClick={() => {
                      if (displayStatus === 'Needs Correction') {
                        setFocusedDocType(normalizedDocs.find((doc) => doc.uploaded && doc.docStatus === 'rejected')?.type ?? null);
                      } else if (displayStatus === 'Awaiting Documents') {
                        setFocusedDocType(normalizedDocs.find((doc) => !doc.uploaded)?.type ?? null);
                      } else if (displayStatus === 'Under Review' || allDocsApproved) {
                        setFocusedDocType(normalizedDocs[0]?.type ?? null);
                      }
                      setScreen('task');
                    }}
                    className="w-full min-h-14 px-4 py-3 bg-green-700 text-white rounded-xl font-bold text-lg sm:text-xl flex items-center justify-center gap-3 active:bg-green-800 shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700"
                  >
                    {t(displayStatus === 'Awaiting Documents'
                      ? documentProgress?.uploaded ? 'home.continueUploading' : 'home.uploadDocuments'
                      : displayStatus === 'Needs Correction'
                        ? documentProgress?.rejected === 1 ? 'home.fixDocument' : 'home.fixDocuments'
                        : displayStatus === 'Under Review' || allDocsApproved ? 'home.viewDocuments' : 'home.viewTask')}
                    <ChevronRight className="w-6 h-6 shrink-0" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-200 p-9 text-center">
                <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Package className="w-9 h-9 text-blue-300" />
                </div>
                <p className="text-xl font-bold text-gray-500">{t('home.noTask')}</p>
                <p className="text-base text-gray-400 mt-2 leading-relaxed">{t('home.checkLater')}</p>
              </div>
            )}
          </section>

          {/* Offline notice */}
          {!online && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-center gap-3">
              <WifiOff className="w-5 h-5 text-amber-500 flex-shrink-0" />
              <p className="text-sm text-amber-700 font-semibold">{t('home.offline')}</p>
            </div>
          )}
        </div>

        {ActionErrorBanner}
        {DriverDrawers}
        {LogoutDialog}
        {LanguageNotice}
        {StatusNotice}
        {CompletionPopup}
      </div>
    );
  }

  if (screen === 'history') {
    return <div className="min-h-screen min-w-0 bg-gray-50">
      <header className="sticky top-0 z-20 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        <button type="button" onClick={() => setScreen('dashboard')} aria-label={t('history.backDashboard')} className="h-11 w-11 shrink-0 rounded-xl border border-gray-200 flex items-center justify-center"><ChevronLeft className="w-5 h-5" /></button>
        <h1 className="text-xl font-bold text-foreground">{t('history.title')}</h1>
      </header>
      <main className="min-w-0 max-w-2xl mx-auto px-4 py-5">
        <p className="text-sm text-gray-500 mb-4">{t('history.subtitle')}</p>
        <label htmlFor="driver-history-search" className="sr-only">{t('history.searchLabel')}</label>
        <input id="driver-history-search" type="search" value={historySearch}
          onChange={(event) => { setHistorySearch(event.target.value); setHistoryPage(1); }}
          placeholder={t('history.searchPlaceholder')} className="w-full min-w-0 h-12 px-4 rounded-xl border border-gray-200 bg-white text-base mb-4" />
        {filteredHistory.length ? <>
          <div className="grid gap-2">
            {historyRows.map((item) => <PastDeliveryRow key={item.id} item={item}
              highlighted={historyHighlightId === item.id} onOpen={() => setSelectedHistoryId(item.id)} />)}
            {Array.from({ length: 8 - historyRows.length }, (_, index) => <div key={`empty-${index}`} aria-hidden="true" className="invisible min-h-20 rounded-2xl border px-4 py-3" />)}
          </div>
          <DriverPageControls page={shownHistoryPage} pages={historyPages} onPage={setHistoryPage} />
        </> : <div className="bg-white rounded-2xl border border-gray-200 px-5 py-7 text-center text-gray-500">{historySearch ? t('history.noMatches') : t('history.empty')}</div>}
      </main>
      {selectedHistoryId && <HistoryDetailsSheet key={selectedHistoryId} driverId={driverId} driverName={driverName} assignmentId={selectedHistoryId} onClose={closeHistoryDetail} onCheckSession={onCheckSession} />}
      {LanguageNotice}
      {StatusNotice}
      {CompletionPopup}
    </div>;
  }

  /* ════════════════════════════════════════════════════════════
     TASK SCREEN
  ════════════════════════════════════════════════════════════ */
  const workflowAction = phase === 'assigned' ? 'workflow.arrivePickup'
    : phase === 'pickup' ? 'workflow.startLoading'
    : phase === 'loading' ? 'workflow.finishLoading'
    : phase === 'pretrip' || phase === 'legacy_picked_up' ? 'workflow.startTrip'
    : phase === 'trip_pending' ? 'workflow.finishTripSync'
    : phase === 'in_transit' ? 'workflow.arriveDestination'
    : phase === 'arrived' ? 'workflow.startUnloading'
    : phase === 'unloading' ? 'workflow.finishUnloading'
    : phase === 'delivery_pending' ? 'workflow.finishDeliverySync' : null;
  const completedAction = phase === 'assigned' ? 'workflow.arrivePickupDone'
    : phase === 'pickup' ? 'workflow.startLoadingDone'
    : phase === 'loading' ? 'workflow.finishLoadingDone'
    : phase === 'pretrip' ? 'workflow.startTripDone'
    : phase === 'in_transit' ? 'workflow.arriveDestinationDone'
    : phase === 'arrived' ? 'workflow.startUnloadingDone'
    : phase === 'unloading' ? 'workflow.finishUnloadingDone' : null;
  const requiredPhotoKeys: readonly OperationalPhotoKey[] = phase === 'pickup' ? [...OPERATIONAL_PHOTOS.pickup, 'loading_before']
    : phase === 'loading' ? ['loading_after']
      : phase === 'pretrip' ? OPERATIONAL_PHOTOS.pretrip
        : phase === 'arrived' ? ['unloading_before']
          : phase === 'unloading' ? ['unloading_after'] : [];
  const photosIncomplete = !!a && requiredPhotoKeys.some((key) => !a.statusPhotos?.[key]?.url);
  const pickupTruckPhotosIncomplete = phase === 'pickup' && !!a && OPERATIONAL_PHOTOS.pickup
    .some((key) => !a.statusPhotos?.[key]?.url);
  const guideKeys = phase === 'pickup' ? OPERATIONAL_PHOTOS.pickup : requiredPhotoKeys;
  const photoProgress = getRequiredPhotoProgress(guideKeys, a?.statusPhotos);
  const nextPhotoKey = getNextRequiredPhoto(phase ?? '', a?.statusPhotos) as OperationalPhotoKey | null;
  const photoLabel = (key: OperationalPhotoKey) => key.endsWith('_front') ? t('workflow.front')
    : key.endsWith('_left') ? t('workflow.left') : key.endsWith('_right') ? t('workflow.right')
      : key.endsWith('_rear') ? t('workflow.rear') : key === 'loading_before' ? t('workflow.beforeLoading')
        : key === 'loading_after' ? t('workflow.afterLoading')
          : key === 'unloading_before' ? t('workflow.beforeUnloading') : t('workflow.afterUnloading');
  const operationalPhotoName = operationalPhotoTarget?.endsWith('_front') ? t('workflow.front')
    : operationalPhotoTarget?.endsWith('_left') ? t('workflow.left')
    : operationalPhotoTarget?.endsWith('_right') ? t('workflow.right')
    : operationalPhotoTarget?.endsWith('_rear') ? t('workflow.rear')
    : operationalPhotoTarget === 'loading_before' ? t('workflow.beforeLoading')
    : operationalPhotoTarget === 'loading_after' ? t('workflow.afterLoading')
    : operationalPhotoTarget === 'unloading_before' ? t('workflow.beforeUnloading')
    : t('workflow.afterUnloading');

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* ── Task Header ── */}
      <header ref={taskHeaderRef} className="sticky top-0 z-20 border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto max-w-2xl px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={() => setScreen('dashboard')}
              className="inline-flex min-h-12 min-w-0 items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-gray-700 focus-visible:outline-2 focus-visible:outline-green-700">
              <ChevronLeft className="h-5 w-5 shrink-0" aria-hidden="true" /> {t('task.dashboardButton')}
            </button>
            {menuButton(true)}
          </div>
          <h1 className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 break-words text-[22px] font-bold leading-tight text-gray-900">
            <span>{driverName}</span>
            {a?.truckPlate && <span className="text-xl font-medium text-gray-600"><span className="max-[389px]:hidden">· </span>{a.truckPlate}</span>}
          </h1>
        </div>
      </header>

      {/* Update indicator */}
      {updating && <div className="h-1 bg-primary/20"><div className="h-full w-1/2 bg-primary animate-pulse rounded-full" /></div>}

      {/* ── Scrollable content ── */}
      <div ref={taskScrollRef} style={{ paddingBottom: Math.max(144, stickyActionHeight + 24) }} className="mx-auto w-full max-w-2xl flex-1 space-y-5 overflow-y-auto px-4 py-5">

        {/* No assignment edge case */}
        {!a && (
          <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center mt-4">
            <Package className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-lg font-bold text-gray-500">{t('task.noActive')}</p>
            <button onClick={() => setScreen('dashboard')} className="mt-4 text-primary font-semibold text-base underline">
              {t('task.backDashboard')}
            </button>
          </div>
        )}

        {a && (
          <>
            {!isFailed && !isCancelled && phase &&
              (phase !== 'delivered' || !!a.unloadingCompletedAt) && <OperationalProgress phase={phase} />}
            <TaskLocationsCard assignment={a} />

            {isDelivered && (
              <div className={`rounded-2xl border px-4 py-4 space-y-3 ${statusColors.Delivered.badge}`}>
                {(a.unloadingCompletedAt || a.statusPhotos?.Delivered?.timestamp) &&
                  <p className="text-sm font-semibold text-emerald-900">{t('workflow.deliveryDone', {
                    time: a.unloadingCompletedAt ? manilaStamp(a.unloadingCompletedAt) : a.statusPhotos?.Delivered?.timestamp ?? '',
                  })}</p>}
                {displayStatus === 'Awaiting Documents' && (
                  <p className="text-sm font-semibold leading-snug text-emerald-900">{t('task.deliveryCompletedUploadPrompt')}</p>
                )}
                <button type="button" onClick={() => {
                  const target = displayStatus === 'Needs Correction'
                    ? normalizedDocs.find((doc) => doc.uploaded && doc.docStatus === 'rejected')
                    : normalizedDocs.find((doc) => !doc.uploaded) ?? normalizedDocs[0];
                  setFocusedDocType(target?.type ?? null);
                  document.getElementById('driver-required-documents')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }} className="w-full min-h-14 rounded-xl bg-green-700 px-4 py-3 text-base font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700">
                  {t(displayStatus === 'Awaiting Documents'
                    ? documentProgress?.uploaded ? 'home.continueUploading' : 'home.uploadDocuments'
                    : displayStatus === 'Needs Correction'
                      ? documentProgress?.rejected === 1 ? 'home.fixDocument' : 'home.fixDocuments'
                      : 'home.viewDocuments')}
                </button>
              </div>
            )}

            {/* The same schedule condition shown on Home and in Dispatch. */}
            <DriverOverdueNotice timing={deliveryTiming} deliveryDate={a.deliveryDate} />

            {/* ── Failed / Cancelled banner ── */}
            {(isFailed || isCancelled) && (
              <div className={`rounded-2xl px-5 py-4 flex items-start gap-3 ${isFailed ? 'bg-red-50 border border-red-200' : 'bg-gray-100 border border-gray-200'}`}>
                <AlertTriangle className={`w-6 h-6 flex-shrink-0 mt-0.5 ${isFailed ? 'text-red-500' : 'text-gray-400'}`} />
                <div>
                  <p className={`text-base font-bold ${isFailed ? 'text-red-700' : 'text-gray-600'}`}>
                    {isFailed ? t('task.issueReported') : t('task.cancelled')}
                  </p>
                  {a.issueReason && <p className="text-sm text-gray-500 mt-0.5 leading-snug">{reasonText(a.issueReason)}</p>}
                </div>
              </div>
            )}

            {issueOpen && (
              <div role="status" className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-red-600" aria-hidden="true" />
                  <div className="min-w-0 space-y-1">
                    <p className="text-xs font-bold uppercase tracking-wide text-red-700">{t('task.deliveryPaused')}</p>
                    <p className="text-base font-bold text-red-900">{t('task.issueUnderReview')}</p>
                    <p className="break-words text-sm font-medium text-red-800">{reasonText(a.openIssue?.reason ?? a.issueReason!)}</p>
                    <p className="text-sm text-red-800">{t('task.pauseExplanation')}</p>
                    <p className="text-xs font-semibold text-red-700">{t('task.waitingStaff')}</p>
                  </div>
                </div>
              </div>
            )}
            {issueResolvedNotice && !issueOpen && !isTerminal && (
              <p role="status" className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-800">
                {t('task.issueResolvedContinue')}
              </p>
            )}

            {/* ── Delay prompts (when active) ── */}
            {showPickupDelay && (
              <div className="bg-amber-50 border-2 border-amber-400 rounded-2xl p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5 animate-pulse" />
                  <div>
                    <p className="text-lg font-bold text-amber-800">{t('task.pickupTimePassed')}</p>
                    <p className="text-base text-amber-600 mt-0.5">{t('task.reportReasonFirst')}</p>
                  </div>
                </div>
                <button onClick={() => setDelaySheet('pickup')} className="w-full py-4 bg-amber-500 text-white rounded-2xl font-bold text-base">
                  {t('task.reportPickupDelay')}
                </button>
              </div>
            )}
            {showDeliveryDelay && (
              <div className="bg-amber-50 border-2 border-amber-400 rounded-2xl p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5 animate-pulse" />
                  <div>
                    <p className="text-lg font-bold text-amber-800">{t('task.deliveryTimePassed')}</p>
                    <p className="text-base text-amber-600 mt-0.5">{t('task.reportReasonFirst')}</p>
                  </div>
                </div>
                <button onClick={() => setDelaySheet('delivery')} className="w-full py-4 bg-amber-500 text-white rounded-2xl font-bold text-base">
                  {t('task.reportDeliveryDelay')}
                </button>
              </div>
            )}

            {/* Operational photos are stored in status_photos, apart from the six documents. */}
            {phase === 'pickup' && <>
              <OperationalPhotos assignment={a} keys={OPERATIONAL_PHOTOS.pickup}
                title={t('workflow.truckPhotos')} help={t('workflow.pickupPhotosHelp')}
                required onSelect={setOperationalPhotoTarget} highlightKey={highlightPhotoKey} />
              <OperationalPhotos assignment={a} keys={['loading_before']}
                title={t('workflow.beforeLoading')} help={t('workflow.beforeLoadingHelp')}
                required onSelect={setOperationalPhotoTarget} highlightKey={highlightPhotoKey} />
            </>}
            {phase === 'loading' && <>
              <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700">
                <p className="font-bold text-base">{t('workflow.loadingProgress')}</p>
                <p className="mt-1">{t('workflow.startedAt', { time: manilaStamp(a.loadingStartedAt ?? undefined) })}</p>
                <ElapsedTime start={a.loadingStartedAt} />
              </div>
              <OperationalPhotos assignment={a} keys={['loading_after']}
                title={t('workflow.afterLoading')} help={t('workflow.afterLoadingHelp')}
                required onSelect={setOperationalPhotoTarget} highlightKey={highlightPhotoKey} />
              <div className="rounded-2xl border border-gray-200 bg-white p-4">
                <label htmlFor="loading-remark" className="block text-sm font-bold text-gray-900">{t('workflow.stageRemark')}</label>
                <p className="mt-0.5 text-xs text-gray-500">{t('workflow.stageRemarkHelp')}</p>
                <textarea id="loading-remark" value={stageRemark} onChange={(e) => setStageRemark(e.target.value.slice(0, 300))}
                  rows={2} maxLength={300} placeholder={t('workflow.stageRemarkPlaceholder')}
                  className="mt-2 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700/30" />
              </div>
            </>}
            {phase === 'pretrip' && <>
              {a.loadingCompletedAt && <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
                <p className="font-semibold">{t('workflow.finishedAt', { time: manilaStamp(a.loadingCompletedAt) })}</p>
                {a.loadingStartedAt && <p>{t('workflow.duration', { time: elapsedClock(a.loadingStartedAt, new Date(a.loadingCompletedAt)) ?? '—' })}</p>}
              </div>}
              <p className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800">{t('workflow.parked')}</p>
              <OperationalPhotos assignment={a} keys={OPERATIONAL_PHOTOS.pretrip}
                title={t('workflow.truckPhotos')} help={t('workflow.pretripPhotosHelp')}
                required onSelect={setOperationalPhotoTarget} highlightKey={highlightPhotoKey} />
            </>}
            {phase === 'trip_pending' && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{t('workflow.departurePending')}</p>}
            {phase === 'legacy_picked_up' && <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700">{t('workflow.legacyPickup')}</p>}
            {phase === 'in_transit' && a.departedAt && <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm font-semibold text-gray-700">
              {t('workflow.tripStartedAt', { time: manilaStamp(a.departedAt ?? undefined) })}
            </div>}
            {phase === 'arrived' && <>
              <div className={`rounded-2xl border p-4 text-sm ${statusColors.Arrived.badge}`}>
                <p className="font-bold text-base">{t('workflow.arrivedMessage')}</p>
                <p className="mt-1 break-words">{getDeliveryLocation(a)}</p>
                <p className="mt-1">{t('workflow.arrivedAt', { time: manilaStamp(a.destinationArrivedAt ?? undefined) })}</p>
              </div>
              <OperationalPhotos assignment={a} keys={['unloading_before']}
                title={t('workflow.beforeUnloading')} required onSelect={setOperationalPhotoTarget} highlightKey={highlightPhotoKey} />
            </>}
            {phase === 'unloading' && <>
              <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700">
                <p className="font-bold text-base">{t('workflow.unloadingProgress')}</p>
                <p className="mt-1">{t('workflow.startedAt', { time: manilaStamp(a.unloadingStartedAt ?? undefined) })}</p>
                <ElapsedTime start={a.unloadingStartedAt} />
              </div>
              <OperationalPhotos assignment={a} keys={['unloading_after']}
                title={t('workflow.afterUnloading')} required onSelect={setOperationalPhotoTarget} highlightKey={highlightPhotoKey} />
              <div className="rounded-2xl border border-gray-200 bg-white p-4">
                <label htmlFor="unloading-remark" className="block text-sm font-bold text-gray-900">{t('workflow.stageRemark')}</label>
                <p className="mt-0.5 text-xs text-gray-500">{t('workflow.stageRemarkHelp')}</p>
                <textarea id="unloading-remark" value={stageRemark} onChange={(e) => setStageRemark(e.target.value.slice(0, 300))}
                  rows={2} maxLength={300} placeholder={t('workflow.stageRemarkPlaceholder')}
                  className="mt-2 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700/30" />
              </div>
            </>}
            {phase === 'delivery_pending' && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{t('workflow.deliveryPending')}</p>}

            {/* Supplementary assignment data stays available without crowding the current action. */}
            <details className="group rounded-2xl border border-gray-200 bg-white shadow-sm">
              <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 focus-visible:outline-2 focus-visible:outline-green-700 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0">
                  <span className="block text-base font-bold text-gray-900">{t('task.details')}</span>
                  <span className="mt-0.5 block text-sm text-gray-600">{t('task.detailsHint')}</span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-gray-500 transition-transform group-open:rotate-90" aria-hidden="true" />
              </summary>
              <div className="border-t border-gray-100 px-5 py-2 pb-4">
                <DetailRow label={t('task.id')} value={a.id} />
                <DetailRow label={t('task.truck')} value={a.truckPlate} />
                <DetailRow label={t('task.pickupLocation')} value={a.pickupLocation} />
                <DetailRow label={t('task.route')} value={getAssignmentRoute(a)} />
                {destinationAreaEnabled && <DetailRow label={t('task.destination')} value={a.destinationArea || '—'} />}
                <DetailRow label={t('task.deliveryLocation')} value={getDeliveryLocation(a)} />
                <DetailRow label={t('task.client')} value={a.company} />
                <DetailRow label={t('task.pickupDate')} value={a.pickedUpDate} />
                <DetailRow label={t('task.pickupTime')} value={a.pickupTime} />
                <DetailRow label={t('task.deliveryDate')} value={a.deliveryDate} />
                <DetailRow label={t('task.deliveryDue')} value={a.ata ?? a.eta} />
                <DetailRow label={t('task.instructions')} value={a.remarks} />
              </div>
            </details>

            {/* ── Delay reports history ── */}
            {(a.delayReports ?? []).length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 space-y-3">
                <p className="text-sm font-bold text-amber-700 uppercase tracking-wide">{t('task.delayReports')}</p>
                {a.delayReports!.map((r, i) => (
                  <div key={i} className="bg-white border border-amber-100 rounded-xl px-4 py-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-xs font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${r.type === 'pickup' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                        {r.type === 'pickup' ? t('task.pickup') : t('task.delivery')}
                      </span>
                      <span className="text-xs text-gray-400">{r.reportedAt}</span>
                    </div>
                    <p className="text-sm text-gray-600">{reasonText(r.reason)}</p>
                  </div>
                ))}
              </div>
            )}

            {/* ── Documents (always visible; locked until delivered) ── */}
            <div id="driver-required-documents" className={`space-y-3 rounded-2xl outline outline-2 outline-offset-2 transition-colors duration-700 motion-reduce:transition-none ${highlightDocuments ? 'outline-green-500 bg-green-50/50' : 'outline-transparent'}`}>
              <div className="flex items-center justify-between px-1">
                <h3 className="text-xl font-bold text-foreground">{t('task.documents')}</h3>
                <span className="text-base text-gray-500 font-semibold">{t('doc.approvedCount', { count: approvedCt, total: REQUIRED_DOCS.length })}</span>
              </div>
              {!isDelivered && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 flex items-center gap-3">
                  <Lock className="w-5 h-5 text-amber-500 flex-shrink-0" />
                  <p className="text-base text-amber-700 font-semibold">
                    {t('doc.uploadAfterDelivered')}
                  </p>
                </div>
              )}
              {normalizedDocs.map((doc) => (
                <DocRow key={doc.type} doc={doc} onUpload={handleDocUpload} isDelivered={isDelivered} isBlurry={!!docBlurErrors[doc.type]} isFocused={focusedDocType === doc.type} />
              ))}
            </div>

            {/* ── Report a problem (subtle, away from slider) ── */}
            {!isTerminal && !issueOpen && (
              <div className="px-1 pb-2">
                <button
                  onClick={() => setIssueSheet(true)}
                  className="flex items-center gap-2 text-sm text-red-400 font-semibold py-2"
                >
                  <AlertTriangle className="w-4 h-4" /> {t('task.problem')}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Sticky bottom action ── */}
      {a && !isTerminal && workflowAction && (
        <div ref={stickyActionRef} className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-[0_-4px_20px_rgba(0,0,0,0.10)] z-20">
          <div className="mx-auto max-w-2xl">
            {blockSlider && <p className="mb-3 text-sm font-semibold text-amber-800">
              {issueOpen ? t('task.pauseExplanation') : t('slide.reportDelay')}
            </p>}
            {photosIncomplete && nextPhotoKey && <button type="button" onClick={() => scrollToPhoto(nextPhotoKey)}
              className="mb-3 flex min-h-14 w-full items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2 text-left text-gray-800 transition-colors hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-green-700">
              <Camera className="h-5 w-5 shrink-0 text-gray-600" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold">{phase === 'pickup'
                  ? t(pickupTruckPhotosIncomplete ? 'workflow.requiredPickupPhotos' : 'workflow.truckPhotosComplete')
                  : phase === 'pretrip' ? t('workflow.requiredPretripPhotos') : t('workflow.nextRequiredPhoto')}</span>
                <span className="block text-xs text-gray-600">{t('workflow.photoNext', { photo: photoLabel(nextPhotoKey) })}</span>
              </span>
              {(phase === 'pickup' || phase === 'pretrip') && <span className="shrink-0 text-sm font-semibold">{photoProgress.captured}/{photoProgress.total}</span>}
              <ArrowDown className="h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />
            </button>}
            <SlideToConfirm
              label={t(workflowAction)}
              completedLabel={completedAction ? t(completedAction) : undefined}
              disabled={updating || photosIncomplete || blockSlider || !online}
              onConfirm={async () => {
                if (issueOpen) return false;
                if (phase === 'legacy_picked_up') {
                  setPhotoTarget('In Transit');
                  return false;
                }
                return handleOperationalSlide();
              }}
            />
          </div>
        </div>
      )}

      <button type="button" aria-label={t('workflow.scrollTop')}
        onClick={() => {
          const content = taskScrollRef.current;
          const scroller = content && content.scrollHeight > content.clientHeight + 1 ? content : window;
          scroller.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
        }}
        style={{ bottom: stickyActionHeight ? stickyActionHeight + 12 : undefined }}
        className={`fixed left-1/2 z-30 flex h-12 w-12 -translate-x-1/2 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-800 shadow-md transition-opacity duration-200 focus-visible:outline-2 focus-visible:outline-green-700 ${stickyActionHeight ? '' : 'bottom-[max(1rem,env(safe-area-inset-bottom))]'} ${scrollTopVisible && !photoTarget && !operationalPhotoTarget && !delaySheet && !issueSheet && !logoutDlg && !activeDrawer && !selectedHistoryId && !completionNotice ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
        <ArrowUp className="h-5 w-5" aria-hidden="true" />
      </button>

      {/* ── Sheets / Modals ── */}
      {photoTarget  && <PhotoSheet status={photoTarget} existingPhoto={a?.statusPhotos?.[photoTarget]}
        onConfirm={handlePhotoConfirmed} onCancel={() => setPhotoTarget(null)} />}
      {operationalPhotoTarget && <PhotoSheet status={null}
        existingPhoto={a?.statusPhotos?.[operationalPhotoTarget]}
        qualityCheck={OPERATIONAL_PHOTOS.pickup.includes(operationalPhotoTarget as typeof OPERATIONAL_PHOTOS.pickup[number])
          || OPERATIONAL_PHOTOS.pretrip.includes(operationalPhotoTarget as typeof OPERATIONAL_PHOTOS.pretrip[number]) ? 'truck' : 'cargo'}
        title={operationalPhotoName}
        instruction={t('workflow.photoSlot', {
          angle: operationalPhotoName,
          requirement: t('workflow.required'),
        })}
        onConfirm={handleOperationalPhotoConfirmed} onCancel={() => setOperationalPhotoTarget(null)} />}
      {delaySheet   && (
        <ReasonSheet
          title={delaySheet === 'pickup' ? t('task.pickupDelay') : t('task.deliveryDelay')}
          subtitle={t('task.delayReason')}
          reasons={delaySheet === 'pickup' ? PICKUP_DELAY_REASONS : DELIVERY_DELAY_REASONS}
          variant="amber"
          onSubmit={(r) => handleDelaySubmit(delaySheet, r)}
          onCancel={() => setDelaySheet(null)}
        />
      )}
      {issueSheet && (
        <ReasonSheet
          title={t('task.reportProblem')}
          subtitle={t('task.whatHappened')}
          reasons={ISSUE_REASONS}
          variant="red"
          onSubmit={handleIssueSubmit}
          onCancel={() => setIssueSheet(false)}
        />
      )}
      {ActionErrorBanner}
      {DriverDrawers}
      {LogoutDialog}
      {LanguageNotice}
      {StatusNotice}
      {CompletionPopup}
    </div>
  );
}
