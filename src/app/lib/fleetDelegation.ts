import { parsePhilippineMobile } from './philippineMobile';

/* Leave coverage (REQ-018): the OPM lets one CSR reset driver PINs and/or register drivers and
   trucks for a stated window. The database is the authority (every call re-checks the window);
   these helpers only decide what the screens show. */

export interface FleetDelegation {
  id: string;
  csrId: string;
  startsAt: string;
  endsAt: string;
  canResetPin: boolean;
  canRegister: boolean;
  revokedAt: string | null;
  /** The number drivers call while PIN reset is covered (local form 09XXXXXXXXX); null for older grants. */
  contactPhone: string | null;
}

/** What the signed-in CSR may do right now: until when each kind of access lasts (null = none). */
export interface MyFleetDelegation {
  pinUntil: string | null;
  registerUntil: string | null;
}

export type DelegationStatus = 'scheduled' | 'active' | 'ended' | 'revoked';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function delegationStatus(d: Pick<FleetDelegation, 'startsAt' | 'endsAt' | 'revokedAt'>, nowMs: number): DelegationStatus {
  if (d.revokedAt) return 'revoked';
  if (nowMs >= new Date(d.endsAt).getTime()) return 'ended';
  if (nowMs < new Date(d.startsAt).getTime()) return 'scheduled';
  return 'active';
}

export function delegationScopeLabel(d: Pick<FleetDelegation, 'canResetPin' | 'canRegister'>): string {
  return [d.canResetPin ? 'Reset driver PINs' : '', d.canRegister ? 'Register drivers & trucks' : '']
    .filter(Boolean).join(' + ');
}

/** true while `until` is still in the future (a missing or unreadable date means no access). */
export function accessActive(until: string | null | undefined, nowMs: number): boolean {
  if (!until) return false;
  const end = new Date(until).getTime();
  return Number.isFinite(end) && nowMs < end;
}

/** "14 days", "14 days 6 hours", "6 hours", "45 minutes" — shown before confirming a grant so a wrong
    month or year stands out. There is deliberately no maximum length. */
export function formatWindowLength(ms: number): string {
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const minutes = Math.round((ms % HOUR) / MINUTE);
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (days > 0) return hours > 0 ? `${unit(days, 'day')} ${unit(hours, 'hour')}` : unit(days, 'day');
  if (hours > 0) return minutes > 0 ? `${unit(hours, 'hour')} ${unit(minutes, 'minute')}` : unit(hours, 'hour');
  return unit(Math.max(minutes, 1), 'minute');
}

export type WindowCheck =
  | { ok: true; startsAt: Date; endsAt: Date; length: string }
  | { ok: false; error: string };

/** Validates the two date-time fields from the form (browser-local `YYYY-MM-DDTHH:mm`). Mirrors the
    database rules: an end after the start, and not already over. */
export function checkCoverageWindow(startValue: string, endValue: string, nowMs: number): WindowCheck {
  if (!startValue || !endValue) return { ok: false, error: 'Choose when the coverage starts and ends.' };
  const startsAt = new Date(startValue);
  const endsAt = new Date(endValue);
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())) {
    return { ok: false, error: 'Enter a valid start and end date.' };
  }
  if (endsAt.getTime() <= startsAt.getTime()) return { ok: false, error: 'The end must be after the start.' };
  if (endsAt.getTime() <= nowMs) return { ok: false, error: 'The end must be in the future.' };
  return { ok: true, startsAt, endsAt, length: formatWindowLength(endsAt.getTime() - startsAt.getTime()) };
}

/** New grants may start today (including "start immediately") or on a future day.
 * Existing historical windows and the backend's accepted timestamp contract stay unchanged. */
export function checkNewCoverageWindow(startValue: string, endValue: string, nowMs: number): WindowCheck {
  const checked = checkCoverageWindow(startValue, endValue, nowMs);
  if (!checked.ok) return checked;
  const today = toLocalInputValue(new Date(nowMs)).slice(0, 10);
  if (toLocalInputValue(checked.startsAt).slice(0, 10) < today) {
    return { ok: false, error: 'The start date must be today or a future date.' };
  }
  return checked;
}

/** Browser-local value for a `datetime-local` input. */
export function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Accepts 09171234567, 0917 123 4567, +63 917 123 4567 …; returns the local form the database stores
    (09XXXXXXXXX), or null when it is not a Philippine mobile number. */
export function normalizeContactPhone(raw: string): string | null {
  const mobile = parsePhilippineMobile(raw);
  return mobile ? `0${mobile.subscriber}` : null;
}

/** 09171234567 → "0917 123 4567" (what a driver reads). */
export function formatContactPhone(local: string): string {
  return local.replace(/^(\d{4})(\d{3})(\d{4})$/, '$1 $2 $3');
}
