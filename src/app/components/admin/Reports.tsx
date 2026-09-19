import { useState } from 'react';
import {
  FileDown, TrendingUp, Package, AlertTriangle,
  X, Eye, Printer, Clock, Truck,
  User, MapPin, Building2, Timer, AlarmClock,
} from 'lucide-react';
import type { Assignment, CompletedTask, DelayReport } from '../../data/assignmentTypes';
import { parseStoredTimestamp } from '../../data/assignmentTypes';

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
      route: `${c.pickupLocation ?? '—'} → ${c.destination}`,
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
      route: `${a.pickupLocation ?? '—'} → ${a.destination}`,
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
        route: `${(a as Assignment).pickupLocation ?? '—'} → ${a.destination}`,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-xl sm:rounded-2xl shadow-2xl w-full max-w-5xl max-h-[94vh] sm:max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">

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
        <div className="flex-1 overflow-auto">
          {/* ── Weekly Table ── */}
          {reportKey === 'weekly' && (
            weeklyRows.length === 0
              ? <EmptyTable message="No deliveries yet. Assignments will appear here once created." />
              : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/40 border-b border-border z-10">
                    <tr>
                      {['Date','Driver','Truck #','Route','Client','Pickup Time','ETA','ATA','Status'].map((h) => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {weeklyRows.map((r, i) => (
                      <tr key={i} className="border-b border-border/40 hover:bg-muted/10 transition-colors">
                        <td className="px-4 py-3 whitespace-nowrap text-muted-foreground text-xs">{r.date}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <User className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                            <span className="whitespace-nowrap">{r.driver}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <Truck className="w-3.5 h-3.5 text-[#0d9488] flex-shrink-0" />
                            <span className="font-semibold text-[#0d9488] whitespace-nowrap">{r.truck}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <MapPin className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                            <span className="whitespace-nowrap">{r.route}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <Building2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                            <span className="whitespace-nowrap">{r.client}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1"><Clock className="w-3 h-3 text-muted-foreground" />{r.pickupTime}</div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1"><Timer className="w-3 h-3 text-muted-foreground" />{r.eta}</div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1"><AlarmClock className="w-3 h-3 text-muted-foreground" />{r.ata}</div>
                        </td>
                        <td className="px-4 py-3">
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
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/40 border-b border-border z-10">
                    <tr>
                      {['Month','Total Deliveries','On-Time','Delayed','Cancelled','Completion Rate'].map((h) => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyRows.map((r, i) => (
                      <tr key={i} className="border-b border-border/40 hover:bg-muted/10 transition-colors">
                        <td className="px-4 py-4 font-semibold text-foreground">{r.week}</td>
                        <td className="px-4 py-4">
                          <span className="text-blue-700 font-bold">{r.total}</span>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-green-600">{r.onTime}</span>
                            <div className="flex-1 bg-gray-100 rounded-full h-1.5 w-16">
                              <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${(r.onTime / Math.max(r.total,1)) * 100}%` }} />
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`font-semibold ${r.delayed > 0 ? 'text-red-600' : 'text-green-600'}`}>{r.delayed}</span>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`font-semibold ${r.cancelled > 0 ? 'text-gray-600' : 'text-green-600'}`}>{r.cancelled}</span>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${
                            parseFloat(r.rate) >= 90 ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                          }`}>{r.rate}</span>
                        </td>
                      </tr>
                    ))}
                    {monthlyRows.length > 1 && (
                      <tr className="bg-muted/30 font-semibold border-t-2 border-border">
                        <td className="px-4 py-3 text-foreground">Total</td>
                        <td className="px-4 py-3 text-blue-700 font-bold">{monthlySummary.total}</td>
                        <td className="px-4 py-3 text-green-600 font-bold">{monthlySummary.onTime}</td>
                        <td className="px-4 py-3 text-red-600 font-bold">{monthlySummary.delayed}</td>
                        <td className="px-4 py-3 text-gray-600 font-bold">{monthlySummary.cancelled}</td>
                        <td className="px-4 py-3">
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
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/40 border-b border-border z-10">
                    <tr>
                      {['Date','Driver','Truck #','Route','Client','Scheduled','Reported At','Issue Type','Reason for Delay','Status'].map((h) => (
                        <th key={h} className="text-left px-3 py-3 text-xs font-semibold text-muted-foreground tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {delayRows.map((r, i) => (
                      <tr key={i} className="border-b border-border/40 hover:bg-muted/10 transition-colors">
                        <td className="px-3 py-3 whitespace-nowrap text-xs text-muted-foreground">{r.date}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1.5">
                            <User className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                            <span className="whitespace-nowrap text-xs">{r.driver}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <span className="font-semibold text-[#0d9488] text-xs whitespace-nowrap">{r.truck}</span>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-xs">{r.route}</td>
                        <td className="px-3 py-3 whitespace-nowrap text-xs">{r.client}</td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1 text-xs"><Clock className="w-3 h-3 text-muted-foreground" />{r.scheduledTime}</div>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1 text-xs text-red-500"><Clock className="w-3 h-3" />{r.reportedAt}</div>
                        </td>
                        <td className="px-3 py-3">
                          <DelayTypeBadge type={r.type} />
                        </td>
                        <td className="px-3 py-3 text-xs text-foreground max-w-[220px]">
                          {r.reason}
                        </td>
                        <td className="px-3 py-3">
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

        {/* Footer */}
        <div className="px-4 sm:px-6 py-4 border-t border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 flex-shrink-0 bg-muted/10">
          <p className="text-xs text-muted-foreground">
            {reportKey === 'weekly'  && `${weeklyRows.length} record${weeklyRows.length !== 1 ? 's' : ''} shown`}
            {reportKey === 'monthly' && `${monthlyRows.length} month${monthlyRows.length !== 1 ? 's' : ''} shown`}
            {reportKey === 'delay'   && `${delayRows.length} incident${delayRows.length !== 1 ? 's' : ''} shown`}
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

/* ─── Delay Reason Breakdown (live) ───────────────── */
function DelayBreakdown({ delayRows }: { delayRows: DelayRow[] }) {
  const typeOrder = ['Pickup Delay','Delivery Delay','Client Issue','Weather','Document Issue','Vehicle Issue'];
  const colors: Record<string, string> = {
    'Pickup Delay':   'bg-amber-400',
    'Delivery Delay': 'bg-red-400',
    'Client Issue':   'bg-purple-400',
    'Weather':        'bg-blue-400',
    'Document Issue': 'bg-gray-400',
    'Vehicle Issue':  'bg-orange-400',
  };
  const counts = typeOrder
    .map((type) => ({ type, count: delayRows.filter((d) => d.type === type).length }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
  const max = counts.length > 0 ? Math.max(...counts.map((c) => c.count)) : 1;

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm p-5">
      <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-red-500" /> Delay Reason Breakdown
      </h3>
      {counts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6">
          {/* Faded placeholder bar chart */}
          <div className="flex items-end gap-2.5 h-16 mb-5 opacity-[0.15] select-none" aria-hidden="true">
            {[65, 40, 85, 25, 55, 15, 70].map((h, i) => (
              <div key={i} className="w-7 bg-gray-500 rounded-t" style={{ height: `${h}%` }} />
            ))}
          </div>
          <p className="text-sm font-medium text-muted-foreground">No delay incidents yet</p>
          <p className="text-xs text-muted-foreground/70 mt-1 text-center max-w-xs">
            Reasons will break down here once delays start coming in.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {counts.map(({ type, count }) => (
            <div key={type} className="flex items-center gap-3">
              <div className="w-32 flex-shrink-0">
                <DelayTypeBadge type={type} />
              </div>
              <div className="flex-1 bg-gray-100 rounded-full h-2.5">
                <div className={`${colors[type] ?? 'bg-gray-400'} h-2.5 rounded-full transition-all`}
                  style={{ width: `${(count / max) * 100}%` }} />
              </div>
              <span className="text-sm font-semibold text-foreground w-6 text-right">{count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Props ───────────────────────────────────────── */
interface ReportsProps {
  assignments: Assignment[];
  completed:   CompletedTask[];
}

/* ─── Main Component ──────────────────────────────── */
export default function Reports({ assignments, completed }: ReportsProps) {
  const [previewKey, setPreviewKey] = useState<ReportKey | null>(null);

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

  const delayRows      = buildDelayRows(assignments, completed);
  const totalCompleted = completed.length;
  const delayCount     = delayRows.length;
  const activeCount    = assignments.length;
  const onTimeCount    = totalCompleted - completed.filter((c) => (c.delayReports?.length ?? 0) > 0).length;
  const totalForRate   = totalCompleted + activeCount;

  const reports: { key: ReportKey; title: string; desc: string; icon: typeof TrendingUp; color: string; badge: string }[] = [
    {
      key:   'weekly',
      title: 'Weekly Performance Report',
      desc:  'All deliveries for the current week — driver, truck, route, client, scheduled & actual times, and status.',
      icon:  TrendingUp,
      color: 'from-blue-500 to-blue-600',
      badge: 'Weekly',
    },
    {
      key:   'monthly',
      title: 'Monthly Delivery Summary',
      desc:  'Month-by-month breakdown of total deliveries, on-time rate, delays, and cancellations.',
      icon:  Package,
      color: 'from-green-500 to-green-600',
      badge: 'Monthly',
    },
    {
      key:   'delay',
      title: 'Delay & Issues Report',
      desc:  'Detailed log of every delayed incident — cause, driver, route, issue type, and resolution status.',
      icon:  AlertTriangle,
      color: 'from-red-500 to-red-600',
      badge: 'Live',
    },
  ];

  return (
    <div className="space-y-6">

      {/* Header */}
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-foreground">Reports & Analytics</h2>
          <span className="text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
            All figures reflect live data
          </span>
        </div>
        <p className="text-sm text-muted-foreground mt-1">Preview and export detailed operational reports</p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Total Deliveries */}
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 rounded-xl">
          <p className="text-xs text-muted-foreground mb-1">Total deliveries</p>
          <p className="text-2xl font-bold text-blue-600">{totalCompleted + activeCount}</p>
          <p className="text-xs text-muted-foreground mt-1">All time</p>
        </div>

        {/* On-Time Rate — neutral when no completed deliveries */}
        <div className={`p-4 rounded-xl ${totalCompleted === 0 ? 'bg-gradient-to-br from-gray-50 to-gray-100' : 'bg-gradient-to-br from-green-50 to-green-100'}`}>
          <p className="text-xs text-muted-foreground mb-1">On-time rate</p>
          {totalCompleted === 0 ? (
            <p className="text-2xl font-bold text-gray-400">—</p>
          ) : (
            <p className="text-2xl font-bold text-green-600">{((onTimeCount / totalCompleted) * 100).toFixed(1)}%</p>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            {totalCompleted === 0 ? 'No completed deliveries yet' : 'Of completed deliveries'}
          </p>
        </div>

        {/* Delay Incidents — green when zero, red when positive */}
        <div className={`p-4 rounded-xl ${delayCount === 0 ? 'bg-gradient-to-br from-green-50 to-emerald-50' : 'bg-gradient-to-br from-red-50 to-red-100'}`}>
          <p className="text-xs text-muted-foreground mb-1">Delay incidents</p>
          <p className={`text-2xl font-bold ${delayCount === 0 ? 'text-green-600' : 'text-red-600'}`}>{delayCount}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {delayCount === 0 ? 'Total reported, none so far' : 'Total reported'}
          </p>
        </div>

        {/* Active Deliveries */}
        <div className="bg-gradient-to-br from-amber-50 to-amber-100 p-4 rounded-xl">
          <p className="text-xs text-muted-foreground mb-1">Active deliveries</p>
          <p className="text-2xl font-bold text-amber-600">{activeCount}</p>
          <p className="text-xs text-muted-foreground mt-1">Currently assigned</p>
        </div>
      </div>

      {/* Report Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {reports.map(({ key, title, desc, icon: Icon, color, badge }) => (
          <div key={key} className="bg-white rounded-xl border border-border shadow-sm p-5 hover:shadow-md transition-shadow flex flex-col gap-4">
            <div className="flex items-start gap-4">
              <div className={`bg-gradient-to-br ${color} p-3 rounded-xl flex-shrink-0`}>
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
            <div className="flex items-center justify-end mt-auto pt-2 border-t border-border gap-2">
              <button
                onClick={() => setPreviewKey(key)}
                className="flex items-center gap-1.5 px-3 py-2 border border-border bg-white text-foreground rounded-lg text-sm hover:bg-accent transition-colors"
              >
                <Eye className="w-3.5 h-3.5" /> Preview
              </button>
              <button
                onClick={() => handleExport(key)}
                title="Export CSV"
                className="p-2 border border-border bg-white text-foreground rounded-lg hover:bg-accent transition-colors"
              >
                <FileDown className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Delay Breakdown */}
      <DelayBreakdown delayRows={delayRows} />

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
