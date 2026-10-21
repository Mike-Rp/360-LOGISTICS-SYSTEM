import { Skeleton } from '../ui/skeleton';

type Page = 'Dashboard' | 'Monitor' | 'Deliveries' | 'Documents' | 'Reports' | 'Accounts';
type Column = { label: string; width: string; badge?: boolean; avatar?: boolean; lines?: number };
const panel = 'min-w-0 rounded-xl border border-border bg-white shadow-sm';
const rows = Array.from({ length: 6 }, (_, index) => index);

function Heading({ title, description }: { title: string; description: string }) {
  return <header><h2 className="text-2xl font-semibold text-foreground">{title}</h2>
    <p className="mt-1 text-sm text-muted-foreground">{description}</p></header>;
}

function Filters({ labels }: { labels: string[] }) {
  return <div className="flex min-w-0 flex-wrap items-center gap-2">
    {labels.map(label => <span key={label} className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm text-muted-foreground">
      {label}<Skeleton className="h-4 w-5 rounded-full" />
    </span>)}
  </div>;
}

function Cell({ column }: { column: Column }) {
  return <div className="flex min-w-0 items-center gap-3">
    {column.avatar && <Skeleton className="h-9 w-9 shrink-0 rounded-full" />}
    <div className="min-w-0 flex-1 space-y-2">
      <Skeleton className={column.badge ? 'h-6 w-28 max-w-full rounded-full' : 'h-4 w-3/4'} />
      {Array.from({ length: (column.lines ?? 2) - 1 }, (_, index) =>
        <Skeleton key={index} className="h-3 w-1/2" />)}
    </div>
  </div>;
}

