import { Fragment, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  FileDown, TrendingUp, Package, AlertTriangle,
  X, Eye, Printer, Clock, Truck, Check,
  User, MapPin, Building2, Timer, AlarmClock, Gauge,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Assignment, CompletedTask, TaskStatus, LocalTruck } from '../../data/assignmentTypes';
import { parseStoredTimestamp } from '../../data/assignmentTypes';
import { splitDisplayDateTime } from '../../lib/displayDateTime';
import { getAssignmentRoute } from '../../data/assignmentRoute';
import { statusColors } from '../../data/statusColors';
import { PaginationFooter, usePagination } from './Pagination';
import QRCode from 'qrcode';
import { restoreSession, issueReport, listIssuedReports, type IssuedReportSummary } from '../../lib/db';
import { REPORT_TYPE_LABEL } from '../../lib/reportTypes';
import WeeklyPrintReport from './WeeklyPrintReport';
import MonthlyPrintReport from './MonthlyPrintReport';
import DelayPrintReport from './DelayPrintReport';
import FleetUtilizationPrintReport from './FleetUtilizationPrintReport';
import DeliveryStatusDonut from './DeliveryStatusDonut';

const REPORT_PAGE_SIZE = 8;
const INCIDENT_PAGE_SIZE = 10;
const UTILIZATION_PAGE_SIZE = 10;

/* ─── Types ───────────────────────────────────────── */
interface WeeklyRow {
  date: string; asn: string; driver: string; truck: string; route: string;
  client: string; pickupTime: string; eta: string; ata: string;
  status: 'On Time' | 'Delayed' | 'Completed' | 'Assigned' | 'Picked Up' | 'In Transit';
}
interface MonthlyRow {
  week: string; period: string; total: number;
  onTime: number; delayed: number; cancelled: number; rate: string;
}
interface DelayRow {
  date: string; asn: string; driver: string; truck: string; route: string;
  client: string; scheduledTime: string; reportedAt: string; reportedStamp: string;
  reason: string; type: string; status: 'Resolved' | 'Ongoing';
}
interface TruckUtilRow {
  plate: string; classification: string; timesAssigned: number;
  completedTrips: number; cancelledAssignments: number;
  lastDriver: string; lastUsedDate: string;
}
interface DriverUtilRow {
  key: string; name: string; timesAssigned: number; completedDeliveries: number;
  cancelledAssignments: number; lastTruck: string; lastRoute: string; lastDeliveryDate: string;
}
type ReportKey = 'weekly' | 'monthly' | 'delay' | 'utilization';
type UtilTab = 'trucks' | 'drivers';
type ReportMetric = {
  label: string;
  value: number | string;
  icon: typeof Package;
  valueColor?: string;
  supporting?: string;
  printColor: string;
  printBackground?: string;
};

interface MonthlyPreviewRow {
  key: string; month: string; total: number; completed: number;
  onTime: number; delayed: number; cancelled: number; active: number;
  weeks: number[];
}

/* ─── Helpers ─────────────────────────────────────── */
function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return iso; }
}
function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

/* REQ-007: issued_reports.report_period_start/end are plain YYYY-MM-DD with no time
   component — anchor to UTC noon so no local timezone can shift the calendar day. */
function fmtPeriod(start: string | null, end: string | null): string {
  if (!start || !end) return '—';
  const label = (day: string) => new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric',
  }).format(new Date(`${day}T00:00:00Z`));
  return start === end ? label(start) : `${label(start)} – ${label(end)}`;
}
function fmtGeneratedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function completionRate(completedTrips: number, timesAssigned: number): string {
  return timesAssigned > 0 ? `${((completedTrips / timesAssigned) * 100).toFixed(1)}%` : '—';
}

function arrivalTime(assignment: Assignment): string {
  return splitDisplayDateTime(assignment.destinationArrivedAt)?.time ?? '—';
}

/* REQ-007: the current ISO calendar week (Mon-Sun) containing `now` — Reports.tsx's
   Weekly report previously had no date filter at all and included every active +
   completed assignment regardless of date. */
function isoWeekBounds(now: Date): { start: Date; end: Date } {
  const day = (now.getDay() + 6) % 7; // Mon=0 ... Sun=6
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day, 0, 0, 0, 0);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 23, 59, 59, 999);
  return { start, end };
}
function inRange(value: string | null | undefined, start: Date, end: Date): boolean {
  const d = value ? parseStoredTimestamp(value) : null;
  return !!d && d.getTime() >= start.getTime() && d.getTime() <= end.getTime();
}

// Local date components only — toISOString() converts to UTC first, which silently
// shifts the date back a day for any positive UTC offset (e.g. Philippine time)
// whenever local midnight hasn't yet reached UTC midnight.
function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* REQ-007: a frozen forensic digest over the exact rows a report includes at
   generation time — never recomputed or live-compared, just stored alongside
   the issued report for possible future/manual auditing. */
