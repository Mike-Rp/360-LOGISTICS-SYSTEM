import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { toast } from 'sonner';
import {
  User, Truck, MapPin, Building2, Calendar, MessageSquare,
  X, ClipboardList, CheckCircle2,
  FileText, Check, XCircle, AlertTriangle, Clock, Lock,
  Package, Trash2, ChevronDown, ChevronUp, ZoomIn,
  Navigation, Timer, Camera, Search,
  Plus, ArrowLeft, ArrowRight, ChevronLeft, ChevronRight,
  Receipt, ClipboardCheck, ScrollText, FileCheck, PackageCheck,
  Pencil, KeyRound,
} from 'lucide-react';
import { RegisterDriverModal, RegisterTruckModal } from './RegisterModals';
import { Popover, PopoverAnchor, PopoverContent } from '../ui/popover';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '../ui/dialog';
import TruckImage from '../TruckImage';
import ASNWithCopy from './ASNWithCopy';
import DocumentsSummaryCard from './DocumentsSummaryCard';
import { ImagePreviewModal, OperationalEvidence } from './ShipmentPhotoEvidence';
import DeliveryTimingBadge from './DeliveryTimingBadge';
import PickupTimingNotice from './PickupTimingNotice';
import { getDispatchTimingNotices } from '../../lib/assignmentTiming';
import { OPERATIONAL_STEPS, OPERATIONAL_PHOTO_GROUPS, getAdminOperationalProgress, formatOperationalStamp, formatOperationalDuration } from '../../lib/assignmentOperational';
import { statusColors } from '../../data/statusColors';
import { assignmentDisplayStatusConfig, canCompleteAssignment, getAssignmentDisplayStatus, getAssignmentDocumentProgress, getDocumentAgingState, type AssignmentDisplayStatus } from '../../lib/assignmentWorkflow';
import { PaginationFooter, usePagination, useStablePageHeight } from './Pagination';
import { sortNewestFirst, markLocalRecordAdded, useLocalAddedHighlight, newRecordHighlight } from '../../lib/recordOrdering';
import { ADMIN_NAVIGATION_EVENT, pushAdminNavigation } from '../../lib/adminNavigation';
import { TRUCK_CLASSIFICATIONS, truckSideImageFor, capacityKgOnly } from '../../data/truckTypes';
import { destinationAreaEnabled, getAssignmentRoute, getDeliveryLocation } from '../../data/assignmentRoute';
import MapboxLocationInput from './MapboxLocationInput';
import { mapboxRouteArea, type SelectedLocation } from '../../lib/mapboxLocations';
import { coordinatePair } from '../../lib/assignmentLocation';
import {
  verifyOwnPassword, editAssignment, cancelAssignment, syncAdminData, AssignmentActionError,
  type AssignmentActionErrorCode, type AssignmentEdit, type AssignmentLocationEdit,
} from '../../lib/db';

/* ── Highlight helper ── */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 text-yellow-900 rounded px-0.5 not-italic font-semibold">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}
import {
  DOCUMENT_TYPES, DEMO_ADMIN_EMAIL, parseStoredTimestamp,
  type Assignment, type CompletedTask, type LocalDriver, type LocalTruck,
  type DocStatus, type AdminActivityEntry, type AdminActivityInput, type AssignmentDoc, type AppNotification,
} from '../../data/assignmentTypes';

/* ─── Date & time values ───────────────────────────── */
/* Both fields carry the value the native input uses:
   dates as "YYYY-MM-DD", times as 24-hour "HH:MM". */

const MONTHS      = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_LONG = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];
const WEEKDAYS    = ['Su','Mo','Tu','We','Th','Fr','Sa'];

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/* "2026-08-03" → "Aug 3, 2026" (the format assignments are stored in) */
const isoToDisplay = (iso: string) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};

/* Parsed as local midnight — `new Date(iso)` would parse as UTC and skew the day */
const isoToDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const dateToIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/* Native <input type="time"> yields 24-hour "HH:MM" — convert to the
   "3:05 PM" display format the rest of the app stores. */
const time24ToDisplay = (v: string) => {
  if (!v) return '';
  const [h, m] = v.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return '';
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
};

const time24ToDate = (base: Date, v: string): Date => {
  const [h, m] = v.split(':').map(Number);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
};

/* "Aug 3, 2026" → "2026-08-03" — the reverse of isoToDisplay, used to pre-fill the Edit form.
   Returns '' when the stored text doesn't parse, so the field shows as empty/required. */
const displayToIso = (s: string) => {
  const m = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/.exec((s ?? '').trim());
  if (!m) return '';
  const mi = MONTHS.indexOf(m[1]);
  if (mi < 0) return '';
  return `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
};

/* "3:05 PM" → "15:05" — the reverse of time24ToDisplay */
const displayToTime24 = (s: string) => {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec((s ?? '').trim());
  if (!m) return '';
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === 'PM') h += 12;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
};

/* A real calendar date with a 4-digit year — rejects "20266-01-01" and Feb 30 */
const isRealIso = (iso: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
};

/* Remarks and "Reason for change" share this limit (the database checks it too) */
const TEXT_MAX = 150;

/* The browser reports a half-typed or impossible date (e.g. 02/30) as "bad input" and an empty value */
type BadDates = { pickup: boolean; delivery: boolean };
const INVALID_DATE = 'Enter a real date (mm/dd/yyyy, 4-digit year).';

/* Latest date allowed for pickup / delivery: today + 1 year (worked out now, never hardcoded) */
const oneYearAheadIso = () => {
  const d = new Date();
  return dateToIso(new Date(d.getFullYear() + 1, d.getMonth(), d.getDate()));
};

/* Date rules shared by the live check (while typing) and submit.
   `requireFilled` also flags empty fields — submit only, not while the admin is still typing. */
function dateErrors(pickup: string, delivery: string, bad: BadDates, requireFilled: boolean): Record<string, string> {
  const e: Record<string, string> = {};
  const today      = todayIso();               // worked out now, never hardcoded
  const latest     = oneYearAheadIso();
  const pickupOk   = !!pickup && isRealIso(pickup);
  const deliveryOk = !!delivery && isRealIso(delivery);

  if (bad.pickup || (pickup && !pickupOk))       e.pickedUpDate = INVALID_DATE;
  else if (!pickup) { if (requireFilled)         e.pickedUpDate = 'Select a picked up date.'; }
  else if (pickup < today)                       e.pickedUpDate = 'Picked up date cannot be before today.';
  else if (pickup > latest)                      e.pickedUpDate = 'Picked up date cannot be more than 1 year ahead.';

  if (bad.delivery || (delivery && !deliveryOk)) e.date = INVALID_DATE;
  else if (!delivery) { if (requireFilled)       e.date = 'Select a delivery date.'; }
  else if (delivery < today)                     e.date = 'Delivery date cannot be in the past.';
  else if (delivery > latest)                    e.date = 'Delivery date cannot be more than 1 year ahead.';
  else if (pickupOk && delivery < pickup)        e.date = 'Delivery date cannot be before the picked up date.';
  return e;
}

/* Every schedule rule checked on submit — used by both Dispatch Truck and Edit */
function scheduleErrors(s: {
  pickup: string; delivery: string; pickupTime: string; eta: string; remarks: string; bad: BadDates;
}): Record<string, string> {
  const e = dateErrors(s.pickup, s.delivery, s.bad, true);
  if (!s.pickupTime) e.pickupTime = 'Select a pick up time.';
  if (!s.eta)        e.eta        = 'Select an ETA.';

  /* If the delivery date is today, times must be in the future */
  if (s.delivery && !e.date) {
    const selDate = isoToDate(s.delivery);
    const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
    if (selDate.getTime() === todayMidnight.getTime()) {
      const now = new Date();
      if (s.pickupTime && time24ToDate(selDate, s.pickupTime) <= now)
        e.pickupTime = "Pickup time must be in the future for today's date.";
      if (s.eta && time24ToDate(selDate, s.eta) <= now)
        e.eta = "ETA must be in the future for today's date.";
    }
  }

  /* ── ETA must not precede pickup — both are zero-padded 24-hour "HH:MM",
     so a plain string compare orders them correctly.

     This only applies when pickup and delivery fall on the SAME day. Across
     different days the comparison is meaningless: a pickup at 14:00 on the 19th
     and an arrival at 08:00 on the 21st is perfectly valid, but a raw time
     compare would reject it. Same-day behaviour is unchanged. ── */
  const sameDay = !!s.pickup && !!s.delivery && s.pickup === s.delivery;
  if (sameDay && s.pickupTime && s.eta && !e.eta && s.eta < s.pickupTime)
    e.eta = 'ETA cannot be earlier than the pick up time.';

  if (s.remarks.length > TEXT_MAX) e.remarks = `Remarks can be at most ${TEXT_MAX} characters.`;
  return e;
}

/* Plain-language text for the errors the edit/cancel database functions can return */
const actionMessage = (code: AssignmentActionErrorCode): string => ({
  wrong_password:    'Incorrect password.',
  reauth_required:   'Please confirm your password again.',
  not_editable:      'This delivery is no longer "Assigned" — the driver may have picked it up — so it can\'t be edited.',
  not_cancellable:   'This delivery is no longer "Assigned" — the driver may have picked it up — so it can\'t be cancelled.',
  driver_busy:       'That driver was just given another delivery. Pick a different driver.',
  truck_unavailable: 'That truck is no longer available. Pick a different truck.',
  no_changes:        'Nothing has changed.',
  not_authorized:    'Your account is not allowed to make this change.',
  not_deployed:      'This feature isn\'t set up on the database yet (the migration hasn\'t been applied).',
  already_archived:  'That record has been archived. Refresh the page.',
  truck_busy:        'That truck is on another delivery. Pick a different truck.',
  invalid:           'The server rejected one of the values. Check the form and try again.',
  network:           'Couldn\'t reach the server. Check your connection and try again.',
}[code]);

const errorCode = (err: unknown): AssignmentActionErrorCode =>
  err instanceof AssignmentActionError ? err.code : 'network';

/* Slim, light scrollbars — the browser default renders as heavy dark bars */
const thinScroll =
  '[scrollbar-width:thin] [scrollbar-color:#d1d5db_transparent] ' +
  '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent ' +
  '[&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-thumb]:rounded-full ' +
  'hover:[&::-webkit-scrollbar-thumb]:bg-[#1DBF73]/50';

/* ─── Date field — type into the input, or click the icon for a calendar ─── */
function DateField({ value, onChange, hasError, minIso, maxIso }: {
  /* `bad` = the browser holds a half-typed or impossible date (its value is then '') */
  value: string; onChange: (v: string, bad?: boolean) => void; hasError?: boolean;
  /* Bound the selectable range; typing is still validated on submit */
  minIso?: string;
  maxIso?: string;
}) {
  const [open, setOpen] = useState(false);

  /* Which month the calendar is showing — follows the value when there is one */
  const anchor = value ? isoToDate(value) : new Date();
  const [viewY, setViewY] = useState(anchor.getFullYear());
  const [viewM, setViewM] = useState(anchor.getMonth());

  /* Re-centre on the selected date each time the calendar is opened */
  const openCalendar = () => {
    const a = value ? isoToDate(value) : new Date();
    setViewY(a.getFullYear());
    setViewM(a.getMonth());
    setOpen((v) => !v);
  };

  const firstWeekday = new Date(viewY, viewM, 1).getDay();
  const daysInMonth  = new Date(viewY, viewM + 1, 0).getDate();
  const min          = minIso ? isoToDate(minIso) : null;
  const max          = maxIso ? isoToDate(maxIso) : null;

  const step = (delta: number) => {
    const d = new Date(viewY, viewM + delta, 1);
    setViewY(d.getFullYear());
    setViewM(d.getMonth());
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative">
          <input
            type="date" value={value}
            onChange={(e) => onChange(e.target.value, e.target.validity.badInput)}
            onBlur={(e) => { if (e.target.validity.badInput) onChange(e.target.value, true); }}
            /* Without a max the browser lets the year run to 6 digits */
            min={minIso} max={maxIso ?? '9999-12-31'}
            className={`${fieldBase} ${fieldTone(hasError)} pr-10 [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-inner-spin-button]:hidden`}
          />
          <button type="button" onClick={openCalendar} aria-label="Open calendar"
            className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <Calendar className="w-4 h-4" />
          </button>
        </div>
      </PopoverAnchor>

      <PopoverContent
        align="start"
        sideOffset={6}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="w-[268px] max-w-[calc(100vw-2rem)] bg-white border border-border rounded-xl shadow-xl p-3"
      >
        {/* Month switcher */}
        <div className="flex items-center justify-between mb-2">
          <button type="button" onClick={() => step(-1)}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold text-foreground">{MONTHS_LONG[viewM]} {viewY}</span>
          <button type="button" onClick={() => step(1)}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-0.5 mb-1">
          {WEEKDAYS.map((w) => (
            <span key={w} className="text-[12px] font-semibold text-muted-foreground text-center py-1">{w}</span>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-0.5">
          {Array.from({ length: firstWeekday }, (_, i) => <span key={`pad-${i}`} />)}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const day      = i + 1;
            const cell     = new Date(viewY, viewM, day);
            const iso      = dateToIso(cell);
            const disabled = (!!min && cell < min) || (!!max && cell > max);
            const selected = iso === value;
            const isToday  = iso === todayIso();
            return (
              <button key={iso} type="button" disabled={disabled}
                onClick={() => { onChange(iso); setOpen(false); }}
                className={`h-8 rounded-md text-xs font-medium transition-colors ${
                  selected ? 'bg-[#1DBF73] text-white'
                  : disabled ? 'text-muted-foreground/35 cursor-not-allowed'
                  : isToday ? 'text-[#1DBF73] font-semibold hover:bg-accent'
                  : 'text-foreground hover:bg-accent'
                }`}>
                {day}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
          <button type="button" onClick={() => { onChange(todayIso()); setOpen(false); }}
            className="text-xs font-medium text-[#1DBF73] hover:underline">Today</button>
          <button type="button" onClick={() => { onChange(''); setOpen(false); }}
            className="text-xs font-medium text-muted-foreground hover:text-foreground">Clear</button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ─── Time field — type into the input, or click the icon for wheels ─── */
const WHEEL_HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const WHEEL_MINS  = Array.from({ length: 60 }, (_, i) => i);

function TimeField({ value, onChange, hasError }: {
  value: string; onChange: (v: string) => void; hasError?: boolean;
}) {
  const [open, setOpen] = useState(false);

  /* Decompose the 24-hour value into wheel positions; default to 8:00 AM */
  const [h24, min] = value ? value.split(':').map(Number) : [8, 0];
  const hour12 = h24 % 12 || 12;
  const ampm: 'AM' | 'PM' = h24 >= 12 ? 'PM' : 'AM';

  const commit = (nh: number, nm: number, nap: 'AM' | 'PM') => {
    let h = nh % 12;
    if (nap === 'PM') h += 12;
    onChange(`${String(h).padStart(2, '0')}:${String(nm).padStart(2, '0')}`);
  };

  const colBtn = (active: boolean) =>
    `w-full px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
      active ? 'bg-[#1DBF73] text-white' : 'text-foreground hover:bg-[#1DBF73]/10'
    }`;

  const colHead = 'text-[12px] font-semibold uppercase tracking-wide text-muted-foreground text-center pb-1.5 mb-1 border-b border-border';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative">
          <input
            type="time" value={value}
            onChange={(e) => onChange(e.target.value)}
            className={`${fieldBase} ${fieldTone(hasError)} pr-10 [&::-webkit-calendar-picker-indicator]:hidden`}
          />
          <button type="button" onClick={() => setOpen((v) => !v)} aria-label="Open time picker"
            className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <Clock className="w-4 h-4" />
          </button>
        </div>
      </PopoverAnchor>

      <PopoverContent
        align="start"
        sideOffset={6}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="w-auto bg-white border border-border rounded-xl shadow-xl p-2.5"
      >
        <div className="flex gap-1.5">
          {/* Hours */}
          <div className="w-[52px]">
            <p className={colHead}>HH</p>
            <div className={`max-h-40 overflow-y-auto space-y-0.5 pr-1 ${thinScroll}`}>
              {WHEEL_HOURS.map((h) => (
                <button key={h} type="button" onClick={() => commit(h, min, ampm)}
                  className={colBtn(h === hour12 && !!value)}>
                  {h}
                </button>
              ))}
            </div>
          </div>

          {/* Minutes */}
          <div className="w-[52px] border-l border-border pl-1.5">
            <p className={colHead}>MM</p>
            <div className={`max-h-40 overflow-y-auto space-y-0.5 pr-1 ${thinScroll}`}>
              {WHEEL_MINS.map((m) => (
                <button key={m} type="button" onClick={() => commit(hour12, m, ampm)}
                  className={colBtn(m === min && !!value)}>
                  {String(m).padStart(2, '0')}
                </button>
              ))}
            </div>
          </div>

          {/* AM / PM */}
          <div className="w-[52px] border-l border-border pl-1.5">
            <p className={colHead}>AM/PM</p>
            <div className="space-y-0.5">
              {(['AM', 'PM'] as const).map((a) => (
                <button key={a} type="button" onClick={() => commit(hour12, min, a)}
                  className={colBtn(a === ampm && !!value)}>
                  {a}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end mt-2 pt-2 border-t border-border">
          <button type="button" onClick={() => setOpen(false)}
            className="text-xs font-medium text-[#1DBF73] hover:underline">Done</button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ─── Assign Task form primitives ──────────────────── */

/* Bold uppercase section header with a hairline divider */
function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h4 className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">{children}</h4>
      <div className="h-px bg-border mt-2" />
    </div>
  );
}

/* Label with the required asterisk beside the text, never on the input */
function FieldLabel({ children, required, hint }: {
  children: React.ReactNode; required?: boolean; hint?: string;
}) {
  return (
    <label className="block text-[13px] font-medium text-foreground mb-1.5">
      {children}
      {required && <span className="text-red-500 ml-0.5">*</span>}
      {hint && <span className="text-muted-foreground font-normal ml-1.5">{hint}</span>}
    </label>
  );
}

/* Shared input chrome — keeps every field on the same visual rhythm */
const fieldBase =
  'w-full px-3.5 py-2.5 rounded-[10px] border text-sm text-foreground placeholder:text-muted-foreground ' +
  'focus:outline-none focus:ring-2 focus:ring-[#1DBF73]/25 focus:border-[#1DBF73] transition-colors';
const fieldTone = (err?: boolean) => err ? 'border-red-400 bg-red-50' : 'border-border bg-white';

/* Two dots + a thin progress bar */
function StepProgress({ step, total = 2 }: { step: number; total?: number }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <div className="flex items-center gap-1.5">
        {Array.from({ length: total }, (_, i) => (
          <span key={i}
            className={`rounded-full transition-all duration-300 ${
              i + 1 === step ? 'w-5 h-1.5 bg-[#1DBF73]'
              : i + 1 < step ? 'w-1.5 h-1.5 bg-[#1DBF73]'
              : 'w-1.5 h-1.5 bg-border'
            }`}
          />
        ))}
      </div>
      <div className="flex-1 h-0.5 bg-border rounded-full overflow-hidden">
        <div className="h-full bg-[#1DBF73] rounded-full transition-all duration-300"
             style={{ width: `${(step / total) * 100}%` }} />
      </div>
      <span className="hidden sm:inline text-[12px] font-medium text-muted-foreground tabular-nums whitespace-nowrap">Step {step} of {total}</span>
    </div>
  );
}

/* Dropdown that degrades into a clickable "add one" action when empty */
function ResourceSelect({ value, onChange, options, placeholder, emptyLabel, onAdd, hasError }: {
  value: string; onChange: (v: string) => void;
  options: { id: string; label: string }[];
  placeholder: string; emptyLabel: string; onAdd: () => void; hasError?: boolean;
}) {
  if (options.length === 0) {
    return (
      <button type="button" onClick={onAdd}
        className={`${fieldBase} ${fieldTone(hasError)} text-left flex items-center gap-1.5 hover:bg-accent cursor-pointer`}>
        <span className="text-muted-foreground">{emptyLabel} —</span>
        <span className="text-[#1DBF73] font-medium inline-flex items-center gap-0.5">
          <Plus className="w-3.5 h-3.5" /> Add {emptyLabel.includes('driver') ? 'driver' : 'truck'}
        </span>
      </button>
    );
  }
  return (
    <div className="relative">
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className={`${fieldBase} ${fieldTone(hasError)} appearance-none pr-9 cursor-pointer`}>
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
    </div>
  );
}

/* ─── Truck preview pieces (Dispatch Truck, Edit, View Details) ─── */

/* Picture for the truck's classification (shared mapping in data/truckTypes.ts);
   the neutral truck icon when the type has no picture (missing / "Tanker"). */
function TruckThumb({ classification }: { classification?: string }) {
  return (
    <div className="w-16 h-12 rounded-lg bg-muted/60 border border-border flex items-center justify-center flex-shrink-0 overflow-hidden">
      <TruckImage classification={classification} className="w-full h-full" iconClassName="w-6 h-6 text-muted-foreground" />
    </div>
  );
}

/* Capacity is stored as one text value, e.g. "8,000 – 20,000 kg (8–20 t)" (see formatCapacity) */
function CapacityBadge({ capacity }: { capacity?: string }) {
  if (!capacity) return <span className="text-xs text-muted-foreground whitespace-nowrap">Capacity not set</span>;
  return (
    <span className="inline-flex items-center rounded-full bg-[#1DBF73]/15 border border-[#1DBF73]/30 px-3 py-1 text-xs font-semibold text-[#0b7a47] whitespace-nowrap">
      {capacityKgOnly(capacity)}
    </span>
  );
}

function TruckPreviewCard({ truck }: { truck: LocalTruck }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-white p-3">
      <TruckThumb classification={truck.classification} />
      <div className="flex-1 min-w-[8rem]">
        <p className="text-sm font-semibold text-foreground break-words">{truck.classification || 'Type not set'}</p>
        <p className="text-xs text-muted-foreground break-words">{truck.plateNumber}</p>
      </div>
      <CapacityBadge capacity={truck.capacity} />
    </div>
  );
}

/* Side-view picture + plate, highlighted type and capacity badge.
   Used by View Details (plate first) and the Edit preview (type first — it's what you're choosing). */
function TruckSummary({ truck, fallbackPlate, typeFirst = false, compact = false }: {
  truck: LocalTruck | null; fallbackPlate?: string; typeFirst?: boolean; compact?: boolean;
}) {
  const plate = (
    <p className="text-2xl sm:text-[28px] font-bold text-foreground leading-tight break-words">
      {truck?.plateNumber ?? fallbackPlate}
    </p>
  );
  const type = (
    <p className={`${compact ? 'text-sm sm:text-base' : 'text-lg sm:text-xl'} font-bold uppercase leading-tight break-words mt-0.5 ${
      truck?.classification ? 'text-blue-600' : 'text-muted-foreground'}`}>
      {truck?.classification || 'Type not set'}
    </p>
  );
  return (
    <div className="flex items-center gap-3 sm:gap-4">
      {/* Side view: shows the left part of the 1200×400 canvas, where the truck is */}
      <div className={`${compact ? 'w-24 lg:w-32' : 'w-[40%] max-w-[11rem]'} aspect-[7/5] flex items-center justify-center flex-shrink-0 overflow-hidden`}>
        <TruckImage anchorLeft src={truckSideImageFor(truck?.classification)} alt={truck?.classification}
          className="w-full h-full" iconClassName="w-10 h-10 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        {typeFirst ? (
          <>
            {type}
            <p className="text-sm font-medium text-muted-foreground mt-1">Plate Number</p>
            <p className="text-base font-bold text-foreground leading-tight break-words">{truck?.plateNumber ?? fallbackPlate}</p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-foreground">Plate Number</p>
            {plate}
            {type}
          </>
        )}
        <div className="mt-2">
          {truck?.capacity ? (
            <span className="inline-flex items-center rounded-full bg-[#1DBF73] px-3 py-1.5 text-xs font-semibold text-white break-words">
              {capacityKgOnly(truck.capacity)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Capacity not set</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* Live "n/150" counter under a limited text field */
function CharCount({ value, max = TEXT_MAX }: { value: string; max?: number }) {
  return (
    <span className={`text-[12px] tabular-nums ${value.length >= max ? 'text-amber-600 font-medium' : 'text-muted-foreground'}`}>
      {value.length}/{max}
    </span>
  );
}

/* ─── Helpers ─────────────────────────────────────── */
/* Colored dot + label (no emoji circles) */
/* `acknowledged` only matters while status is 'Assigned' — it shows a lighter
   purple instead of the usual purple until the driver's app has actually loaded
   the task, so admin can tell a fresh assignment hasn't been seen yet. */
function StatusBadge({ status, size = 'sm', acknowledged = true }: { status: AssignmentDisplayStatus; size?: 'sm' | 'xs'; acknowledged?: boolean }) {
  const cfg = assignmentDisplayStatusConfig[status];
  const unseen = status === 'Assigned' && !acknowledged;
  const badge  = unseen ? 'bg-purple-50 text-purple-600 border-purple-200' : cfg.badge;
  const dot    = unseen ? 'bg-purple-300' : cfg.dot;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-medium ${badge} ${size === 'xs' ? 'text-xs' : 'text-xs'}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
      {cfg.label}
    </span>
  );
}

function DispatchStatusBadge({ assignment }: { assignment: Assignment }) {
  const stage = getAdminOperationalProgress(assignment).badge;
  if (!stage) return <StatusBadge status={getAssignmentDisplayStatus(assignment)} acknowledged={!!assignment.driverAcknowledgedAt} />;
  const color = statusColors[stage as keyof typeof statusColors];
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${color.badge}`}>
    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />{stage}
  </span>;
}

