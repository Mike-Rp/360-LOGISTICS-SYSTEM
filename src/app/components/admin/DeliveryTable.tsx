import { useState } from 'react';
import { MapPin, Package, CheckCircle2, Truck, Building2, Calendar, Clock, Filter, Search, X, User } from 'lucide-react';
import type { Assignment, CompletedTask, TaskStatus } from '../../data/assignmentTypes';
import { taskStatusConfig } from '../../data/assignmentTypes';

type FilterPeriod = 'all' | 'today' | 'month' | 'year';

interface DeliveryTableProps {
  fullView?: boolean;
  completed?: CompletedTask[];
  assignments?: Assignment[];
  /* Cancelled assignments — shown under the "Cancelled" tab. */
  cancelled?: Assignment[];
}

function StatusBadge({ status }: { status: TaskStatus }) {
  const cfg = taskStatusConfig[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${cfg.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

/* When the delivery was created, in ms. createdAt comes from assignments.created_at; a row
   dispatched moments ago that hasn't been reloaded yet has none, so it counts as "just now". */
const createdMs = (a: Assignment) => {
  const t = a.createdAt ? Date.parse(a.createdAt) : NaN;
  return isNaN(t) ? Date.now() : t;
};

/* Filters by CREATED time, compared in the browser's local time (Philippine time for the
   team) — not UTC, which would shift anything created before 8 AM to the previous day. */
function matchesPeriod(a: Assignment, period: FilterPeriod): boolean {
  if (period === 'all') return true;
  const d   = new Date(createdMs(a));
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  if (period === 'year')  return sameYear;
  if (period === 'month') return sameYear && d.getMonth() === now.getMonth();
  if (period === 'today') return sameYear && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return true;
}

/* Newest first, by created time */
const newestFirst = <T extends Assignment>(rows: T[]): T[] =>
  [...rows].sort((x, y) => createdMs(y) - createdMs(x));

const PERIOD_LABELS: Record<FilterPeriod, string> = {
  all:   'All Time',
  today: 'Today',
  month: 'This Month',
  year:  'This Year',
};

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

/* ── Dashboard mini panel: "Recent Activities" ───── */
function RecentActivities({ assignments, completed }: { assignments: Assignment[]; completed: CompletedTask[] }) {
  const all: Array<{ key: string; truckPlate: string; driverName: string; destination: string; company: string; status: TaskStatus; date: string; isCompleted: boolean }> = [
    ...assignments.map((a) => ({
      key: a.id, truckPlate: a.truckPlate, driverName: a.driverName,
      destination: a.destination, company: a.company, status: a.taskStatus,
      date: a.assignedAt, isCompleted: false,
    })),
    ...completed.map((c) => ({
      key: c.id + '-done', truckPlate: c.truckPlate, driverName: c.driverName,
      destination: c.destination, company: c.company, status: 'Delivered' as TaskStatus,
      date: c.completedAt, isCompleted: true,
    })),
  ].slice(0, 6);

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="text-lg font-semibold text-foreground">Recent Activities</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Latest delivery updates from your fleet</p>
      </div>

      {all.length === 0 ? (
        <div className="py-12 text-center">
          <Package className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">No recent activity. Assign tasks to see updates here.</p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {all.map((item) => (
            <div key={item.key} className="flex items-center gap-4 px-5 py-3.5 hover:bg-muted/10 transition-colors">
              <div className="w-9 h-9 bg-[#0d9488]/15 rounded-full flex items-center justify-center flex-shrink-0">
                <Truck className="w-4 h-4 text-[#0d9488]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-foreground">{item.truckPlate}</span>
                  <span className="text-xs text-muted-foreground">·</span>
                  <span className="text-sm text-foreground truncate">{item.driverName}</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                  <MapPin className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">{item.destination}</span>
                  <span>·</span>
                  <Building2 className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">{item.company}</span>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <StatusBadge status={item.status} />
                <span className="text-xs text-muted-foreground hidden sm:block">{item.date}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Full Deliveries Table ──────────────────────── */
export default function DeliveryTable({
  fullView = false,
  completed = [],
  assignments = [],
  cancelled = [],
}: DeliveryTableProps) {

  if (!fullView) {
    return <RecentActivities assignments={assignments} completed={completed} />;
  }

  const [tab, setTab]       = useState<'active' | 'completed' | 'cancelled'>('active');
  const [period, setPeriod] = useState<FilterPeriod>('all');
  const [search, setSearch] = useState('');

  const q = search.trim().toLowerCase();

  const matchesSearch = (fields: string[]) =>
    !q || fields.some((f) => f.toLowerCase().includes(q));

  /* Time filter (created time) + search, then newest first — the same for all three tabs */
  const filteredActive = newestFirst(assignments
    .filter((a) => matchesPeriod(a, period))
    .filter((a) => matchesSearch([a.truckPlate, a.id, a.driverName, a.destination, a.company, a.taskStatus])));

  const filteredDone = newestFirst(completed
    .filter((c) => matchesPeriod(c, period))
    .filter((c) => matchesSearch([c.truckPlate, c.id, c.driverName, c.destination, c.company])));

  const filteredCancelled = newestFirst(cancelled
    .filter((a) => matchesPeriod(a, period))
    .filter((a) => matchesSearch([a.truckPlate, a.id, a.driverName, a.destination, a.company, a.taskStatus])));

  /* A time range or search is narrowing the list */
  const filtering = !!q || period !== 'all';

  /* Cancelled rows are plain Assignment objects, exactly like active ones, so both tabs
     render through the same table/card markup below instead of a duplicated copy. */
  const listRows = tab === 'cancelled' ? filteredCancelled : filteredActive;

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-border">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Deliveries</h2>
            <p className="text-sm text-muted-foreground mt-0.5">All assignments fetched from Drivers Management</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Search */}
            <div className="flex items-center gap-1.5 border border-border rounded-lg px-2.5 py-1.5 bg-white w-full sm:w-auto sm:min-w-[200px]">
              <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
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

            {/* Tab */}
            <div className="flex bg-muted/30 rounded-lg p-1 border border-border">
              <button onClick={() => setTab('active')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-1.5 ${tab === 'active' ? 'bg-white shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                Active
                {filteredActive.length > 0 && (
                  <span className={`text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center ${tab === 'active' ? 'bg-primary text-white' : 'bg-muted text-muted-foreground'}`}>{filteredActive.length}</span>
                )}
              </button>
              <button onClick={() => setTab('completed')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-1.5 ${tab === 'completed' ? 'bg-white shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                Completed
                {filteredDone.length > 0 && (
                  <span className={`text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center ${tab === 'completed' ? 'bg-green-500 text-white' : 'bg-muted text-muted-foreground'}`}>{filteredDone.length}</span>
                )}
              </button>
              <button onClick={() => setTab('cancelled')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-1.5 ${tab === 'cancelled' ? 'bg-white shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                Cancelled
                {filteredCancelled.length > 0 && (
                  <span className={`text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center ${tab === 'cancelled' ? 'bg-gray-500 text-white' : 'bg-muted text-muted-foreground'}`}>{filteredCancelled.length}</span>
                )}
              </button>
            </div>

            {/* Filter */}
            <div className="flex items-center gap-1.5 border border-border rounded-lg px-2 py-1.5 bg-white">
              <Filter className="w-3.5 h-3.5 text-muted-foreground" />
              <select value={period} onChange={(e) => setPeriod(e.target.value as FilterPeriod)}
                className="text-sm text-foreground bg-transparent focus:outline-none cursor-pointer pr-1">
                {(Object.entries(PERIOD_LABELS) as [FilterPeriod, string][]).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Search result count */}
        {q && (
          <p className="text-xs text-muted-foreground mt-2">
            {tab === 'completed' ? filteredDone.length : listRows.length} result{(tab === 'completed' ? filteredDone.length : listRows.length) !== 1 ? 's' : ''} for <span className="font-semibold text-foreground">"{search}"</span>
          </p>
        )}
      </div>

      {/* ── Active / Cancelled Assignments (same row shape) ── */}
      {tab !== 'completed' && (
        <>
          {listRows.length === 0 ? (
            <div className="py-16 text-center">
              <Package className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
              <p className="font-medium text-foreground">
                {filtering
                  ? 'No deliveries found for this filter'
                  : (tab === 'cancelled' ? 'No cancelled deliveries' : 'No active assignments')}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {filtering
                  ? 'Try a different time range or search term.'
                  : tab === 'cancelled'
                    ? 'Assignments cancelled from Monitor will appear here.'
                    : 'Assign tasks from Drivers Management to see them here.'}
              </p>
            </div>
          ) : (
            <>
              {/* Desktop/tablet table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30">
                    <tr>
                      {['TRUCK #', 'DRIVER', 'ROUTE', 'CUSTOMER', 'STATUS', 'DATE'].map((col) => (
                        <th key={col} className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {listRows.map((a) => (
                      <tr key={a.id} className={"hover:bg-accent/50 transition-colors" + (q ? " bg-yellow-50/30" : "")}>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2">
                            <Truck className="w-4 h-4 text-[#0d9488] flex-shrink-0" />
                            <span className="font-semibold text-[#0d9488]"><Highlight text={a.truckPlate} query={search} /></span>
                          </div>
                          <p className="text-xs text-muted-foreground ml-6"><Highlight text={a.id} query={search} /></p>
                        </td>
                        <td className="px-5 py-4 text-foreground"><Highlight text={a.driverName} query={search} /></td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-1.5">
                            <MapPin className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                            <span className="text-foreground"><Highlight text={a.destination} query={search} /></span>
                          </div>
                          {a.remarks && <p className="text-xs text-muted-foreground italic mt-0.5 ml-5">{a.remarks}</p>}
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-1.5">
                            <Building2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                            <span className="text-foreground"><Highlight text={a.company} query={search} /></span>
                          </div>
                        </td>
                        <td className="px-5 py-4"><StatusBadge status={a.taskStatus} /></td>
                        <td className="px-5 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-1.5 text-foreground">
                            <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                            {a.deliveryDate}
                          </div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                            <Clock className="w-3 h-3" /> {a.assignedAt}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile card list */}
              <div className="sm:hidden divide-y divide-border">
                {listRows.map((a) => (
                  <div key={a.id} className={`p-4 space-y-2.5 ${q ? 'bg-yellow-50/30' : ''}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Truck className="w-4 h-4 text-[#0d9488] flex-shrink-0" />
                        <span className="font-semibold text-[#0d9488] truncate"><Highlight text={a.truckPlate} query={search} /></span>
                      </div>
                      <StatusBadge status={a.taskStatus} />
                    </div>
                    <p className="text-xs text-muted-foreground ml-6"><Highlight text={a.id} query={search} /></p>
                    <div className="flex items-center gap-1.5 text-sm text-foreground">
                      <User className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="truncate"><Highlight text={a.driverName} query={search} /></span>
                    </div>
                    <div className="flex items-start gap-1.5 text-sm">
                      <MapPin className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <span className="text-foreground"><Highlight text={a.destination} query={search} /></span>
                        {a.remarks && <p className="text-xs text-muted-foreground italic mt-0.5">{a.remarks}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 text-sm text-foreground">
                      <Building2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="truncate"><Highlight text={a.company} query={search} /></span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground pt-1.5 border-t border-border/60">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5" /> {a.deliveryDate}
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {a.assignedAt}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ── Completed ── */}
      {tab === 'completed' && (
        <>
          <div className="px-5 py-2.5 border-b border-border bg-muted/10 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span className="text-sm font-semibold text-foreground">Recent Completed Deliveries</span>
            <span className="bg-green-100 text-green-700 text-xs rounded-full px-2 py-0.5 border border-green-200 ml-1">
              {filteredDone.length} total
            </span>
          </div>
          {filteredDone.length === 0 ? (
            <div className="py-14 text-center">
              <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
              <p className="font-medium text-foreground">
                {filtering ? 'No deliveries found for this filter' : 'No completed deliveries'}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {filtering ? 'Try a different time range or search term.' : 'Completed deliveries from Drivers Management will appear here.'}
              </p>
            </div>
          ) : (
            <>
              {/* Desktop/tablet table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30">
                    <tr>
                      {['TRUCK #', 'DRIVER', 'ROUTE', 'CUSTOMER', 'DELIVERY DATE', 'COMPLETED AT'].map((col) => (
                        <th key={col} className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredDone.map((c) => (
                      <tr key={c.id} className={"hover:bg-accent/50 transition-colors" + (q ? " bg-yellow-50/30" : "")}>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2">
                            <Truck className="w-4 h-4 text-[#0d9488]" />
                            <span className="font-semibold text-[#0d9488]"><Highlight text={c.truckPlate} query={search} /></span>
                          </div>
                        </td>
                        <td className="px-5 py-4 text-foreground"><Highlight text={c.driverName} query={search} /></td>
                        <td className="px-5 py-4 text-foreground"><Highlight text={c.destination} query={search} /></td>
                        <td className="px-5 py-4 text-foreground"><Highlight text={c.company} query={search} /></td>
                        <td className="px-5 py-4 text-foreground whitespace-nowrap">{c.deliveryDate}</td>
                        <td className="px-5 py-4">
                          <span className="text-xs px-2.5 py-1 bg-green-100 text-green-700 rounded-full border border-green-200 font-medium">
                            {c.completedAt}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile card list */}
              <div className="sm:hidden divide-y divide-border">
                {filteredDone.map((c) => (
                  <div key={c.id} className={`p-4 space-y-2.5 ${q ? 'bg-yellow-50/30' : ''}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Truck className="w-4 h-4 text-[#0d9488] flex-shrink-0" />
                        <span className="font-semibold text-[#0d9488] truncate"><Highlight text={c.truckPlate} query={search} /></span>
                      </div>
                      <span className="text-xs px-2.5 py-1 bg-green-100 text-green-700 rounded-full border border-green-200 font-medium flex-shrink-0">
                        {c.completedAt}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-sm text-foreground">
                      <User className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="truncate"><Highlight text={c.driverName} query={search} /></span>
                    </div>
                    <div className="flex items-center gap-1.5 text-sm text-foreground">
                      <MapPin className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="truncate"><Highlight text={c.destination} query={search} /></span>
                    </div>
                    <div className="flex items-center gap-1.5 text-sm text-foreground">
                      <Building2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="truncate"><Highlight text={c.company} query={search} /></span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1.5 border-t border-border/60">
                      <Calendar className="w-3.5 h-3.5" /> {c.deliveryDate}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}