// These breakpoints match the corresponding pages; table widths never set a viewport minimum.
function RecordList({ columns, layout }: { columns: Column[]; layout: 'deliveries' | 'documents' | 'accounts' | 'reports' }) {
  const desktop = layout === 'deliveries' ? 'hidden xl:block' : layout === 'reports' ? 'hidden lg:block' : 'hidden sm:block';
  const mobile = layout === 'deliveries' ? 'xl:hidden' : layout === 'reports' ? 'lg:hidden' : 'sm:hidden';
  return <div className={`${panel} overflow-hidden`}>
    <div className={desktop}>
      <table className="w-full table-fixed text-sm">
        <colgroup>{columns.map(column => <col key={column.label} style={{ width: column.width }} />)}</colgroup>
        <thead className="border-b border-border bg-muted/30"><tr>
          {columns.map(column => <th key={column.label} className="break-words px-2 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{column.label}</th>)}
        </tr></thead>
        <tbody className="divide-y divide-border">{rows.map(row => <tr key={row}>
          {columns.map(column => <td key={column.label} className={`px-2 ${layout === 'deliveries' ? 'py-5' : 'py-4'}`}><Cell column={column} /></td>)}
        </tr>)}</tbody>
      </table>
    </div>
    <div className={`${mobile} divide-y divide-border`}>
      {rows.map(row => <div key={row} className="min-w-0 space-y-3 p-4">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0 flex-1"><Cell column={columns[0]} /></div>
          <Skeleton className="h-6 w-24 max-w-[40%] rounded-full" />
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
          {columns.slice(1).map(column => <div key={column.label} className="min-w-0 space-y-1.5">
            <p className="text-xs text-muted-foreground">{column.label}</p><Cell column={column} />
          </div>)}
        </div>
      </div>)}
    </div>
  </div>;
}

function DashboardSkeleton({ isViewOnly }: { isViewOnly: boolean }) {
  return <div className="space-y-4 sm:space-y-6">
    <div className={`${panel} rounded-2xl px-6 py-6 sm:px-8 xl:h-[160px] flex flex-col justify-center gap-3`}>
      <Skeleton className="h-8 w-96 max-w-full" /><Skeleton className="h-4 w-80 max-w-full" />
      {!isViewOnly && <Skeleton className="h-10 w-full rounded-xl sm:w-40" />}
    </div>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {['Active Deliveries', 'Completed Deliveries', 'Delayed Deliveries', 'Docs Pending Review'].map(title =>
        <div key={title} className={`${panel} rounded-2xl px-5 py-4`}>
          <p className="text-sm font-medium text-foreground">{title}</p>
          <div className="mt-3 flex min-w-0 items-start justify-between gap-3">
            <Skeleton className="h-8 w-12 shrink-0" /><Skeleton className="h-8 w-28 max-w-[60%]" />
          </div>
        </div>)}
    </div>
    <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-2">
      <div className={`${panel} rounded-2xl p-5 sm:p-6`}>
        <h3 className="text-lg font-semibold text-foreground">Delivery Overview</h3>
        <Skeleton className="mt-3 h-4 w-48 max-w-full" /><Skeleton className="mt-4 h-[260px] w-full rounded-xl" />
      </div>
      <div className={`${panel} rounded-2xl p-5 sm:p-6`}>
        <h3 className="text-lg font-semibold text-foreground">Recent Activity</h3>
        <p className="text-sm text-muted-foreground">Driver fleet events</p>
        <div className="mt-4 divide-y divide-border">{rows.map(row => <div key={row} className="grid grid-cols-4 gap-3 py-3">
          <Skeleton className="h-5 w-full" /><Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full rounded-full" /><Skeleton className="h-5 w-full" />
        </div>)}</div>
      </div>
      {['Available Drivers', 'Fleet'].map(title => <div key={title} className={`${panel} rounded-2xl p-5 sm:p-6`}>
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        <div className="mt-4 space-y-3">{rows.slice(0, 4).map(row => <div key={row} className="flex min-w-0 items-center gap-3 py-2">
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-3 w-1/3" /></div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>)}</div>
      </div>)}
    </div>
  </div>;
}

function DispatchSkeleton({ isViewOnly }: { isViewOnly: boolean }) {
  return <div className="space-y-8">
    <div className="flex flex-col justify-between gap-4 2xl:flex-row 2xl:items-center">
      <Heading title="Dispatch & Drivers" description="Manage dispatch assignments, drivers, and delivery operations." />
      <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:flex">
        <Skeleton className="h-12 w-full rounded-xl sm:col-span-2 xl:w-48" />
        <Skeleton className="h-12 w-full rounded-xl xl:w-40" />
        {!isViewOnly && <Skeleton className="h-12 w-full rounded-xl xl:w-40" />}
      </div>
    </div>
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {rows.map(row => <div key={row} className={`${panel} rounded-2xl p-4 sm:p-5`}>
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-2"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-6 w-24" /><Skeleton className="h-3 w-20" /></div>
          <Skeleton className="h-6 w-24 max-w-[40%] rounded-full" />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-2">
          {['Driver', 'Corporation', 'Route', 'Delivery date'].map(label => <div key={label} className="min-w-0 space-y-1.5">
            <p className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</p><Skeleton className="h-4 w-3/4" />
          </div>)}
        </div>
        <div className="mt-4 space-y-2 rounded-lg bg-muted/40 p-3">
          <p className="text-xs font-medium text-foreground">Documents</p>
          <Skeleton className="h-1.5 w-full rounded-full" /><Skeleton className="h-3 w-full" />
        </div>
        <div className="mt-5 flex justify-end"><Skeleton className="h-10 w-32 rounded-lg" /></div>
      </div>)}
    </div>
  </div>;
}

function ReportsSkeleton() {
  return <div className="min-w-0 space-y-6">
    <Heading title="Reports & Analytics" description="Review delivery performance, identify operational issues, and generate reports." />
    <section className="space-y-3">
      <h3 className="text-lg font-semibold text-foreground">Reports</h3>
      <div className="grid w-full grid-cols-1 gap-4 lg:grid-cols-2">
        {['Weekly Performance Report', 'Monthly Delivery Summary', 'Delay & Issues Report', 'Fleet & Driver Utilization Report'].map(title => <div key={title} className={`${panel} flex min-h-[184px] flex-col gap-2.5 p-4`}>
          <div className="flex items-start gap-2.5"><Skeleton className="mt-1 h-5 w-5 shrink-0 rounded" />
            <div className="min-w-0 flex-1"><h4 className="text-xl font-semibold leading-tight text-foreground lg:text-[22px]">{title}</h4></div><Skeleton className="h-4 w-16 shrink-0" /></div>
          <div className="space-y-2"><Skeleton className="h-4 w-4/5" /><Skeleton className="h-4 w-3/5" /></div>
          <div className="mt-auto flex flex-wrap justify-end gap-2"><Skeleton className="h-10 w-28" /><Skeleton className="h-10 w-28" /></div>
        </div>)}
      </div>
    </section>
    <section className={`${panel} p-4 sm:p-5`}>
      <div className="flex min-w-0 flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div><h3 className="font-semibold text-foreground">Analytics date range</h3><p className="mt-1 text-xs text-muted-foreground">Filter charts by scheduled delivery date.</p></div>
        <div className="flex min-w-0 flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
          {['From', 'To'].map(label => <div key={label} className="min-w-0 space-y-1 text-xs text-muted-foreground">{label}<Skeleton className="h-10 w-full md:w-40" /></div>)}
          <div className="flex flex-wrap gap-2"><Skeleton className="h-11 w-28" /><Skeleton className="h-11 w-28" /></div>
        </div>
      </div>
    </section>
    <section className="space-y-4">
      <h3 className="text-lg font-semibold text-foreground">Analytics</h3>
      <div className={`${panel} p-4 sm:p-5`}><h4 className="font-semibold text-foreground">Delivery Performance Trend</h4>
        <Skeleton className="mt-2 h-4 w-80 max-w-full" /><Skeleton className="mt-5 h-64 w-full rounded-xl" /><Skeleton className="mx-auto mt-3 h-4 w-48 max-w-full" />
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {['Delay Reason Breakdown', 'Delivery Status Breakdown'].map(title => <div key={title} className={`${panel} p-4 sm:p-5`}>
          <h4 className="font-semibold text-foreground">{title}</h4><Skeleton className="mt-2 h-4 w-64 max-w-full" /><Skeleton className="mt-4 h-48 w-full rounded-xl" />
        </div>)}
      </div>
    </section>
    <section className="space-y-4"><h3 className="text-lg font-semibold text-foreground">Recent Reports</h3>
      <RecordList layout="reports" columns={['Report Name', 'Type', 'Date Range', 'Generated At', 'Generated By', 'Actions'].map(label => ({ label, width: `${100 / 6}%`, badge: label === 'Type', lines: 1 }))} />
    </section>
  </div>;
}

/** Presentation only: real pages mount after the first request, including empty/error results. */
export default function AdminContentSkeleton({ page, isViewOnly, canManageFleetAccounts }: { page: Page; isViewOnly: boolean; canManageFleetAccounts: boolean }) {
  let content;
  switch (page) {
    case 'Dashboard': content = <DashboardSkeleton isViewOnly={isViewOnly} />; break;
    case 'Monitor': content = <DispatchSkeleton isViewOnly={isViewOnly} />; break;
    case 'Reports': content = <ReportsSkeleton />; break;
    case 'Deliveries': content = <div className={`${panel} overflow-hidden`}>
      <div className="space-y-3 border-b border-border px-6 py-5">
        <h2 className="text-lg font-semibold text-foreground">Deliveries</h2>
        <p className="text-sm text-muted-foreground">View and manage current delivery assignments.</p>
        <div className="flex flex-wrap justify-between gap-3"><Filters labels={['Active', 'Completed', 'Cancelled']} /><Skeleton className="h-9 w-32" /></div>
      </div>
      <RecordList layout="deliveries" columns={[
        { label: 'Truck', width: '14%', lines: 3 }, { label: 'Driver', width: '10%' },
        { label: 'Route', width: '20%', lines: 3 }, { label: 'Customer', width: '10%' },
        { label: 'Status', width: '17%', badge: true, lines: 1 }, { label: 'Date', width: '12%' },
        { label: 'Documents', width: '17%', badge: true, lines: 1 },
      ]} />
    </div>; break;
    case 'Documents': content = <div className="space-y-4">
      <Heading title="Document Archive" description="Click any assignment row to expand its documents." />
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <Filters labels={['All', 'Pending review', 'All approved', 'Rejected']} /><Skeleton className="h-11 w-full sm:w-36" />
      </div>
      <RecordList layout="documents" columns={[
        { label: 'Assignment', width: '19%' }, { label: 'Driver', width: '16%' },
        { label: 'Truck', width: '13%' }, { label: 'Date', width: '16%' },
        { label: 'Status', width: '18%', badge: true, lines: 1 }, { label: 'Document Status', width: '18%', badge: true },
      ]} />
    </div>; break;
    case 'Accounts': content = <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <Heading title="Drivers & Trucks" description={canManageFleetAccounts ? 'Manage driver accounts, availability, and truck records.' : 'View driver and truck availability for dispatch.'} /><Filters labels={['Drivers', 'Trucks']} />
      </div>
      <div className="flex flex-wrap justify-between gap-3"><Filters labels={['Active', 'Archived']} />{canManageFleetAccounts && <Skeleton className="h-10 w-40" />}</div>
      <RecordList layout="accounts" columns={[
        { label: 'Driver', width: canManageFleetAccounts ? '25%' : '28%', avatar: true }, { label: 'Contact', width: '22%' },
        { label: 'Availability', width: '24%', badge: true, lines: 1 },
        { label: canManageFleetAccounts ? 'PIN' : 'Current Truck', width: canManageFleetAccounts ? '22%' : '26%', lines: 1 },
        ...(canManageFleetAccounts ? [{ label: 'Action', width: '7%', lines: 1 }] : []),
      ]} />
    </div>; break;
  }
  return <div aria-hidden="true" className="min-w-0">{content}</div>;
}