/* ─── Modal Shell ──────────────────────────────────── */
function ModalShell({ title, onClose, wide = false, children }: {
  title: React.ReactNode; onClose: () => void; wide?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-white rounded-xl sm:rounded-2xl shadow-2xl w-full ${wide ? 'max-w-3xl' : 'max-w-md'} flex flex-col max-h-[94vh] sm:max-h-[92vh] animate-in fade-in zoom-in-95 duration-200`}>
        <div className="flex items-center justify-between px-5 sm:px-7 py-4 sm:py-5 border-b border-border flex-shrink-0">
          <h3 className="text-lg sm:text-xl font-semibold text-foreground">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 sm:p-7 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

/* ─── View Details building blocks ─────────────────── */

/* Card wrapper — soft rounded group with a shared background */
function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border/70 bg-muted/25 p-4">
      <p className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">{title}</p>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/* One label/value pair. `hero` is for the single most time-critical field (ETA). */
function DetailRow({ icon, label, value, hero = false, compact = false }: {
  icon: React.ReactNode; label: string; value?: string; hero?: boolean; compact?: boolean;
}) {
  const filled = !!value && value !== '—';
  return (
    <div className={`flex items-start ${compact ? 'gap-1.5' : 'gap-2.5'}`}>
      <span className="text-muted-foreground mt-0.5 flex-shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
        {filled ? (
          <p className={hero
            ? 'text-2xl font-bold text-foreground leading-tight mt-0.5'
            : 'text-[15px] font-semibold text-foreground break-words'}>{value}</p>
        ) : (
          /* Pending, not missing — dashed placeholder reads better than a bare dash */
          <p className="mt-1 inline-block rounded-lg border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground">
            Not yet available
          </p>
        )}
      </div>
    </div>
  );
}

/* Origin → destination area, with the saved legacy route as fallback. */
function RouteRow({ route }: { route: string }) {
  const [from, to] = route.split('→').map((s) => s.trim());
  return (
    <div className="flex items-start gap-2.5">
      <Navigation className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide">Route</p>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[15px] font-semibold text-foreground break-words">{from || route}</span>
          {to && <ArrowRight className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />}
          {to && <span className="text-[15px] font-semibold text-foreground break-words">{to}</span>}
        </div>
      </div>
    </div>
  );
}

function DeliveryStepper({ assignment }: { assignment: Assignment }) {
  const progress = getAdminOperationalProgress(assignment);
  const complete = [
    !!assignment.createdAt || !!assignment.assignedAt,
    !!assignment.pickupArrivedAt,
    !!assignment.loadingCompletedAt,
    !!assignment.departedAt && !!assignment.destinationArrivedAt,
    !!assignment.destinationArrivedAt && !!assignment.unloadingStartedAt,
    !!assignment.unloadingCompletedAt && assignment.taskStatus === 'Delivered',
    assignment.taskStatus === 'Delivered',
  ];
  const hasOperationalHistory = !!(assignment.pickupArrivedAt || assignment.loadingStartedAt ||
    assignment.departedAt || assignment.destinationArrivedAt || assignment.unloadingStartedAt);
  return (
    <div aria-label={progress.terminal ? `Delivery progress ended: ${assignment.taskStatus}` : `Step ${progress.index + 1} of 7, ${progress.label}`}>
      <p className="mb-3 text-sm font-semibold text-foreground">{progress.terminal
        ? `Progress ended · ${assignment.taskStatus}` : `Step ${progress.index + 1} of 7 · ${progress.label}`}</p>
      <div className="grid grid-cols-4 gap-y-3 sm:grid-cols-7" aria-label="Physical delivery stages">
        {OPERATIONAL_STEPS.map((step, i) => {
          const color = statusColors[step];
          const done = complete[i] && (i < progress.index || i === 6);
          const active = !progress.terminal && i === progress.index;
          return (
            <div key={step} className="relative flex min-w-0 flex-col items-center text-center">
              {i < OPERATIONAL_STEPS.length - 1 && <span aria-hidden="true"
                className={`absolute top-[11px] left-1/2 right-[-50%] h-0.5 ${i === 3 ? 'hidden sm:block' : ''} ${done ? 'bg-green-500' : 'bg-border'}`} />}
              <span aria-hidden="true" className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                active ? color.activeStep : done ? 'border-green-600 bg-green-600 text-white'
                  : 'border-border bg-white text-muted-foreground'}`}>
                {done ? <Check className="h-4 w-4" /> : <span className="text-xs font-semibold">{i + 1}</span>}
              </span>
              <span className={`mt-1.5 px-0.5 text-[13px] leading-tight ${active ? `font-semibold ${color.activeLabel}` : done ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                {step}
              </span>
            </div>
          );
        })}
      </div>
      {progress.syncWarning && (
        <p className="mt-3 text-sm text-amber-800">{progress.syncWarning}</p>
      )}
      {assignment.taskStatus === 'Delivered' && !hasOperationalHistory && (
        <p className="mt-3 text-[13px] text-muted-foreground">Earlier delivery · intermediate stage times were not recorded.</p>
      )}
    </div>
  );
}

function DeliveryActivity({ assignment, now, onViewPhotos }: {
  assignment: Assignment; now: Date; onViewPhotos: (group: string) => void;
}) {
  const photos = assignment.statusPhotos ?? {};
  const photoStage = (index: number, name: string) => {
    const group = OPERATIONAL_PHOTO_GROUPS[index];
    const count = group.slots.filter(([key]) => !!photos[key]?.url).length;
    const complete = group.slots.every(([key]) => !!photos[key]?.url);
    return { group: group.title, name, count, total: group.slots.length, complete };
  };
  const loadingDuration = formatOperationalDuration(assignment.loadingStartedAt, assignment.loadingCompletedAt ?? now);
  const unloadingDuration = formatOperationalDuration(assignment.unloadingStartedAt, assignment.unloadingCompletedAt ?? now);
  const rows: Array<{
    label: string; done: boolean; main: string | null; prefix?: string;
    details?: Array<string | null>; photoStage?: ReturnType<typeof photoStage>;
  }> = [
    { label: 'Assigned', done: true, main: formatOperationalStamp(assignment.createdAt || assignment.assignedAt) },
    { label: 'At Pickup', done: !!assignment.pickupArrivedAt,
      main: formatOperationalStamp(assignment.pickupArrivedAt),
      photoStage: photoStage(0, 'pickup') },
    { label: 'Loading', done: !!assignment.loadingStartedAt,
      main: formatOperationalStamp(assignment.loadingStartedAt), prefix: 'Started',
      details: [assignment.loadingCompletedAt ? `Finished · ${formatOperationalStamp(assignment.loadingCompletedAt)}` : null,
        loadingDuration ? `${assignment.loadingCompletedAt ? 'Duration' : 'Elapsed'} · ${loadingDuration}` : null],
      photoStage: photoStage(1, 'loading') },
    { label: 'In Transit', done: !!assignment.departedAt || assignment.taskStatus === 'In Transit',
      main: formatOperationalStamp(assignment.departedAt), prefix: 'Departed',
      photoStage: photoStage(2, 'pre-trip') },
    { label: 'Arrived', done: !!assignment.destinationArrivedAt,
      main: formatOperationalStamp(assignment.destinationArrivedAt) },
    { label: 'Unloading', done: !!assignment.unloadingStartedAt,
      main: formatOperationalStamp(assignment.unloadingStartedAt), prefix: 'Started',
      details: [assignment.unloadingCompletedAt ? `Finished · ${formatOperationalStamp(assignment.unloadingCompletedAt)}` : null,
        unloadingDuration ? `${assignment.unloadingCompletedAt ? 'Duration' : 'Elapsed'} · ${unloadingDuration}` : null],
      photoStage: photoStage(3, 'unloading') },
    { label: 'Delivered', done: assignment.taskStatus === 'Delivered',
      main: assignment.taskStatus === 'Delivered'
        ? formatOperationalStamp(assignment.unloadingCompletedAt) ?? assignment.statusPhotos?.Delivered?.timestamp ?? null : null },
  ];
  return (
    <section aria-label="Delivery Activity" className="rounded-xl border border-border/70 bg-white p-3 sm:p-4">
      <p className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">Delivery Activity</p>
      <ol>
        {rows.map((row, index) => <li key={row.label} className="relative grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 pb-1 last:pb-0">
          {index < rows.length - 1 && <span aria-hidden="true"
            className={`absolute bottom-0 left-[11px] top-6 w-px ${row.done ? 'bg-green-300' : 'bg-border'}`} />}
          <span aria-hidden="true" className={`relative z-10 flex h-6 w-6 items-center justify-center rounded-full border ${row.done
            ? 'border-green-200 bg-green-50 text-green-700' : 'border-border bg-white text-muted-foreground'}`}>
            {row.done ? <Check className="h-4 w-4" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
          </span>
          <div className={`grid min-w-0 grid-cols-1 gap-y-1 pb-1.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-x-4 ${index < rows.length - 1 ? 'border-b border-border/50' : ''}`}>
            <div className="min-w-0">
              <p className={`text-sm font-semibold leading-5 ${row.done ? 'text-foreground' : 'text-muted-foreground'}`}>{row.label}</p>
              <p className="mt-0.5 break-words text-[13px] leading-snug text-muted-foreground">
                {row.main ? `${row.prefix ? `${row.prefix} · ` : ''}${row.main}` : row.done ? 'Time not recorded' : 'Not yet reached'}
              </p>
              {row.details?.some(Boolean) && <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[13px] leading-snug text-muted-foreground">
                {row.details.filter(Boolean).map((detail, detailIndex) => <span key={detailIndex} className="break-words">
                  {detailIndex > 0 && <span aria-hidden="true" className="mr-2 text-muted-foreground/60">·</span>}{detail}
                </span>)}
              </div>}
            </div>
            {row.photoStage && <button type="button" onClick={() => onViewPhotos(row.photoStage!.group)}
                aria-label={`View ${row.photoStage.count} of ${row.photoStage.total} ${row.photoStage.name} photos`}
                className={`inline-flex min-h-8 shrink-0 items-center justify-self-start gap-1.5 rounded-lg border px-2 py-1 text-[13px] font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:justify-self-end ${row.photoStage.complete
                  ? 'border-green-200 bg-green-50/40 hover:bg-green-50' : 'border-amber-200 bg-amber-50/40 hover:bg-amber-50'}`}>
                <Camera aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
                <span>Photos</span>
                <span className={`rounded-full px-1.5 py-0.5 tabular-nums ${row.photoStage.complete
                  ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                  {row.photoStage.count}/{row.photoStage.total}
                </span>
                <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
            </button>}
          </div>
        </li>)}
      </ol>
      <p className="mt-1 border-t border-border/50 pt-2 text-[13px] leading-snug text-muted-foreground">
        ⓘ Physical delivery progress is updated by the driver.
      </p>
    </section>
  );
}

