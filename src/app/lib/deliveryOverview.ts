import type { Assignment, CompletedTask, AppNotification, AdminActivityEntry } from '../data/assignmentTypes';
import {
  ASSIGNMENT_DISPLAY_STATUSES, getAssignmentDisplayStatus,
  type AssignmentDisplayStatus,
} from './assignmentWorkflow';
import { creationTime } from './recordOrdering';
import { statusPhotoTimestamp } from './assignmentTiming';

export type OverviewPeriod = 'today' | 'week' | 'month' | 'year' | 'all';
export type OverviewCounts = Record<AssignmentDisplayStatus, number>;
export type OverviewBar = { key: string; label: string; detail: string; title: string; counts: OverviewCounts };

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type ManilaParts = { year: number; month: number; day: number; hour: number };
type OverviewItem = { id: string; activityAt: number | null; status: AssignmentDisplayStatus };
type DatedItem = { date: ManilaParts; status: AssignmentDisplayStatus };

const manilaFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', hourCycle: 'h23',
});
const manilaParts = (date: Date): ManilaParts => {
  const parts = Object.fromEntries(manilaFormatter.formatToParts(date).map(part => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour) };
};
const dayKey = ({ year, month, day }: ManilaParts) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const utcDay = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day));
const mondayOffset = (date: Date) => (date.getUTCDay() + 6) % 7;

export const emptyOverviewCounts = (): OverviewCounts =>
  Object.fromEntries(ASSIGNMENT_DISPLAY_STATUSES.map(status => [status, 0])) as OverviewCounts;
const makeBar = (key: string, label: string, detail: string, title: string): OverviewBar =>
  ({ key, label, detail, title, counts: emptyOverviewCounts() });

/** Server event times retain the year and offset. Display-only timestamps do not. */
function eventTime(value?: string): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** One current status per assignment ID, using the same workflow calculation as
 * Dispatch and Deliveries. The cancelled archive wins if arrays briefly overlap.
 * The most recent known assignment activity determines its date bucket. */
export function getOverviewItems(
  assignments: readonly Assignment[], completed: readonly CompletedTask[], cancelled: readonly Assignment[],
  notifications: readonly AppNotification[] = [], activityLog: readonly AdminActivityEntry[] = [],
): OverviewItem[] {
  const byId = new Map<string, OverviewItem>();
  const add = (record: Assignment, status: AssignmentDisplayStatus) => {
    const evidenceTimes = Object.values(record.statusPhotos ?? {})
      .map(photo => statusPhotoTimestamp(photo.timestamp))
      .filter((time): time is number => time !== null);
    const times = [creationTime(record.createdAt, record.id), ...evidenceTimes].filter((time): time is number => time !== null);
    byId.set(record.id, { id: record.id, activityAt: times.length ? Math.max(...times) : null, status });
  };
  // An archived completion wins if a save/poll briefly exposes both copies.
  for (const record of [...assignments, ...completed]) {
    add(record, getAssignmentDisplayStatus(record));
  }
  for (const record of cancelled) {
    add(record, 'Cancelled');
  }
  const noteActivity = (id: string | undefined, time: number | null) => {
    const item = id ? byId.get(id) : undefined;
    if (item && time !== null) item.activityAt = Math.max(item.activityAt ?? time, time);
  };
  for (const notification of notifications) {
    noteActivity(notification.assignmentId, eventTime(notification.createdAt));
  }
  for (const entry of activityLog) {
    noteActivity(entry.assignmentId, eventTime(entry.timestamp));
  }
  return [...byId.values()];
}

/** The selected period is based on the latest known assignment activity.
 * Each record is grouped once by its CURRENT workflow status, not by transitions.
 * Calendar buckets use Manila time, matching the previous chart behaviour. */
export function buildOverviewBars(
  assignments: readonly Assignment[], completed: readonly CompletedTask[], cancelled: readonly Assignment[],
  period: OverviewPeriod, now = new Date(), compactMonth = false,
  notifications: readonly AppNotification[] = [], activityLog: readonly AdminActivityEntry[] = [],
): OverviewBar[] {
  const items = getOverviewItems(assignments, completed, cancelled, notifications, activityLog);
  if (period === 'all') {
    const bar = makeBar('all', 'All', 'time', 'All time');
    items.forEach(item => { bar.counts[item.status] += 1; });
    return [bar];
  }

  const current = manilaParts(now);
  const dated: DatedItem[] = items.flatMap(item => item.activityAt === null ? [] : [{
    date: manilaParts(new Date(item.activityAt)), status: item.status,
  }]);

  let bars: OverviewBar[];
  let bucketKey: (item: DatedItem) => string;
  let selected = dated;
  if (period === 'today') {
    const today = dayKey(current);
    selected = dated.filter(item => dayKey(item.date) === today);
    if (selected.length <= 3) {
      bars = [makeBar(today, 'Today', '', 'Today')];
      bucketKey = item => dayKey(item.date);
    } else {
      const hours = [...new Set(selected.map(item => item.date.hour))].sort((a, b) => a - b);
      bars = hours.map(hour => makeBar(String(hour), String(hour).padStart(2, '0'), 'h', `${String(hour).padStart(2, '0')}:00`));
      bucketKey = item => String(item.date.hour);
    }
  } else if (period === 'week') {
    const first = utcDay(current.year, current.month, current.day);
    first.setUTCDate(first.getUTCDate() - mondayOffset(first));
    bars = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(first);
      date.setUTCDate(first.getUTCDate() + index);
      const parts = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: 0 };
      return makeBar(dayKey(parts), DAY_NAMES[date.getUTCDay()], String(parts.day), `${DAY_NAMES[date.getUTCDay()]} ${MONTH_NAMES[parts.month - 1]} ${parts.day}`);
    });
    bucketKey = item => dayKey(item.date);
  } else if (period === 'month') {
    const daysInMonth = utcDay(current.year, current.month + 1, 0).getUTCDate();
    const firstOffset = mondayOffset(utcDay(current.year, current.month, 1));
    if (compactMonth && daysInMonth >= 30) {
      const weekCount = Math.ceil((firstOffset + daysInMonth) / 7);
      bars = Array.from({ length: weekCount }, (_, index) => {
        const firstDay = Math.max(1, index * 7 + 1 - firstOffset);
        const lastDay = Math.min(daysInMonth, (index + 1) * 7 - firstOffset);
        return makeBar(String(index), `W${index + 1}`, `${firstDay}–${lastDay}`, `${MONTH_NAMES[current.month - 1]} ${firstDay}–${lastDay}`);
      });
      bucketKey = item => String(Math.floor((firstOffset + item.date.day - 1) / 7));
    } else {
      bars = Array.from({ length: daysInMonth }, (_, index) => {
        const date = utcDay(current.year, current.month, index + 1);
        return makeBar(String(index + 1), DAY_NAMES[date.getUTCDay()], String(index + 1), `${MONTH_NAMES[current.month - 1]} ${index + 1}`);
      });
      bucketKey = item => String(item.date.day);
    }
  } else {
    bars = MONTH_NAMES.map((name, index) => makeBar(String(index + 1), name, '', `${name} ${current.year}`));
    bucketKey = item => String(item.date.month);
  }

  const byKey = new Map(bars.map(bar => [bar.key, bar]));
  for (const item of selected) {
    if (period === 'month' && (item.date.year !== current.year || item.date.month !== current.month)) continue;
    if (period === 'year' && item.date.year !== current.year) continue;
    const bar = byKey.get(bucketKey(item));
    if (bar) bar.counts[item.status] += 1;
  }
  return bars;
}
