import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  FileDown, TrendingUp, Package, AlertTriangle,
  X, Eye, Printer, Clock, Truck, Check,
  User, MapPin, Building2, Timer, AlarmClock,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Assignment, CompletedTask, TaskStatus } from '../../data/assignmentTypes';
import { parseStoredTimestamp } from '../../data/assignmentTypes';
import { getAssignmentRoute } from '../../data/assignmentRoute';
import { PaginationFooter, usePagination } from './Pagination';

const REPORT_PAGE_SIZE = 8;

/* ─── Types ───────────────────────────────────────── */
interface WeeklyRow {
  date: string; driver: string; truck: string; route: string;
  client: string; pickupTime: string; eta: string; ata: string;
  status: 'On Time' | 'Delayed' | 'Completed' | 'Assigned' | 'Picked Up' | 'In Transit';
}
interface MonthlyRow {
  week: string; period: string; total: number;
  onTime: number; delayed: number; cancelled: number; rate: string;
}
interface DelayRow {
  date: string; driver: string; truck: string; route: string;
  client: string; scheduledTime: string; reportedAt: string;
  reason: string; type: string; status: 'Resolved' | 'Ongoing';
}
type ReportKey = 'weekly' | 'monthly' | 'delay';

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

/* Build weekly rows from live data */
function buildWeeklyRows(assignments: Assignment[], completed: CompletedTask[]): WeeklyRow[] {
  const rows: WeeklyRow[] = [];

  for (const c of completed) {
    const isDelayed = (c.delayReports?.length ?? 0) > 0;
    rows.push({
      date: c.completedAt ? fmtDate(c.completedAt) : c.deliveryDate,
      driver: c.driverName, truck: c.truckPlate,
      route: getAssignmentRoute(c),
      client: c.company,
      pickupTime: c.pickupTime || '—', eta: c.eta || '—', ata: c.ata || '—',
      status: isDelayed ? 'Delayed' : 'Completed',
    });
  }

  for (const a of assignments) {
    const isDelayed = (a.delayReports?.length ?? 0) > 0;
    const statusMap: Record<string, WeeklyRow['status']> = {
      'Assigned':   'Assigned',
      'Picked Up':  'Picked Up',
      'In Transit': 'In Transit',
    };
    rows.push({
      date: a.deliveryDate,
      driver: a.driverName, truck: a.truckPlate,
      route: getAssignmentRoute(a),
      client: a.company,
      pickupTime: a.pickupTime || '—', eta: a.eta || '—', ata: a.ata || '—',
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
        driver: a.driverName, truck: a.truckPlate,
        route: getAssignmentRoute(a),
        client: a.company,
        scheduledTime: dr.type === 'pickup' ? (a.pickupTime || '—') : (a.ata || '—'),
        reportedAt: dr.reportedAt ? fmtTime(dr.reportedAt) : '—',
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

/* ─── Preview Modal ───────────────────────────────── */
function PreviewModal({
  reportKey, assignments, completed, onClose,
}: {
  reportKey: ReportKey;
  assignments: Assignment[];
  completed: CompletedTask[];
  onClose: () => void;
}) {
  const weeklyRows  = buildWeeklyRows(assignments, completed);
  const delayRows   = buildDelayRows(assignments, completed);
  const monthlyRows = buildMonthlyRows(completed);
  const weeklyPage = usePagination(weeklyRows, REPORT_PAGE_SIZE);
  const monthlyPage = usePagination(monthlyRows, REPORT_PAGE_SIZE);
  const delayPage = usePagination(delayRows, REPORT_PAGE_SIZE);
  const selectedPage = reportKey === 'weekly' ? weeklyPage : reportKey === 'monthly' ? monthlyPage : delayPage;
  const selectedCount = reportKey === 'weekly' ? weeklyRows.length : reportKey === 'monthly' ? monthlyRows.length : delayRows.length;
  const [printing, setPrinting] = useState(false);
  const selectedDataKey = JSON.stringify(reportKey === 'weekly' ? weeklyRows : reportKey === 'monthly' ? monthlyRows : delayRows);
  useEffect(() => { selectedPage.setPage(1); }, [reportKey, selectedDataKey]);
  useEffect(() => {
    const showAllForPrint = () => flushSync(() => setPrinting(true));
    const restorePage = () => setPrinting(false);
    window.addEventListener('beforeprint', showAllForPrint);
    window.addEventListener('afterprint', restorePage);
    return () => {
      window.removeEventListener('beforeprint', showAllForPrint);
      window.removeEventListener('afterprint', restorePage);
    };
  }, []);
  const visibleWeeklyRows = printing ? weeklyRows : weeklyPage.pageItems;
  const visibleMonthlyRows = printing ? monthlyRows : monthlyPage.pageItems;
  const visibleDelayRows = printing ? delayRows : delayPage.pageItems;
  const tableLayout = 'block w-full min-w-0 xl:table xl:table-fixed print:table print:table-fixed';
  const tableHead = 'hidden xl:table-header-group print:table-header-group';
  const tableBody = 'block xl:table-row-group print:table-row-group';
  const tableRow = 'block mx-3 my-3 rounded-lg border border-border xl:table-row xl:m-0 xl:rounded-none xl:border-x-0 xl:border-t-0 print:table-row print:m-0 print:border-0';
  const tableCell = 'flex min-w-0 items-start gap-2 px-3 py-2 text-xs break-words before:w-24 before:shrink-0 before:text-[11px] before:font-medium before:text-muted-foreground before:content-[attr(data-label)] xl:table-cell xl:px-2 xl:py-3 xl:before:hidden print:table-cell print:before:hidden';

  const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const config = {
    weekly:  { title: 'Weekly Performance Report',  subtitle: `Generated ${today}` },
    monthly: { title: 'Monthly Delivery Summary',   subtitle: `Generated ${today}` },
    delay:   { title: 'Delay & Issues Report',      subtitle: `Generated ${today}` },
  }[reportKey];

  /* Summary stats */
  const weeklySummary = {
    total:   weeklyRows.length,
    onTime:  weeklyRows.filter((r) => r.status === 'On Time' || r.status === 'Completed').length,
    delayed: weeklyRows.filter((r) => r.status === 'Delayed').length,
    active:  weeklyRows.filter((r) => r.status === 'Assigned' || r.status === 'In Transit' || r.status === 'Picked Up').length,
  };
  const monthlySummary = {
    total:     monthlyRows.reduce((s, r) => s + r.total, 0),
    onTime:    monthlyRows.reduce((s, r) => s + r.onTime, 0),
    delayed:   monthlyRows.reduce((s, r) => s + r.delayed, 0),
    cancelled: monthlyRows.reduce((s, r) => s + r.cancelled, 0),
  };
  const delaySummary = {
    total:    delayRows.length,
    resolved: delayRows.filter((r) => r.status === 'Resolved').length,
    ongoing:  delayRows.filter((r) => r.status === 'Ongoing').length,
    types:    [...new Set(delayRows.map((r) => r.type))].length,
  };

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
    } else {
      downloadCSV('delay_report.csv',
        ['Date','Driver','Truck #','Route','Client','Scheduled','Reported At','Issue Type','Reason','Status'],
        delayRows.map((r) => [r.date,r.driver,r.truck,r.route,r.client,r.scheduledTime,r.reportedAt,r.type,r.reason,r.status]),
      );
    }
  };

  const handlePrint = () => window.print();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative min-w-0 max-w-full bg-white rounded-xl sm:rounded-2xl shadow-2xl w-full xl:max-w-6xl max-h-[94vh] sm:max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200 ${selectedCount > REPORT_PAGE_SIZE ? 'h-[94vh] sm:h-[90vh]' : ''}`}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-border flex-shrink-0">
          <div>
            <h3 className="font-semibold text-foreground">{config.title}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{config.subtitle}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Summary Stats */}
        <div className="px-4 sm:px-6 py-4 border-b border-border flex-shrink-0">
          {reportKey === 'weekly' && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label:'Total Deliveries', value: weeklySummary.total,   color:'text-blue-600',  bg:'bg-blue-50'   },
                { label:'On Time / Done',   value: weeklySummary.onTime,  color:'text-green-600', bg:'bg-green-50'  },
                { label:'Delayed',          value: weeklySummary.delayed, color:'text-red-600',   bg:'bg-red-50'    },
                { label:'Active / Assigned',value: weeklySummary.active,  color:'text-amber-600', bg:'bg-amber-50'  },
              ].map((s) => (
                <div key={s.label} className={`${s.bg} rounded-xl p-3 text-center`}>
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          )}
          {reportKey === 'monthly' && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label:'Total Deliveries', value: monthlySummary.total,     color:'text-blue-600',  bg:'bg-blue-50'  },
                { label:'On-Time',          value: monthlySummary.onTime,    color:'text-green-600', bg:'bg-green-50' },
                { label:'Delayed',          value: monthlySummary.delayed,   color:'text-red-600',   bg:'bg-red-50'   },
                { label:'Cancelled',        value: monthlySummary.cancelled, color:'text-gray-600',  bg:'bg-gray-50'  },
              ].map((s) => (
                <div key={s.label} className={`${s.bg} rounded-xl p-3 text-center`}>
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          )}
          {reportKey === 'delay' && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label:'Total Incidents', value: delaySummary.total,    color:'text-red-600',   bg:'bg-red-50'    },
                { label:'Resolved',        value: delaySummary.resolved, color:'text-green-600', bg:'bg-green-50'  },
                { label:'Ongoing',         value: delaySummary.ongoing,  color:'text-amber-600', bg:'bg-amber-50'  },
                { label:'Issue Types',     value: delaySummary.types,    color:'text-purple-600',bg:'bg-purple-50' },
              ].map((s) => (
                <div key={s.label} className={`${s.bg} rounded-xl p-3 text-center`}>
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
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
                      <tr key={i} className={`${tableRow} border-b border-border/40 hover:bg-muted/10 transition-colors`}>
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
                          <div className="flex min-w-0 items-start gap-1"><Clock className="w-3 h-3 shrink-0 text-muted-foreground" /><span className="min-w-0 break-words">{r.pickupTime}</span></div>
                        </td>
                        <td data-label="ETA" className={tableCell}>
                          <div className="flex min-w-0 items-start gap-1"><Timer className="w-3 h-3 shrink-0 text-muted-foreground" /><span className="min-w-0 break-words">{r.eta}</span></div>
                        </td>
                        <td data-label="ATA" className={tableCell}>
                          <div className="flex min-w-0 items-start gap-1"><AlarmClock className="w-3 h-3 shrink-0 text-muted-foreground" /><span className="min-w-0 break-words">{r.ata}</span></div>
                        </td>
                        <td data-label="Status" className={tableCell}>
                          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${
                            r.status === 'On Time' || r.status === 'Completed'
                              ? 'bg-green-100 text-green-700 border-green-200'
                            : r.status === 'Delayed'
                              ? 'bg-red-100 text-red-700 border-red-200'
                            : r.status === 'In Transit'
                              ? 'bg-blue-100 text-blue-700 border-blue-200'
                            : r.status === 'Picked Up'
                              ? 'bg-amber-100 text-amber-700 border-amber-200'
                            : 'bg-gray-100 text-gray-600 border-gray-200'
                          }`}>{r.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
          )}

          {/* ── Monthly Table ── */}
          {reportKey === 'monthly' && (
            monthlyRows.length === 0
              ? <EmptyTable message="No completed deliveries yet. Monthly summary will appear here once deliveries are completed." />
              : (
                <table className={`${tableLayout} text-sm`}>
                  <colgroup className="hidden xl:table-column-group print:table-column-group">
                    {[22, 16, 16, 14, 14, 18].map((width, i) => <col key={i} style={{ width: `${width}%` }} />)}
                  </colgroup>
                  <thead className={`${tableHead} sticky top-0 bg-muted/40 border-b border-border z-10`}>
                    <tr>
                      {['Month','Total Deliveries','On-Time','Delayed','Cancelled','Completion Rate'].map((h) => (
                        <th key={h} className="text-left px-2 py-3 text-xs font-semibold text-muted-foreground tracking-wide break-words">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className={tableBody}>
                    {visibleMonthlyRows.map((r, i) => (
                      <tr key={i} className={`${tableRow} border-b border-border/40 hover:bg-muted/10 transition-colors`}>
                        <td data-label="Month" className={`${tableCell} font-semibold text-foreground`}>{r.week}</td>
                        <td data-label="Total Deliveries" className={tableCell}>
                          <span className="text-blue-700 font-bold">{r.total}</span>
                        </td>
                        <td data-label="On-Time" className={tableCell}>
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="font-semibold text-green-600">{r.onTime}</span>
                            <div className="min-w-0 flex-1 bg-gray-100 rounded-full h-1.5 w-16">
                              <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${(r.onTime / Math.max(r.total,1)) * 100}%` }} />
                            </div>
                          </div>
                        </td>
                        <td data-label="Delayed" className={tableCell}>
                          <span className={`font-semibold ${r.delayed > 0 ? 'text-red-600' : 'text-green-600'}`}>{r.delayed}</span>
                        </td>
                        <td data-label="Cancelled" className={tableCell}>
                          <span className={`font-semibold ${r.cancelled > 0 ? 'text-gray-600' : 'text-green-600'}`}>{r.cancelled}</span>
                        </td>
                        <td data-label="Completion Rate" className={tableCell}>
                          <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${
                            parseFloat(r.rate) >= 90 ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                          }`}>{r.rate}</span>
                        </td>
                      </tr>
                    ))}
                    {monthlyRows.length > 1 && (
                      <tr className={`${tableRow} bg-muted/30 font-semibold border-t-2 border-border`}>
                        <td data-label="Month" className={`${tableCell} text-foreground`}>Total</td>
                        <td data-label="Total Deliveries" className={`${tableCell} text-blue-700 font-bold`}>{monthlySummary.total}</td>
                        <td data-label="On-Time" className={`${tableCell} text-green-600 font-bold`}>{monthlySummary.onTime}</td>
                        <td data-label="Delayed" className={`${tableCell} text-red-600 font-bold`}>{monthlySummary.delayed}</td>
                        <td data-label="Cancelled" className={`${tableCell} text-gray-600 font-bold`}>{monthlySummary.cancelled}</td>
                        <td data-label="Completion Rate" className={tableCell}>
                          <span className="text-sm font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                            {monthlySummary.total > 0
                              ? `${((monthlySummary.onTime / monthlySummary.total) * 100).toFixed(1)}%`
                              : '—'}
                          </span>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )
          )}

          {/* ── Delay Table ── */}
          {reportKey === 'delay' && (
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
          )}
        </div>

        <PaginationFooter page={selectedPage.page} totalItems={selectedCount} pageSize={REPORT_PAGE_SIZE}
          onPageChange={selectedPage.setPage} singular="record" plural="records"
          className="border-t border-border bg-muted/10" />

        {/* Footer */}
        <div className="px-4 sm:px-6 py-4 border-t border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 flex-shrink-0 bg-muted/10">
          <p className="text-xs text-muted-foreground">
            {reportKey === 'weekly'  && `${weeklyRows.length} record${weeklyRows.length !== 1 ? 's' : ''} total`}
            {reportKey === 'monthly' && `${monthlyRows.length} month${monthlyRows.length !== 1 ? 's' : ''} total`}
            {reportKey === 'delay'   && `${delayRows.length} incident${delayRows.length !== 1 ? 's' : ''} total`}
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
      </div>
    </div>
  );
}

/* The dashboard already uses these status colours; keep analytics in the same palette. */
const STATUS_COLORS: Record<TaskStatus, string> = {
  'Assigned': '#a855f7',
  'Picked Up': '#38bdf8',
  'In Transit': '#1d4ed8',
  'Delivered': '#22c55e',
  'Failed / Issue': '#ef4444',
  'Cancelled': '#d1d5db',
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
  const bars = new Map<string, { key: string; label: string; onTime: number; delayed: number }>();
  for (const date = new Date(first); date <= last; date.setUTCDate(date.getUTCDate() + 1)) {
    const key = keyFor(date.toISOString().slice(0, 10));
    if (bars.has(key)) continue;
    const label = grouping === 'month'
      ? formatBucket(`${key}-01`, { month: 'short', year: '2-digit' })
      : formatBucket(key, { month: 'short', day: 'numeric' });
    bars.set(key, { key, label, onTime: 0, delayed: 0 });
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
}

/* ─── Main Component ──────────────────────────────── */
export default function Reports({ assignments, completed, cancelled }: ReportsProps) {
  const [previewKey, setPreviewKey] = useState<ReportKey | null>(null);
  const [draftRange, setDraftRange] = useState<DateRange>(initialRange);
  const [range, setRange] = useState<DateRange>(initialRange);
  const [rangeError, setRangeError] = useState('');
  const [actionFeedback, setActionFeedback] = useState<'apply' | 'reset' | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof window.setTimeout> | undefined>(undefined);

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
    const weeklyRows  = buildWeeklyRows(assignments, completed);
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
    } else {
      downloadCSV('delay_report.csv',
        ['Date','Driver','Truck #','Route','Client','Scheduled','Reported At','Issue Type','Reason','Status'],
        dRows.map((r) => [r.date,r.driver,r.truck,r.route,r.client,r.scheduledTime,r.reportedAt,r.type,r.reason,r.status]),
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

  const reports: { key: ReportKey; title: string; desc: string; icon: typeof TrendingUp; color: string; badge: string }[] = [
    {
      key:   'weekly',
      title: 'Weekly Performance Report',
      desc:  'Driver, truck, route, client, scheduled and actual times, and status.',
      icon:  TrendingUp,
      color: 'bg-blue-600',
      badge: 'Weekly',
    },
    {
      key:   'monthly',
      title: 'Monthly Delivery Summary',
      desc:  'Month-by-month breakdown of total deliveries, on-time rate, delays, and cancellations.',
      icon:  Package,
      color: 'bg-green-600',
      badge: 'Monthly',
    },
    {
      key:   'delay',
      title: 'Delay & Issues Report',
      desc:  'Detailed log of every delayed incident — cause, driver, route, issue type, and resolution status.',
      icon:  AlertTriangle,
      color: 'bg-red-600',
      badge: 'On demand',
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

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Reports</h3>
          <p className="text-sm text-muted-foreground">Preview and export detailed operational reports.</p>
        </div>
      {/* Report Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {reports.map(({ key, title, desc, icon: Icon, color, badge }) => (
          <div key={key} className="bg-white rounded-xl border border-border shadow-sm p-5 hover:shadow-md transition-shadow flex flex-col gap-4">
            <div className="flex items-start gap-4">
              <div className={`${color} p-3 rounded-xl flex-shrink-0`}>
                <Icon className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-foreground leading-tight">{title}</h3>
                </div>
                <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded">{badge}</span>
              </div>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
            <div className="flex flex-wrap items-center justify-end mt-auto pt-2 border-t border-border gap-2">
              <button
                onClick={() => setPreviewKey(key)}
                className="flex items-center gap-1.5 px-3 py-2 border border-border bg-white text-foreground rounded-lg text-sm hover:bg-accent transition-colors"
              >
                <Eye className="w-3.5 h-3.5" /> Preview
              </button>
              <button
                onClick={() => handleExport(key)}
                title="Export CSV"
                className="flex items-center gap-1.5 px-3 py-2 border border-border bg-white text-foreground rounded-lg text-sm hover:bg-accent transition-colors"
              >
                <FileDown className="w-3.5 h-3.5" /> Export
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
              <div className="mt-5 h-64 w-full min-w-0" role="img" aria-label="Stacked chart of on-time and delayed deliveries">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trend} margin={{ top: 8, right: 8, left: -20, bottom: 8 }}>
                    <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} interval="preserveStartEnd" minTickGap={20} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                    <Tooltip />
                    <Bar dataKey="onTime" name="On-time" stackId="deliveries" fill="#22c55e" maxBarSize={44} />
                    <Bar dataKey="delayed" name="Delayed" stackId="deliveries" fill="#ef4444" maxBarSize={44} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex flex-wrap justify-center gap-4 text-xs text-muted-foreground">
                <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-green-500" />On-time</span>
                <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-red-500" />Delayed</span>
              </div>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Uses the existing report definition: a completed delivery with a submitted delay report is delayed.
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

          <div className="rounded-xl border border-border bg-white p-4 sm:p-5 shadow-sm min-w-0">
            <h4 className="font-semibold text-foreground">Delivery Status Breakdown</h4>
            <p className="text-sm text-muted-foreground mt-1">Current status of assignments in the selected period.</p>
            {entries.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">No assignments for this period.</p>
            ) : (
              <div className="mt-4 flex flex-col sm:flex-row items-center gap-4">
                <div className="relative h-48 w-48 shrink-0" role="img" aria-label="Delivery status donut chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={statusCounts.filter(item => item.count > 0)} dataKey="count" nameKey="status"
                        cx="50%" cy="50%" innerRadius={62} outerRadius={88} stroke="#ffffff" strokeWidth={2}>
                        {statusCounts.filter(item => item.count > 0).map(item => <Cell key={item.status} fill={item.color} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-bold text-foreground">{entries.length}</span>
                    <span className="text-xs text-muted-foreground">assignments</span>
                  </div>
                </div>
                <div className="w-full min-w-0 space-y-2">
                  {statusCounts.map(item => (
                    <div key={item.status} className="flex items-center gap-2 text-xs sm:text-sm">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                      <span className="min-w-0 flex-1 text-foreground">{item.status}</span>
                      <span className="shrink-0 font-medium text-foreground">{item.count}</span>
                      <span className="w-9 shrink-0 text-right text-muted-foreground">{Math.round(item.count / entries.length * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
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
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">
            Report history is unavailable. This system downloads reports without saving a generated-report record.
          </p>
        </div>
      </section>

      {/* Preview Modal */}
      {previewKey && (
        <PreviewModal
          reportKey={previewKey}
          assignments={assignments}
          completed={completed}
          onClose={() => setPreviewKey(null)}
        />
      )}
    </div>
  );
}