/* Collapsible remarks — muted and non-interactive when empty */
function RemarksBlock({ remarks }: { remarks?: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!remarks?.trim()) {
    return (
      <section className="rounded-xl border border-dashed border-border p-4">
        <p className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Remarks</p>
        <p className="text-xs text-muted-foreground mt-1">No remarks for this assignment.</p>
      </section>
    );
  }
  return (
    <section className="rounded-xl border border-border/70 bg-muted/25 overflow-hidden">
      <button type="button" onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between p-4 hover:bg-accent/40 transition-colors">
        <span className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Remarks</span>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      <p className={`px-4 pb-4 text-sm text-foreground leading-relaxed break-words [overflow-wrap:anywhere] ${expanded ? '' : 'line-clamp-2'}`}>
        {remarks}
      </p>
    </section>
  );
}

/* Circular progress ring for the documents header */
function ProgressRing({ value, total }: { value: number; total: number }) {
  const r = 22, c = 2 * Math.PI * r;
  const pct = total ? value / total : 0;
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" className="flex-shrink-0 -rotate-90">
      <circle cx="26" cy="26" r={r} fill="none" strokeWidth="5" className="stroke-border" />
      <circle cx="26" cy="26" r={r} fill="none" strokeWidth="5" strokeLinecap="round"
        className={pct === 1 ? 'stroke-green-500' : 'stroke-blue-500'}
        strokeDasharray={c} strokeDashoffset={c * (1 - pct)}
        style={{ transition: 'stroke-dashoffset 300ms ease' }} />
    </svg>
  );
}

/* Per-document-type icon */
const docTypeIcon = (type: string) => {
  const cls = 'w-4 h-4';
  if (/proof of delivery/i.test(type))   return <PackageCheck className={cls} />;
  if (/receiving/i.test(type))           return <ClipboardCheck className={cls} />;
  if (/dispatch/i.test(type))            return <ClipboardList className={cls} />;
  if (/invoice/i.test(type))             return <Receipt className={cls} />;
  if (/bill of lading/i.test(type))      return <ScrollText className={cls} />;
  if (/waybill|receipt/i.test(type))     return <FileCheck className={cls} />;
  return <FileText className={cls} />;
};