async function sha256Hex(input: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* Build weekly rows from live data, scoped to the current ISO week */
function buildWeeklyRows(assignments: Assignment[], completed: CompletedTask[], week: { start: Date; end: Date }): WeeklyRow[] {
  const rows: WeeklyRow[] = [];

  for (const c of completed) {
    if (!inRange(c.completedEventAt ?? c.completedAt, week.start, week.end)) continue;
    const isDelayed = (c.delayReports?.length ?? 0) > 0;
    rows.push({
      date: c.completedAt ? fmtDate(c.completedAt) : c.deliveryDate,
      asn: c.id,
      driver: c.driverName, truck: c.truckPlate,
      route: getAssignmentRoute(c),
      client: c.company,
      pickupTime: c.pickupTime || '—', eta: c.eta || '—', ata: arrivalTime(c),
      status: isDelayed ? 'Delayed' : 'Completed',
    });
  }

  for (const a of assignments) {
    if (!inRange(a.deliveryDate, week.start, week.end)) continue;
    const isDelayed = (a.delayReports?.length ?? 0) > 0;
    const statusMap: Record<string, WeeklyRow['status']> = {
      'Assigned':   'Assigned',
      'Picked Up':  'Picked Up',
      'In Transit': 'In Transit',
    };
    rows.push({
      date: a.deliveryDate,
      asn: a.id,
      driver: a.driverName, truck: a.truckPlate,
      route: getAssignmentRoute(a),
      client: a.company,
      pickupTime: a.pickupTime || '—', eta: a.eta || '—', ata: arrivalTime(a),
      status: isDelayed ? 'Delayed' : (statusMap[a.taskStatus] ?? 'Assigned'),
    });
  }

  return rows;
}

/* Build delay rows from live data */
function buildDelayRows(assignments: Assignment[], completed: CompletedTask[]): DelayRow[] {
  const rows: DelayRow[] = [];

  const processReports = (a: Assignment | CompletedTask, resolved: boolean) => {
    if (!a.delayReports?.length) return;
    for (const dr of a.delayReports) {
      rows.push({
        date: dr.reportedAt ? fmtDate(dr.reportedAt) : a.deliveryDate,
        asn: a.id,
        driver: a.driverName, truck: a.truckPlate,
        route: getAssignmentRoute(a),
        client: a.company,
        scheduledTime: dr.type === 'pickup' ? (a.pickupTime || '—') : (a.ata || '—'),
        reportedAt: dr.reportedAt ? fmtTime(dr.reportedAt) : '—',
        reportedStamp: dr.reportedAt || '—',
        reason: dr.reason,
        type: dr.type === 'pickup' ? 'Pickup Delay' : 'Delivery Delay',
        status: resolved ? 'Resolved' : 'Ongoing',
      });
    }
  };

  for (const a of assignments) processReports(a, false);
  for (const c of completed)   processReports(c, true);

  return rows;
}

/* Build monthly summary rows from completed + cancelled */
function buildMonthlyRows(completed: CompletedTask[]): MonthlyRow[] {
  if (completed.length === 0) return [];

  // Group by calendar month
  const byMonth: Record<string, CompletedTask[]> = {};
  for (const c of completed) {
    /* This heading prints the year, so a yearless completedAt used to group every
       month under "September 2001". */
    const parsed = c.completedAt ? parseStoredTimestamp(c.completedAt) : null;
    const key = parsed
      ? parsed.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : 'Unknown';
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(c);
  }

  return Object.entries(byMonth).map(([month, tasks]) => {
    const total    = tasks.length;
    const delayed  = tasks.filter((t) => (t.delayReports?.length ?? 0) > 0).length;
    const onTime   = total - delayed;
    const cancelled = 0; // cancelled are removed from completed list
    const rate     = total > 0 ? `${((onTime / total) * 100).toFixed(1)}%` : '0%';
    return { week: month, period: month, total, onTime, delayed, cancelled, rate };
  });
}

/* Web overview uses the scheduled delivery month for every assignment state.
   The existing completed-only rows remain intact for CSV and Print / PDF. */
function buildMonthlyPreviewRows(
  assignments: Assignment[], completed: CompletedTask[], cancelled: Assignment[],
): MonthlyPreviewRow[] {
  const months = new Map<string, MonthlyPreviewRow>();
  const add = (task: Assignment, state: 'active' | 'completed' | 'cancelled') => {
    if (!/\d{4}/.test(task.deliveryDate)) return;
    const date = parseStoredTimestamp(task.deliveryDate);
    if (!date) return;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    let row = months.get(key);
    if (!row) {
      row = {
        key, month: date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        total: 0, completed: 0, onTime: 0, delayed: 0, cancelled: 0, active: 0,
        weeks: [0, 0, 0, 0, 0],
      };
      months.set(key, row);
    }
    row.total += 1;
    row.weeks[Math.floor((date.getDate() - 1) / 7)] += 1;
    const hasDelay = (task.delayReports?.length ?? 0) > 0;
    if (hasDelay) row.delayed += 1;
    if (state === 'completed') {
      row.completed += 1;
      if (!hasDelay) row.onTime += 1;
    } else if (state === 'cancelled') row.cancelled += 1;
    else row.active += 1;
  };
  assignments.forEach((task) => add(task, 'active'));
  completed.forEach((task) => add(task, 'completed'));
  cancelled.forEach((task) => add(task, 'cancelled'));
  return [...months.values()].sort((a, b) => b.key.localeCompare(a.key));
}

/* Build truck utilization rows from ALL history (active + completed + cancelled),
   keyed by plate rather than the live trucks list — a truck that was later
   deleted still shows its historical usage here, just with no classification
   on file. This is deliberately about historical usage, not current status:
   no "Available/Assigned" column, only cumulative counts. */
function buildTruckUtilRows(
  assignments: Assignment[], completed: CompletedTask[], cancelled: Assignment[], trucks: { plateNumber: string; classification?: string }[],
): TruckUtilRow[] {
  const classByPlate = new Map(trucks.map((t) => [t.plateNumber, t.classification?.trim() || '—']));
  const byPlate = new Map<string, {
    classification: string; timesAssigned: number; completedTrips: number; cancelledAssignments: number;
    lastDriver: string; lastUsedDate: string; lastUsedSort: number;
  }>();

  const touch = (plate: string, driver: string, dateValue: string, kind: 'completed' | 'cancelled' | 'other') => {
    if (!plate.trim()) return;
    let row = byPlate.get(plate);
    if (!row) {
      row = {
        classification: classByPlate.get(plate) ?? '—', timesAssigned: 0, completedTrips: 0,
        cancelledAssignments: 0, lastDriver: '—', lastUsedDate: '—', lastUsedSort: -1,
      };
      byPlate.set(plate, row);
    }
    row.timesAssigned += 1;
    if (kind === 'completed') row.completedTrips += 1;
    if (kind === 'cancelled') row.cancelledAssignments += 1;
    const sortValue = parseStoredTimestamp(dateValue)?.getTime() ?? 0;
    if (sortValue >= row.lastUsedSort) {
      row.lastUsedSort = sortValue;
      row.lastDriver = driver.trim() || '—';
      row.lastUsedDate = dateValue ? fmtDate(dateValue) : '—';
    }
  };

  for (const a of assignments) touch(a.truckPlate, a.driverName, a.pickedUpDate || a.deliveryDate, 'other');
  for (const c of completed)   touch(c.truckPlate, c.driverName, c.completedAt || c.deliveryDate, 'completed');
  for (const x of cancelled)   touch(x.truckPlate, x.driverName, x.deliveryDate, 'cancelled');

  return [...byPlate.entries()]
    .map(([plate, r]) => ({
      plate, classification: r.classification, timesAssigned: r.timesAssigned,
      completedTrips: r.completedTrips, cancelledAssignments: r.cancelledAssignments,
      lastDriver: r.lastDriver, lastUsedDate: r.lastUsedDate,
    }))
    .sort((a, b) => b.timesAssigned - a.timesAssigned || a.plate.localeCompare(b.plate));
}

/* Use the persisted driver ID so two people with the same name stay separate.
   Historical records without an ID retain the previous name-based grouping. */
function buildDriverUtilRows(assignments: Assignment[], completed: CompletedTask[], cancelled: Assignment[]): DriverUtilRow[] {
  const byDriver = new Map<string, {
    name: string;
    timesAssigned: number; completedDeliveries: number; cancelledAssignments: number;
    lastTruck: string; lastRoute: string; lastDeliveryDate: string; lastUsedSort: number;
  }>();

  const touch = (driverId: string, name: string, truck: string, route: string, dateValue: string, kind: 'completed' | 'cancelled' | 'other') => {
    if (!name.trim()) return;
    const persistedId = driverId?.trim();
    const key = persistedId ? `id:${persistedId}` : `name:${name.trim().toLocaleLowerCase()}`;
    let row = byDriver.get(key);
    if (!row) {
      row = { name, timesAssigned: 0, completedDeliveries: 0, cancelledAssignments: 0, lastTruck: '—', lastRoute: '—', lastDeliveryDate: '—', lastUsedSort: -1 };
      byDriver.set(key, row);
    }
    row.timesAssigned += 1;
    if (kind === 'completed') row.completedDeliveries += 1;
    if (kind === 'cancelled') row.cancelledAssignments += 1;
    const sortValue = parseStoredTimestamp(dateValue)?.getTime() ?? 0;
    if (sortValue >= row.lastUsedSort) {
      row.lastUsedSort = sortValue;
      row.name = name;
      row.lastTruck = truck.trim() || '—';
      row.lastRoute = route;
      row.lastDeliveryDate = dateValue ? fmtDate(dateValue) : '—';
    }
  };

  for (const a of assignments) touch(a.driverId, a.driverName, a.truckPlate, getAssignmentRoute(a), a.pickedUpDate || a.deliveryDate, 'other');
  for (const c of completed)   touch(c.driverId, c.driverName, c.truckPlate, getAssignmentRoute(c), c.completedAt || c.deliveryDate, 'completed');
  for (const x of cancelled)   touch(x.driverId, x.driverName, x.truckPlate, getAssignmentRoute(x), x.deliveryDate, 'cancelled');

  return [...byDriver.entries()]
    .map(([key, r]) => ({
      key, name: r.name, timesAssigned: r.timesAssigned, completedDeliveries: r.completedDeliveries,
      cancelledAssignments: r.cancelledAssignments, lastTruck: r.lastTruck, lastRoute: r.lastRoute, lastDeliveryDate: r.lastDeliveryDate,
    }))
    .sort((a, b) => b.timesAssigned - a.timesAssigned || a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}

/* ─── CSV Export Helper ───────────────────────────── */
function downloadCSV(filename: string, headers: string[], rows: string[][]) {
  const csv = [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click(); URL.revokeObjectURL(url);
}

/* ─── Delay Type Badge ────────────────────────────── */
function DelayTypeBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    'Pickup Delay':   'bg-amber-100 text-amber-700 border-amber-200',
    'Delivery Delay': 'bg-red-100 text-red-700 border-red-200',
    'Client Issue':   'bg-purple-100 text-purple-700 border-purple-200',
    'Weather':        'bg-blue-100 text-blue-700 border-blue-200',
    'Document Issue': 'bg-gray-100 text-gray-700 border-gray-200',
    'Vehicle Issue':  'bg-orange-100 text-orange-700 border-orange-200',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${map[type] ?? 'bg-gray-100 text-gray-700 border-gray-200'}`}>
      {type}
    </span>
  );
}

/* ─── Empty State ─────────────────────────────────── */
function EmptyTable({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
      <Package className="w-10 h-10 mb-3 opacity-30" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

function ReportMetricGrid({ metrics, printMetrics = metrics, weeklyPrint = false, gridClassName = 'lg:grid-cols-4', mobileSingle = false }: { metrics: ReportMetric[]; printMetrics?: ReportMetric[]; weeklyPrint?: boolean; gridClassName?: string; mobileSingle?: boolean }) {
  return <>
    <div className={`grid gap-2.5 print:hidden ${mobileSingle ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2'} ${gridClassName}`}>
      {metrics.map(({ label, value, icon: Icon, valueColor = 'text-foreground', supporting }) => (
        <div key={label} className="flex min-h-[128px] min-w-0 flex-col rounded-xl border border-border bg-white p-3 sm:p-4">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <p className="min-w-0 break-words text-[13px] font-medium leading-snug text-foreground sm:text-sm">{label}</p>
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted/50 text-muted-foreground sm:h-7 sm:w-7">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
          </div>
          <p className={`mt-auto text-4xl font-bold leading-none tabular-nums ${valueColor}`}>{value}</p>
          {supporting && <p className="mt-2 text-xs text-muted-foreground">{supporting}</p>}
        </div>
      ))}
    </div>
    {/* Print / PDF keeps the existing summary treatment. */}
    <div className="hidden print:block">
      <div className={weeklyPrint ? 'grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4' : 'grid grid-cols-2 gap-3 sm:grid-cols-4'}>
        {printMetrics.map(({ label, value, printColor, printBackground }) => weeklyPrint ? (
          <div key={label} className="flex min-h-[92px] flex-col justify-between rounded-xl border border-border bg-white p-3 sm:min-h-[108px] sm:p-4">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className={`text-3xl font-bold leading-none tabular-nums ${printColor}`}>{value}</p>
          </div>
        ) : (
          <div key={label} className={`${printBackground} rounded-xl p-3 text-center`}>
            <p className={`text-2xl font-bold ${printColor}`}>{value}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>
    </div>
  </>;
}

/* ─── Preview Modal ───────────────────────────────── */
function PreviewModal({
  reportKey, assignments, completed, cancelled, trucks, onClose,
}: {
  reportKey: ReportKey;
  assignments: Assignment[];
  completed: CompletedTask[];
  cancelled: Assignment[];
  trucks: { plateNumber: string; classification?: string }[];
  onClose: () => void;
}) {
  const weekBounds  = isoWeekBounds(new Date());
  const weeklyRows  = buildWeeklyRows(assignments, completed, weekBounds);
  const delayRows   = buildDelayRows(assignments, completed);
  const monthlyRows = buildMonthlyRows(completed);
  const monthlyPreviewRows = buildMonthlyPreviewRows(assignments, completed, cancelled);
  const [selectedMonthKey, setSelectedMonthKey] = useState<string | null>(null);
  const selectedMonth = monthlyPreviewRows.find((row) => row.key === selectedMonthKey) ?? monthlyPreviewRows[0];
  const [utilTab, setUtilTab] = useState<UtilTab>('trucks');
  const truckUtilRows  = buildTruckUtilRows(assignments, completed, cancelled, trucks);
  const driverUtilRows = buildDriverUtilRows(assignments, completed, cancelled);
  const weeklyPage = usePagination(weeklyRows, REPORT_PAGE_SIZE);
  const monthlyPreviewPage = usePagination(monthlyPreviewRows, REPORT_PAGE_SIZE);
  const delayPage = usePagination(delayRows, INCIDENT_PAGE_SIZE);
  const truckUtilPage = usePagination(truckUtilRows, UTILIZATION_PAGE_SIZE);
  const driverUtilPage = usePagination(driverUtilRows, UTILIZATION_PAGE_SIZE);
  const selectedPage = reportKey === 'weekly' ? weeklyPage : reportKey === 'monthly' ? monthlyPreviewPage
    : reportKey === 'delay' ? delayPage : utilTab === 'trucks' ? truckUtilPage : driverUtilPage;
  const selectedCount = reportKey === 'weekly' ? weeklyRows.length : reportKey === 'monthly' ? monthlyPreviewRows.length
    : reportKey === 'delay' ? delayRows.length : utilTab === 'trucks' ? truckUtilRows.length : driverUtilRows.length;
  const [printing, setPrinting] = useState(false);
  const [formalPrintContext, setFormalPrintContext] = useState<{
    generatedAt: Date; generatedBy: string; role: 'OPM' | 'CSR';
    reportId: string | null; qrDataUrl: string | null;
  } | null>(null);
  const [printError, setPrintError] = useState('');
  const selectedDataKey = JSON.stringify(
    reportKey === 'weekly' ? weeklyRows : reportKey === 'monthly' ? monthlyPreviewRows
      : reportKey === 'delay' ? delayRows : utilTab === 'trucks' ? truckUtilRows : driverUtilRows,
  );
  useEffect(() => { selectedPage.setPage(1); }, [reportKey, utilTab, selectedDataKey]);
  useEffect(() => {
    const showAllForPrint = () => flushSync(() => setPrinting(true));
    const restorePage = () => {
      setPrinting(false);
      setFormalPrintContext(null);
    };
    window.addEventListener('beforeprint', showAllForPrint);
    window.addEventListener('afterprint', restorePage);
    return () => {
      window.removeEventListener('beforeprint', showAllForPrint);
      window.removeEventListener('afterprint', restorePage);
    };
  }, []);
  const visibleWeeklyRows = printing ? weeklyRows : weeklyPage.pageItems;
  const visibleMonthlyPreviewRows = monthlyPreviewPage.pageItems;
  const visibleDelayRows = printing ? delayRows : delayPage.pageItems;
  const visibleTruckUtilRows = printing ? truckUtilRows : truckUtilPage.pageItems;
  const visibleDriverUtilRows = printing ? driverUtilRows : driverUtilPage.pageItems;
  const tableLayout = 'block w-full min-w-0 xl:table xl:table-fixed print:table print:table-fixed';
  const tableHead = 'hidden xl:table-header-group print:table-header-group';
  const tableBody = 'block xl:table-row-group print:table-row-group';
  const tableRow = 'block mx-3 my-3 rounded-lg border border-border xl:table-row xl:m-0 xl:rounded-none xl:border-x-0 xl:border-t-0 print:table-row print:m-0 print:border-0';
  const tableCell = 'flex min-w-0 items-start gap-2 px-3 py-2 text-xs break-words before:w-24 before:shrink-0 before:text-[11px] before:font-medium before:text-muted-foreground before:content-[attr(data-label)] xl:table-cell xl:px-2 xl:py-3 xl:before:hidden print:table-cell print:before:hidden';

  const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const config = {
    weekly:      { title: 'Weekly Performance Report',           subtitle: `Generated ${today}` },
    monthly:     { title: 'Monthly Delivery Summary',            subtitle: `Generated ${today}` },
    delay:       { title: 'Delay & Issues Report',                subtitle: `Generated ${today}` },
    utilization: { title: 'Fleet & Driver Utilization Report',   subtitle: `Historical usage, generated ${today}` },
  }[reportKey];

  /* Summary stats */
  const weeklySummary = {
    total:   weeklyRows.length,
    completed: completed.length,
    delayed: weeklyRows.filter((r) => r.status === 'Delayed').length,
    active:  assignments.length,
  };
  const delaySummary = {
    total:    delayRows.length,
    resolved: delayRows.filter((r) => r.status === 'Resolved').length,
    ongoing:  delayRows.filter((r) => r.status === 'Ongoing').length,
    affected: new Set(delayRows.map((r) => r.asn)).size,
  };
  const issueCounts = [...delayRows.reduce((counts, row) =>
    counts.set(row.type, (counts.get(row.type) ?? 0) + 1), new Map<string, number>())]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const mostCommonIssues = issueCounts.length
    ? issueCounts.filter(([, count]) => count === issueCounts[0][1]).map(([type]) => type).join(', ')
    : null;
  const truckUtilSummary = {
    trucks:    truckUtilRows.length,
    assigned:  truckUtilRows.reduce((s, r) => s + r.timesAssigned, 0),
    completed: truckUtilRows.reduce((s, r) => s + r.completedTrips, 0),
    cancelled: truckUtilRows.reduce((s, r) => s + r.cancelledAssignments, 0),
  };
  const driverUtilSummary = {
    drivers:   driverUtilRows.length,
    assigned:  driverUtilRows.reduce((s, r) => s + r.timesAssigned, 0),
    completed: driverUtilRows.reduce((s, r) => s + r.completedDeliveries, 0),
    cancelled: driverUtilRows.reduce((s, r) => s + r.cancelledAssignments, 0),
  };
  const truckUtilMetrics: ReportMetric[] = [
    { label:'Trucks Used',           value: truckUtilSummary.trucks,    icon: Truck,   printColor:'text-blue-600',  printBackground:'bg-blue-50' },
    { label:'Total Assignments',     value: truckUtilSummary.assigned,  icon: Package, printColor:'text-foreground',printBackground:'bg-muted/40' },
    { label:'Completed Trips',       value: truckUtilSummary.completed, icon: Check,   valueColor:'text-green-700', printColor:'text-green-600', printBackground:'bg-green-50' },
    { label:'Cancelled Assignments', value: truckUtilSummary.cancelled, icon: X,       printColor:'text-slate-600', printBackground:'bg-slate-50' },
  ];
  const driverUtilMetrics: ReportMetric[] = [
    { label:'Drivers Used',          value: driverUtilSummary.drivers,   icon: User,    printColor:'text-blue-600',  printBackground:'bg-blue-50' },
    { label:'Total Assignments',     value: driverUtilSummary.assigned,  icon: Package, printColor:'text-foreground',printBackground:'bg-muted/40' },
    { label:'Completed Deliveries',  value: driverUtilSummary.completed, icon: Check,   valueColor:'text-green-700', printColor:'text-green-600', printBackground:'bg-green-50' },
    { label:'Cancelled Assignments', value: driverUtilSummary.cancelled, icon: X,       printColor:'text-slate-600', printBackground:'bg-slate-50' },
  ];

  /* CSV Export */
  const handleExportCSV = () => {
    if (reportKey === 'weekly') {
      downloadCSV('weekly_report.csv',
        ['Date','Driver','Truck #','Route','Client','Pickup Time','ETA','ATA','Status'],
        weeklyRows.map((r) => [r.date,r.driver,r.truck,r.route,r.client,r.pickupTime,r.eta,r.ata,r.status]),
      );
    } else if (reportKey === 'monthly') {
      downloadCSV('monthly_report.csv',
        ['Month','Total','On-Time','Delayed','Cancelled','Rate'],
        monthlyRows.map((r) => [r.week,String(r.total),String(r.onTime),String(r.delayed),String(r.cancelled),r.rate]),
      );
    } else if (reportKey === 'delay') {
      downloadCSV('delay_report.csv',
        ['Date','Driver','Truck #','Route','Client','Scheduled','Reported At','Issue Type','Reason','Status'],
        delayRows.map((r) => [r.date,r.driver,r.truck,r.route,r.client,r.scheduledTime,r.reportedAt,r.type,r.reason,r.status]),
      );
    } else if (utilTab === 'trucks') {
      downloadCSV('truck_utilization_report.csv',
        ['Plate Number','Classification','Times Assigned','Completed Trips','Cancelled Assignments','Last Driver','Last Used Date'],
        truckUtilRows.map((r) => [r.plate,r.classification,String(r.timesAssigned),String(r.completedTrips),String(r.cancelledAssignments),r.lastDriver,r.lastUsedDate]),
      );
    } else {
      downloadCSV('driver_utilization_report.csv',
        ['Driver Name','Times Assigned','Completed Deliveries','Cancelled Assignments','Last Truck Used','Last Delivery Date'],
        driverUtilRows.map((r) => [r.name,String(r.timesAssigned),String(r.completedDeliveries),String(r.cancelledAssignments),r.lastTruck,r.lastDeliveryDate]),
      );
    }
  };

  const handlePrint = async () => {
    setPrintError('');
    try {
      if (reportKey === 'monthly' && !selectedMonth) throw new Error('No selected reporting month');
      const session = await restoreSession();
      if (session?.kind !== 'staff') throw new Error('No active staff session');

      // REQ-007: issue the persistent, publicly-verifiable Report ID BEFORE printing —
      // the QR is only created once a record has actually been issued.
      let periodStart: string | null = null;
      let periodEnd: string | null = null;
      let rowCount = 0;
      let digestSource = '';
      if (reportKey === 'weekly') {
        periodStart = toIsoDate(weekBounds.start);
        periodEnd = toIsoDate(weekBounds.end);
        rowCount = weeklyRows.length;
        digestSource = weeklyRows.map((r) => r.asn).sort().join(',');
      } else if (reportKey === 'monthly' && selectedMonth) {
        periodStart = `${selectedMonth.key}-01`;
        const [y, m] = selectedMonth.key.split('-').map(Number);
        periodEnd = toIsoDate(new Date(y, m, 0));
        rowCount = selectedMonth.total;
        digestSource = JSON.stringify(selectedMonth);
      } else if (reportKey === 'delay') {
        rowCount = delayRows.length;
        digestSource = delayRows.map((r) => `${r.asn}:${r.type}:${r.reportedStamp}`).sort().join(',');
      } else {
        rowCount = utilTab === 'trucks' ? truckUtilRows.length : driverUtilRows.length;
        digestSource = (utilTab === 'trucks' ? truckUtilRows.map((r) => r.plate) : driverUtilRows.map((r) => r.key)).sort().join(',');
      }
      const rowDigest = await sha256Hex(digestSource);
      const issued = await issueReport({ reportType: reportKey, periodStart, periodEnd, rowCount, rowDigest });
      const verifyUrl = `${window.location.origin}/verify-report?id=${encodeURIComponent(issued.id)}`;
      const qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 240 });
      // window.print() can snapshot the page before a freshly-set data: URL image has
      // actually decoded, printing it blank — force the decode to finish first.
      const preload = new Image();
      preload.src = qrDataUrl;
      await preload.decode().catch(() => {});

      flushSync(() => setFormalPrintContext({
        generatedAt: new Date(issued.generatedAt),
        generatedBy: session.staff.name.trim() || session.staff.email,
        // The retained legacy admin role has CSR permissions; OPM is its own role.
        role: session.staff.role === 'opm' ? 'OPM' : 'CSR',
        reportId: issued.id,
        qrDataUrl,
      }));
      window.print();
    } catch {
      setPrintError('Unable to prepare the report. Please try again.');
    }
  };

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative min-w-0 max-w-full bg-white rounded-xl sm:rounded-2xl shadow-2xl w-full xl:max-w-6xl max-h-[94vh] sm:max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200 ${selectedCount > (reportKey === 'delay' ? INCIDENT_PAGE_SIZE : REPORT_PAGE_SIZE) ? 'h-[94vh] sm:h-[90vh]' : ''}`}>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6 flex-shrink-0">
          <div>
            <h3 className="text-lg font-semibold text-foreground">{config.title}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{config.subtitle}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Summary Stats */}
        <div className="border-b border-border px-4 py-3 sm:px-6 flex-shrink-0">
          {reportKey === 'weekly' && (
            <ReportMetricGrid weeklyPrint metrics={[
              { label:'Total Deliveries', value: weeklySummary.total,     icon: Package,       printColor:'text-foreground' },
              { label:'Completed',        value: weeklySummary.completed, icon: Check,         valueColor:'text-green-700', printColor:'text-green-700' },
              { label:'Delayed',          value: weeklySummary.delayed,   icon: AlertTriangle, valueColor:weeklySummary.delayed > 0 ? 'text-red-700' : 'text-foreground', printColor:weeklySummary.delayed > 0 ? 'text-red-700' : 'text-foreground' },
              { label:'Active',           value: weeklySummary.active,    icon: Truck,         valueColor:'text-amber-700', printColor:'text-amber-700' },
            ]} />
          )}
          {reportKey === 'delay' && (
            <ReportMetricGrid metrics={[
              { label:'Total Incidents', value: delaySummary.total,    icon: AlertTriangle, valueColor:delaySummary.total > 0 ? 'text-red-700' : 'text-foreground', printColor:'text-red-600',    printBackground:'bg-red-50' },
              { label:'Resolved',        value: delaySummary.resolved, icon: Check,         valueColor:'text-green-700', printColor:'text-green-600',  printBackground:'bg-green-50' },
              { label:'Ongoing',         value: delaySummary.ongoing,  icon: Timer,         valueColor:'text-amber-700', printColor:'text-amber-600',  printBackground:'bg-amber-50' },
              { label:'Affected Deliveries', value: delaySummary.affected, icon: Truck, supporting:'Unique assignments with reports', printColor:'text-foreground' },
            ]} />
          )}
          {reportKey === 'utilization' && (
            <>
              <div role="tablist" aria-label="Utilization report type" className="mb-4 inline-flex rounded-lg border border-border bg-muted/30 p-1">
                {([['trucks', 'Trucks'], ['drivers', 'Drivers']] as const).map(([key, label]) => (
                  <button key={key} type="button" role="tab" aria-selected={utilTab === key} onClick={() => setUtilTab(key)}
                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      utilTab === key ? 'bg-white text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    }`}>
                    {label}
                  </button>
                ))}
              </div>
              {utilTab === 'trucks' ? (
                <ReportMetricGrid mobileSingle gridClassName="lg:grid-cols-3 2xl:grid-cols-5" printMetrics={truckUtilMetrics} metrics={[
                  ...truckUtilMetrics,
                  { label:'Completion Rate', value:completionRate(truckUtilSummary.completed, truckUtilSummary.assigned), icon:Gauge,
                    supporting:'Completed trips / assignments', printColor:'text-foreground' },
                ]} />
              ) : (
                <ReportMetricGrid mobileSingle gridClassName="lg:grid-cols-3 2xl:grid-cols-5" printMetrics={driverUtilMetrics} metrics={[
                  ...driverUtilMetrics,
                  { label:'Completion Rate', value:completionRate(driverUtilSummary.completed, driverUtilSummary.assigned), icon:Gauge,
                    supporting:'Completed trips / assignments', printColor:'text-foreground' },
                ]} />
              )}
            </>
          )}
        </div>

        {/* Table */}
        <div className="min-w-0 flex-1 overflow-y-auto">
          {/* ── Weekly Table ── */}
          {reportKey === 'weekly' && (
            weeklyRows.length === 0
              ? <EmptyTable message="No deliveries yet. Assignments will appear here once created." />
              : (
                <table className={`${tableLayout} text-sm`}>
                  <colgroup className="hidden xl:table-column-group print:table-column-group">
                    {[8, 11, 9, 18, 16, 9, 8, 8, 13].map((width, i) => <col key={i} style={{ width: `${width}%` }} />)}
                  </colgroup>
                  <thead className={`${tableHead} sticky top-0 bg-muted/40 border-b border-border z-10`}>
                    <tr>
                      {['Date','Driver','Truck #','Route','Client','Pickup Time','ETA','ATA','Status'].map((h) => (
                        <th key={h} className="text-left px-2 py-3 text-[11px] leading-tight font-semibold text-muted-foreground tracking-wide break-words">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className={tableBody}>
                    {visibleWeeklyRows.map((r, i) => (
                      <tr key={i} className={`${tableRow} border-b border-border/40 hover:bg-muted/10 transition-colors xl:[&>td]:align-middle`}>
                        <td data-label="Date" className={`${tableCell} text-muted-foreground`}>{r.date}</td>
                        <td data-label="Driver" className={tableCell}>
                          <div className="flex min-w-0 items-start gap-1.5">
                            <User className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                            <span className="min-w-0 break-words">{r.driver}</span>
                          </div>
                        </td>
                        <td data-label="Truck #" className={tableCell}>
                          <div className="flex min-w-0 items-start gap-1.5">
                            <Truck className="w-3.5 h-3.5 text-[#0d9488] flex-shrink-0" />
                            <span className="min-w-0 break-words font-semibold text-[#0d9488]">{r.truck}</span>
                          </div>
                        </td>
                        <td data-label="Route" className={tableCell}>
                          <div className="flex min-w-0 items-start gap-1.5">
                            <MapPin className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                            <span className="min-w-0 break-words">{r.route}</span>
                          </div>
                        </td>
                        <td data-label="Client" className={tableCell}>
                          <div className="flex min-w-0 items-start gap-1.5">
                            <Building2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                            <span className="min-w-0 break-words">{r.client}</span>
                          </div>
                        </td>
                        <td data-label="Pickup Time" className={tableCell}>
                          <div className="flex min-w-0 items-center gap-1"><Clock className="w-3 h-3 shrink-0 text-muted-foreground" /><span className="min-w-0 break-words xl:whitespace-nowrap">{r.pickupTime}</span></div>
                        </td>
                        <td data-label="ETA" className={tableCell}>
                          <div className="flex min-w-0 items-center gap-1"><Timer className="w-3 h-3 shrink-0 text-muted-foreground" /><span className="min-w-0 break-words xl:whitespace-nowrap">{r.eta}</span></div>
                        </td>
                        <td data-label="ATA" className={tableCell}>
                          <div className="flex min-w-0 items-center gap-1"><AlarmClock className="w-3 h-3 shrink-0 text-muted-foreground" /><span className="min-w-0 break-words xl:whitespace-nowrap">{r.ata}</span></div>
                        </td>
                        <td data-label="Status" className={tableCell}>
                          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${
                            r.status === 'On Time'
                              ? statusColors.Completed.badge
                            : r.status === 'Delayed'
                              ? statusColors['Needs Correction'].badge
                              : statusColors[r.status].badge
                          }`}>{r.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
          )}

          {/* Monthly management overview stays interactive; the formal print document is separate. */}
          {reportKey === 'monthly' && <div className="space-y-4 px-4 py-4 sm:px-6 print:hidden">
            {monthlyPreviewRows.length === 0 ? (
              <EmptyTable message="No deliveries with a dated delivery schedule are available for a monthly summary." />
            ) : <>
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h4 className="text-base font-semibold text-foreground">Monthly overview</h4>
                  <p className="text-xs text-muted-foreground">Grouped by scheduled delivery date across active, completed and cancelled assignments.</p>
                </div>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  Month
                  <select aria-label="Report month" value={selectedMonth.key} onChange={(event) => setSelectedMonthKey(event.target.value)} className="h-9 rounded-lg border border-border bg-white px-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-primary">
                    {monthlyPreviewRows.map((row) => <option key={row.key} value={row.key}>{row.month}</option>)}
                  </select>
                </label>
              </div>
              <div className="space-y-2.5">
                <ReportMetricGrid mobileSingle gridClassName="xl:grid-cols-4" metrics={[
                  { label:'Total Deliveries', value:selectedMonth.total, icon:Package, supporting:selectedMonth.month, printColor:'text-foreground' },
                  { label:'Completed', value:selectedMonth.completed, icon:Check, supporting:'Final completed assignments', valueColor:'text-green-700', printColor:'text-green-700' },
                  { label:'Completion Rate', value:`${((selectedMonth.completed / selectedMonth.total) * 100).toFixed(1)}%`, icon:Gauge, supporting:'Completed / total deliveries', printColor:'text-foreground' },
                  { label:'On-Time Rate', value:selectedMonth.completed ? `${((selectedMonth.onTime / selectedMonth.completed) * 100).toFixed(1)}%` : '—', icon:Clock, supporting:'Completed without a delay report', valueColor:'text-green-700', printColor:'text-green-700' },
                ]} />
                <ReportMetricGrid mobileSingle gridClassName="xl:grid-cols-3" metrics={[
                  { label:'Delayed', value:selectedMonth.delayed, icon:AlertTriangle, supporting:'Assignments with a delay report', valueColor:selectedMonth.delayed ? 'text-red-700' : 'text-foreground', printColor:'text-foreground' },
                  { label:'Cancelled', value:selectedMonth.cancelled, icon:X, supporting:'Cancelled assignments', printColor:'text-foreground' },
                  { label:'Active', value:selectedMonth.active, icon:Truck, supporting:'Not finally completed', valueColor:'text-amber-700', printColor:'text-amber-700' },
                ]} />
              </div>
              <section className="rounded-xl border border-border bg-white p-4">
                <h4 className="text-sm font-semibold uppercase tracking-wide text-foreground">Delivery Activity</h4>
                <p className="mt-1 text-xs text-muted-foreground">Scheduled delivery volume by day-of-month week for {selectedMonth.month}.</p>
                <div className="mt-3 h-44 min-w-0" role="img" aria-label={`Weekly delivery volume: ${selectedMonth.weeks.map((count, index) => `Week ${index + 1}, ${count}`).join('; ')}`}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={selectedMonth.weeks.map((total, index) => ({ week:`Week ${index + 1}`, total }))} margin={{ top: 6, right: 4, left: -24, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="#e5e7eb" />
                      <XAxis dataKey="week" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                      <Tooltip formatter={(value) => [value, 'Deliveries']} />
                      <Bar dataKey="total" fill="#238a4a" radius={[3, 3, 0, 0]} maxBarSize={64} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
              <section>
                <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-foreground">Monthly Breakdown</h4>
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="min-w-[760px] w-full text-sm">
                    <thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr>
                      {['Month','Total Deliveries','Completed','On-Time','Delayed','Cancelled','Completion Rate'].map((label) => <th key={label} className="px-3 py-2.5 font-semibold">{label}</th>)}
                    </tr></thead>
                    <tbody>{visibleMonthlyPreviewRows.map((row) => <tr key={row.key} className="border-t border-border/70">
                      <td className="px-3 py-2.5 font-medium">{row.month}</td>
                      <td className="px-3 py-2.5">{row.total}</td>
                      <td className="px-3 py-2.5">{row.completed}</td>
                      <td className="px-3 py-2.5">{row.onTime}</td>
                      <td className="px-3 py-2.5">{row.delayed}</td>
                      <td className="px-3 py-2.5">{row.cancelled}</td>
                      <td className="px-3 py-2.5 font-medium">{((row.completed / row.total) * 100).toFixed(1)}%</td>
                    </tr>)}</tbody>
                  </table>
                </div>
              </section>
              <section className="rounded-xl border border-border bg-white p-4">
                <h4 className="text-sm font-semibold uppercase tracking-wide text-foreground">Monthly Notes</h4>
                <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-sm">
                  <dt>Completed deliveries</dt><dd className="font-semibold">{selectedMonth.completed}</dd>
                  <dt>On-time rate</dt><dd className="font-semibold">{selectedMonth.completed ? `${((selectedMonth.onTime / selectedMonth.completed) * 100).toFixed(1)}%` : '—'}</dd>
                  <dt>Delayed deliveries</dt><dd className="font-semibold">{selectedMonth.delayed}</dd>
                  <dt>Cancelled deliveries</dt><dd className="font-semibold">{selectedMonth.cancelled}</dd>
                  {selectedMonth.active > 0 && <><dt>Active deliveries</dt><dd className="font-semibold">{selectedMonth.active}</dd></>}
                </dl>
              </section>
            </>}
          </div>}

          {reportKey === 'delay' && <div className="space-y-5 px-4 py-4 sm:px-6 print:hidden">
            {delayRows.length === 0 ? (
              <EmptyTable message="No delay reports yet. Incidents will appear here when drivers report delays." />
            ) : <>
              <section>
                <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-foreground">Issue Type Breakdown</h4>
                <div className="rounded-xl border border-border bg-white">
                  {issueCounts.map(([type, count]) => (
                    <div key={type} className="flex items-center justify-between gap-4 border-b border-border/70 px-4 py-2.5 last:border-b-0">
                      <span className="text-sm text-foreground">{type}</span>
                      <span className="font-semibold tabular-nums text-foreground">{count}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-foreground">Incident Details</h4>
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full min-w-[880px] table-fixed text-xs">
                    <colgroup>
                      <col className="w-[9%]" /><col className="w-[12%]" /><col className="w-[15%]" />
                      <col className="w-[11%]" /><col className="w-[27%]" /><col className="w-[15%]" /><col className="w-[11%]" />
                    </colgroup>
                    <thead className="bg-muted/40 text-left text-muted-foreground"><tr>
                      {['Date', 'ASN', 'Driver', 'Truck', 'Route', 'Issue Type', 'Status'].map((label) => (
                        <th key={label} className="px-2.5 py-2.5 font-semibold">{label}</th>
                      ))}
                    </tr></thead>
                    <tbody>{delayPage.pageItems.map((row, index) => (
                      <Fragment key={`${row.asn}-${delayPage.page}-${index}`}>
                      <tr className="border-t border-border/70 align-top">
                        <td className="px-2.5 py-3 text-muted-foreground">{row.date}</td>
                        <td className="break-all px-2.5 py-3 font-semibold text-foreground">{row.asn}</td>
                        <td className="break-words px-2.5 py-3">{row.driver}</td>
                        <td className="break-words px-2.5 py-3">{row.truck}</td>
                        <td className="break-words px-2.5 py-3">{row.route}</td>
                        <td className="px-2.5 py-3"><DelayTypeBadge type={row.type} /></td>
                        <td className="px-2.5 py-3">
                          <span className={`inline-flex rounded-md border px-2 py-0.5 font-medium ${row.status === 'Resolved' ? 'border-green-200 bg-green-50 text-green-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>{row.status}</span>
                        </td>
                      </tr>
                      <tr className="border-b border-border/70 bg-muted/10">
                        <td colSpan={7} className="px-2.5 pb-3 pt-1 text-xs">
                          <p className="break-words text-foreground"><span className="font-semibold">Reason:</span> {row.reason}</p>
                          <p className="mt-1 break-words text-muted-foreground">Client: {row.client} · Scheduled: {row.scheduledTime}</p>
                          <p className="mt-1 break-words text-muted-foreground">Reported: {row.reportedStamp} · Resolved at: — · Delay duration: —</p>
                        </td>
                      </tr>
                      </Fragment>
                    ))}</tbody>
                  </table>
                </div>
              </section>

              <section>
                <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-foreground">Incident Summary</h4>
                <dl className="rounded-xl border border-border bg-white px-4 text-sm">
                  {[
                    ['Total incidents', String(delaySummary.total)],
                    ['Resolved', String(delaySummary.resolved)],
                    ['Ongoing', String(delaySummary.ongoing)],
                    ['Affected deliveries', String(delaySummary.affected)],
                    ...(mostCommonIssues ? [['Most common issue', mostCommonIssues]] : []),
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-start justify-between gap-4 border-b border-border/70 py-2.5 last:border-b-0">
                      <dt className="text-muted-foreground">{label}</dt><dd className="text-right font-semibold text-foreground">{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-2 text-xs text-muted-foreground">Resolved follows the existing completed-delivery rule. Individual incident resolution times and durations are not recorded.</p>
              </section>
            </>}
          </div>}

          {/* Existing Print / PDF table and CSV fields retain their current definitions. */}
          {reportKey === 'delay' && <div className="hidden print:block">{(
            delayRows.length === 0
              ? <EmptyTable message="No delay reports yet. Incidents will appear here when drivers report delays." />
              : (
                <table className={`${tableLayout} text-sm`}>
                  <colgroup className="hidden xl:table-column-group print:table-column-group">
                    {[7, 10, 8, 13, 11, 8, 9, 11, 15, 8].map((width, i) => <col key={i} style={{ width: `${width}%` }} />)}
                  </colgroup>
                  <thead className={`${tableHead} sticky top-0 bg-muted/40 border-b border-border z-10`}>
                    <tr>
                      {['Date','Driver','Truck #','Route','Client','Scheduled','Reported At','Issue Type','Reason for Delay','Status'].map((h) => (
                        <th key={h} className="text-left px-2 py-3 text-[11px] leading-tight font-semibold text-muted-foreground tracking-wide break-words">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className={tableBody}>
                    {visibleDelayRows.map((r, i) => (
                      <tr key={i} className={`${tableRow} border-b border-border/40 hover:bg-muted/10 transition-colors`}>
                        <td data-label="Date" className={`${tableCell} text-muted-foreground`}>{r.date}</td>
                        <td data-label="Driver" className={tableCell}>
                          <div className="flex min-w-0 items-start gap-1.5">
                            <User className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                            <span className="min-w-0 break-words text-xs">{r.driver}</span>
                          </div>
                        </td>
                        <td data-label="Truck #" className={tableCell}>
                          <span className="min-w-0 break-words font-semibold text-[#0d9488] text-xs">{r.truck}</span>
                        </td>
                        <td data-label="Route" className={tableCell}><span className="min-w-0 break-words">{r.route}</span></td>
                        <td data-label="Client" className={tableCell}><span className="min-w-0 break-words">{r.client}</span></td>
                        <td data-label="Scheduled" className={tableCell}>
                          <div className="flex min-w-0 items-start gap-1 text-xs"><Clock className="w-3 h-3 shrink-0 text-muted-foreground" /><span className="min-w-0 break-words">{r.scheduledTime}</span></div>
                        </td>
                        <td data-label="Reported At" className={tableCell}>
                          <div className="flex min-w-0 items-start gap-1 text-xs text-red-500"><Clock className="w-3 h-3 shrink-0" /><span className="min-w-0 break-words">{r.reportedAt}</span></div>
                        </td>
                        <td data-label="Issue Type" className={tableCell}>
                          <DelayTypeBadge type={r.type} />
                        </td>
                        <td data-label="Reason for Delay" className={`${tableCell} text-foreground`}>
                          <span className="min-w-0 break-words">{r.reason}</span>
                        </td>
                        <td data-label="Status" className={tableCell}>
                          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${
                            r.status === 'Resolved'
                              ? 'bg-green-100 text-green-700 border-green-200'
                              : 'bg-amber-100 text-amber-700 border-amber-200'
                          }`}>{r.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
          )}</div>}

          {/* ── Truck Utilization Table ── */}
          {reportKey === 'utilization' && utilTab === 'trucks' && (
            truckUtilRows.length === 0
              ? <EmptyTable message="No fleet utilization data available in the current assignment history." />
              : (
                <table className={`${tableLayout} text-sm`}>
                  <colgroup className="hidden print:table-column-group">
                    {[14, 14, 12, 12, 12, 18, 18].map((width, i) => <col key={i} style={{ width: `${width}%` }} />)}
                  </colgroup>
                  <thead className={`${tableHead} sticky top-0 bg-muted/40 border-b border-border z-10`}>
                    <tr>
                      {['Plate Number','Classification','Times Assigned','Completed Trips','Cancelled','Completion Rate','Last Driver','Last Used Date'].map((h) => (
                        <th key={h} className={`text-left px-2 py-3 text-[11px] leading-tight font-semibold text-muted-foreground tracking-wide break-words ${h === 'Completion Rate' ? 'print:!hidden' : ''}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className={tableBody}>
                    {visibleTruckUtilRows.map((r) => (
                      <tr key={r.plate} className={`${tableRow} border-b border-border/40 hover:bg-muted/10 transition-colors`}>
                        <td data-label="Plate Number" className={tableCell}>
                          <div className="flex min-w-0 items-start gap-1.5">
                            <Truck className="w-3.5 h-3.5 text-[#0d9488] flex-shrink-0" />
                            <span className="min-w-0 break-words font-semibold text-[#0d9488]">{r.plate}</span>
                          </div>
                        </td>
                        <td data-label="Classification" className={`${tableCell} text-muted-foreground`}>{r.classification}</td>
                        <td data-label="Times Assigned" className={tableCell}><span className="font-semibold text-foreground">{r.timesAssigned}</span></td>
                        <td data-label="Completed Trips" className={tableCell}><span className="font-semibold text-green-600">{r.completedTrips}</span></td>
                        <td data-label="Cancelled" className={tableCell}>
                          <span className={`font-semibold ${r.cancelledAssignments > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>{r.cancelledAssignments}</span>
                        </td>
                        <td data-label="Completion Rate" className={`${tableCell} print:!hidden`}><span className="font-semibold tabular-nums text-foreground">{completionRate(r.completedTrips, r.timesAssigned)}</span></td>
                        <td data-label="Last Driver" className={tableCell}>
                          <div className="flex min-w-0 items-start gap-1.5">
                            <User className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                            <span className="min-w-0 break-words">{r.lastDriver}</span>
                          </div>
                        </td>
                        <td data-label="Last Used Date" className={`${tableCell} text-muted-foreground`}>{r.lastUsedDate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
          )}

          {/* ── Driver Utilization Table ── */}
          {reportKey === 'utilization' && utilTab === 'drivers' && (
            driverUtilRows.length === 0
              ? <EmptyTable message="No driver utilization data available in the current assignment history." />
              : (
                <table className={`${tableLayout} text-sm`}>
                  <colgroup className="hidden print:table-column-group">
                    {[20, 14, 16, 14, 16, 20].map((width, i) => <col key={i} style={{ width: `${width}%` }} />)}
                  </colgroup>
                  <thead className={`${tableHead} sticky top-0 bg-muted/40 border-b border-border z-10`}>
                    <tr>
                      {['Driver Name','Times Assigned','Completed Deliveries','Cancelled','Completion Rate','Last Truck Used','Last Route','Last Delivery Date'].map((h) => (
                        <th key={h} className={`text-left px-2 py-3 text-[11px] leading-tight font-semibold text-muted-foreground tracking-wide break-words ${h === 'Completion Rate' || h === 'Last Route' ? 'print:!hidden' : ''}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className={tableBody}>
                    {visibleDriverUtilRows.map((r) => (
                      <tr key={r.key} className={`${tableRow} border-b border-border/40 hover:bg-muted/10 transition-colors`}>
                        <td data-label="Driver Name" className={tableCell}>
                          <div className="flex min-w-0 items-start gap-1.5">
                            <User className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                            <span className="min-w-0 break-words font-semibold text-foreground">{r.name}</span>
                          </div>
                        </td>
                        <td data-label="Times Assigned" className={tableCell}><span className="font-semibold text-foreground">{r.timesAssigned}</span></td>
                        <td data-label="Completed Deliveries" className={tableCell}><span className="font-semibold text-green-600">{r.completedDeliveries}</span></td>
                        <td data-label="Cancelled" className={tableCell}>
                          <span className={`font-semibold ${r.cancelledAssignments > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>{r.cancelledAssignments}</span>
                        </td>
                        <td data-label="Completion Rate" className={`${tableCell} print:!hidden`}><span className="font-semibold tabular-nums text-foreground">{completionRate(r.completedDeliveries, r.timesAssigned)}</span></td>
                        <td data-label="Last Truck Used" className={tableCell}>
                          <div className="flex min-w-0 items-start gap-1.5">
                            <Truck className="w-3.5 h-3.5 text-[#0d9488] flex-shrink-0" />
                            <span className="min-w-0 break-words font-semibold text-[#0d9488]">{r.lastTruck}</span>
                          </div>
                        </td>
                        <td data-label="Last Route" className={`${tableCell} print:!hidden`}><span className="min-w-0 break-words">{r.lastRoute}</span></td>
                        <td data-label="Last Delivery Date" className={`${tableCell} text-muted-foreground`}>{r.lastDeliveryDate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
          )}
        </div>

        <PaginationFooter page={selectedPage.page} totalItems={selectedCount} pageSize={reportKey === 'delay' ? INCIDENT_PAGE_SIZE : reportKey === 'utilization' ? UTILIZATION_PAGE_SIZE : REPORT_PAGE_SIZE}
          onPageChange={selectedPage.setPage} singular="record" plural="records"
          className="border-t border-border bg-muted/10" />

        {/* Footer */}
        <div className="px-4 sm:px-6 py-4 border-t border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 flex-shrink-0 bg-muted/10">
          <p className="text-xs text-muted-foreground">
            {reportKey === 'weekly'      && `${weeklyRows.length} record${weeklyRows.length !== 1 ? 's' : ''} total`}
            {reportKey === 'monthly'     && `${monthlyPreviewRows.length} month${monthlyPreviewRows.length !== 1 ? 's' : ''} total`}
            {reportKey === 'delay'       && `${delayRows.length} incident${delayRows.length !== 1 ? 's' : ''} total`}
            {reportKey === 'utilization' && utilTab === 'trucks'
              && `${truckUtilRows.length} truck${truckUtilRows.length !== 1 ? 's' : ''} total`}
            {reportKey === 'utilization' && utilTab === 'drivers'
              && `${driverUtilRows.length} driver${driverUtilRows.length !== 1 ? 's' : ''} total`}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={onClose}
              className="px-4 py-2 border border-border rounded-lg text-sm hover:bg-accent transition-colors">
              Close
            </button>
            <button onClick={handlePrint}
              className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm hover:bg-accent transition-colors">
              <Printer className="w-4 h-4" /> Print / PDF
            </button>
            <button onClick={handleExportCSV}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary/90 transition-colors">
              <FileDown className="w-4 h-4" /> Export CSV
            </button>
          </div>
        </div>
        {printError && <p role="alert" className="px-4 pb-2 text-sm text-red-700 sm:px-6">{printError}</p>}
      </div>
    </div>
    {reportKey === 'weekly' && formalPrintContext && (
      <WeeklyPrintReport
        rows={weeklyRows}
        summary={weeklySummary}
        weekStart={toIsoDate(weekBounds.start)}
        weekEnd={toIsoDate(weekBounds.end)}
        generatedAt={formalPrintContext.generatedAt}
        generatedBy={formalPrintContext.generatedBy}
        role={formalPrintContext.role}
        reportId={formalPrintContext.reportId}
        qrDataUrl={formalPrintContext.qrDataUrl}
      />
    )}
    {reportKey === 'monthly' && selectedMonth && formalPrintContext && (
      <MonthlyPrintReport
        month={selectedMonth}
        breakdownMonths={monthlyPreviewRows}
        generatedAt={formalPrintContext.generatedAt}
        generatedBy={formalPrintContext.generatedBy}
        role={formalPrintContext.role}
        reportId={formalPrintContext.reportId}
        qrDataUrl={formalPrintContext.qrDataUrl}
      />
    )}
    {reportKey === 'delay' && formalPrintContext && (
      <DelayPrintReport
        rows={delayRows}
        summary={delaySummary}
        issueCounts={issueCounts}
        mostCommonIssues={mostCommonIssues}
        generatedAt={formalPrintContext.generatedAt}
        generatedBy={formalPrintContext.generatedBy}
        role={formalPrintContext.role}
        reportId={formalPrintContext.reportId}
        qrDataUrl={formalPrintContext.qrDataUrl}
      />
    )}
    {reportKey === 'utilization' && formalPrintContext && (
      <FleetUtilizationPrintReport
        trucks={truckUtilRows}
        drivers={driverUtilRows}
        fleetSummary={truckUtilSummary}
        driverSummary={driverUtilSummary}
        formatCompletionRate={completionRate}
        generatedAt={formalPrintContext.generatedAt}
        generatedBy={formalPrintContext.generatedBy}
        role={formalPrintContext.role}
        reportId={formalPrintContext.reportId}
        qrDataUrl={formalPrintContext.qrDataUrl}
      />
    )}
    </>
  );
}

const STATUS_COLORS: Record<TaskStatus, string> = {
  Assigned: statusColors.Assigned.chart,
  'Picked Up': statusColors['Picked Up'].chart,
  'In Transit': statusColors['In Transit'].chart,
  Delivered: statusColors.Delivered.chart,
  'Failed / Issue': statusColors['Failed / Issue'].chart,
  Cancelled: '#64748B',
};
const STATUS_ORDER: TaskStatus[] = [
  'Assigned', 'Picked Up', 'In Transit', 'Delivered', 'Failed / Issue', 'Cancelled',
];
type DateRange = { start: string; end: string };
type ReportEntry = { task: Assignment | CompletedTask; status: TaskStatus; day: string };

function manilaDay(date: Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function initialRange(): DateRange {
  const end = manilaDay(new Date());
  const startDate = new Date(`${end}T00:00:00Z`);
  startDate.setUTCDate(startDate.getUTCDate() - 29);
  return { start: startDate.toISOString().slice(0, 10), end };
}

function validateRange(value: DateRange): string {
  const validDay = (day: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number(day.slice(0, 4)) === 0) return false;
    const date = bucketDate(day);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day;
  };
  if (!validDay(value.start) || !validDay(value.end)) return 'Select a valid date range.';
  return value.start > value.end ? 'From date cannot be after To date.' : '';
}

function reportDay(value?: string): string | null {
  const parsed = value ? parseStoredTimestamp(value) : null;
  return parsed ? manilaDay(parsed) : null;
}

function bucketDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function formatBucket(day: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(bucketDate(day));
}

function buildTrend(entries: ReportEntry[], range: DateRange) {
  const first = bucketDate(range.start);
  const last = bucketDate(range.end);
  const span = Math.round((last.getTime() - first.getTime()) / 86_400_000) + 1;
  const grouping = span <= 14 ? 'day' : span <= 120 ? 'week' : 'month';
  const keyFor = (day: string) => {
    if (grouping === 'day') return day;
    if (grouping === 'month') return day.slice(0, 7);
    const monday = bucketDate(day);
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    return monday.toISOString().slice(0, 10);
  };
  const bars = new Map<string, { key: string; label: string; title: string; onTime: number; delayed: number }>();
  for (const date = new Date(first); date <= last; date.setUTCDate(date.getUTCDate() + 1)) {
    const key = keyFor(date.toISOString().slice(0, 10));
    if (bars.has(key)) continue;
    const label = grouping === 'month'
      ? formatBucket(`${key}-01`, { month: 'short', year: '2-digit' })
      : formatBucket(key, { month: 'short', day: 'numeric' });
    const title = grouping === 'month'
      ? formatBucket(`${key}-01`, { month: 'long', year: 'numeric' })
      : `${grouping === 'week' ? 'Week of ' : ''}${formatBucket(key, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    bars.set(key, { key, label, title, onTime: 0, delayed: 0 });
  }
  for (const entry of entries) {
    if (entry.status !== 'Delivered') continue;
    const key = keyFor(entry.day);
    const bar = bars.get(key)!;
    if (entry.task.delayReports?.length) bar.delayed += 1;
    else bar.onTime += 1;
  }
  return [...bars.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/* ─── Props ───────────────────────────────────────── */
interface ReportsProps {
  assignments: Assignment[];
  completed:   CompletedTask[];
  cancelled:   Assignment[];
  trucks:      LocalTruck[];
}

/* ─── Main Component ──────────────────────────────── */
export default function Reports({ assignments, completed, cancelled, trucks }: ReportsProps) {
  const [previewKey, setPreviewKey] = useState<ReportKey | null>(null);
  const [issuedReports, setIssuedReports] = useState<IssuedReportSummary[] | null>(null);
  const [issuedReportsError, setIssuedReportsError] = useState('');
  const fetchIssuedReports = () => {
    listIssuedReports(20)
      .then((rows) => { setIssuedReports(rows); setIssuedReportsError(''); })
      .catch((error: unknown) => setIssuedReportsError(error instanceof Error ? error.message : 'Could not load report history.'));
  };
  // Refetch on mount, and again whenever the preview modal closes — covers the
  // common "print, close, see it appear" flow without a cross-component event bus.
  useEffect(() => { fetchIssuedReports(); }, []);
  useEffect(() => { if (!previewKey) fetchIssuedReports(); }, [previewKey]);
  const [draftRange, setDraftRange] = useState<DateRange>(initialRange);
  const [range, setRange] = useState<DateRange>(initialRange);
  const [rangeError, setRangeError] = useState('');
  const [actionFeedback, setActionFeedback] = useState<'apply' | 'reset' | null>(null);
  const feedbackTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(feedbackTimer.current), []);

  const clearActionFeedback = () => {
    window.clearTimeout(feedbackTimer.current);
    setActionFeedback(null);
  };
  const confirmRangeAction = (action: 'apply' | 'reset') => {
    clearActionFeedback();
    setActionFeedback(action);
    feedbackTimer.current = window.setTimeout(() => setActionFeedback(null), 1800);
  };
  const applyRange = () => {
    clearActionFeedback();
    const error = validateRange(draftRange);
    setRangeError(error);
    if (error) return;
    setRange(draftRange);
    confirmRangeAction('apply');
  };
  const resetRange = () => {
    const reset = initialRange();
    setDraftRange(reset);
    setRange(reset);
    setRangeError('');
    confirmRangeAction('reset');
  };

  const handleExport = (reportKey: ReportKey) => {
    const weeklyRows  = buildWeeklyRows(assignments, completed, isoWeekBounds(new Date()));
    const dRows       = buildDelayRows(assignments, completed);
    const monthlyRows = buildMonthlyRows(completed);
    if (reportKey === 'weekly') {
      downloadCSV('weekly_report.csv',
        ['Date','Driver','Truck #','Route','Client','Pickup Time','ETA','ATA','Status'],
        weeklyRows.map((r) => [r.date,r.driver,r.truck,r.route,r.client,r.pickupTime,r.eta,r.ata,r.status]),
      );
    } else if (reportKey === 'monthly') {
      downloadCSV('monthly_report.csv',
        ['Month','Total','On-Time','Delayed','Cancelled','Rate'],
        monthlyRows.map((r) => [r.week,String(r.total),String(r.onTime),String(r.delayed),String(r.cancelled),r.rate]),
      );
    } else if (reportKey === 'delay') {
      downloadCSV('delay_report.csv',
        ['Date','Driver','Truck #','Route','Client','Scheduled','Reported At','Issue Type','Reason','Status'],
        dRows.map((r) => [r.date,r.driver,r.truck,r.route,r.client,r.scheduledTime,r.reportedAt,r.type,r.reason,r.status]),
      );
    } else {
      /* Quick export from the card (no tab context) — one combined file, Trucks then Drivers. */
      const truckRows  = buildTruckUtilRows(assignments, completed, cancelled, trucks);
      const driverRows = buildDriverUtilRows(assignments, completed, cancelled);
      downloadCSV('fleet_driver_utilization_report.csv',
        ['Section','Name / Plate','Classification','Times Assigned','Completed','Cancelled Assignments','Last Driver / Truck','Last Date'],
        [
          ...truckRows.map((r) => ['Truck', r.plate, r.classification, String(r.timesAssigned), String(r.completedTrips), String(r.cancelledAssignments), r.lastDriver, r.lastUsedDate]),
          ...driverRows.map((r) => ['Driver', r.name, '—', String(r.timesAssigned), String(r.completedDeliveries), String(r.cancelledAssignments), r.lastTruck, r.lastDeliveryDate]),
        ],
      );
    }
  };

  const entries: ReportEntry[] = [
    ...assignments.map(task => ({ task, status: task.taskStatus, day: reportDay(task.deliveryDate) })),
    ...completed.map(task => ({ task, status: 'Delivered' as TaskStatus, day: reportDay(task.deliveryDate) })),
    ...cancelled.map(task => ({ task, status: 'Cancelled' as TaskStatus, day: reportDay(task.deliveryDate) })),
  ].filter((entry): entry is ReportEntry => !!entry.day && entry.day >= range.start && entry.day <= range.end);
  const trend = buildTrend(entries, range);
  const statusCounts = STATUS_ORDER.map(status => ({
    status, count: entries.filter(entry => entry.status === status).length,
    color: STATUS_COLORS[status],
  }));
  const delayEntries = entries.filter(entry => (entry.task.delayReports?.length ?? 0) > 0);
  const reasonCounts = new Map<string, number>();
  for (const entry of delayEntries) {
    const reasons = new Set(entry.task.delayReports?.map(report => report.reason.trim() || 'Reason not provided') ?? []);
    for (const reason of reasons) reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }
  const reasons = [...reasonCounts].sort((a, b) => b[1] - a[1]);

  const reports: { key: ReportKey; title: string; desc: string; icon: typeof TrendingUp; badge: string }[] = [
    {
      key:   'weekly',
      title: 'Weekly Performance Report',
      desc:  'Driver, truck, route, schedule and actual delivery performance.',
      icon:  TrendingUp,
      badge: 'Weekly',
    },
    {
      key:   'monthly',
      title: 'Monthly Delivery Summary',
      desc:  'Monthly delivery volume, completion, delays and cancellations.',
      icon:  Package,
      badge: 'Monthly',
    },
    {
      key:   'delay',
      title: 'Delay & Issues Report',
      desc:  'Delayed deliveries, causes, affected routes and resolution history.',
      icon:  AlertTriangle,
      badge: 'On demand',
    },
    {
      key:   'utilization',
      title: 'Fleet & Driver Utilization Report',
      desc:  'Truck and driver utilization across historical assignments.',
      icon:  Gauge,
      badge: 'Historical',
    },
  ];

  return (
    <div className="space-y-6 min-w-0">
      <header>
        <h2 className="text-2xl font-semibold text-foreground">Reports & Analytics</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Review delivery performance, identify operational issues, and generate reports.
        </p>
      </header>

      <section className="space-y-3">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Reports</h3>
          <p className="text-sm text-muted-foreground">Preview and export detailed operational reports.</p>
        </div>
        <div className="grid w-full grid-cols-1 gap-4 lg:grid-cols-2">
          {reports.map(({ key, title, desc, icon: Icon, badge }) => (
            <div key={key} className="flex min-h-[184px] min-w-0 flex-col gap-2.5 rounded-xl border border-border bg-white p-4">
              <div className="flex min-w-0 items-start gap-2.5">
                <Icon className="mt-1 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                <h3 className="min-w-0 flex-1 text-xl font-semibold leading-tight text-foreground lg:text-[22px]">{title}</h3>
                <span className="shrink-0 whitespace-nowrap rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{badge}</span>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">{desc}</p>
              <div className="mt-auto flex flex-wrap items-center justify-end gap-2">
                <button
                  onClick={() => setPreviewKey(key)}
                  className="flex h-10 items-center gap-1.5 rounded-lg border border-border bg-white px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <Eye className="h-3.5 w-3.5" /> Preview
                </button>
                <button
                  onClick={() => handleExport(key)}
                  title="Export CSV"
                  className="flex h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <FileDown className="h-3.5 w-3.5" /> Export
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-white p-4 sm:p-5 shadow-sm">
        <div className="flex min-w-0 flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div className="min-w-0">
            <h3 className="font-semibold text-foreground">Analytics date range</h3>
            <p className="text-xs text-muted-foreground mt-1">Filter charts by scheduled delivery date.</p>
          </div>
          <div className="w-full min-w-0 lg:w-auto">
            <div className="flex min-w-0 flex-col md:flex-row md:flex-wrap md:items-end gap-3">
              <label className="text-xs font-medium text-muted-foreground min-w-0 flex-1 md:basis-40 lg:flex-none">
                From
                <input type="date" required value={draftRange.start} max={draftRange.end}
                  aria-invalid={!!rangeError} aria-describedby={rangeError ? 'analytics-range-error' : undefined}
                  onChange={event => { clearActionFeedback(); setDraftRange(value => ({ ...value, start: event.target.value })); setRangeError(''); }}
                  className={`mt-1 block w-full min-w-0 rounded-lg border bg-white px-3 py-2 text-sm text-foreground ${rangeError ? 'border-red-500' : 'border-border'}`} />
              </label>
              <label className="text-xs font-medium text-muted-foreground min-w-0 flex-1 md:basis-40 lg:flex-none">
                To
                <input type="date" required value={draftRange.end} min={draftRange.start}
                  aria-invalid={!!rangeError} aria-describedby={rangeError ? 'analytics-range-error' : undefined}
                  onChange={event => { clearActionFeedback(); setDraftRange(value => ({ ...value, end: event.target.value })); setRangeError(''); }}
                  className={`mt-1 block w-full min-w-0 rounded-lg border bg-white px-3 py-2 text-sm text-foreground ${rangeError ? 'border-red-500' : 'border-border'}`} />
              </label>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button type="button" onClick={resetRange} aria-label="Reset"
                  className="grid w-28 min-h-11 shrink-0 items-center justify-center rounded-lg border border-border px-3 text-sm text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                  <span aria-hidden="true" className={`col-start-1 row-start-1 transition-opacity duration-150 motion-reduce:transition-none ${actionFeedback === 'reset' ? 'opacity-0' : 'opacity-100'}`}>Reset</span>
                  <span aria-hidden="true" className={`col-start-1 row-start-1 inline-flex items-center justify-center gap-1.5 transition-opacity duration-150 motion-reduce:transition-none ${actionFeedback === 'reset' ? 'opacity-100' : 'opacity-0'}`}><Check className="h-3.5 w-3.5" />Reset</span>
                </button>
                <button type="button" onClick={applyRange} aria-label={actionFeedback === 'apply' ? 'Applied' : 'Apply'}
                  className="grid w-28 min-h-11 shrink-0 items-center justify-center rounded-lg bg-primary px-3 text-sm text-white hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                  <span aria-hidden="true" className={`col-start-1 row-start-1 transition-opacity duration-150 motion-reduce:transition-none ${actionFeedback === 'apply' ? 'opacity-0' : 'opacity-100'}`}>Apply</span>
                  <span aria-hidden="true" className={`col-start-1 row-start-1 inline-flex items-center justify-center gap-1.5 transition-opacity duration-150 motion-reduce:transition-none ${actionFeedback === 'apply' ? 'opacity-100' : 'opacity-0'}`}><Check className="h-3.5 w-3.5" />Applied</span>
                </button>
              </div>
            </div>
            {rangeError && <p id="analytics-range-error" role="alert" className="mt-2 text-xs text-red-600">{rangeError}</p>}
            <span role="status" className="sr-only">{actionFeedback === 'apply' ? 'Applied' : actionFeedback === 'reset' ? 'Reset' : ''}</span>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Analytics</h3>
          <p className="text-sm text-muted-foreground">Key insights and trends based on your delivery data.</p>
        </div>

        <div className="rounded-xl border border-border bg-white p-4 sm:p-5 shadow-sm min-w-0">
          <h4 className="font-semibold text-foreground">Delivery Performance Trend</h4>
          <p className="text-sm text-muted-foreground mt-1">On-time and delayed deliveries over time.</p>
          {!trend.some(bar => bar.onTime + bar.delayed > 0) ? (
            <div className="flex min-h-56 items-center justify-center text-sm text-muted-foreground text-center">
              No completed deliveries for this period.
            </div>
          ) : (
            <>
              <div className="mt-5 h-64 w-full min-w-0" role="img" aria-label="Line chart of on-time and delayed deliveries over time">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend} margin={{ top: 12, right: 12, left: -20, bottom: 8 }}>
                    <CartesianGrid stroke="#e8eceb" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} interval="preserveStartEnd" minTickGap={24} />
                    <YAxis allowDecimals={false} domain={[0, 'auto']} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                    <Tooltip cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '3 3' }}
                      content={({ active, payload }) => {
                        const point = payload?.[0]?.payload as (typeof trend)[number] | undefined;
                        if (!active || !point) return null;
                        const total = point.onTime + point.delayed;
                        return <div className="min-w-44 rounded-lg border border-border bg-white px-3 py-2.5 text-xs shadow-sm">
                          <p className="mb-2 font-semibold text-foreground">{point.title}</p>
                          <div className="space-y-1">
                            <div className="flex items-center gap-2"><span className="h-[11px] w-[11px] rounded-[3px] bg-[#16A34A]" /><span className="text-muted-foreground">On-Time</span><strong className="ml-auto text-foreground">{point.onTime}</strong></div>
                            <div className="flex items-center gap-2"><span className="h-[11px] w-[11px] rounded-[3px] bg-[#DC2626]" /><span className="text-muted-foreground">Delayed</span><strong className="ml-auto text-foreground">{point.delayed}</strong></div>
                            <div className="flex justify-between gap-4 border-t border-border pt-1 text-foreground"><span>Total</span><strong>{total}</strong></div>
                            <div className="flex justify-between gap-4 text-foreground"><span>On-Time Rate</span><strong>{total ? `${((point.onTime / total) * 100).toFixed(1)}%` : '—'}</strong></div>
                          </div>
                        </div>;
                      }} />
                    <Line type="monotone" dataKey="onTime" name="On-Time" stroke="#16A34A" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
                      dot={trend.length === 1 ? { r: 4, strokeWidth: 2, fill: '#fff' } : false} activeDot={{ r: 5, strokeWidth: 2, fill: '#fff' }} isAnimationActive={false} />
                    <Line type="monotone" dataKey="delayed" name="Delayed" stroke="#DC2626" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
                      dot={trend.length === 1 ? { r: 4, strokeWidth: 2, fill: '#fff' } : false} activeDot={{ r: 5, strokeWidth: 2, fill: '#fff' }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex flex-wrap justify-center gap-4 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><i className="h-[11px] w-[11px] rounded-[3px] bg-[#16A34A]" />On-Time</span>
                <span className="inline-flex items-center gap-1.5"><i className="h-[11px] w-[11px] rounded-[3px] bg-[#DC2626]" />Delayed</span>
              </div>
              <p className="mt-2 text-center text-[11px] text-muted-foreground">
                A delivery with a submitted delay report is counted as delayed.
              </p>
            </>
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <div className="rounded-xl border border-border bg-white p-4 sm:p-5 shadow-sm min-w-0">
            <h4 className="font-semibold text-foreground">Delay Reason Breakdown</h4>
            <p className="text-sm text-muted-foreground mt-1">Distribution of delayed deliveries by reason.</p>
            {reasons.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">No reported delays for this period.</p>
            ) : (
              <div className="mt-5 space-y-4">
                {reasons.map(([reason, count]) => (
                  <div key={reason}>
                    <div className="flex items-start justify-between gap-3 text-sm">
                      <span className="min-w-0 break-words font-medium text-foreground">{reason}</span>
                      <span className="shrink-0 text-muted-foreground">{count} · {Math.round(count / delayEntries.length * 100)}%</span>
                    </div>
                    <div className="mt-1.5 h-2 rounded-full bg-muted">
                      <div className="h-full rounded-full bg-amber-500" style={{ width: `${count / delayEntries.length * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div data-status-card className="rounded-xl border border-border bg-white p-4 sm:p-5 shadow-sm min-w-0">
            <h4 className="font-semibold text-foreground">Delivery Status Breakdown</h4>
            <p className="text-sm text-muted-foreground mt-1">Current status of assignments in the selected period.</p>
            {entries.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">No assignments for this period.</p>
            ) : (
              <DeliveryStatusDonut statusCounts={statusCounts} total={entries.length} />
            )}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Recent Reports</h3>
          <p className="text-sm text-muted-foreground">Recently generated and downloaded reports.</p>
        </div>
        <div className="rounded-xl border border-border bg-white shadow-sm">
          <div className="hidden lg:grid grid-cols-6 gap-3 border-b border-border bg-muted/40 px-4 py-3 text-xs font-semibold text-muted-foreground">
            <span>Report Name</span><span>Type</span><span>Date Range</span>
            <span>Generated At</span><span>Generated By</span><span>Actions</span>
          </div>
          {issuedReportsError ? (
            <p role="alert" className="px-4 py-12 text-center text-sm text-red-600">{issuedReportsError}</p>
          ) : issuedReports === null ? (
            <p className="px-4 py-12 text-center text-sm text-muted-foreground">Loading…</p>
          ) : issuedReports.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-muted-foreground">No reports have been generated yet.</p>
          ) : (
            <div className="divide-y divide-border">
              {issuedReports.map((r) => (
                <div key={r.id} className="grid grid-cols-1 gap-1 px-4 py-3 text-sm lg:grid-cols-6 lg:items-center lg:gap-3">
                  <span className="break-all font-mono text-xs font-medium text-foreground">{r.id}</span>
                  <span className="text-muted-foreground">{REPORT_TYPE_LABEL[r.reportType] ?? r.reportType}</span>
                  <span className="text-muted-foreground">{fmtPeriod(r.periodStart, r.periodEnd)}</span>
                  <span className="text-muted-foreground">{fmtGeneratedAt(r.generatedAt)}</span>
                  <span className="text-muted-foreground">{r.generatedByName}</span>
                  <span>
                    <a href={`/verify-report?id=${encodeURIComponent(r.id)}`} target="_blank" rel="noreferrer"
                      className="text-sm font-medium text-primary hover:underline">Verify</a>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Preview Modal */}
      {previewKey && (
        <PreviewModal
          reportKey={previewKey}
          assignments={assignments}
          completed={completed}
          cancelled={cancelled}
          trucks={trucks}
          onClose={() => setPreviewKey(null)}
        />
      )}
    </div>
  );
}
