import { useState } from 'react';
import {
  User, Truck, MapPin, Building2, Calendar, MessageSquare,
  Activity, X, ClipboardList, CheckCircle2,
  FileText, Check, XCircle, Eye, AlertTriangle, Clock,
  Package, Trash2, ChevronDown, ChevronUp, ZoomIn,
  Navigation, Timer, AlarmClock, Camera, Search,
  Plus, ArrowLeft, ArrowRight, ChevronLeft, ChevronRight,
  Receipt, ClipboardCheck, ScrollText, FileCheck, PackageCheck,
} from 'lucide-react';
import { RegisterDriverModal, RegisterTruckModal } from './RegisterModals';
import { Popover, PopoverAnchor, PopoverContent } from '../ui/popover';

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
  DOCUMENT_TYPES, taskStatusConfig, DEMO_ADMIN_EMAIL,
  type Assignment, type CompletedTask, type LocalDriver, type LocalTruck,
  type TaskStatus, type DocStatus, type AdminActivityInput, type AssignmentDoc,
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

/* Slim, light scrollbars — the browser default renders as heavy dark bars */
const thinScroll =
  '[scrollbar-width:thin] [scrollbar-color:#d1d5db_transparent] ' +
  '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent ' +
  '[&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-thumb]:rounded-full ' +
  'hover:[&::-webkit-scrollbar-thumb]:bg-[#1DBF73]/50';

/* ─── Date field — type into the input, or click the icon for a calendar ─── */
function DateField({ value, onChange, hasError, minIso, maxIso }: {
  value: string; onChange: (v: string) => void; hasError?: boolean;
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
            onChange={(e) => onChange(e.target.value)}
            min={minIso} max={maxIso}
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
            <span key={w} className="text-[10px] font-semibold text-muted-foreground text-center py-1">{w}</span>
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

  const colHead = 'text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-center pb-1.5 mb-1 border-b border-border';

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
      <span className="hidden sm:inline text-[11px] font-medium text-muted-foreground tabular-nums whitespace-nowrap">Step {step} of {total}</span>
    </div>
  );
}

/* Free-text input that suggests addresses already used in past deliveries */
function AddressAutocomplete({ value, onChange, options, placeholder, hasError, icon }: {
  value: string; onChange: (v: string) => void; options: string[];
  placeholder?: string; hasError?: boolean; icon?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const q = value.trim().toLowerCase();
  const matches = options
    .filter((o) => o.toLowerCase().includes(q) && o.toLowerCase() !== q)
    .slice(0, 5);

  return (
    <div className="relative">
      {icon && (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
          {icon}
        </span>
      )}
      <input
        type="text" value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        /* Delay so a click on a suggestion registers before the list closes */
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder={placeholder}
        autoComplete="off"
        className={`${fieldBase} ${fieldTone(hasError)} ${icon ? 'pl-9' : ''}`}
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-20 left-0 right-0 top-full mt-1 bg-white border border-border rounded-[10px] shadow-lg overflow-hidden py-1">
          {matches.map((m) => (
            <li key={m}>
              <button type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(m); setOpen(false); }}
                className="w-full text-left px-3.5 py-2 text-sm text-foreground hover:bg-accent transition-colors truncate">
                {m}
              </button>
            </li>
          ))}
        </ul>
      )}
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

/* ─── Helpers ─────────────────────────────────────── */
const driverStatusColor = (s: string) =>
  ({ Assigned: 'bg-blue-100 text-blue-700 border-blue-200',
     Pending:  'bg-amber-100 text-amber-700 border-amber-200',
     Complete: 'bg-green-100 text-green-700 border-green-200',
  }[s] ?? 'bg-gray-100 text-gray-700 border-gray-200');

/* Colored dot + label (no emoji circles) */
/* `acknowledged` only matters while status is 'Assigned' — it shows gray
   instead of the usual green until the driver's app has actually loaded the
   task, so admin can tell a fresh assignment hasn't been seen yet. */
function StatusBadge({ status, size = 'sm', acknowledged = true }: { status: TaskStatus; size?: 'sm' | 'xs'; acknowledged?: boolean }) {
  const cfg = taskStatusConfig[status];
  const unseen = status === 'Assigned' && !acknowledged;
  const badge  = unseen ? 'bg-gray-100 text-gray-500 border-gray-200' : cfg.badge;
  const dot    = unseen ? 'bg-gray-400' : cfg.dot;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-medium ${badge} ${size === 'xs' ? 'text-xs' : 'text-xs'}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
      {cfg.label}
    </span>
  );
}