/* Document chips use the same families as the assignment's document status. */
function DocChip({ doc, uploadAvailable }: { doc: AssignmentDoc; uploadAvailable: boolean }) {
  const cfg = !doc.uploaded
    ? uploadAvailable
      ? { cls: statusColors['Awaiting Documents'].badge, icon: <Clock className="w-3 h-3" />, label: 'Awaiting upload' }
      : { cls: statusColors.Cancelled.badge, icon: <Lock className="w-3 h-3" />, label: 'Locked' }
    : doc.docStatus === 'approved' ? { cls: statusColors.Completed.badge, icon: <Check className="w-3 h-3" />, label: 'Approved' }
    : doc.docStatus === 'rejected' ? { cls: statusColors['Needs Correction'].badge, icon: <XCircle className="w-3 h-3" />, label: 'Rejected' }
    : { cls: statusColors['Under Review'].badge, icon: <Clock className="w-3 h-3" />, label: 'Pending review' };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[12px] font-medium whitespace-nowrap ${cfg.cls}`}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

/* ─── View Details Modal ───────────────────────────── */
type ShipmentTab = 'overview' | 'activity' | 'photos' | 'documents';

function ViewDetailsModal({ assignment, driver, truck, onClose, onEdit, onApproveDoc, onRejectDoc, onComplete, onCancel, onSimulateLate, isViewOnly = false, adminEmail, reviewTarget, timingNow }: {
  assignment: Assignment | null; driver: LocalDriver | null;
  /* null when the truck record was deleted — the plate saved on the assignment is still shown */
  truck: LocalTruck | null;
  onClose: () => void;
  onEdit:         () => void;
  onApproveDoc:   (id: string, docType: string) => void;
  onRejectDoc:    (id: string, docType: string, reason: string) => void;
  onComplete:     (id: string) => Promise<void>;
  onCancel:       (id: string) => Promise<void>;
  onSimulateLate: (id: string) => void;
  isViewOnly?:    boolean;
  adminEmail?:    string | null;
  reviewTarget?: { docType?: string } | null;
  timingNow: Date;
}) {
  const isDemoAdmin = adminEmail === DEMO_ADMIN_EMAIL;
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelBusy,    setCancelBusy]    = useState(false);
  const [cancelError,   setCancelError]   = useState('');
  const [previewDoc,    setPreviewDoc]    = useState<{ url: string; type: string } | null>(null);
  const [rejectingDoc,  setRejectingDoc]  = useState<string | null>(null);
  const [rejectReason,  setRejectReason]  = useState('');
  const reviewSectionRef = useRef<HTMLDivElement>(null);
  const reviewDocumentRef = useRef<HTMLDivElement>(null);
  const [highlightReview, setHighlightReview] = useState(false);
  const [activeTab, setActiveTab] = useState<ShipmentTab>(reviewTarget ? 'documents' : 'overview');
  const [expandedPhotoGroup, setExpandedPhotoGroup] = useState<string | null>(null);
  const [photosViewed, setPhotosViewed] = useState(false);
  const [completeBusy, setCompleteBusy] = useState(false);
  const [completeError, setCompleteError] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);
  const reviewDocument = reviewTarget ? assignment?.documents.find(doc => reviewTarget.docType
    ? doc.type === reviewTarget.docType : doc.uploaded && doc.docStatus === 'pending') : undefined;

  const selectTab = (tab: ShipmentTab) => {
    setActiveTab(tab);
    if (tab === 'photos') setPhotosViewed(true);
    contentRef.current?.scrollTo({ top: 0 });
  };
  const viewPhotoGroup = (group: string) => {
    setExpandedPhotoGroup(group);
    selectTab('photos');
  };

  useEffect(() => {
    if (reviewTarget) setActiveTab('documents');
  }, [reviewTarget]);
  useEffect(() => {
    setPhotosViewed(false);
    setCompleteError('');
  }, [assignment?.id]);

  useLayoutEffect(() => {
    setHighlightReview(false);
    if (!reviewTarget || activeTab !== 'documents') return;
    const element = reviewDocumentRef.current ?? reviewSectionRef.current;
    if (!element) return;
    element.scrollIntoView({ block: reviewDocumentRef.current ? 'center' : 'start' });
    element.focus({ preventScroll: true });
    setHighlightReview(true);
    const timer = window.setTimeout(() => setHighlightReview(false), 3000);
    return () => window.clearTimeout(timer);
  }, [reviewTarget, assignment?.id, activeTab]);
  if (!driver) return null;

  const documentProgress = assignment ? getAssignmentDocumentProgress(assignment) : null;
  const allApproved = documentProgress?.allApproved ?? false;
  const approvedCount = documentProgress?.approved ?? 0;
  const completionEligible = !!assignment && canCompleteAssignment(assignment);
  const photosNeedAttention = !photosViewed && Object.values(assignment?.statusPhotos ?? {}).some((photo) => !!photo?.url);
  const documentsNeedAttention = assignment?.documents.some((doc) => doc.uploaded && doc.docStatus === 'pending') ?? false;
  const completeShipment = async () => {
    if (!assignment || !completionEligible || completeBusy) return;
    setCompleteBusy(true);
    setCompleteError('');
    try {
      await onComplete(assignment.id);
      onClose();
    } catch (error) {
      setCompleteError(error instanceof Error ? error.message : 'Unable to mark this assignment complete. Please try again.');
    } finally {
      setCompleteBusy(false);
    }
  };
  const { delivery: deliveryTiming, pickup: pickupTiming } = assignment
    ? getDispatchTimingNotices(assignment, timingNow) : { delivery: null, pickup: null };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center sm:p-4 lg:p-6">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-[100dvh] w-full min-w-0 flex-col overflow-hidden bg-white shadow-xl sm:h-[min(90dvh,820px)] sm:w-[94vw] sm:max-w-[960px] sm:rounded-2xl lg:h-[min(86dvh,820px)]">

        {/* ── Sticky header: driver identity ── */}
        <header className="flex flex-shrink-0 items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
          <div className="w-12 h-12 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center flex-shrink-0">
            <User className="w-6 h-6 text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-xl sm:text-2xl font-bold text-foreground leading-tight break-words">{driver.name}</h3>
            <p className="text-[13px] text-muted-foreground break-words">{driver.id} · {driver.phone}</p>
            {driver.currentLocation?.trim() && driver.currentLocation.trim() !== '—' && (
              <p className="text-xs text-muted-foreground break-words">Current location: {driver.currentLocation}</p>
            )}
          </div>
          <button onClick={onClose} aria-label="Close"
            className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground flex-shrink-0 self-start">
            <X className="w-5 h-5" />
          </button>
        </header>

        <div role="tablist" aria-label="Shipment details" className="grid flex-shrink-0 grid-cols-4 border-b border-border bg-white px-2 sm:px-6">
          {(['overview', 'activity', 'photos', 'documents'] as const).map((tab) => {
            const needsAttention = tab === 'photos' ? photosNeedAttention : tab === 'documents' && documentsNeedAttention;
            return <button key={tab} type="button"
            role="tab" id={`shipment-tab-${tab}`} aria-controls={`shipment-panel-${tab}`}
            aria-selected={activeTab === tab} onClick={() => selectTab(tab)}
            className={`flex min-w-0 items-center justify-center gap-1 border-b-2 px-1 py-3 text-[13px] font-medium capitalize transition-colors sm:text-sm ${activeTab === tab
              ? 'border-blue-600 text-blue-700' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {tab}
            <span className="flex h-2 w-2 shrink-0 items-center justify-center" aria-hidden="true">
              {needsAttention && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
            </span>
            {needsAttention && <span className="sr-only">needs attention</span>}
          </button>})}
        </div>

        {/* ── Scrollable content ── */}
        <div ref={contentRef} role="tabpanel" id={`shipment-panel-${activeTab}`}
          aria-labelledby={`shipment-tab-${activeTab}`}
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
      {!assignment ? (
        <div className="py-10 text-center text-muted-foreground">
          <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No active assignment for this driver.</p>
        </div>
      ) : (
        <>
        {activeTab === 'overview' && <div className="space-y-4">
          {/* Delivery progress */}
          <div className="rounded-xl border border-border/70 p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider">Delivery Progress</p>
              <DispatchStatusBadge assignment={assignment} />
            </div>
            <DeliveryStepper assignment={assignment} />
          </div>

          {/* Demo-only: simulate a late driver — "adminabuse" account only */}
          {isDemoAdmin && (assignment.taskStatus === 'Assigned' || assignment.taskStatus === 'In Transit') && (
            <div className="flex items-center justify-between gap-3 p-3 bg-purple-50 border border-dashed border-purple-300 rounded-xl">
              <div className="flex items-center gap-2 min-w-0">
                <AlertTriangle className="w-4 h-4 text-purple-600 flex-shrink-0" />
                <p className="text-xs text-purple-700">
                  Demo: force this driver's {assignment.taskStatus === 'Assigned' ? 'pickup' : 'delivery'} time late
                </p>
              </div>
              <button
                onClick={() => onSimulateLate(assignment.id)}
                className="flex-shrink-0 px-3 py-1.5 bg-purple-600 text-white text-xs font-medium rounded-lg hover:bg-purple-700 transition-colors"
              >
                Simulate Late
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 items-start gap-4 lg:items-stretch lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <section className="rounded-xl border border-border/70 bg-muted/25 p-4 lg:flex lg:h-full lg:flex-col">
              <p className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">Truck</p>
              <div className="lg:flex lg:flex-1 lg:items-center">
                <TruckSummary truck={truck} fallbackPlate={assignment.truckPlate} compact />
              </div>
            </section>
            <section className="rounded-xl border border-border/70 bg-muted/25 p-4 lg:h-full">
              <p className="mb-1.5 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">Schedule</p>
              <div className="grid grid-cols-1 gap-x-3 gap-y-1.5 min-[430px]:grid-cols-2">
                <DetailRow compact icon={<Calendar className="h-4 w-4" />} label="Pickup Date" value={assignment.pickedUpDate} />
                <DetailRow compact icon={<Clock className="h-4 w-4" />} label="Pickup Time" value={assignment.pickupTime} />
                <DetailRow compact icon={<Calendar className="h-4 w-4" />} label="Delivery Date" value={assignment.deliveryDate} />
                <DetailRow compact icon={<Timer className="h-4 w-4" />} label="ETA" value={assignment.eta} />
                <DetailRow compact icon={<Clock className="h-4 w-4" />} label="Assigned At" value={assignment.assignedAt} />
                {assignment.taskStatus === 'Delivered' && <DetailRow compact icon={<CheckCircle2 className="h-4 w-4" />}
                  label="Delivered At" value={formatOperationalStamp(assignment.unloadingCompletedAt) ?? assignment.statusPhotos?.Delivered?.timestamp ?? '—'} />}
              </div>
              {(deliveryTiming || pickupTiming) && <div className="mt-2 space-y-2">
                <DeliveryTimingBadge timing={deliveryTiming} />
                <PickupTimingNotice timing={pickupTiming} />
              </div>}
            </section>
          </div>

          <DetailCard title="Route & Client">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:gap-6">
              <div className="space-y-3">
                <RouteRow route={getAssignmentRoute(assignment)} />
                <DetailRow icon={<Building2 className="h-4 w-4" />} label="Client" value={assignment.company} />
                {destinationAreaEnabled && <DetailRow icon={<Navigation className="h-4 w-4" />} label="Destination" value={assignment.destinationArea || '—'} />}
              </div>
              <div className="space-y-3">
                <DetailRow icon={<MapPin className="h-4 w-4" />} label="Pickup Location" value={assignment.pickupLocation} />
                <DetailRow icon={<MapPin className="h-4 w-4" />} label="Delivery Location" value={getDeliveryLocation(assignment)} />
              </div>
            </div>
          </DetailCard>

          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            <RemarksBlock remarks={assignment.remarks} />
            <DocumentsSummaryCard count={`${approvedCount}/${assignment.documents.length} approved`}
              onActivate={() => selectTab('documents')} />
          </div>
        </div>}

        {activeTab === 'activity' && <div className="space-y-4">
          <DeliveryActivity assignment={assignment} now={timingNow} onViewPhotos={viewPhotoGroup} />
          {/* ── Delay Reports ── */}
          {assignment.delayReports && assignment.delayReports.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Delay Reports</p>
              <div className="space-y-2">
                {assignment.delayReports.map((report, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                    <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-semibold text-amber-800 capitalize">{report.type} Delay</span>
                        <span className="text-[12px] text-amber-600">{report.reportedAt}</span>
                      </div>
                      <p className="text-xs text-amber-700">{report.reason}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Issue Reason ── */}
          {assignment.taskStatus === 'Failed / Issue' && assignment.issueReason && (
            <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-xl">
              <XCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-red-800 mb-0.5">Issue Reported</p>
                <p className="text-xs text-red-700">{assignment.issueReason}</p>
              </div>
            </div>
          )}
        </div>}

        {activeTab === 'photos' && <OperationalEvidence assignment={assignment}
          expandedGroup={expandedPhotoGroup} onExpand={setExpandedPhotoGroup}
          onPreview={(url, type) => setPreviewDoc({ url, type })} />}

        {activeTab === 'documents' && <div className="space-y-4">
          {/* Documents */}
          <div ref={reviewSectionRef} tabIndex={reviewTarget ? -1 : undefined}
            role={reviewTarget ? 'region' : undefined} aria-label={reviewTarget ? `Document review for ${assignment.id}` : undefined}
            className={highlightReview && !reviewDocument ? 'rounded-xl bg-primary/5 ring-2 ring-primary/40' : undefined}>
            {/* Progress ring header */}
            <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/25 p-4 mb-3">
              <div className="relative flex items-center justify-center">
                <ProgressRing value={approvedCount} total={assignment.documents.length} />
                <span className="absolute text-[12px] font-bold text-foreground">
                  {approvedCount}/{assignment.documents.length}
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Documents</p>
                <p className="text-[15px] font-semibold text-foreground">
                  {approvedCount} of {assignment.documents.length} approved
                </p>
              </div>
            </div>
            {reviewTarget?.docType && !reviewDocument && <p role="status" className="mb-3 text-sm text-muted-foreground">This item is no longer available.</p>}
            <div className="space-y-2">
              {assignment.documents.map((doc) => (
                <div key={doc.type} ref={doc === reviewDocument ? reviewDocumentRef : undefined}
                  tabIndex={doc === reviewDocument ? -1 : undefined} aria-label={doc === reviewDocument ? `Review ${doc.type} for ${assignment.id}` : undefined}
                  className={`border border-border rounded-xl overflow-hidden transition-colors motion-reduce:transition-none ${highlightReview && doc === reviewDocument ? 'bg-primary/5 ring-2 ring-primary/40' : 'bg-white'}`}>
                  {/* Main row */}
                  <div className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <span className="text-muted-foreground flex-shrink-0 mt-0.5">{docTypeIcon(doc.type)}</span>
                        <span className="text-sm font-medium text-foreground break-words">{doc.type}</span>
                      </div>
                      <DocChip doc={doc} uploadAvailable={documentProgress?.applicable ?? false} />
                    </div>
                    {doc.uploaded && (
                      <div className="flex items-center justify-end gap-1.5 mt-2">
                        {doc.fileUrl && (
                          <button onClick={() => setPreviewDoc({ url: doc.fileUrl!, type: doc.type })}
                            className="flex items-center gap-1 px-2 py-1 bg-muted/50 border border-border rounded-lg text-xs hover:bg-accent transition-colors text-muted-foreground">
                            <ZoomIn className="w-3 h-3" /> View
                          </button>
                        )}
                        {doc.docStatus === 'pending' && !isViewOnly && (
                          <>
                            <button onClick={() => onApproveDoc(assignment!.id, doc.type)}
                              className="flex items-center gap-1 px-2.5 py-1 bg-green-500 text-white rounded-lg text-xs hover:bg-green-600 transition-colors">
                              <Check className="w-3 h-3" /> Approve
                            </button>
                            <button
                              onClick={() => { setRejectingDoc(doc.type); setRejectReason(''); }}
                              className="flex items-center gap-1 px-2.5 py-1 bg-red-500 text-white rounded-lg text-xs hover:bg-red-600 transition-colors">
                              <XCircle className="w-3 h-3" /> Reject
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Inline reject reason input — shown when this doc is being rejected */}
                  {rejectingDoc === doc.type && (
                    <div className="px-3 pb-3 pt-0 border-t border-red-100 bg-red-50/60">
                      <p className="text-xs text-red-600 font-medium mb-1.5 mt-2">
                        Reason for rejection <span className="font-normal text-red-400">(required)</span>
                      </p>
                      <textarea
                        autoFocus
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="e.g. Document is blurry, wrong document submitted, signature missing…"
                        rows={2}
                        className="w-full px-3 py-2 rounded-lg border border-red-200 bg-white text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-red-300/50 resize-none"
                      />
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => { setRejectingDoc(null); setRejectReason(''); }}
                          className="flex-1 py-1.5 border border-border rounded-lg text-xs hover:bg-accent transition-colors">
                          Cancel
                        </button>
                        <button
                          disabled={!rejectReason.trim()}
                          onClick={() => {
                            onRejectDoc(assignment!.id, doc.type, rejectReason);
                            setRejectingDoc(null);
                            setRejectReason('');
                          }}
                          className="flex-1 py-1.5 bg-red-500 text-white rounded-lg text-xs font-medium hover:bg-red-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1">
                          <XCircle className="w-3 h-3" /> Confirm Reject
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Reject reason display — shown after rejection */}
                  {doc.docStatus === 'rejected' && doc.rejectReason && (
                    <div className="px-3 pb-3 pt-2 border-t border-red-100 bg-red-50/40">
                      <p className="text-xs text-red-500 font-medium flex items-center gap-1 mb-0.5">
                        <XCircle className="w-3 h-3" /> Rejection Reason
                      </p>
                      <p className="text-xs text-red-700 leading-relaxed">{doc.rejectReason}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {!isViewOnly && assignment.taskStatus === 'Delivered' && !allApproved && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <p className="text-xs text-amber-700">All documents must be approved before marking as complete.</p>
            </div>
          )}
        </div>}
        </>
      )}
        </div>

        {/* ── Sticky action bar ── */}
        <footer className="flex flex-shrink-0 flex-col gap-2 border-t border-border bg-white px-4 py-3 sm:px-6">
          {completeError && <p role="alert" className="break-words text-sm text-red-700">{completeError}</p>}
          <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
          <button onClick={onClose}
            className="min-h-10 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent sm:min-w-32">
            Close
          </button>
          {assignment && !isViewOnly && completionEligible && (
            <button type="button" onClick={completeShipment} disabled={completeBusy}
              className="order-first flex min-h-10 items-center justify-center gap-2 rounded-xl bg-green-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-600 disabled:cursor-wait disabled:opacity-60 sm:order-none sm:ml-auto">
              <CheckCircle2 className="h-4 w-4" /> {completeBusy ? 'Completing…' : 'Mark as Complete'}
            </button>
          )}
          {/* Editable only while Assigned (the database re-checks this on save). */}
          {assignment?.taskStatus === 'Assigned' && !isViewOnly && (
            <button onClick={onEdit}
              className="min-h-10 flex-1 rounded-xl bg-[#1DBF73] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#19a865] flex items-center justify-center gap-2">
              <Pencil className="w-4 h-4" /> Edit
            </button>
          )}
          {/* Hidden once the driver has picked it up; cancel_assignment() refuses it too */}
          {assignment && !isViewOnly && assignment.taskStatus === 'Assigned' && (
            <button onClick={() => setConfirmCancel(true)}
              className="min-h-10 flex-1 rounded-xl border border-red-200 px-4 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 flex items-center justify-center gap-2">
              <Trash2 className="w-4 h-4" /> Cancel Assignment
            </button>
          )}
          </div>
        </footer>

        {/* ── Cancel confirmation ── */}
        {confirmCancel && assignment && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-black/30 backdrop-blur-[2px] p-5">
            <div className="bg-white rounded-xl border border-border shadow-xl p-5 w-full max-w-[340px]">
              <div className="w-10 h-10 rounded-full bg-red-50 border border-red-100 flex items-center justify-center mx-auto mb-3">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <p className="text-sm font-semibold text-foreground text-center">Cancel this assignment?</p>
              <p className="text-xs text-muted-foreground text-center mt-1">
                This releases {driver.name} and the assigned truck. It can't be undone.
              </p>
              {cancelError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3 break-words">{cancelError}</p>
              )}
              <div className="flex gap-2 mt-4">
                <button onClick={() => { setConfirmCancel(false); setCancelError(''); }}
                  className="flex-1 py-2 border border-border rounded-lg text-sm hover:bg-accent transition-colors">Keep It</button>
                <button disabled={cancelBusy}
                  onClick={async () => {
                    setCancelBusy(true); setCancelError('');
                    try { await onCancel(assignment.id); onClose(); }
                    catch (err) { setCancelError(actionMessage(errorCode(err))); }
                    finally { setCancelBusy(false); }
                  }}
                  className="flex-1 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  {cancelBusy ? 'Cancelling…' : 'Yes, Cancel'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Image Preview */}
      {previewDoc && (
        <ImagePreviewModal url={previewDoc.url} docType={previewDoc.type} onClose={() => setPreviewDoc(null)} />
      )}
    </div>
  );
}

/* ─── Edit Assignment Modal ────────────────────────── */
/* Failed password attempts are counted per browser tab and survive closing/reopening
   the modal. Supabase Auth also rate-limits sign-ins on its own servers. */
const REAUTH_MAX_FAILS   = 3;
const REAUTH_COOLDOWN_MS = 30_000;
let reauthFails       = 0;
let reauthLockedUntil = 0;

function savedMapboxStop(address: string | null | undefined, latitude: number | null | undefined,
  longitude: number | null | undefined, city: string | null): SelectedLocation | null {
  const point = coordinatePair(latitude, longitude);
  if (!address?.trim() || !point) return null;
  return { formatted: address, name: address, city, region: null,
    latitude: point.latitude, longitude: point.longitude, featureId: null };
}

function EditAssignmentModal({ assignment, drivers, trucks, assignments, onClose, onSaved, onServerChange }: {
  /* Live copy from props — null once it leaves the active list (completed/cancelled elsewhere) */
  assignment: Assignment | null;
  drivers: LocalDriver[]; trucks: LocalTruck[]; assignments: Assignment[];
  onClose: () => void;
  onSaved: (id: string) => void;
  onServerChange: (action: () => Promise<void>, onActionSuccess?: () => void) => Promise<void>;
}) {
  /* The version the form was opened with */
  const [original] = useState(assignment);
  const [routeFrom, routeTo] = (original?.destination ?? '').split('→').map((s) => s.trim());

  const [f, setF] = useState({
    driverId: original?.driverId ?? '', truckId: original?.truckId ?? '',
    from: routeFrom ?? '', to: original?.deliveryLocation || routeTo || '', destinationArea: original?.destinationArea ?? '',
    company: original?.company ?? '', pickupLocation: original?.pickupLocation ?? '',
    pickup: displayToIso(original?.pickedUpDate ?? ''), delivery: displayToIso(original?.deliveryDate ?? ''),
    pickupTime: displayToTime24(original?.pickupTime ?? ''), eta: displayToTime24(original?.eta ?? ''),
    remarks: original?.remarks ?? '', reason: '',
  });
  const [pickupSelected, setPickupSelected] = useState<SelectedLocation | null>(() =>
    savedMapboxStop(original?.pickupLocation, original?.pickupLatitude, original?.pickupLongitude, routeFrom ?? null));
  const [deliverySelected, setDeliverySelected] = useState<SelectedLocation | null>(() =>
    savedMapboxStop(original?.deliveryLocation, original?.deliveryLatitude, original?.deliveryLongitude,
      original?.destinationArea ?? null));
  const [badDates,  setBadDates]  = useState<BadDates>({ pickup: false, delivery: false });
  const [errors,    setErrors]    = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');

  /* Password confirmation step */
  const [pending,  setPending]  = useState<(AssignmentEdit & AssignmentLocationEdit) | null>(null);
  const [password, setPassword] = useState('');
  const [pwError,  setPwError]  = useState('');
  const [busy,     setBusy]     = useState(false);
  const [now,      setNow]      = useState(Date.now());

  /* Tick once a second while the password step is open, so the cooldown counts down */
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pending]);

  if (!original) return null;

  /* A poll may show the driver already picked it up — lock the form (the database refuses it anyway) */
  const stillEditable = !!assignment && assignment.taskStatus === 'Assigned';
  const lockedFor = Math.max(0, Math.ceil((reauthLockedUntil - now) / 1000));

  const set = (key: keyof typeof f, value: string, errKey: string = key) => {
    setF((p) => ({ ...p, [key]: value }));
    setErrors((p) => ({ ...p, [errKey]: '' }));
    setFormError('');
  };

  const setDate = (which: 'pickup' | 'delivery', v: string, bad?: boolean) => {
    const nextBad = { ...badDates, [which]: !!bad };
    const next    = { ...f, [which]: v };
    setBadDates(nextBad);
    setF(next);
    setFormError('');
    setErrors((p) => ({ ...p, pickedUpDate: '', date: '', eta: '', ...dateErrors(next.pickup, next.delivery, nextBad, false) }));
  };

  /* Drivers not on another active delivery (plus this one's driver); Available trucks (plus this one's truck) */
  const busyDrivers   = new Set(assignments.filter((a) => a.id !== original.id).map((a) => a.driverId));
  const driverOptions = drivers.filter((d) => !busyDrivers.has(d.id)).map((d) => ({ id: d.id, label: d.name }));
  const truckOptions  = trucks.filter((t) => t.status === 'Available' || t.id === original.truckId)
    .map((t) => ({ id: t.id, label: t.plateNumber }));
  const selectedTruck = trucks.find((t) => t.id === f.truckId) ?? null;

  const validate = () => {
    const e: Record<string, string> = {};
    if (!f.driverId)              e.driver         = 'Select a driver.';
    if (!f.truckId)               e.truck          = 'Select a truck.';
    if (!pickupSelected || pickupSelected.formatted !== f.pickupLocation ||
      !mapboxRouteArea(pickupSelected) || f.from.trim() !== mapboxRouteArea(pickupSelected))
      e.pickupLocation = 'Select a pickup location with a city or area from Mapbox.';
    if (!deliverySelected || deliverySelected.formatted !== f.to ||
      !mapboxRouteArea(deliverySelected) || f.destinationArea.trim() !== mapboxRouteArea(deliverySelected))
      e.to = 'Select a delivery location with a city or area from Mapbox.';
    if (!f.company.trim())        e.company        = 'Enter a client name.';
    Object.assign(e, scheduleErrors({
      pickup: f.pickup, delivery: f.delivery, pickupTime: f.pickupTime, eta: f.eta, remarks: f.remarks, bad: badDates,
    }));
    if (!f.reason.trim())                    e.reason = 'Enter the reason for this change.';
    else if (f.reason.trim().length > TEXT_MAX) e.reason = `Reason can be at most ${TEXT_MAX} characters.`;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  /* Only the fields that differ from the current record, in the stored formats */
  const buildChanges = (): AssignmentEdit & AssignmentLocationEdit => {
    const base = assignment ?? original;
    const next: Required<AssignmentEdit> = {
      driverId: f.driverId, truckId: f.truckId,
      destination: `${f.from.trim()} → ${f.to.trim()}`,
      destinationArea: f.destinationArea.trim(),
      company: f.company.trim(), pickupLocation: f.pickupLocation.trim(),
      pickupTime: time24ToDisplay(f.pickupTime), pickedUpDate: isoToDisplay(f.pickup),
      eta: time24ToDisplay(f.eta), deliveryDate: isoToDisplay(f.delivery),
      remarks: f.remarks.trim(),
    };
    const before: Required<AssignmentEdit> = {
      driverId: base.driverId, truckId: base.truckId, destination: base.destination,
      destinationArea: base.destinationArea ?? '',
      company: base.company, pickupLocation: base.pickupLocation,
      pickupTime: base.pickupTime, pickedUpDate: base.pickedUpDate,
      eta: base.eta, deliveryDate: base.deliveryDate, remarks: base.remarks,
    };
    const changes: AssignmentEdit & AssignmentLocationEdit = Object.fromEntries(
      (Object.keys(next) as (keyof AssignmentEdit)[]).filter((k) => next[k] !== before[k]).map((k) => [k, next[k]]),
    );
    const pickupPoint = pickupSelected?.formatted === f.pickupLocation ? pickupSelected : null;
    if (pickupPoint && (changes.pickupLocation !== undefined ||
      pickupPoint.latitude !== base.pickupLatitude || pickupPoint.longitude !== base.pickupLongitude)) {
      changes.pickupLatitude = pickupPoint.latitude;
      changes.pickupLongitude = pickupPoint.longitude;
    } else if (changes.pickupLocation !== undefined && base.pickupLatitude != null) {
      changes.pickupLatitude = null;
      changes.pickupLongitude = null;
    }
    const deliveryAddress = f.to.trim();
    const deliveryPoint = deliverySelected?.formatted === f.to ? deliverySelected : null;
    if (deliveryAddress !== (base.deliveryLocation ?? '') &&
      (deliveryPoint || deliveryAddress !== getDeliveryLocation(base))) {
      changes.deliveryLocation = deliveryAddress;
    }
    if (deliveryPoint && (changes.deliveryLocation !== undefined ||
      deliveryPoint.latitude !== base.deliveryLatitude || deliveryPoint.longitude !== base.deliveryLongitude)) {
      changes.deliveryLatitude = deliveryPoint.latitude;
      changes.deliveryLongitude = deliveryPoint.longitude;
    } else if (changes.deliveryLocation !== undefined && base.deliveryLatitude != null) {
      changes.deliveryLatitude = null;
      changes.deliveryLongitude = null;
    }
    return changes;
  };

  const handleSave = () => {
    if (!stillEditable || !validate()) return;
    const changes = buildChanges();
    if (Object.keys(changes).length === 0) { setFormError('Nothing has changed yet.'); return; }
    setPwError('');
    setPending(changes);
  };

  const handleConfirm = async () => {
    if (!pending || !password || busy || Date.now() < reauthLockedUntil) return;
    setBusy(true);
    setPwError('');
    const typed = password;
    setPassword('');                     // don't keep the password in state any longer than needed
    try {
      await verifyOwnPassword(typed);
      reauthFails = 0;
      await onServerChange(() => editAssignment(original.id, pending, f.reason.trim()));
      onSaved(original.id);
    } catch (err) {
      const code = errorCode(err);
      if (code === 'wrong_password') {
        reauthFails += 1;
        if (reauthFails >= REAUTH_MAX_FAILS) {
          reauthFails = 0;
          reauthLockedUntil = Date.now() + REAUTH_COOLDOWN_MS;
          setNow(Date.now());
          setPwError(`Too many failed attempts. Try again in ${REAUTH_COOLDOWN_MS / 1000} seconds.`);
        } else {
          const left = REAUTH_MAX_FAILS - reauthFails;
          setPwError(`Incorrect password. ${left} attempt${left === 1 ? '' : 's'} left.`);
        }
      } else {
        setPwError(actionMessage(code));
      }
    } finally {
      setBusy(false);
    }
  };

  const errText = (k: string) => errors[k] ? <p className="text-xs text-red-500 mt-1">{errors[k]}</p> : null;

  return (
    <>
      <ModalShell title={<>Edit Delivery · <ASNWithCopy value={original.id} /></>} onClose={onClose}>
        {!stillEditable && (
          <div className="flex items-start gap-2 p-3 mb-5 bg-red-50 border border-red-200 rounded-xl">
            <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-700">{actionMessage('not_editable')}</p>
          </div>
        )}

        <SectionHeader>Assignment</SectionHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel required>Driver Name</FieldLabel>
              <ResourceSelect value={f.driverId} onChange={(v) => set('driverId', v, 'driver')}
                options={driverOptions} placeholder="Select a driver…" emptyLabel="No drivers available"
                onAdd={() => {}} hasError={!!errors.driver} />
              {errText('driver')}
            </div>
            <div>
              <FieldLabel required>Truck</FieldLabel>
              <ResourceSelect value={f.truckId} onChange={(v) => set('truckId', v, 'truck')}
                options={truckOptions} placeholder="Select a truck…" emptyLabel="No trucks available"
                onAdd={() => {}} hasError={!!errors.truck} />
              {errText('truck')}
            </div>
          </div>

          {selectedTruck && (
            <div className="rounded-xl border border-border bg-white p-3">
              <TruckSummary truck={selectedTruck} typeFirst />
            </div>
          )}

          <div>
            <FieldLabel required>Pickup Location</FieldLabel>
            <MapboxLocationInput value={f.pickupLocation} selected={pickupSelected}
              onChange={(v) => { if (pickupSelected) set('from', ''); setPickupSelected(null); set('pickupLocation', v); }}
              onSelect={(place) => { setPickupSelected(place); set('pickupLocation', place.formatted); set('from', mapboxRouteArea(place)); }}
              placeholder="Search exact pickup address or location" hasError={!!errors.pickupLocation} />
            {errText('pickupLocation')}
          </div>

          <div>
            <FieldLabel required>Delivery Location</FieldLabel>
            <MapboxLocationInput value={f.to} selected={deliverySelected}
              onChange={(v) => { if (deliverySelected) set('destinationArea', ''); setDeliverySelected(null); set('to', v); }}
              onSelect={(place) => { setDeliverySelected(place); set('to', place.formatted); set('destinationArea', mapboxRouteArea(place)); }}
              placeholder="Search exact delivery address or location" hasError={!!errors.to} />
            {errText('to')}
          </div>

          {pickupSelected?.formatted === f.pickupLocation && deliverySelected?.formatted === f.to
            && mapboxRouteArea(pickupSelected) && mapboxRouteArea(deliverySelected) &&
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
              <span className="block font-medium text-foreground">Route</span>
              <span className="block break-words text-foreground">{mapboxRouteArea(pickupSelected)} → {mapboxRouteArea(deliverySelected)}</span>
              <span className="block text-xs text-muted-foreground">Automatically detected</span>
            </div>}

          <div>
            <FieldLabel required>Client</FieldLabel>
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <input type="text" value={f.company} onChange={(e) => set('company', e.target.value)}
                placeholder="Client or company name"
                className={`${fieldBase} ${fieldTone(!!errors.company)} pl-9`} />
            </div>
            {errText('company')}
          </div>

        </div>

        <div className="mt-7">
          <SectionHeader>Schedule</SectionHeader>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel required>Picked Up Date</FieldLabel>
              <DateField value={f.pickup} onChange={(v, bad) => setDate('pickup', v, bad)}
                hasError={!!errors.pickedUpDate} minIso={todayIso()} maxIso={f.delivery || oneYearAheadIso()} />
              {errText('pickedUpDate')}
            </div>
            <div>
              <FieldLabel required>Pick Up Time</FieldLabel>
              <TimeField value={f.pickupTime}
                onChange={(v) => { set('pickupTime', v); setErrors((p) => ({ ...p, eta: '' })); }}
                hasError={!!errors.pickupTime} />
              {errText('pickupTime')}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel required>Delivery Date</FieldLabel>
              <DateField value={f.delivery} onChange={(v, bad) => setDate('delivery', v, bad)}
                hasError={!!errors.date}
                minIso={f.pickup && f.pickup > todayIso() ? f.pickup : todayIso()} maxIso={oneYearAheadIso()} />
              {errText('date')}
            </div>
            <div>
              <FieldLabel required>ETA</FieldLabel>
              <TimeField value={f.eta} onChange={(v) => set('eta', v)} hasError={!!errors.eta} />
              {errText('eta')}
            </div>
          </div>

          <div>
            <FieldLabel hint="(optional)">Remarks</FieldLabel>
            <textarea value={f.remarks} maxLength={TEXT_MAX} onChange={(e) => set('remarks', e.target.value)}
              placeholder="Any special instructions…" rows={3}
              className={`${fieldBase} ${fieldTone(!!errors.remarks)} resize-none break-words`} />
            <div className="flex items-start justify-between gap-2 mt-1">
              {errors.remarks ? <p className="text-xs text-red-500">{errors.remarks}</p> : <span />}
              <CharCount value={f.remarks} />
            </div>
          </div>
        </div>

        <div className="mt-7">
          <SectionHeader>Reason for change</SectionHeader>
        </div>
        <div>
          <FieldLabel required>Reason</FieldLabel>
          <textarea value={f.reason} maxLength={TEXT_MAX} onChange={(e) => set('reason', e.target.value)}
            placeholder="e.g. Client moved the delivery to Friday" rows={2}
            className={`${fieldBase} ${fieldTone(!!errors.reason)} resize-none break-words`} />
          <div className="flex items-start justify-between gap-2 mt-1">
            {errors.reason ? <p className="text-xs text-red-500">{errors.reason}</p> : <span />}
            <CharCount value={f.reason} />
          </div>
        </div>

        {formError && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-5">{formError}</p>
        )}

        <div className="flex flex-col-reverse sm:flex-row gap-3 pt-6 sm:pt-7">
          <button onClick={onClose}
            className="px-5 py-2.5 border border-border rounded-[10px] hover:bg-accent transition-colors text-sm font-medium text-foreground inline-flex items-center justify-center gap-1.5">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <button onClick={handleSave} disabled={!stillEditable}
            className="flex-1 px-5 py-2.5 bg-[#1DBF73] text-white rounded-[10px] hover:bg-[#19a865] transition-all shadow-sm hover:shadow active:scale-[0.99] text-sm font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
            <CheckCircle2 className="w-4 h-4" /> Save Changes
          </button>
        </div>
      </ModalShell>

      {/* ── Re-enter password before saving ── */}
      {pending && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => { if (!busy) { setPending(null); setPassword(''); } }} />
          <form
            onSubmit={(e) => { e.preventDefault(); void handleConfirm(); }}
            className="relative bg-white rounded-xl border border-border shadow-xl p-5 w-full max-w-[360px] animate-in fade-in zoom-in-95 duration-200">
            <div className="w-10 h-10 rounded-full bg-[#1DBF73]/10 border border-[#1DBF73]/25 flex items-center justify-center mx-auto mb-3">
              <KeyRound className="w-5 h-5 text-[#1DBF73]" />
            </div>
            <p className="text-sm font-semibold text-foreground text-center">Confirm it's you</p>
            <p className="text-xs text-muted-foreground text-center mt-1">
              Enter your account password to save {Object.keys(pending).length} change{Object.keys(pending).length === 1 ? '' : 's'}.
            </p>
            <input type="password" autoFocus autoComplete="current-password" value={password}
              onChange={(e) => { setPassword(e.target.value); setPwError(''); }}
              disabled={busy || lockedFor > 0}
              placeholder="Password"
              className={`${fieldBase} ${fieldTone(!!pwError)} mt-4 disabled:opacity-60`} />
            {(pwError || lockedFor > 0) && (
              <p className="text-xs text-red-600 mt-1.5 break-words">
                {lockedFor > 0 ? `Too many failed attempts. Try again in ${lockedFor}s.` : pwError}
              </p>
            )}
            <div className="flex gap-2 mt-4">
              <button type="button" disabled={busy}
                onClick={() => { setPending(null); setPassword(''); }}
                className="flex-1 py-2 border border-border rounded-lg text-sm hover:bg-accent transition-colors disabled:opacity-50">
                Cancel
              </button>
              <button type="submit" disabled={busy || !password || lockedFor > 0}
                className="flex-1 py-2 bg-[#1DBF73] text-white rounded-lg text-sm font-medium hover:bg-[#19a865] transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {busy ? 'Saving…' : 'Confirm & Save'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

/* ─── Props ────────────────────────────────────────── */
interface Props {
  drivers: LocalDriver[];     setDrivers: React.Dispatch<React.SetStateAction<LocalDriver[]>>;
  trucks: LocalTruck[];       setTrucks:  React.Dispatch<React.SetStateAction<LocalTruck[]>>;
  assignments: Assignment[];  setAssignments: React.Dispatch<React.SetStateAction<Assignment[]>>;
  notifications: AppNotification[];
  activityLog: AdminActivityEntry[];
  completed: CompletedTask[]; setCompleted:   React.Dispatch<React.SetStateAction<CompletedTask[]>>;
  cancelled: Assignment[];    setCancelled: React.Dispatch<React.SetStateAction<Assignment[]>>;
  isViewOnly?: boolean;
  onLogActivity?: (entry: AdminActivityInput) => void;
  /* Runs a database-function change (edit / cancel), then reloads — see App.tsx */
  onServerChange: (action: () => Promise<void>, onActionSuccess?: () => void) => Promise<void>;
  adminEmail?: string | null;
  /* Dashboard "Dispatch Truck": open this screen's Dispatch Truck form once on arrival */
  openDispatchOnMount?: boolean;
  onDispatchOpened?: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  notificationTarget?: { assignmentId: string; docType?: string; review?: boolean } | null;
  onNotificationTargetHandled?: () => void;
}

const MONITOR_PAGE_SIZE = 6;
const RECENT_COMPLETED_LIMIT = 5;

function formatRecentCompletion(date: Date, today: string) {
  const day = dateToIso(date) === today ? 'Today' : 'Yesterday';
  return `${day} · ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

function reviewQueueRequested() {
  const params = new URLSearchParams(window.location.search);
  return params.get('review') === 'true' && !params.has('assignment');
}

/* ─── Main Component ───────────────────────────────── */
export default function DriversManagement({
  drivers, setDrivers, trucks, setTrucks,
  assignments, setAssignments, notifications, activityLog, completed, setCompleted, cancelled, setCancelled,
  isViewOnly = false, onLogActivity, onServerChange, adminEmail,
  openDispatchOnMount = false, onDispatchOpened, search, onSearchChange, notificationTarget, onNotificationTargetHandled,
}: Props) {

  const [timingNow, setTimingNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setTimingNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const [showAssignTask, setShowAssignTask] = useState(false);

  useEffect(() => {
    if (!openDispatchOnMount) return;
    if (!isViewOnly) setShowAssignTask(true);
    onDispatchOpened?.();
  }, [openDispatchOnMount]); // eslint-disable-line react-hooks/exhaustive-deps
  const [viewDetailsId,  setViewDetailsId]  = useState<string | null>(null);
  const [reviewTarget, setReviewTarget] = useState<{ assignmentId: string; docType?: string } | null>(null);
  const [missingTarget, setMissingTarget] = useState(false);
  const [editId,         setEditId]         = useState<string | null>(null);
  const [classificationFilter, setClassificationFilter] = useState('');
  const [completedOpen, setCompletedOpen] = useState(false);
  const [reviewQueueOpen, setReviewQueueOpen] = useState(reviewQueueRequested);

  useEffect(() => {
    const restoreReviewQueue = () => setReviewQueueOpen(reviewQueueRequested());
    window.addEventListener('popstate', restoreReviewQueue);
    window.addEventListener(ADMIN_NAVIGATION_EVENT, restoreReviewQueue);
    return () => {
      window.removeEventListener('popstate', restoreReviewQueue);
      window.removeEventListener(ADMIN_NAVIGATION_EVENT, restoreReviewQueue);
    };
  }, []);

  useLayoutEffect(() => {
    if (!reviewQueueOpen) return;
    setClassificationFilter('');
    if (search) onSearchChange('');
    setCompletedOpen(false);
    setViewDetailsId(null);
    setReviewTarget(null);
    setMissingTarget(false);
  }, [reviewQueueOpen]);

  /* ── Assign Task wizard ── */
  const [taskStep,        setTaskStep]        = useState<1 | 2>(1);
  const [taskDriverId,    setTaskDriverId]    = useState('');
  const [taskTruckId,     setTaskTruckId]     = useState('');
  const [taskFrom,        setTaskFrom]        = useState('');
  const [taskTo,          setTaskTo]          = useState('');
  const [taskDestinationArea, setTaskDestinationArea] = useState('');
  const [taskCompany,     setTaskCompany]     = useState('');
  /* Dates as "YYYY-MM-DD" — the value the native date input uses */
  const [taskDate,        setTaskDate]        = useState('');
  const [taskPickedUpDate, setTaskPickedUpDate] = useState('');
  const [taskRemarks,     setTaskRemarks]     = useState('');
  const [taskPickupLocation, setTaskPickupLocation] = useState('');
  const [taskPickupSelected, setTaskPickupSelected] = useState<SelectedLocation | null>(null);
  const [taskDeliverySelected, setTaskDeliverySelected] = useState<SelectedLocation | null>(null);
  /* Native time inputs → 24-hour "HH:MM" strings */
  const [taskPickupTime,  setTaskPickupTime]  = useState('');
  const [taskEta,         setTaskEta]         = useState('');
  const [taskErrors,      setTaskErrors]      = useState<Record<string, string>>({});
  const [taskBadDates,    setTaskBadDates]    = useState<BadDates>({ pickup: false, delivery: false });

  /* Quick-add layered over the Assign Task modal — the wizard stays mounted
     underneath, so anything already typed survives the round trip. */
  const [quickAdd, setQuickAdd] = useState<null | 'driver' | 'truck'>(null);

  const assignedDriverIds = new Set(assignments.map((a) => a.driverId));
  const availableDrivers  = drivers.filter((d) => !assignedDriverIds.has(d.id));
  const availableTrucks   = trucks.filter((t)  => t.status === 'Available');

  const resetAssignTask = () => {
    setShowAssignTask(false); setTaskStep(1); setTaskDriverId(''); setTaskTruckId('');
    setTaskFrom(''); setTaskTo(''); setTaskDestinationArea('');
    setTaskCompany(''); setTaskDate(''); setTaskPickedUpDate(''); setTaskRemarks('');
    setTaskPickupLocation(''); setTaskPickupSelected(null); setTaskDeliverySelected(null);
    setTaskPickupTime(''); setTaskEta('');
    setTaskErrors({}); setTaskBadDates({ pickup: false, delivery: false });
  };

  /* Live date check as the admin types or picks — shows the inline error straight away */
  const setTaskDateField = (which: 'pickup' | 'delivery', v: string, bad?: boolean) => {
    const nextBad  = { ...taskBadDates, [which]: !!bad };
    const pickup   = which === 'pickup'   ? v : taskPickedUpDate;
    const delivery = which === 'delivery' ? v : taskDate;
    setTaskBadDates(nextBad);
    if (which === 'pickup') setTaskPickedUpDate(v); else setTaskDate(v);
    setTaskErrors((p) => ({ ...p, pickedUpDate: '', date: '', eta: '', ...dateErrors(pickup, delivery, nextBad, false) }));
  };

  /* ── Step 1: Assignment info ── */
  const validateStep1 = () => {
    const e: Record<string, string> = {};
    if (!taskDriverId)              e.driver         = 'Select a driver.';
    if (!taskTruckId)               e.truck          = 'Select a truck.';
    if (!taskPickupSelected || taskPickupSelected.formatted !== taskPickupLocation ||
      !mapboxRouteArea(taskPickupSelected) || taskFrom.trim() !== mapboxRouteArea(taskPickupSelected))
      e.pickupLocation = 'Select a pickup location with a city or area from Mapbox.';
    if (!taskDeliverySelected || taskDeliverySelected.formatted !== taskTo ||
      !mapboxRouteArea(taskDeliverySelected) || taskDestinationArea.trim() !== mapboxRouteArea(taskDeliverySelected))
      e.to = 'Select a delivery location with a city or area from Mapbox.';
    if (!taskCompany.trim())        e.company        = 'Enter a client name.';
    setTaskErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNextStep = () => { if (validateStep1()) { setTaskErrors({}); setTaskStep(2); } };

  const handleAssignTask = () => {
    /* Same rules as the live check, re-run on submit (typed dates skip the calendar's limits) */
    const e = scheduleErrors({
      pickup: taskPickedUpDate, delivery: taskDate, pickupTime: taskPickupTime, eta: taskEta,
      remarks: taskRemarks, bad: taskBadDates,
    });

    if (Object.keys(e).length) { setTaskErrors(e); return; }

    /* Step 1 is already validated, but re-check in case state changed behind us */
    if (!validateStep1()) { setTaskStep(1); return; }

    const driver      = drivers.find((d) => d.id === taskDriverId)!;
    const truck       = trucks.find((t)  => t.id  === taskTruckId)!;
    const newAssignId = `ASN${String(Date.now()).slice(-5)}`;

    setAssignments((p) => [...p, {
      id: newAssignId,
      driverName: driver.name, driverId: driver.id,
      truckPlate: truck.plateNumber, truckId: truck.id,
      destination:     `${taskFrom.trim()} → ${taskTo.trim()}`,
      ...(destinationAreaEnabled ? { destinationArea: taskDestinationArea.trim() } : {}),
      company:         taskCompany.trim(),
      pickupLocation:  taskPickupLocation.trim(),
      ...(taskPickupSelected?.formatted === taskPickupLocation ? {
        pickupLatitude: taskPickupSelected.latitude, pickupLongitude: taskPickupSelected.longitude,
      } : {}),
      deliveryLocation: taskTo.trim(),
      ...(taskDeliverySelected?.formatted === taskTo ? {
        deliveryLatitude: taskDeliverySelected.latitude, deliveryLongitude: taskDeliverySelected.longitude,
      } : {}),
      pickupTime:      time24ToDisplay(taskPickupTime),
      pickedUpDate:    isoToDisplay(taskPickedUpDate),
      eta:             time24ToDisplay(taskEta),
      /* ATA is captured later, when the task is marked as delivered */
      ata:             '',
      deliveryDate:    isoToDisplay(taskDate),
      remarks:         taskRemarks.trim(),
      taskStatus: 'Assigned',
      documents: DOCUMENT_TYPES.map((type) => ({ type, uploaded: false, docStatus: 'pending' as DocStatus })),
      assignedAt: new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    }]);
    markLocalRecordAdded('assignment', newAssignId);
    activePage.setPage(1);
    setDrivers((p) => p.map((d) => d.id === taskDriverId ? { ...d, status: 'Assigned' as const } : d));
    setTrucks((p)  => p.map((t) => t.id === taskTruckId  ? { ...t, status: 'Assigned' }   : t));
    onLogActivity?.({
      type: 'task_assigned',
      driverName: driver.name,
      truckPlate: truck.plateNumber,
      assignmentId: newAssignId,
      destination: `${taskFrom.trim()} → ${destinationAreaEnabled ? taskDestinationArea.trim() : taskTo.trim()}`,
      company: taskCompany.trim(),
    });
    resetAssignTask();
  };

  /* A document can be (re-)uploaded after the delivery is already archived to
     `completed` (e.g. a driver fixing a document that failed to save earlier),
     so review has to reach that array too, not just the still-active one. */
  const handleApproveDoc = (assignId: string, docType: string) => {
    const a = assignments.find((x) => x.id === assignId) ?? completed.find((x) => x.id === assignId);
    const patch = (d: AssignmentDoc) => d.type === docType ? { ...d, docStatus: 'approved' as DocStatus } : d;
    setAssignments((p) => p.map((x) => x.id !== assignId ? x : { ...x, documents: x.documents.map(patch) }));
    setCompleted((p) => p.map((x) => x.id !== assignId ? x : { ...x, documents: x.documents.map(patch) }));
    onLogActivity?.({
      type: 'doc_approved',
      driverName: a?.driverName,
      truckPlate: a?.truckPlate,
      assignmentId: assignId,
      docType,
    });
  };

  const handleRejectDoc = (assignId: string, docType: string, reason: string) => {
    const a = assignments.find((x) => x.id === assignId) ?? completed.find((x) => x.id === assignId);
    const patch = (d: AssignmentDoc) =>
      d.type === docType ? { ...d, docStatus: 'rejected' as DocStatus, rejectReason: reason.trim() || undefined } : d;
    setAssignments((p) => p.map((x) => x.id !== assignId ? x : { ...x, documents: x.documents.map(patch) }));
    setCompleted((p) => p.map((x) => x.id !== assignId ? x : { ...x, documents: x.documents.map(patch) }));
    onLogActivity?.({
      type: 'doc_rejected',
      driverName: a?.driverName,
      truckPlate: a?.truckPlate,
      assignmentId: assignId,
      docType,
      rejectReason: reason.trim(),
    });
  };

  /* ── Demo-only: "adminabuse" account can force a driver's pickup/delivery
     time a couple minutes into the past, so the driver's app immediately
     shows the real late-delay prompt without waiting on the clock or
     fighting the Assign Task form's future-only date/time validation. ── */
  const handleSimulateLate = (id: string) => {
    const pastTime = (minutesAgo: number) => {
      const d = new Date(Date.now() - minutesAgo * 60000);
      const h24 = d.getHours();
      const ampm = h24 >= 12 ? 'PM' : 'AM';
      const h12 = h24 % 12 || 12;
      return `${h12}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
    };
    /* The driver app judges lateness against the scheduled DATE + time
       together (not just time-of-day) — so forcing only the time into the
       past isn't enough once that scheduled date is still weeks out; the
       date has to move to today too, or the combined moment is still in
       the future and the driver never sees the late prompt. */
    const today = isoToDisplay(todayIso());
    setAssignments((p) => p.map((x) => {
      if (x.id !== id) return x;
      if (x.taskStatus === 'Assigned')  return { ...x, pickedUpDate: today, pickupTime: pastTime(2) };
      if (x.taskStatus === 'In Transit') return { ...x, deliveryDate: today, ata: pastTime(2) };
      return x;
    }));
  };

  const handleComplete = async (id: string) => {
    const a = assignments.find((x) => x.id === id);
    if (completed.some((item) => item.id === id)) throw new Error('This assignment is already completed.');
    if (!a || !canCompleteAssignment(a)) {
      throw new Error('All required documents must be approved before marking this delivery complete.');
    }
    const nextCompleted = [...completed, { ...a, completedAt: new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }];
    const nextAssignments = assignments.filter((x) => x.id !== id);
    const nextDrivers = drivers.map((d) => d.id === a.driverId ? { ...d, status: 'Complete' as const } : d);
    const nextTrucks = trucks.map((t) => t.plateNumber === a.truckPlate ? { ...t, status: 'Available' as const } : t);
    const completionActivity: AdminActivityEntry = {
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      type: 'task_completed',
      driverName: a.driverName,
      truckPlate: a.truckPlate,
      assignmentId: id,
      destination: a.destination,
      company: a.company,
      adminEmail: adminEmail ?? undefined,
    };
    // Use the existing save path, but show success only after it has persisted.
    await onServerChange(
      () => syncAdminData({ drivers: nextDrivers, trucks: nextTrucks, assignments: nextAssignments,
        completed: nextCompleted, cancelled, notifications, activityLog: [completionActivity, ...activityLog] }),
      () => {
        setAssignments(nextAssignments);
        setCompleted(nextCompleted);
        setDrivers(nextDrivers);
        setTrucks(nextTrucks);
      },
    );
  };

  /* Goes through the cancel_assignment() database function, not the auto-save: it refuses
     unless the delivery is still 'Assigned', frees the driver + truck, and writes the
     audit-log entry itself. The screen reloads afterwards (onServerChange). */
  const handleCancel = async (id: string) => {
    const assignment = assignments.find((item) => item.id === id);
    try {
      await onServerChange(() => cancelAssignment(id), () => {
        if (!assignment) return;
        setAssignments((current) => current.filter((item) => item.id !== id));
        setCancelled((current) => current.some((item) => item.id === id)
          ? current : [{ ...assignment, taskStatus: 'Cancelled' }, ...current]);
        if (!assignments.some((item) => item.id !== id && item.driverId === assignment.driverId)) {
          setDrivers((current) => current.map((driver) => driver.id === assignment.driverId
            ? { ...driver, status: 'Pending' } : driver));
        }
        if (!assignments.some((item) => item.id !== id && item.truckId === assignment.truckId)) {
          setTrucks((current) => current.map((truck) => truck.id === assignment.truckId
            ? { ...truck, status: 'Available' } : truck));
        }
      });
      toast.success('Assignment cancelled successfully.', { duration: 3000 });
    } catch (error) {
      toast.error('Unable to cancel this assignment. Please try again.', { duration: 3000 });
      throw error;
    }
  };

  const sq = search.trim().toLowerCase();
  /* The assignment is the source of truth for Dispatch. A missing or archived
     master record must not hide an otherwise active shipment that Deliveries
     still shows; the card can render its saved driver name and truck plate. */
  const validAssignments = assignments;
  const reviewAssignments = reviewQueueOpen
    ? assignments.filter((assignment) => assignment.documents.some((doc) => doc.uploaded && doc.docStatus === 'pending'))
    : validAssignments;
  const matchingClassifications = classificationFilter
    ? reviewAssignments.filter((a) => trucks.find((t) => t.id === a.truckId)?.classification === classificationFilter)
    : reviewAssignments;
  const visibleAssignments = sortNewestFirst(sq
    ? matchingClassifications.filter((a) =>
        [a.truckPlate, a.id, a.driverName, a.destination, a.destinationArea ?? '', a.company, a.taskStatus].some((f) =>
          f.toLowerCase().includes(sq)
        )
      )
    : matchingClassifications, (assignment) => assignment.id);
  const activePage = usePagination(visibleAssignments, MONITOR_PAGE_SIZE);
  const newAssignmentId = useLocalAddedHighlight('assignment', () => activePage.setPage(1));
  useLayoutEffect(() => { activePage.setPage(1); }, [search, reviewQueueOpen, activePage.setPage]);
  useEffect(() => {
    if (!notificationTarget) return;
    setReviewTarget(null);
    const assignment = assignments.find(a => a.id === notificationTarget.assignmentId)
      ?? completed.find(a => a.id === notificationTarget.assignmentId);
    if (!assignment || !drivers.some(driver => driver.id === assignment.driverId)) {
      setViewDetailsId(null);
      setMissingTarget(true);
    } else {
      setMissingTarget(false);
      setViewDetailsId(assignment.id);
      if (notificationTarget.review) setReviewTarget({ assignmentId: assignment.id, docType: notificationTarget.docType });
      setCompletedOpen(false);
      setClassificationFilter('');
      if (search) onSearchChange('');
      activePage.setPage(1);
    }
    onNotificationTargetHandled?.();
  }, [notificationTarget]);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const todayKey = dateToIso(today);
  const yesterdayKey = dateToIso(yesterday);
  const recentCompleted = completed.flatMap((assignment) => {
    const date = parseStoredTimestamp(assignment.completedAt);
    if (!date || (dateToIso(date) !== todayKey && dateToIso(date) !== yesterdayKey)) return [];
    return [{ assignment, date }];
  }).sort((left, right) => right.date.getTime() - left.date.getTime() || right.assignment.id.localeCompare(left.assignment.id));
  const visibleCompleted = recentCompleted.slice(0, RECENT_COMPLETED_LIMIT);
  const openCompletedDelivery = (assignmentId: string) => {
    setCompletedOpen(false);
    pushAdminNavigation('Deliveries', { assignmentId }, 'completed');
  };
  const activePageArea = useStablePageHeight(activePage.page, visibleAssignments.length, MONITOR_PAGE_SIZE, `${search}|${classificationFilter}`);

  const viewDetailsAssign = viewDetailsId
    ? assignments.find((a) => a.id === viewDetailsId) ?? completed.find((a) => a.id === viewDetailsId)
      ?? cancelled.find((a) => a.id === viewDetailsId) ?? null
    : null;
  const viewDetailsDriver = viewDetailsAssign ? drivers.find((d) => d.id === viewDetailsAssign.driverId) ?? null : null;

  /* ════════════ RENDER ════════════ */
  return (
    <div className="space-y-8">

      {missingTarget && <p role="status" className="rounded-lg border border-border bg-white px-4 py-3 text-sm text-muted-foreground">This item is no longer available.</p>}

      {/* ── Header ── */}
      <div className="relative flex flex-col justify-between gap-4 2xl:flex-row 2xl:items-center">
        <div className="min-w-0 2xl:flex-1">
          <h2 className="text-2xl font-semibold text-foreground">Dispatch &amp; Drivers</h2>
          <p className="text-sm text-muted-foreground mt-1">Manage dispatch assignments, drivers, and delivery operations.</p>
        </div>
        <div className="grid w-full min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:flex xl:flex-nowrap xl:items-center xl:justify-end 2xl:w-auto">
          <div className="w-full min-w-0 sm:col-span-2 xl:w-auto">
            <Dialog open={completedOpen} onOpenChange={setCompletedOpen}>
              <DialogTrigger asChild>
                <button type="button"
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-white px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/30 xl:w-auto">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" /> Recent Completed
                  <span className="rounded-full bg-green-500 px-2 py-0.5 text-xs text-white">{recentCompleted.length}</span>
                  <ChevronDown className={'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 ' + (completedOpen ? 'rotate-180' : '')} />
                </button>
              </DialogTrigger>
            <DialogContent hideCloseButton aria-describedby="recent-completed-description"
              className="top-0 left-0 flex h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 shadow-xl sm:top-1/2 sm:left-1/2 sm:h-[min(84vh,720px)] sm:max-h-[720px] sm:w-[94vw] sm:max-w-[880px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border">
              <div className="flex shrink-0 items-center gap-3 border-b border-border bg-white px-4 py-4 sm:px-6">
                <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700">
                  <Check className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <DialogTitle className="text-base font-semibold leading-tight text-foreground">Recent Completed Deliveries</DialogTitle>
                    <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-green-100 px-1.5 text-xs font-semibold text-green-700">{recentCompleted.length}</span>
                  </div>
                  <DialogDescription id="recent-completed-description" className="mt-0.5 text-[13px] leading-tight">Today &amp; yesterday</DialogDescription>
                </div>
                <DialogClose aria-label="Close recent completed deliveries" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                  <X className="h-4 w-4" />
                </DialogClose>
              </div>
              <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
              {recentCompleted.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">No recent completed deliveries.</p>
              ) : (
                  <div>
                    <table className="hidden w-full table-fixed text-xs lg:table xl:text-sm">
                      <colgroup>
                        <col className="w-[20%]" /><col className="w-[14%]" /><col className="w-[18%]" />
                        <col className="w-[15%]" /><col className="w-[14%]" /><col className="w-[19%]" />
                      </colgroup>
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          {['TRUCK #', 'DRIVER', 'ROUTE', 'CUSTOMER', 'DELIVERY DATE', 'COMPLETED AT'].map((col) => (
                            <th key={col} className="px-2 py-3 text-left text-xs font-semibold tracking-wide text-muted-foreground">{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {visibleCompleted.map(({ assignment: c, date }) => (
                          <tr key={c.id} role="link" tabIndex={0}
                            aria-label={`View completed delivery ${c.id} for ${c.driverName}`}
                            onClick={(event) => {
                              if ((event.target as Element).closest('button, a')) return;
                              openCompletedDelivery(c.id);
                            }}
                            onKeyDown={(event) => {
                              if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
                              event.preventDefault();
                              openCompletedDelivery(c.id);
                            }}
                            className="cursor-pointer border-b border-border/50 transition-colors hover:bg-muted/30 focus-visible:bg-muted/30 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary">
                            <td className="px-2 py-3 align-top">
                              <div className="flex min-w-0 items-start gap-2">
                                <Truck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#0d9488]" />
                                <span className="min-w-0">
                                  <span className="block whitespace-nowrap font-semibold text-[#0d9488]">{c.truckPlate}</span>
                                  <span className="block whitespace-nowrap text-xs text-muted-foreground"><ASNWithCopy value={c.id} noWrap /></span>
                                  {trucks.find((t) => t.id === c.truckId)?.classification && <span className="block break-words text-xs text-muted-foreground">{trucks.find((t) => t.id === c.truckId)?.classification}</span>}
                                </span>
                              </div>
                            </td>
                            <td className="px-2 py-3 align-top text-foreground [overflow-wrap:anywhere]">{c.driverName}</td>
                            <td className="px-2 py-3 align-top text-foreground [overflow-wrap:anywhere]">{getAssignmentRoute(c)}</td>
                            <td className="px-2 py-3 align-top text-foreground [overflow-wrap:anywhere]">{c.company}</td>
                            <td className="px-2 py-3 align-top text-foreground [overflow-wrap:anywhere]">{c.deliveryDate}</td>
                            <td className="px-2 py-3 align-top [overflow-wrap:anywhere]">
                              <span className="inline-block max-w-full rounded-full border border-green-200 bg-green-100 px-2 py-1 text-xs text-green-700">{formatRecentCompletion(date, todayKey)}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="divide-y divide-border/50 lg:hidden">
                      {visibleCompleted.map(({ assignment: c, date }) => (
                        <div key={c.id} role="link" tabIndex={0}
                          aria-label={`View completed delivery ${c.id} for ${c.driverName}`}
                          onClick={(event) => {
                            if ((event.target as Element).closest('button, a')) return;
                            openCompletedDelivery(c.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
                            event.preventDefault();
                            openCompletedDelivery(c.id);
                          }}
                          className="grid min-w-0 cursor-pointer grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 py-3 text-sm transition-colors hover:bg-muted/30 focus-visible:bg-muted/30 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary [overflow-wrap:anywhere]">
                          <span className="text-xs font-semibold text-muted-foreground">TRUCK #</span>
                          <span className="inline-flex min-w-0 items-start gap-2 text-[#0d9488]"><Truck className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="min-w-0"><span className="block whitespace-nowrap font-semibold">{c.truckPlate}</span><span className="block whitespace-nowrap text-xs text-muted-foreground"><ASNWithCopy value={c.id} noWrap /></span>{trucks.find((t) => t.id === c.truckId)?.classification && <span className="block break-words text-xs text-muted-foreground">{trucks.find((t) => t.id === c.truckId)?.classification}</span>}</span></span>
                          <span className="text-xs font-semibold text-muted-foreground">DRIVER</span><span className="min-w-0 text-foreground">{c.driverName}</span>
                          <span className="text-xs font-semibold text-muted-foreground">ROUTE</span><span className="min-w-0 text-foreground">{getAssignmentRoute(c)}</span>
                          <span className="text-xs font-semibold text-muted-foreground">CUSTOMER</span><span className="min-w-0 text-foreground">{c.company}</span>
                          <span className="text-xs font-semibold text-muted-foreground">DELIVERY DATE</span><span className="min-w-0 text-foreground">{c.deliveryDate}</span>
                          <span className="text-xs font-semibold text-muted-foreground">COMPLETED AT</span>
                          <span className="min-w-0"><span className="inline-block max-w-full rounded-full border border-green-200 bg-green-100 px-2 py-1 text-xs text-green-700">{formatRecentCompletion(date, todayKey)}</span></span>
                        </div>
                      ))}
                    </div>
                  </div>
              )}
              </div>
              <div className="flex shrink-0 flex-col gap-3 border-t border-border bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <p className="text-sm text-muted-foreground">Showing {visibleCompleted.length}{recentCompleted.length > visibleCompleted.length ? ` of ${recentCompleted.length}` : ''} completed deliver{visibleCompleted.length === 1 ? 'y' : 'ies'}</p>
                <button type="button" onClick={() => { setCompletedOpen(false); pushAdminNavigation('Deliveries', undefined, 'completed'); }}
                  className="inline-flex min-h-11 w-full items-center gap-2 rounded-lg border border-border bg-white px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:w-auto">
                  <ClipboardList aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>View All Completed Deliveries</span><ChevronRight aria-hidden="true" className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </div>
            </DialogContent>
            </Dialog>
          </div>
          <div className="relative w-full min-w-0 xl:w-48">
            <select
              aria-label="Truck Classification"
              value={classificationFilter}
              onChange={(e) => { setClassificationFilter(e.target.value); activePage.setPage(1); }}
              className={`h-12 w-full min-w-0 appearance-none rounded-xl border bg-white py-2 pl-3 pr-10 text-sm text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-primary ${classificationFilter ? 'border-primary' : 'border-border'}`}
            >
              <option value="">All Classifications</option>
              {TRUCK_CLASSIFICATIONS.map((classification) => (
                <option key={classification.value} value={classification.value}>{classification.value}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
          {!isViewOnly && (
            <button onClick={() => setShowAssignTask(true)}
              className="flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-primary px-6 text-sm font-semibold text-white shadow-md transition-all hover:bg-primary/90 hover:shadow-lg active:scale-[0.98] xl:w-auto">
              <Plus className="w-5 h-5" /> Dispatch Truck
            </button>
          )}
        </div>
      </div>

      {reviewQueueOpen && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="text-muted-foreground">{reviewAssignments.length} assignment{reviewAssignments.length === 1 ? '' : 's'} requiring review</p>
          <button type="button" onClick={() => pushAdminNavigation('Monitor')}
            className="min-h-10 text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            Show all assignments
          </button>
        </div>
      )}

      {/* ── Main Board ── */}
      {validAssignments.length === 0 && !classificationFilter && !reviewQueueOpen ? (
        <div className="bg-white rounded-2xl border border-dashed border-border p-16 text-center">
          <ClipboardList className="w-14 h-14 mx-auto mb-4 text-muted-foreground/30" />
          <p className="font-semibold text-foreground mb-1">No Active Assignments</p>
          <p className="text-sm text-muted-foreground mb-5">
            Click <strong>Dispatch Truck</strong> to dispatch a driver and truck.
          </p>
          <button onClick={() => setShowAssignTask(true)}
            className="px-5 py-2.5 bg-primary text-white rounded-lg text-sm hover:bg-primary/90 transition-colors">
            + Dispatch Truck
          </button>
        </div>
      ) : visibleAssignments.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-border p-16 text-center">
          <Search className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
          {reviewQueueOpen && !classificationFilter && !sq ? (
            <p role="status" className="font-semibold text-foreground">No documents waiting for review.</p>
          ) : classificationFilter ? (
            <p className="font-semibold text-foreground">No trucks found for this classification.</p>
          ) : (
            <>
              <p className="font-semibold text-foreground mb-1">No results for "{search}"</p>
              <p className="text-sm text-muted-foreground">Try a different truck plate, driver name, or route.</p>
              <button onClick={() => onSearchChange('')} className="mt-4 px-4 py-2 bg-muted text-foreground rounded-lg text-sm hover:bg-muted/80 transition-colors">
                Clear Search
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          {sq && (
            <p className="text-sm text-muted-foreground -mt-4">
              <span className="font-semibold text-foreground">{visibleAssignments.length}</span> result{visibleAssignments.length !== 1 ? 's' : ''} for "<span className="font-semibold text-foreground">{search}</span>"
            </p>
          )}
        <div className="space-y-3">
        <div ref={activePageArea}>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {activePage.pageItems.map((a) => {
            const truck    = trucks.find((t) => t.id === a.truckId);
            const { delivery: timing, pickup: pickupTiming } = getDispatchTimingNotices(a, timingNow);
            const docs = getAssignmentDocumentProgress(a);
            const documentAge = getDocumentAgingState(a, timingNow, notifications);
            const operational = getAdminOperationalProgress(a);
            const activeDuration = a.operationalStage === 'loading' && a.loadingStartedAt
              ? formatOperationalDuration(a.loadingStartedAt, timingNow)
              : a.operationalStage === 'unloading' && a.unloadingStartedAt
                ? formatOperationalDuration(a.unloadingStartedAt, timingNow) : null;
            const ageText = documentAge?.days == null ? null : documentAge.days === 0
              ? 'Delivered today' : `${documentAge.days} day${documentAge.days === 1 ? '' : 's'} since delivery`;

            return (
              <div key={a.id}
                style={newRecordHighlight(a.id, newAssignmentId)}
                className={`flex h-full flex-col rounded-xl border-[0.5px] overflow-hidden ${
                  sq ? 'border-yellow-400 bg-yellow-50/30' : timing?.kind === 'overdue' || pickupTiming?.kind === 'pickup_overdue' ? 'border-red-200 bg-white' : 'border-border bg-white'
                }`}
              >
                <div className="flex flex-1 flex-col p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base sm:text-lg font-bold leading-tight text-foreground break-words">{truck?.classification || 'Truck'}</h3>
                      <p className="mt-1 w-fit max-w-full rounded-md bg-muted/70 px-2 py-0.5 text-base font-semibold text-foreground break-words">
                        <Highlight text={a.truckPlate} query={search} />
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground break-words"><ASNWithCopy value={a.id}><Highlight text={a.id} query={search} /></ASNWithCopy></p>
                    </div>
                    <div className="ml-auto shrink-0"><DispatchStatusBadge assignment={a} /></div>
                  </div>

                  <div className="mt-4 border-t border-border pt-4">
                    <div className="grid grid-cols-1 gap-3 border-b border-border pb-3 sm:grid-cols-2 sm:gap-0">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Driver</p>
                        <p className="mt-0.5 text-sm font-semibold text-foreground break-words"><Highlight text={a.driverName} query={search} /></p>
                      </div>
                      <div className="min-w-0 sm:border-l sm:border-border sm:pl-4">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Corporation</p>
                        <p className="mt-0.5 text-sm text-foreground break-words"><Highlight text={a.company} query={search} /></p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 pt-3 sm:grid-cols-2 sm:gap-0">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Route</p>
                        <p className="mt-0.5 text-sm text-foreground [overflow-wrap:anywhere]"><Highlight text={getAssignmentRoute(a)} query={search} /></p>
                      </div>
                      <div className="min-w-0 sm:border-l sm:border-border sm:pl-4">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Delivery date</p>
                        <p className="mt-0.5 text-sm text-foreground break-words">{a.deliveryDate}</p>
                        {timing && !(documentAge && timing.kind === 'delivered_late') && <div className="mt-1.5"><DeliveryTimingBadge timing={timing} /></div>}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col md:mt-3 md:min-h-[4.5rem] md:gap-2">
                    {pickupTiming?.kind === 'pickup_overdue' && (
                      <div className="mt-3 md:mt-0"><PickupTimingNotice timing={pickupTiming} /></div>
                    )}

                    {activeDuration && <p className="mt-3 text-sm text-muted-foreground md:mt-0">
                      {a.operationalStage === 'loading' ? 'Loading' : 'Unloading'} in progress · {activeDuration}
                    </p>}
                    {operational.syncWarning && <p className="mt-3 text-sm text-amber-800 md:mt-0" role="status">
                      {operational.syncWarning}
                    </p>}

                    {documentAge && (
                      <div className="mt-3 flex min-w-0 items-start gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2.5 text-yellow-800 md:mt-0">
                        <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        <div className="min-w-0 text-xs leading-snug">
                          <p className="font-semibold">Waiting for documents{ageText ? ` · ${ageText}` : ''}</p>
                          {documentAge.deliveredOn && <p className="mt-0.5 text-yellow-800">Delivery completed on {documentAge.deliveredOn}.</p>}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 md:mt-auto md:pt-4">
                  <div className="rounded-lg bg-muted/40 p-3 md:min-h-24">
                    {/* Segmented document bar — green only ever means approved */}
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="font-medium text-foreground">Documents</span>
                      <span className="font-medium text-foreground">{docs.uploaded} of {docs.required}</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-1.5 flex overflow-hidden">
                      <div className="bg-green-500 h-full transition-all"
                        style={{ width: `${docs.required ? (docs.approved / docs.required) * 100 : 0}%` }} />
                      <div className="bg-amber-500 h-full transition-all"
                        style={{ width: `${docs.required ? ((docs.pending + docs.rejected) / docs.required) * 100 : 0}%` }} />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[12px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Check className="w-3 h-3 text-green-600" />{docs.approved} approved
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3 text-amber-500" />{docs.pending} pending review
                      </span>
                      {docs.rejected > 0 && <span className="inline-flex items-center gap-1 text-red-700"><AlertTriangle className="w-3 h-3" />{docs.rejected} needs correction</span>}
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3 text-gray-400" />{docs.missing} awaiting upload
                      </span>
                    </div>
                  </div>
                  </div>
                </div>

                <div className="flex justify-end px-4 pb-4 sm:px-5 sm:pb-5">
                  <button onClick={() => {
                    if (reviewQueueOpen && !drivers.some((driver) => driver.id === a.driverId)) {
                      setMissingTarget(true);
                      return;
                    }
                    setViewDetailsId(a.id);
                    if (reviewQueueOpen) setReviewTarget({ assignmentId: a.id });
                  }}
                    className="min-h-10 rounded-lg bg-[#10b981] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#059669]">
                    {reviewQueueOpen ? 'Review documents' : 'View Shipment'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        </div>
        <PaginationFooter page={activePage.page} totalItems={visibleAssignments.length} pageSize={MONITOR_PAGE_SIZE}
          onPageChange={activePage.setPage} singular="assignment" plural="assignments"
          className="rounded-xl border border-border bg-white shadow-sm" />
        </div>
        </>
      )}

      {/* ════ MODALS ════ */}

      {showAssignTask && (
        <ModalShell title="Dispatch Truck" onClose={resetAssignTask}>
          <StepProgress step={taskStep} />

          {/* ══════════ STEP 1 — Assignment ══════════ */}
          {taskStep === 1 && (
            <div>
              <SectionHeader>Assignment</SectionHeader>

              <div className="space-y-4">
                {/* Driver + Truck */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <FieldLabel required>Driver Name</FieldLabel>
                    <ResourceSelect
                      value={taskDriverId}
                      onChange={(v) => { setTaskDriverId(v); setTaskErrors((p) => ({ ...p, driver: '' })); }}
                      options={availableDrivers.map((d) => ({ id: d.id, label: d.name }))}
                      placeholder="Select a driver…"
                      emptyLabel="No drivers available"
                      onAdd={() => setQuickAdd('driver')}
                      hasError={!!taskErrors.driver}
                    />
                    {taskErrors.driver && <p className="text-xs text-red-500 mt-1">{taskErrors.driver}</p>}
                  </div>
                  <div>
                    <FieldLabel required>Truck</FieldLabel>
                    <ResourceSelect
                      value={taskTruckId}
                      onChange={(v) => { setTaskTruckId(v); setTaskErrors((p) => ({ ...p, truck: '' })); }}
                      options={availableTrucks.map((t) => ({ id: t.id, label: t.plateNumber }))}
                      placeholder="Select a truck…"
                      emptyLabel="No trucks available"
                      onAdd={() => setQuickAdd('truck')}
                      hasError={!!taskErrors.truck}
                    />
                    {taskErrors.truck && <p className="text-xs text-red-500 mt-1">{taskErrors.truck}</p>}
                  </div>
                </div>

                {/* Truck preview — only once a truck is picked */}
                {(() => {
                  const t = trucks.find((x) => x.id === taskTruckId);
                  return t ? (
                    <div className="rounded-xl border border-border bg-white p-3">
                      <TruckSummary truck={t} typeFirst />
                    </div>
                  ) : null;
                })()}

                {/* Exact locations set the existing route fields through structured Mapbox geography. */}
                <div className="space-y-4">
                  <div>
                    <FieldLabel required>Pickup Location</FieldLabel>
                    <MapboxLocationInput
                      value={taskPickupLocation}
                      selected={taskPickupSelected}
                      onChange={(v) => { setTaskPickupLocation(v); if (taskPickupSelected) { setTaskPickupSelected(null); setTaskFrom(''); } setTaskErrors((p) => ({ ...p, pickupLocation: '' })); }}
                      onSelect={(place) => { setTaskPickupSelected(place); setTaskPickupLocation(place.formatted); setTaskFrom(mapboxRouteArea(place)); setTaskErrors((p) => ({ ...p, pickupLocation: '' })); }}
                      placeholder="Search exact pickup address or location"
                      hasError={!!taskErrors.pickupLocation}
                    />
                    {taskErrors.pickupLocation && <p className="text-xs text-red-500 mt-1">{taskErrors.pickupLocation}</p>}
                  </div>
                  <div>
                    <FieldLabel required>Delivery Location</FieldLabel>
                    <MapboxLocationInput
                      value={taskTo}
                      selected={taskDeliverySelected}
                      onChange={(v) => { setTaskTo(v); if (taskDeliverySelected) { setTaskDeliverySelected(null); setTaskDestinationArea(''); } setTaskErrors((p) => ({ ...p, to: '' })); }}
                      onSelect={(place) => { setTaskDeliverySelected(place); setTaskTo(place.formatted); setTaskDestinationArea(mapboxRouteArea(place)); setTaskErrors((p) => ({ ...p, to: '' })); }}
                      placeholder="Search exact delivery address or location"
                      hasError={!!taskErrors.to}
                    />
                    {taskErrors.to && <p className="text-xs text-red-500 mt-1">{taskErrors.to}</p>}
                  </div>
                  {taskPickupSelected?.formatted === taskPickupLocation && taskDeliverySelected?.formatted === taskTo
                    && mapboxRouteArea(taskPickupSelected) && mapboxRouteArea(taskDeliverySelected) &&
                    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                      <span className="block font-medium text-foreground">Route</span>
                      <span className="block break-words text-foreground">{mapboxRouteArea(taskPickupSelected)} → {mapboxRouteArea(taskDeliverySelected)}</span>
                      <span className="block text-xs text-muted-foreground">Automatically detected</span>
                    </div>}
                </div>

                {/* Client */}
                <div>
                  <FieldLabel required>Client</FieldLabel>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                    <input type="text" value={taskCompany}
                      onChange={(e) => { setTaskCompany(e.target.value); setTaskErrors((p) => ({ ...p, company: '' })); }}
                      placeholder="Client or company name"
                      className={`${fieldBase} ${fieldTone(!!taskErrors.company)} pl-9`}
                    />
                  </div>
                  {taskErrors.company && <p className="text-xs text-red-500 mt-1">{taskErrors.company}</p>}
                </div>
              </div>

              {/* Buttons */}
              <div className="flex flex-col-reverse sm:flex-row gap-3 pt-6 sm:pt-7">
                <button onClick={resetAssignTask}
                  className="px-5 py-2.5 border border-border rounded-[10px] hover:bg-accent transition-colors text-sm font-medium text-foreground inline-flex items-center gap-1.5">
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                <button onClick={handleNextStep}
                  className="flex-1 px-5 py-2.5 bg-[#1DBF73] text-white rounded-[10px] hover:bg-[#19a865] transition-all shadow-sm hover:shadow active:scale-[0.99] text-sm font-semibold inline-flex items-center justify-center gap-1.5">
                  Next <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* ══════════ STEP 2 — Schedule ══════════ */}
          {taskStep === 2 && (
            <div>
              <SectionHeader>Schedule</SectionHeader>

              <div className="space-y-4">
                {/* Row 1 — pickup. The two date pickers still bound each other live via
                    minIso/maxIso; ISO "YYYY-MM-DD" sorts lexicographically, so plain
                    string compares work here. */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <FieldLabel required>Picked Up Date</FieldLabel>
                    <DateField value={taskPickedUpDate}
                      onChange={(v, bad) => setTaskDateField('pickup', v, bad)}
                      hasError={!!taskErrors.pickedUpDate}
                      minIso={todayIso()}
                      maxIso={taskDate || oneYearAheadIso()}
                    />
                    {taskErrors.pickedUpDate
                      ? <p className="text-xs text-red-500 mt-1">{taskErrors.pickedUpDate}</p>
                      : <p className="text-[12px] text-muted-foreground mt-1.5">Planned pickup date</p>}
                  </div>
                  <div>
                    <FieldLabel required>Pick Up Time</FieldLabel>
                    <TimeField value={taskPickupTime}
                      /* Also clears any ETA-ordering error, which pickup time feeds into */
                      onChange={(v) => { setTaskPickupTime(v); setTaskErrors((p) => ({ ...p, pickupTime: '', eta: '' })); }}
                      hasError={!!taskErrors.pickupTime}
                    />
                    {taskErrors.pickupTime && <p className="text-xs text-red-500 mt-1">{taskErrors.pickupTime}</p>}
                  </div>
                </div>

                {/* Row 2 — delivery */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <FieldLabel required>Delivery Date</FieldLabel>
                    <DateField value={taskDate}
                      onChange={(v, bad) => setTaskDateField('delivery', v, bad)}
                      hasError={!!taskErrors.date}
                      minIso={taskPickedUpDate && taskPickedUpDate > todayIso() ? taskPickedUpDate : todayIso()}
                      maxIso={oneYearAheadIso()}
                    />
                    {taskErrors.date
                      ? <p className="text-xs text-red-500 mt-1">{taskErrors.date}</p>
                      : <p className="text-[12px] text-muted-foreground mt-1.5">Target delivery date</p>}
                  </div>
                  <div>
                    <FieldLabel required>ETA</FieldLabel>
                    <TimeField value={taskEta}
                      onChange={(v) => { setTaskEta(v); setTaskErrors((p) => ({ ...p, eta: '' })); }}
                      hasError={!!taskErrors.eta}
                    />
                    {taskErrors.eta
                      ? <p className="text-xs text-red-500 mt-1">{taskErrors.eta}</p>
                      : <p className="text-[12px] text-muted-foreground mt-1.5">Estimated Time of Arrival</p>}
                  </div>
                </div>

                {/* Remarks */}
                <div>
                  <FieldLabel hint="(optional)">Remarks</FieldLabel>
                  <textarea value={taskRemarks} maxLength={TEXT_MAX}
                    onChange={(e) => { setTaskRemarks(e.target.value); setTaskErrors((p) => ({ ...p, remarks: '' })); }}
                    placeholder="Any special instructions…" rows={3}
                    className={`${fieldBase} ${fieldTone(!!taskErrors.remarks)} resize-none break-words`}
                  />
                  <div className="flex items-start justify-between gap-2 mt-1">
                    {taskErrors.remarks ? <p className="text-xs text-red-500">{taskErrors.remarks}</p> : <span />}
                    <CharCount value={taskRemarks} />
                  </div>
                </div>
              </div>

              {/* Buttons */}
              <div className="flex flex-col-reverse sm:flex-row gap-3 pt-6 sm:pt-7">
                <button onClick={() => { setTaskErrors({}); setTaskStep(1); }}
                  className="px-5 py-2.5 border border-border rounded-[10px] hover:bg-accent transition-colors text-sm font-medium text-foreground inline-flex items-center gap-1.5">
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                {/* Blocked while a date is invalid — the error is shown under the field */}
                <button onClick={handleAssignTask} disabled={!!(taskErrors.pickedUpDate || taskErrors.date)}
                  className="flex-1 px-5 py-2.5 bg-[#1DBF73] text-white rounded-[10px] hover:bg-[#19a865] transition-all shadow-sm hover:shadow active:scale-[0.99] text-sm font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
                  <CheckCircle2 className="w-4 h-4" /> Dispatch Truck
                </button>
              </div>
            </div>
          )}
        </ModalShell>
      )}

      {/* ── Quick-add layered above the Assign Task wizard ── */}
      {quickAdd === 'driver' && (
        <RegisterDriverModal
          layer
          drivers={drivers}
          setDrivers={setDrivers}
          onClose={() => setQuickAdd(null)}
          onCreated={(d) => { markLocalRecordAdded('driver', d.id); setTaskDriverId(d.id); }}
        />
      )}
      {quickAdd === 'truck' && (
        <RegisterTruckModal
          layer
          trucks={trucks}
          setTrucks={setTrucks}
          onClose={() => setQuickAdd(null)}
          onCreated={(t) => setTaskTruckId(t.id)}
        />
      )}

      {viewDetailsId && (
        <ViewDetailsModal
          assignment={viewDetailsAssign}
          driver={viewDetailsDriver}
          truck={viewDetailsAssign ? trucks.find((t) => t.id === viewDetailsAssign.truckId) ?? null : null}
          onClose={() => { setViewDetailsId(null); setReviewTarget(null); }}
          onEdit={() => { setEditId(viewDetailsId); setViewDetailsId(null); setReviewTarget(null); }}
          onApproveDoc={handleApproveDoc}
          onRejectDoc={handleRejectDoc}
          onComplete={handleComplete}
          onCancel={handleCancel}
          onSimulateLate={handleSimulateLate}
          isViewOnly={isViewOnly || !assignments.some(a => a.id === viewDetailsId) || completed.some(a => a.id === viewDetailsId)}
          adminEmail={adminEmail}
          reviewTarget={reviewTarget?.assignmentId === viewDetailsId ? reviewTarget : null}
          timingNow={timingNow}
        />
      )}

      {/* Edit — Back returns to View Details; a successful save reopens it with the new details */}
      {editId && (
        <EditAssignmentModal
          key={editId}
          assignment={assignments.find((a) => a.id === editId) ?? null}
          drivers={drivers}
          trucks={trucks}
          assignments={assignments}
          onClose={() => { setViewDetailsId(editId); setEditId(null); }}
          onSaved={(id) => { setEditId(null); setViewDetailsId(id); }}
          onServerChange={onServerChange}
        />
      )}
    </div>
  );
}
