import { useLayoutEffect, useRef, useState } from 'react';
import { MapPin, Package, CheckCircle2, Truck, Building2, Filter, Search, X } from 'lucide-react';
import type { Assignment, CompletedTask, LocalTruck, TaskStatus } from '../../data/assignmentTypes';
import { taskStatusConfig } from '../../data/assignmentTypes';
import { PaginationFooter, usePagination, useStablePageHeight } from './Pagination';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

type FilterPeriod = 'all' | 'today' | 'month' | 'year';
const DELIVERIES_PAGE_SIZE = 8;

interface DeliveryTableProps {
  fullView?: boolean;
  completed?: CompletedTask[];
  assignments?: Assignment[];
  trucks?: LocalTruck[];
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

function RemarksPreview({ remarks, onOpen }: { remarks: string; onOpen: () => void }) {
  const textRef = useRef<HTMLParagraphElement>(null);
  const [clipped, setClipped] = useState(false);

  useLayoutEffect(() => {
    const text = textRef.current;
    if (!text) return;
    const check = () => setClipped(text.scrollHeight > text.clientHeight + 1 || text.scrollWidth > text.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(text);
    return () => observer.disconnect();
  }, [remarks]);

  return (
    <div className="flex min-w-0 max-w-full items-center gap-1">
      <p ref={textRef} className="min-w-0 flex-1 line-clamp-1 break-all text-xs italic text-muted-foreground/80"><span className="not-italic font-medium">Remarks: </span>{remarks}</p>
      {clipped && (
        <button type="button" onClick={(event) => { event.stopPropagation(); onOpen(); }} className="shrink-0 px-0.5 py-0.5 text-xs font-medium text-primary hover:underline">
          See more
        </button>
      )}
    </div>
  );
}

function TruckMetadata({ assignment, truck, query }: { assignment: Assignment; truck?: LocalTruck; query: string }) {
  const capacity = truck?.capacity?.replace(/\s*\([^)]*\)\s*$/, '').trim();
  return (
    <div className="min-w-0 leading-4">
      {(truck?.classification || capacity) && <p className="break-words text-xs text-muted-foreground">{truck?.classification}{truck?.classification && capacity && ' · '}{capacity}</p>}
      <p className="break-all text-xs text-muted-foreground/75"><Highlight text={assignment.id} query={query} /></p>
    </div>
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
  trucks = [],
  cancelled = [],
}: DeliveryTableProps) {

  if (!fullView) {
    return <RecentActivities assignments={assignments} completed={completed} />;
  }

  const [tab, setTab]       = useState<'active' | 'completed' | 'cancelled'>('active');
  const [period, setPeriod] = useState<FilterPeriod>('all');
  const [search, setSearch] = useState('');
  const [remarksAssignment, setRemarksAssignment] = useState<Assignment | null>(null);

  const truckFor = (assignment: Assignment) =>
    trucks.find((truck) => truck.id === assignment.truckId) ??
    trucks.find((truck) => truck.plateNumber === assignment.truckPlate);

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

  const activePage = usePagination(filteredActive, DELIVERIES_PAGE_SIZE);
  const completedPage = usePagination(filteredDone, DELIVERIES_PAGE_SIZE);
  const cancelledPage = usePagination(filteredCancelled, DELIVERIES_PAGE_SIZE);
  const resetPages = () => {
    activePage.setPage(1);
    completedPage.setPage(1);
    cancelledPage.setPage(1);
  };

  /* A time range or search is narrowing the list */
  const filtering = !!q || period !== 'all';

  /* Cancelled rows are plain Assignment objects, exactly like active ones, so both tabs
     render through the same table/card markup below instead of a duplicated copy. */
  const listRows = tab === 'cancelled' ? filteredCancelled : filteredActive;
  const pageRows = tab === 'cancelled' ? cancelledPage.pageItems : activePage.pageItems;
  const selectedPage = tab === 'completed' ? completedPage : tab === 'cancelled' ? cancelledPage : activePage;
  const selectedCount = tab === 'completed' ? filteredDone.length : listRows.length;
  const pageArea = useStablePageHeight(selectedPage.page, selectedCount, DELIVERIES_PAGE_SIZE, `${tab}|${period}|${search}`);

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-border">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Deliveries</h2>
            <p className="text-sm text-muted-foreground mt-0.5">View and manage current delivery assignments.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Search */}
            <div className="flex items-center gap-1.5 border border-border rounded-lg px-2.5 py-1.5 bg-white w-full sm:w-auto sm:min-w-[200px]">
              <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); resetPages(); }}
                placeholder="Search truck, driver, route…"
                className="text-sm bg-transparent focus:outline-none placeholder:text-muted-foreground/60 flex-1 min-w-0"
              />
              {search && (
                <button onClick={() => { setSearch(''); resetPages(); }} className="text-muted-foreground hover:text-foreground transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Tab */}
            <div className="flex flex-wrap max-w-full min-w-0 bg-muted/30 rounded-lg p-1 border border-border">
              <button onClick={() => { setTab('active'); resetPages(); }}
                className={`px-2 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all flex items-center gap-1 sm:gap-1.5 ${tab === 'active' ? 'bg-white shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                Active
                {filteredActive.length > 0 && (
                  <span className={`text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center ${tab === 'active' ? 'bg-primary text-white' : 'bg-muted text-muted-foreground'}`}>{filteredActive.length}</span>
                )}
              </button>
              <button onClick={() => { setTab('completed'); resetPages(); }}
                className={`px-2 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all flex items-center gap-1 sm:gap-1.5 ${tab === 'completed' ? 'bg-white shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                Completed
                {filteredDone.length > 0 && (
                  <span className={`text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center ${tab === 'completed' ? 'bg-green-500 text-white' : 'bg-muted text-muted-foreground'}`}>{filteredDone.length}</span>
                )}
              </button>
              <button onClick={() => { setTab('cancelled'); resetPages(); }}
                className={`px-2 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all flex items-center gap-1 sm:gap-1.5 ${tab === 'cancelled' ? 'bg-white shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                Cancelled
                {filteredCancelled.length > 0 && (
                  <span className={`text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center ${tab === 'cancelled' ? 'bg-gray-500 text-white' : 'bg-muted text-muted-foreground'}`}>{filteredCancelled.length}</span>
                )}
              </button>
            </div>

            {/* Filter */}
            <div className="flex items-center gap-1.5 border border-border rounded-lg px-2 py-1.5 bg-white">
              <Filter className="w-3.5 h-3.5 text-muted-foreground" />
              <select value={period} onChange={(e) => { setPeriod(e.target.value as FilterPeriod); resetPages(); }}
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
              <div ref={pageArea}>
              {/* Desktop table */}
              <div className="hidden xl:block w-full min-w-0">
                <table className="w-full table-fixed text-sm">
                  <colgroup>
                    <col className="w-[20%]" /><col className="w-[12%]" /><col className="w-[26%]" />
                    <col className="w-[15%]" /><col className="w-[14%]" /><col className="w-[13%]" />
                  </colgroup>
                  <thead className="bg-muted/30">
                    <tr>
                      {['TRUCK', 'DRIVER', 'ROUTE', 'CUSTOMER', 'STATUS', 'DATE'].map((col) => (
                        <th key={col} className="px-2 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider break-words">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {pageRows.map((a) => (
                      <tr key={a.id} className={"hover:bg-accent/50 transition-colors" + (q ? " bg-yellow-50/30" : "")}>
                        <td className="px-2 py-3 min-w-0 break-words">
                          <p className="font-semibold text-foreground"><Highlight text={a.truckPlate} query={search} /></p>
                          <TruckMetadata assignment={a} truck={truckFor(a)} query={search} />
                        </td>
                        <td className="px-2 py-3 font-semibold text-foreground break-words"><Highlight text={a.driverName} query={search} /></td>
                        <td className="px-2 py-3 min-w-0">
                          <p className="font-medium break-words text-foreground"><Highlight text={a.destination} query={search} /></p>
                          {a.pickupLocation && <p className="break-words text-xs text-muted-foreground">Pickup: {a.pickupLocation}</p>}
                          {a.remarks && <RemarksPreview remarks={a.remarks} onOpen={() => setRemarksAssignment(a)} />}
                        </td>
                        <td className="px-2 py-3 font-medium text-foreground break-words"><Highlight text={a.company} query={search} /></td>
                        <td className="px-2 py-3"><StatusBadge status={a.taskStatus} /></td>
                        <td className="px-2 py-3 min-w-0 break-words">
                          <p className="font-medium text-foreground">{a.deliveryDate}</p>
                          <p className="text-xs text-muted-foreground break-words">{a.assignedAt}</p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Tablet and mobile card list */}
              <div className="xl:hidden divide-y divide-border">
                {pageRows.map((a) => (
                  <div key={a.id} className={`p-4 min-w-0 space-y-2 ${q ? 'bg-yellow-50/30' : ''}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="min-w-0 font-semibold text-foreground break-words"><Highlight text={a.truckPlate} query={search} /></span>
                      <StatusBadge status={a.taskStatus} />
                    </div>
                    <TruckMetadata assignment={a} truck={truckFor(a)} query={search} />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 min-w-0 text-sm">
                      <p className="min-w-0 font-semibold text-foreground break-all"><Highlight text={a.driverName} query={search} /></p>
                      <div className="min-w-0 text-sm">
                        <p className="font-medium text-foreground break-all"><Highlight text={a.destination} query={search} /></p>
                        {a.pickupLocation && <p className="break-words text-xs text-muted-foreground">Pickup: {a.pickupLocation}</p>}
                        {a.remarks && <RemarksPreview remarks={a.remarks} onOpen={() => setRemarksAssignment(a)} />}
                      </div>
                      <p className="min-w-0 font-medium text-foreground break-all"><Highlight text={a.company} query={search} /></p>
                      <div className="min-w-0 text-sm">
                        <p className="font-medium text-foreground break-words">{a.deliveryDate}</p>
                        <p className="text-xs text-muted-foreground break-words">{a.assignedAt}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
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
              <div ref={pageArea}>
              {/* Desktop table */}
              <div className="hidden xl:block w-full min-w-0">
                <table className="w-full table-fixed text-sm">
                  <colgroup>
                    <col className="w-[20%]" /><col className="w-[12%]" /><col className="w-[26%]" />
                    <col className="w-[15%]" /><col className="w-[14%]" /><col className="w-[13%]" />
                  </colgroup>
                  <thead className="bg-muted/30">
                    <tr>
                      {['TRUCK', 'DRIVER', 'ROUTE', 'CUSTOMER', 'STATUS', 'DATE'].map((col) => (
                        <th key={col} className="px-2 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider break-words">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {completedPage.pageItems.map((c) => (
                      <tr key={c.id} className={"hover:bg-accent/50 transition-colors" + (q ? " bg-yellow-50/30" : "")}>
                        <td className="px-2 py-3 min-w-0 break-words">
                          <p className="font-semibold text-foreground"><Highlight text={c.truckPlate} query={search} /></p>
                          <TruckMetadata assignment={c} truck={truckFor(c)} query={search} />
                        </td>
                        <td className="px-2 py-3 font-semibold text-foreground break-all"><Highlight text={c.driverName} query={search} /></td>
                        <td className="px-2 py-3 min-w-0">
                          <p className="font-medium text-foreground break-all"><Highlight text={c.destination} query={search} /></p>
                          {c.pickupLocation && <p className="break-words text-xs text-muted-foreground">Pickup: {c.pickupLocation}</p>}
                          {c.remarks && <RemarksPreview remarks={c.remarks} onOpen={() => setRemarksAssignment(c)} />}
                        </td>
                        <td className="px-2 py-3 font-medium text-foreground break-all"><Highlight text={c.company} query={search} /></td>
                        <td className="px-2 py-3">{c.taskStatus && taskStatusConfig[c.taskStatus] && <StatusBadge status={c.taskStatus} />}</td>
                        <td className="px-2 py-3 break-words text-foreground">
                          <p className="font-medium">{c.deliveryDate}</p>
                          <p className="text-xs text-muted-foreground break-words">{c.completedAt}</p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Tablet and mobile card list */}
              <div className="xl:hidden divide-y divide-border">
                {completedPage.pageItems.map((c) => (
                  <div key={c.id} className={`p-4 min-w-0 space-y-2 ${q ? 'bg-yellow-50/30' : ''}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="min-w-0 font-semibold text-foreground break-words"><Highlight text={c.truckPlate} query={search} /></span>
                      {c.taskStatus && taskStatusConfig[c.taskStatus] && <StatusBadge status={c.taskStatus} />}
                    </div>
                    <TruckMetadata assignment={c} truck={truckFor(c)} query={search} />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 min-w-0 text-sm">
                      <p className="min-w-0 font-semibold text-foreground break-all"><Highlight text={c.driverName} query={search} /></p>
                      <div className="min-w-0">
                        <p className="font-medium text-foreground break-all"><Highlight text={c.destination} query={search} /></p>
                        {c.pickupLocation && <p className="break-words text-xs text-muted-foreground">Pickup: {c.pickupLocation}</p>}
                        {c.remarks && <RemarksPreview remarks={c.remarks} onOpen={() => setRemarksAssignment(c)} />}
                      </div>
                      <p className="min-w-0 font-medium text-foreground break-all"><Highlight text={c.company} query={search} /></p>
                      <div className="min-w-0">
                        <p className="font-medium text-foreground break-words">{c.deliveryDate}</p>
                        <p className="text-xs text-muted-foreground break-words">{c.completedAt}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              </div>
            </>
          )}
        </>
      )}
      <PaginationFooter page={selectedPage.page} totalItems={selectedCount} pageSize={DELIVERIES_PAGE_SIZE} onPageChange={selectedPage.setPage}
        singular="delivery" plural="deliveries" className="border-t border-border bg-muted/20" />
      <Dialog open={remarksAssignment !== null} onOpenChange={(open) => { if (!open) setRemarksAssignment(null); }}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-lg min-w-0 max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:p-6">
          <DialogHeader className="min-w-0 pr-6 text-left">
            <DialogTitle>Remarks</DialogTitle>
            <DialogDescription className="break-all">
              {remarksAssignment && `${remarksAssignment.truckPlate} · ${remarksAssignment.destination} · ${remarksAssignment.id}`}
            </DialogDescription>
          </DialogHeader>
          <div className="min-w-0 max-h-[60dvh] overflow-y-auto whitespace-pre-wrap break-all text-sm text-foreground">
            {remarksAssignment?.remarks}
          </div>
          <DialogFooter>
            <DialogClose className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/30">Close</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