/* ─── Modal Shell ──────────────────────────────────── */
function ModalShell({ title, onClose, wide = false, children }: {
  title: string; onClose: () => void; wide?: boolean; children: React.ReactNode;
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

/* ─── Image Preview Modal ──────────────────────────── */
function ImagePreviewModal({ url, docType, onClose }: { url: string; docType: string; onClose: () => void }) {
  const isPdf = url.startsWith('data:application/pdf');
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl flex flex-col max-h-[85vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground">{docType}</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-muted/10">
          {isPdf ? (
            <iframe src={url} className="w-full h-[500px] rounded-lg border border-border" title={docType} />
          ) : (
            <img src={url} alt={docType} className="max-w-full max-h-[500px] object-contain rounded-xl shadow-md" />
          )}
        </div>
        <div className="px-5 py-3 border-t border-border flex-shrink-0">
          <a href={url} download={`${docType}.${url.startsWith('data:application/pdf') ? 'pdf' : 'jpg'}`}
            className="text-xs text-primary underline hover:text-primary/80">Download file</a>
        </div>
      </div>
    </div>
  );
}

/* ─── View Details building blocks ─────────────────── */

/* Card wrapper — soft rounded group with a shared background */
function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border/70 bg-muted/25 p-4">
      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">{title}</p>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/* One label/value pair. `hero` is for the single most time-critical field (ETA). */
function DetailRow({ icon, label, value, hero = false }: {
  icon: React.ReactNode; label: string; value?: string; hero?: boolean;
}) {
  const filled = !!value && value !== '—';
  return (
    <div className="flex items-start gap-2.5">
      <span className="text-muted-foreground mt-0.5 flex-shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
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

/* Origin → destination, split on the arrow stored in `destination` */
function RouteRow({ route }: { route: string }) {
  const [from, to] = route.split('→').map((s) => s.trim());
  return (
    <div className="flex items-start gap-2.5">
      <Navigation className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Route</p>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[15px] font-semibold text-foreground break-words">{from || route}</span>
          {to && <ArrowRight className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />}
          {to && <span className="text-[15px] font-semibold text-foreground break-words">{to}</span>}
        </div>
      </div>
    </div>
  );
}

const DELIVERY_STEPS: TaskStatus[] = ['Assigned', 'Picked Up', 'In Transit', 'Delivered'];

function DeliveryStepper({ status }: { status: TaskStatus }) {
  const idx      = DELIVERY_STEPS.indexOf(status);
  const abnormal = idx === -1;                 /* Failed / Cancelled sit outside the flow */
  const current  = abnormal ? -1 : idx;
  return (
    <div>
      <div className="flex items-start">
        {DELIVERY_STEPS.map((step, i) => {
          const done   = i < current;
          const active = i === current;
          return (
            <div key={step} className="flex-1 flex flex-col items-center relative">
              {i > 0 && (
                <span className={`absolute top-[11px] right-1/2 left-[-50%] h-0.5 ${
                  i <= current ? 'bg-blue-500' : 'bg-border'}`} />
              )}
              <span className={`relative z-10 w-6 h-6 rounded-full flex items-center justify-center border-2 ${
                done   ? 'bg-blue-500 border-blue-500 text-white'
                : active ? 'bg-white border-blue-500 text-blue-600 ring-4 ring-blue-100'
                : 'bg-white border-border text-muted-foreground'}`}>
                {done ? <Check className="w-3.5 h-3.5" /> : <span className="text-[10px] font-bold">{i + 1}</span>}
              </span>
              <span className={`mt-1.5 text-[11px] text-center leading-tight ${
                active ? 'font-semibold text-blue-600' : done ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                {step}
              </span>
            </div>
          );
        })}
      </div>
      {abnormal && (
        <p className="mt-3 text-center text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg py-1.5">
          {status}
        </p>
      )}
    </div>
  );
}

/* Collapsible remarks — muted and non-interactive when empty */
function RemarksBlock({ remarks }: { remarks?: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!remarks?.trim()) {
    return (
      <section className="rounded-xl border border-dashed border-border p-4">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Remarks</p>
        <p className="text-xs text-muted-foreground mt-1">No remarks for this assignment.</p>
      </section>
    );
  }
  return (
    <section className="rounded-xl border border-border/70 bg-muted/25 overflow-hidden">
      <button type="button" onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between p-4 hover:bg-accent/40 transition-colors">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Remarks</span>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      <p className={`px-4 pb-4 text-sm text-foreground leading-relaxed ${expanded ? '' : 'line-clamp-2'}`}>
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

/* Color-coded chip: gray = awaiting upload, amber = pending, green = approved, red = rejected */
function DocChip({ doc }: { doc: AssignmentDoc }) {
  const cfg = !doc.uploaded
    ? { cls: 'bg-gray-100 text-gray-600 border-gray-200', icon: <Clock className="w-3 h-3" />, label: 'Awaiting upload' }
    : doc.docStatus === 'approved' ? { cls: 'bg-green-50 text-green-700 border-green-200', icon: <Check className="w-3 h-3" />, label: 'Approved' }
    : doc.docStatus === 'rejected' ? { cls: 'bg-red-50 text-red-700 border-red-200', icon: <XCircle className="w-3 h-3" />, label: 'Rejected' }
    : { cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: <Clock className="w-3 h-3" />, label: 'Pending review' };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium whitespace-nowrap ${cfg.cls}`}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

/* ─── View Details Modal ───────────────────────────── */
function ViewDetailsModal({ assignment, driver, onClose, onApproveDoc, onRejectDoc, onComplete, onCancel, onSimulateLate, isViewOnly = false, adminEmail }: {
  assignment: Assignment | null; driver: LocalDriver | null;
  onClose: () => void;
  onApproveDoc:   (id: string, docType: string) => void;
  onRejectDoc:    (id: string, docType: string, reason: string) => void;
  onComplete:     (id: string) => void;
  onCancel:       (id: string) => void;
  onSimulateLate: (id: string) => void;
  isViewOnly?:    boolean;
  adminEmail?:    string | null;
}) {
  const isDemoAdmin = adminEmail === DEMO_ADMIN_EMAIL;
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [previewDoc,    setPreviewDoc]    = useState<{ url: string; type: string } | null>(null);
  const [rejectingDoc,  setRejectingDoc]  = useState<string | null>(null);
  const [rejectReason,  setRejectReason]  = useState('');
  if (!driver) return null;

  const allApproved = assignment
    ? assignment.documents.every((d) => d.uploaded && d.docStatus === 'approved') : false;

  const approvedCount = assignment?.documents.filter((d) => d.docStatus === 'approved').length ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-[480px] flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-200">

        {/* ── Sticky header: driver identity + status ── */}
        <header className="flex items-start gap-3 px-5 py-4 border-b border-border flex-shrink-0">
          <div className="w-12 h-12 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center flex-shrink-0">
            <User className="w-6 h-6 text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold text-foreground leading-tight truncate">{driver.name}</h3>
            <p className="text-xs text-muted-foreground truncate">{driver.id} · {driver.phone}</p>
            {driver.currentLocation && (
              <p className="text-xs text-muted-foreground truncate">{driver.currentLocation}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className={`text-xs px-2.5 py-1 rounded-full border ${driverStatusColor(driver.status)}`}>
              {driver.status}
            </span>
            <button onClick={onClose} aria-label="Close"
              className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground">
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* ── Scrollable content ── */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
      {!assignment ? (
        <div className="py-10 text-center text-muted-foreground">
          <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No active assignment for this driver.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Delivery progress */}
          <div className="rounded-xl border border-border/70 p-4">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Delivery Progress</p>
              <StatusBadge status={assignment.taskStatus} size="xs" />
            </div>
            <DeliveryStepper status={assignment.taskStatus} />
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

          {/* Route & Client */}
          <DetailCard title="Route & Client">
            <DetailRow icon={<Truck className="w-4 h-4" />}     label="Truck #" value={assignment.truckPlate} />
            <RouteRow route={assignment.destination} />
            <DetailRow icon={<Building2 className="w-4 h-4" />} label="Client" value={assignment.company} />
            <DetailRow icon={<MapPin className="w-4 h-4" />}    label="Pickup Location" value={assignment.pickupLocation} />
          </DetailCard>

          {/* Schedule */}
          <DetailCard title="Schedule">
            <DetailRow icon={<Timer className="w-4 h-4" />}     label="ETA — Estimated Arrival" value={assignment.eta} hero />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <DetailRow icon={<Clock className="w-4 h-4" />}    label="Pick Up Time"   value={assignment.pickupTime} />
              <DetailRow icon={<Calendar className="w-4 h-4" />} label="Picked Up Date" value={assignment.pickedUpDate} />
              <DetailRow icon={<Calendar className="w-4 h-4" />} label="Delivery Date"  value={assignment.deliveryDate} />
              <DetailRow icon={<AlarmClock className="w-4 h-4" />} label="ATA"          value={assignment.ata} />
            </div>
            <DetailRow icon={<Clock className="w-4 h-4" />} label="Assigned At" value={assignment.assignedAt} />
          </DetailCard>

          {/* Remarks */}
          <RemarksBlock remarks={assignment.remarks} />

          {/* Status note */}
          <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-xl">
            <Activity className="w-4 h-4 text-blue-500 flex-shrink-0" />
            <p className="text-xs text-blue-700">Delivery status is updated by the driver from their mobile view.</p>
          </div>

          {/* ── Status Photos ── */}
          {assignment.statusPhotos && Object.keys(assignment.statusPhotos).length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Camera className="w-4 h-4 text-primary" />
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Driver Status Photos</p>
              </div>
              {/* Stacked cards rather than a table — the modal is only ~480px wide */}
              <div className="space-y-2">
                {(['Picked Up', 'In Transit'] as const).map((status) => {
                  const photo = assignment.statusPhotos?.[status];
                  if (!photo) return null;
                  const cfg = taskStatusConfig[status];
                  return (
                    <div key={status} className="border border-border rounded-xl p-3">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium whitespace-nowrap ${cfg.badge}`}>
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
                          {status}
                        </span>
                        <button
                          onClick={() => setPreviewDoc({ url: photo.url, type: `${status} Photo` })}
                          className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-xs font-medium hover:bg-blue-100 transition-colors whitespace-nowrap"
                        >
                          <ZoomIn className="w-3 h-3" /> View
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3 flex-shrink-0" />
                        <span className="text-foreground font-medium">{photo.timestamp}</span>
                      </div>
                      <div className="flex items-start gap-1.5 text-xs text-muted-foreground mt-1">
                        <MapPin className="w-3 h-3 flex-shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-foreground font-medium leading-snug break-words">{photo.location}</p>
                          {photo.coords && (
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {photo.coords.lat.toFixed(5)}° N, {photo.coords.lng.toFixed(5)}° E
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

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
                        <span className="text-[10px] text-amber-600">{report.reportedAt}</span>
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

          {/* Documents */}
          <div>
            {/* Progress ring header */}
            <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/25 p-4 mb-3">
              <div className="relative flex items-center justify-center">
                <ProgressRing value={approvedCount} total={assignment.documents.length} />
                <span className="absolute text-[11px] font-bold text-foreground">
                  {approvedCount}/{assignment.documents.length}
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Documents</p>
                <p className="text-[15px] font-semibold text-foreground">
                  {approvedCount} of {assignment.documents.length} approved
                </p>
              </div>
            </div>
            <div className="space-y-2">
              {assignment.documents.map((doc) => (
                <div key={doc.type} className="border border-border rounded-xl bg-white overflow-hidden">
                  {/* Main row */}
                  <div className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <span className="text-muted-foreground flex-shrink-0 mt-0.5">{docTypeIcon(doc.type)}</span>
                        <span className="text-sm font-medium text-foreground break-words">{doc.type}</span>
                      </div>
                      <DocChip doc={doc} />
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

          {/* Complete */}
          {!isViewOnly && (allApproved ? (
            <button onClick={() => { onComplete(assignment.id); onClose(); }}
              className="w-full py-3 bg-green-500 text-white rounded-xl font-semibold hover:bg-green-600 transition-colors flex items-center justify-center gap-2">
              <CheckCircle2 className="w-5 h-5" /> Mark as Complete
            </button>
          ) : (
            <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <p className="text-xs text-amber-700">All documents must be approved before marking as complete.</p>
            </div>
          ))}
        </div>
      )}
        </div>

        {/* ── Sticky action bar ── */}
        <footer className="flex items-center gap-2 px-5 py-4 border-t border-border flex-shrink-0 bg-white rounded-b-xl">
          <button onClick={onClose}
            className="flex-1 py-2.5 border border-border rounded-xl text-sm font-medium text-foreground hover:bg-accent transition-colors">
            Close
          </button>
          {assignment && !isViewOnly && (
            <button onClick={() => setConfirmCancel(true)}
              className="flex-1 py-2.5 border border-red-200 text-red-600 rounded-xl text-sm font-medium hover:bg-red-50 transition-colors flex items-center justify-center gap-2">
              <Trash2 className="w-4 h-4" /> Cancel Assignment
            </button>
          )}
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
              <div className="flex gap-2 mt-4">
                <button onClick={() => setConfirmCancel(false)}
                  className="flex-1 py-2 border border-border rounded-lg text-sm hover:bg-accent transition-colors">Keep It</button>
                <button onClick={() => { onCancel(assignment.id); onClose(); }}
                  className="flex-1 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 transition-colors">Yes, Cancel</button>
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

/* ─── Props ────────────────────────────────────────── */
interface Props {
  drivers: LocalDriver[];     setDrivers: React.Dispatch<React.SetStateAction<LocalDriver[]>>;
  trucks: LocalTruck[];       setTrucks:  React.Dispatch<React.SetStateAction<LocalTruck[]>>;
  assignments: Assignment[];  setAssignments: React.Dispatch<React.SetStateAction<Assignment[]>>;
  completed: CompletedTask[]; setCompleted:   React.Dispatch<React.SetStateAction<CompletedTask[]>>;
  setCancelled: React.Dispatch<React.SetStateAction<Assignment[]>>;
  isViewOnly?: boolean;
  onLogActivity?: (entry: AdminActivityInput) => void;
  adminEmail?: string | null;
}

/* ─── Main Component ───────────────────────────────── */
export default function DriversManagement({
  drivers, setDrivers, trucks, setTrucks,
  assignments, setAssignments, completed, setCompleted, setCancelled,
  isViewOnly = false, onLogActivity, adminEmail,
}: Props) {


  const [showAssignTask, setShowAssignTask] = useState(false);
  const [viewDetailsId,  setViewDetailsId]  = useState<string | null>(null);
  const [search,         setSearch]         = useState('');

  /* ── Assign Task wizard ── */
  const [taskStep,        setTaskStep]        = useState<1 | 2>(1);
  const [taskDriverId,    setTaskDriverId]    = useState('');
  const [taskTruckId,     setTaskTruckId]     = useState('');
  const [taskFrom,        setTaskFrom]        = useState('');
  const [taskTo,          setTaskTo]          = useState('');
  const [taskCompany,     setTaskCompany]     = useState('');
  /* Dates as "YYYY-MM-DD" — the value the native date input uses */
  const [taskDate,        setTaskDate]        = useState('');
  const [taskPickedUpDate, setTaskPickedUpDate] = useState('');
  const [taskRemarks,     setTaskRemarks]     = useState('');
  const [taskPickupLocation, setTaskPickupLocation] = useState('');
  /* Native time inputs → 24-hour "HH:MM" strings */
  const [taskPickupTime,  setTaskPickupTime]  = useState('');
  const [taskEta,         setTaskEta]         = useState('');
  const [taskErrors,      setTaskErrors]      = useState<Record<string, string>>({});

  /* Quick-add layered over the Assign Task modal — the wizard stays mounted
     underneath, so anything already typed survives the round trip. */
  const [quickAdd, setQuickAdd] = useState<null | 'driver' | 'truck'>(null);

  const assignedDriverIds = new Set(assignments.map((a) => a.driverId));
  const availableDrivers  = drivers.filter((d) => !assignedDriverIds.has(d.id));
  const availableTrucks   = trucks.filter((t)  => t.status === 'Available');

  /* Autocomplete suggestions drawn from addresses used in past deliveries */
  const addressBook = (() => {
    const from = new Set<string>();
    const to   = new Set<string>();
    const pickup = new Set<string>();
    [...assignments, ...completed].forEach((a) => {
      if (a.pickupLocation?.trim()) pickup.add(a.pickupLocation.trim());
      const dest = a.destination ?? '';
      if (dest.includes('→')) {
        const [f, t] = dest.split('→');
        if (f?.trim()) from.add(f.trim());
        if (t?.trim()) to.add(t.trim());
      } else if (dest.trim()) {
        to.add(dest.trim());
      }
    });
    return { from: [...from].sort(), to: [...to].sort(), pickup: [...pickup].sort() };
  })();

  const resetAssignTask = () => {
    setShowAssignTask(false); setTaskStep(1); setTaskDriverId(''); setTaskTruckId('');
    setTaskFrom(''); setTaskTo('');
    setTaskCompany(''); setTaskDate(''); setTaskPickedUpDate(''); setTaskRemarks('');
    setTaskPickupLocation(''); setTaskPickupTime(''); setTaskEta('');
    setTaskErrors({});
  };

  /* ── Step 1: Assignment info ── */
  const validateStep1 = () => {
    const e: Record<string, string> = {};
    if (!taskDriverId)              e.driver         = 'Select a driver.';
    if (!taskTruckId)               e.truck          = 'Select a truck.';
    if (!taskFrom.trim())           e.from           = 'Enter an origin.';
    if (!taskTo.trim())             e.to             = 'Enter a destination.';
    if (!taskCompany.trim())        e.company        = 'Enter a client name.';
    if (!taskPickupLocation.trim()) e.pickupLocation = 'Enter a pickup location.';
    setTaskErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNextStep = () => { if (validateStep1()) { setTaskErrors({}); setTaskStep(2); } };

  const handleAssignTask = () => {
    const e: Record<string, string> = {};
    if (!taskDate)                  e.date         = 'Select a delivery date.';
    if (!taskPickedUpDate)          e.pickedUpDate = 'Select a picked up date.';
    if (!taskPickupTime)            e.pickupTime   = 'Select a pick up time.';
    if (!taskEta)                   e.eta          = 'Select an ETA.';

    /* ── Past-date / past-time guard ── */
    if (taskDate) {
      const selDate = isoToDate(taskDate);
      const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
      if (selDate < todayMidnight) {
        e.date = 'Delivery date cannot be in the past.';
      } else {
        /* If today, validate that times are in the future */
        const isToday = selDate.getTime() === todayMidnight.getTime();
        if (isToday) {
          const now = new Date();
          if (taskPickupTime && time24ToDate(selDate, taskPickupTime) <= now)
            e.pickupTime = "Pickup time must be in the future for today's date.";
          if (taskEta && time24ToDate(selDate, taskEta) <= now)
            e.eta = "ETA must be in the future for today's date.";
        }
      }
    }

    /* ── ETA must not precede pickup — both are zero-padded 24-hour "HH:MM",
       so a plain string compare orders them correctly.

       This only applies when pickup and delivery fall on the SAME day. Across
       different days the comparison is meaningless: a pickup at 14:00 on the 19th
       and an arrival at 08:00 on the 21st is perfectly valid, but a raw time
       compare would reject it. Same-day behaviour is unchanged. ── */
    const sameDay = !!taskPickedUpDate && !!taskDate && taskPickedUpDate === taskDate;
    if (sameDay && taskPickupTime && taskEta && !e.eta && taskEta < taskPickupTime)
      e.eta = 'ETA cannot be earlier than the pick up time.';

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
      company:         taskCompany.trim(),
      pickupLocation:  taskPickupLocation.trim(),
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
    setDrivers((p) => p.map((d) => d.id === taskDriverId ? { ...d, status: 'Assigned' as const } : d));
    setTrucks((p)  => p.map((t) => t.id === taskTruckId  ? { ...t, status: 'Assigned' }   : t));
    onLogActivity?.({
      type: 'task_assigned',
      driverName: driver.name,
      truckPlate: truck.plateNumber,
      assignmentId: newAssignId,
      destination: `${taskFrom.trim()} → ${taskTo.trim()}`,
      company: taskCompany.trim(),
    });
    resetAssignTask();
  };

  const handleApproveDoc = (assignId: string, docType: string) => {
    const a = assignments.find((x) => x.id === assignId);
    setAssignments((p) => p.map((x) => x.id !== assignId ? x : {
      ...x, documents: x.documents.map((d) => d.type === docType ? { ...d, docStatus: 'approved' as DocStatus } : d),
    }));
    onLogActivity?.({
      type: 'doc_approved',
      driverName: a?.driverName,
      truckPlate: a?.truckPlate,
      assignmentId: assignId,
      docType,
    });
  };

  const handleRejectDoc = (assignId: string, docType: string, reason: string) => {
    const a = assignments.find((x) => x.id === assignId);
    setAssignments((p) => p.map((x) => x.id !== assignId ? x : {
      ...x, documents: x.documents.map((d) =>
        d.type === docType ? { ...d, docStatus: 'rejected' as DocStatus, rejectReason: reason.trim() || undefined } : d
      ),
    }));
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

  const handleComplete = (id: string) => {
    const a = assignments.find((x) => x.id === id)!;
    setCompleted((p) => [...p, { ...a, completedAt: new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }]);
    setAssignments((p) => p.filter((x) => x.id !== id));
    setDrivers((p) => p.map((d) => d.id === a.driverId ? { ...d, status: 'Complete' as const } : d));
    setTrucks((p)  => p.map((t) => t.plateNumber === a.truckPlate ? { ...t, status: 'Available' } : t));
    onLogActivity?.({
      type: 'task_completed',
      driverName: a.driverName,
      truckPlate: a.truckPlate,
      assignmentId: id,
      destination: a.destination,
      company: a.company,
    });
  };

  const handleCancel = (id: string) => {
    const a = assignments.find((x) => x.id === id)!;
    setAssignments((p) => p.filter((x) => x.id !== id));
    setCancelled((p) => [...p, { ...a, taskStatus: 'Cancelled' as const }]);
    setDrivers((p) => p.map((d) => d.id === a.driverId ? { ...d, status: 'Pending' as const } : d));
    setTrucks((p)  => p.map((t) => t.plateNumber === a.truckPlate ? { ...t, status: 'Available' } : t));
    onLogActivity?.({
      type: 'task_cancelled',
      driverName: a.driverName,
      truckPlate: a.truckPlate,
      assignmentId: id,
      destination: a.destination,
      company: a.company,
    });
  };

  const sq = search.trim().toLowerCase();
  /* Only show assignments whose driver still exists — hides cards for deleted drivers */
  const activeDriverIds = new Set(drivers.map((d) => d.id));
  const validAssignments = assignments.filter((a) => activeDriverIds.has(a.driverId));
  const visibleAssignments = sq
    ? validAssignments.filter((a) =>
        [a.truckPlate, a.id, a.driverName, a.destination, a.company, a.taskStatus].some((f) =>
          f.toLowerCase().includes(sq)
        )
      )
    : validAssignments;

  const viewDetailsAssign = viewDetailsId ? assignments.find((a) => a.id === viewDetailsId) ?? null : null;
  const viewDetailsDriver = viewDetailsAssign ? drivers.find((d) => d.id === viewDetailsAssign.driverId) ?? null : null;

  /* ════════════ RENDER ════════════ */
  return (
    <div className="space-y-8">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Truck and Drivers Management</h2>
          <p className="text-sm text-muted-foreground mt-1">Manage and monitor your driver fleet</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="flex items-center gap-1.5 border border-border rounded-xl px-3 py-2.5 bg-white shadow-sm min-w-[210px]">
            <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search truck, driver, route…"
              className="text-sm bg-transparent focus:outline-none placeholder:text-muted-foreground/60 flex-1 min-w-0"
            />
            {search && (
              <button onClick={() => setSearch('')} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {!isViewOnly && (
            <button onClick={() => setShowAssignTask(true)}
              className="flex items-center gap-3 px-6 py-3.5 bg-primary text-white rounded-xl hover:bg-primary/90 transition-all shadow-md hover:shadow-lg active:scale-[0.98] text-sm font-semibold">
              <ClipboardList className="w-5 h-5" /> Assign Task
            </button>
          )}
        </div>
      </div>

      {/* ── Main Board ── */}
      {assignments.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-border p-16 text-center">
          <ClipboardList className="w-14 h-14 mx-auto mb-4 text-muted-foreground/30" />
          <p className="font-semibold text-foreground mb-1">No Active Assignments</p>
          <p className="text-sm text-muted-foreground mb-5">
            Click <strong>Assign Task</strong> to dispatch a driver and truck.
          </p>
          <button onClick={() => setShowAssignTask(true)}
            className="px-5 py-2.5 bg-primary text-white rounded-lg text-sm hover:bg-primary/90 transition-colors">
            + Assign Task
          </button>
        </div>
      ) : visibleAssignments.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-border p-16 text-center">
          <Search className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
          <p className="font-semibold text-foreground mb-1">No results for "{search}"</p>
          <p className="text-sm text-muted-foreground">Try a different truck plate, driver name, or route.</p>
          <button onClick={() => setSearch('')} className="mt-4 px-4 py-2 bg-muted text-foreground rounded-lg text-sm hover:bg-muted/80 transition-colors">
            Clear Search
          </button>
        </div>
      ) : (
        <>
          {sq && (
            <p className="text-sm text-muted-foreground -mt-4">
              <span className="font-semibold text-foreground">{visibleAssignments.length}</span> result{visibleAssignments.length !== 1 ? 's' : ''} for "<span className="font-semibold text-foreground">{search}</span>"
            </p>
          )}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visibleAssignments.map((a) => {
            const total    = a.documents.length;
            const approved = a.documents.filter((d) => d.docStatus === 'approved').length;
            /* Uploaded but not yet approved — amber. Rejected sits here too:
               it still needs admin/driver action, so it must not read as done. */
            const inReview = a.documents.filter((d) => d.uploaded && d.docStatus !== 'approved').length;

            return (
              <div key={a.id}
                className={`rounded-xl border-[0.5px] overflow-hidden ${
                  sq ? 'border-yellow-400 bg-yellow-50/30' : 'border-border bg-white'
                }`}
              >
                <div className="p-5">
                  {/* Row 1 — truck identity + status */}
                  <div className="flex items-start gap-3">
                    <div className="w-11 h-11 bg-[#0d9488]/10 rounded-full flex items-center justify-center flex-shrink-0 border-[0.5px] border-[#0d9488]/25">
                      <Truck className="w-5 h-5 text-[#0d9488]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg font-bold text-foreground leading-tight truncate">
                        <Highlight text={a.truckPlate} query={search} />
                      </h3>
                      <p className="text-xs text-muted-foreground truncate"><Highlight text={a.id} query={search} /></p>
                      <p className="text-sm text-foreground mt-1 flex items-center gap-1.5 truncate">
                        <User className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <Highlight text={a.driverName} query={search} />
                      </p>
                    </div>
                    <StatusBadge status={a.taskStatus} acknowledged={!!a.driverAcknowledgedAt} />
                  </div>

                  {/* Row 2 — route + labelled delivery date */}
                  <div className="flex items-start justify-between gap-3 mt-4">
                    <div className="flex items-start gap-2 min-w-0">
                      <MapPin className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-1" />
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Route</p>
                        <p className="text-sm text-foreground truncate"><Highlight text={a.destination} query={search} /></p>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Delivery date</p>
                      <p className="text-sm text-foreground whitespace-nowrap">{a.deliveryDate}</p>
                    </div>
                  </div>

                  {/* Row 3 — client */}
                  <div className="flex items-center gap-2 text-sm mt-3 min-w-0">
                    <Building2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="text-foreground truncate"><Highlight text={a.company} query={search} /></span>
                  </div>

                  <div className="border-t border-border mt-4 pt-3">
                    {/* Segmented document bar — green only ever means approved */}
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="text-muted-foreground">Documents</span>
                      <span className="font-medium text-foreground">{approved}/{total} approved</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-1.5 flex overflow-hidden">
                      <div className="bg-green-500 h-full transition-all"
                        style={{ width: `${total ? (approved / total) * 100 : 0}%` }} />
                      <div className="bg-amber-500 h-full transition-all"
                        style={{ width: `${total ? (inReview / total) * 100 : 0}%` }} />
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Check className="w-3 h-3 text-green-600" />{approved} approved
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3 text-amber-500" />{inReview} pending review
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3 text-gray-400" />{total - approved - inReview} awaiting upload
                      </span>
                    </div>
                  </div>
                </div>

                {/* Single primary action */}
                <div className="px-5 pb-5">
                  <button onClick={() => setViewDetailsId(a.id)}
                    className="w-full py-2.5 bg-[#10b981] text-white rounded-xl text-sm font-medium hover:bg-[#059669] transition-colors flex items-center justify-center gap-1.5">
                    <Eye className="w-4 h-4" /> View details
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        </>
      )}

      {/* ── Completed Deliveries ── */}
      {completed.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-500" />
            <h3 className="font-semibold text-foreground">Recent Completed Deliveries</h3>
            <span className="bg-green-500 text-white text-xs rounded-full px-2 py-0.5">{completed.length}</span>
          </div>
          <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30 border-b border-border">
                    {['TRUCK #', 'DRIVER', 'ROUTE', 'CUSTOMER', 'DATE', 'COMPLETED AT'].map((col) => (
                      <th key={col} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground tracking-wide whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {completed.map((c, i) => (
                    <tr key={c.id} className={`hover:bg-muted/10 transition-colors ${i < completed.length - 1 ? 'border-b border-border/50' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Truck className="w-3.5 h-3.5 text-[#0d9488]" />
                          <span className="font-semibold text-[#0d9488]">{c.truckPlate}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-foreground">{c.driverName}</td>
                      <td className="px-4 py-3 text-foreground">{c.destination}</td>
                      <td className="px-4 py-3 text-foreground">{c.company}</td>
                      <td className="px-4 py-3 text-foreground whitespace-nowrap">{c.deliveryDate}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full border border-green-200">{c.completedAt}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ════ MODALS ════ */}

      {showAssignTask && (
        <ModalShell title="Assign Task" onClose={resetAssignTask}>
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

                {/* Route — From / To */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <FieldLabel required>From</FieldLabel>
                    <AddressAutocomplete
                      value={taskFrom}
                      onChange={(v) => { setTaskFrom(v); setTaskErrors((p) => ({ ...p, from: '' })); }}
                      options={addressBook.from}
                      placeholder="e.g. Makati City"
                      hasError={!!taskErrors.from}
                      icon={<MapPin className="w-3.5 h-3.5" />}
                    />
                    {taskErrors.from && <p className="text-xs text-red-500 mt-1">{taskErrors.from}</p>}
                  </div>
                  <div>
                    <FieldLabel required>To</FieldLabel>
                    <AddressAutocomplete
                      value={taskTo}
                      onChange={(v) => { setTaskTo(v); setTaskErrors((p) => ({ ...p, to: '' })); }}
                      options={addressBook.to}
                      placeholder="e.g. Pasig City"
                      hasError={!!taskErrors.to}
                      icon={<Navigation className="w-3.5 h-3.5" />}
                    />
                    {taskErrors.to && <p className="text-xs text-red-500 mt-1">{taskErrors.to}</p>}
                  </div>
                </div>

                {/* Client */}
                <div>
                  <FieldLabel required>Client</FieldLabel>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                    <input type="text" value={taskCompany}
                      onChange={(e) => { setTaskCompany(e.target.value); setTaskErrors((p) => ({ ...p, company: '' })); }}
                      placeholder="e.g. ABC Retail Corp"
                      className={`${fieldBase} ${fieldTone(!!taskErrors.company)} pl-9`}
                    />
                  </div>
                  {taskErrors.company && <p className="text-xs text-red-500 mt-1">{taskErrors.company}</p>}
                </div>

                {/* Pickup Location */}
                <div>
                  <FieldLabel required>Pickup Location</FieldLabel>
                  <AddressAutocomplete
                    value={taskPickupLocation}
                    onChange={(v) => { setTaskPickupLocation(v); setTaskErrors((p) => ({ ...p, pickupLocation: '' })); }}
                    options={addressBook.pickup}
                    placeholder="e.g. Warehouse A, Valenzuela City"
                    hasError={!!taskErrors.pickupLocation}
                    icon={<Package className="w-3.5 h-3.5" />}
                  />
                  {taskErrors.pickupLocation && <p className="text-xs text-red-500 mt-1">{taskErrors.pickupLocation}</p>}
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
                      onChange={(v) => { setTaskPickedUpDate(v); setTaskErrors((p) => ({ ...p, pickedUpDate: '', eta: '' })); }}
                      hasError={!!taskErrors.pickedUpDate}
                      minIso={todayIso()}
                      maxIso={taskDate || undefined}
                    />
                    {taskErrors.pickedUpDate
                      ? <p className="text-xs text-red-500 mt-1">{taskErrors.pickedUpDate}</p>
                      : <p className="text-[11px] text-muted-foreground mt-1.5">Planned pickup date</p>}
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
                      onChange={(v) => { setTaskDate(v); setTaskErrors((p) => ({ ...p, date: '', eta: '' })); }}
                      hasError={!!taskErrors.date}
                      minIso={taskPickedUpDate && taskPickedUpDate > todayIso() ? taskPickedUpDate : todayIso()}
                    />
                    {taskErrors.date
                      ? <p className="text-xs text-red-500 mt-1">{taskErrors.date}</p>
                      : <p className="text-[11px] text-muted-foreground mt-1.5">Target delivery date</p>}
                  </div>
                  <div>
                    <FieldLabel required>ETA</FieldLabel>
                    <TimeField value={taskEta}
                      onChange={(v) => { setTaskEta(v); setTaskErrors((p) => ({ ...p, eta: '' })); }}
                      hasError={!!taskErrors.eta}
                    />
                    {taskErrors.eta
                      ? <p className="text-xs text-red-500 mt-1">{taskErrors.eta}</p>
                      : <p className="text-[11px] text-muted-foreground mt-1.5">Estimated Time of Arrival</p>}
                  </div>
                </div>

                {/* Remarks */}
                <div>
                  <FieldLabel hint="(optional)">Remarks</FieldLabel>
                  <textarea value={taskRemarks} onChange={(e) => setTaskRemarks(e.target.value)}
                    placeholder="Any special instructions…" rows={3}
                    className={`${fieldBase} ${fieldTone(false)} resize-none`}
                  />
                </div>
              </div>

              {/* Buttons */}
              <div className="flex flex-col-reverse sm:flex-row gap-3 pt-6 sm:pt-7">
                <button onClick={() => { setTaskErrors({}); setTaskStep(1); }}
                  className="px-5 py-2.5 border border-border rounded-[10px] hover:bg-accent transition-colors text-sm font-medium text-foreground inline-flex items-center gap-1.5">
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                <button onClick={handleAssignTask}
                  className="flex-1 px-5 py-2.5 bg-[#1DBF73] text-white rounded-[10px] hover:bg-[#19a865] transition-all shadow-sm hover:shadow active:scale-[0.99] text-sm font-semibold inline-flex items-center justify-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" /> Assign Task
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
          onCreated={(d) => setTaskDriverId(d.id)}
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
          onClose={() => setViewDetailsId(null)}
          onApproveDoc={handleApproveDoc}
          onRejectDoc={handleRejectDoc}
          onComplete={handleComplete}
          onCancel={handleCancel}
          onSimulateLate={handleSimulateLate}
          isViewOnly={isViewOnly}
          adminEmail={adminEmail}
        />
      )}
    </div>
  );
}