import { useState } from 'react';
import { Calendar, Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import { Popover, PopoverAnchor, PopoverContent } from '../ui/popover';

const MONTHS_LONG = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];
const WEEKDAYS    = ['Su','Mo','Tu','We','Th','Fr','Sa'];

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/* Parsed as local midnight — `new Date(iso)` would parse as UTC and skew the day */
const isoToDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const dateToIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const fieldBase =
  'w-full px-3.5 py-2.5 rounded-[10px] border text-sm text-foreground placeholder:text-muted-foreground ' +
  'focus:outline-none focus:ring-2 focus:ring-[#1DBF73]/25 focus:border-[#1DBF73] transition-colors';
const fieldTone = (err?: boolean) => err ? 'border-red-400 bg-red-50' : 'border-border bg-white';

/* Slim, light scrollbars — the browser default renders as heavy dark bars */
const thinScroll =
  '[scrollbar-width:thin] [scrollbar-color:#d1d5db_transparent] ' +
  '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent ' +
  '[&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-thumb]:rounded-full ' +
  'hover:[&::-webkit-scrollbar-thumb]:bg-[#1DBF73]/50';

/* ─── Date field — type into the input, or click the icon for a calendar ─── */
export function DateField({ value, onChange, hasError, minIso, maxIso, id, label, restrictToday = false, layer = false, calendarToday, describedBy }: {
  /* `bad` = the browser holds a half-typed or impossible date (its value is then '') */
  value: string; onChange: (v: string, bad?: boolean) => void; hasError?: boolean;
  /* Bound the selectable range; typing is still validated on submit */
  minIso?: string;
  maxIso?: string;
  id?: string;
  label?: string;
  describedBy?: string;
  restrictToday?: boolean;
  layer?: boolean;
  /** Override only the calendar day; date-only selections are never converted to instants. */
  calendarToday?: string;
}) {
  const [open, setOpen] = useState(false);

  /* Which month the calendar is showing — follows the value when there is one */
  const today = calendarToday ?? todayIso();
  const anchor = isoToDate(value || today);
  const [viewY, setViewY] = useState(anchor.getFullYear());
  const [viewM, setViewM] = useState(anchor.getMonth());

  /* Re-centre on the selected date each time the calendar is opened */
  const openCalendar = () => {
    const a = isoToDate(value || today);
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
            id={id} aria-label={label} aria-describedby={describedBy} aria-invalid={hasError || undefined} type="date" value={value}
            onChange={(e) => onChange(e.target.value, e.target.validity.badInput)}
            onBlur={(e) => { if (e.target.validity.badInput) onChange(e.target.value, true); }}
            /* Without a max the browser lets the year run to 6 digits */
            min={minIso} max={maxIso ?? '9999-12-31'}
            className={`${fieldBase} ${fieldTone(hasError)} pr-10 [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-inner-spin-button]:hidden`}
          />
          <button type="button" onClick={openCalendar} aria-label={label ? `Open ${label.toLowerCase()} calendar` : 'Open calendar'}
            className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <Calendar className="w-4 h-4" />
          </button>
        </div>
      </PopoverAnchor>

      <PopoverContent
        align="start"
        sideOffset={6}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className={`w-[268px] max-w-[calc(100vw-2rem)] bg-white border border-border rounded-xl shadow-xl p-3 ${layer ? 'z-[90]' : ''}`}
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
            const isToday  = iso === today;
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
          <button type="button" disabled={restrictToday && ((!!minIso && today < minIso) || (!!maxIso && today > maxIso))} onClick={() => { onChange(today); setOpen(false); }}
            className="text-xs font-medium text-[#1DBF73] hover:underline disabled:opacity-40 disabled:cursor-not-allowed">Today</button>
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

export function TimeField({ value, onChange, hasError, id, label, layer = false, describedBy }: {
  value: string; onChange: (v: string) => void; hasError?: boolean;
  id?: string;
  label?: string;
  describedBy?: string;
  layer?: boolean;
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
            id={id} aria-label={label} aria-describedby={describedBy} aria-invalid={hasError || undefined} type="time" value={value}
            onChange={(e) => onChange(e.target.value)}
            className={`${fieldBase} ${fieldTone(hasError)} pr-10 [&::-webkit-calendar-picker-indicator]:hidden`}
          />
          <button type="button" onClick={() => setOpen((v) => !v)} aria-label={label ? `Open ${label.toLowerCase()} picker` : 'Open time picker'}
            className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <Clock className="w-4 h-4" />
          </button>
        </div>
      </PopoverAnchor>

      <PopoverContent
        align="start"
        sideOffset={6}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className={`w-auto bg-white border border-border rounded-xl shadow-xl p-2.5 ${layer ? 'z-[90]' : ''}`}
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

