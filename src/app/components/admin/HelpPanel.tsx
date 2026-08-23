import { useState, useMemo, useEffect, useRef } from 'react';
import {
  X, Search, HelpCircle, ChevronRight, ArrowLeft,
  Truck, ClipboardList, FileText, BarChart3, UserCog,
  MonitorCheck, Package, Phone, Shield, Lightbulb,
  AlertTriangle, CheckCircle2, ArrowRight, BookOpen,
} from 'lucide-react';

interface Step {
  title: string;
  body: string;
  tip?: string;
  warning?: string;
}

interface Topic {
  id: string;
  category: string;
  title: string;
  summary: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  steps: Step[];
  tags: string[];
}

const TOPICS: Topic[] = [
  {
    id: 'add-driver',
    category: 'Accounts',
    title: 'Register a Driver',
    summary: 'Add a new driver with a mobile number and PIN so they can log in on their phone.',
    icon: UserCog,
    iconColor: 'text-purple-600',
    iconBg: 'bg-purple-100',
    tags: ['driver', 'register', 'add', 'pin', 'mobile'],
    steps: [
      { title: 'Go to Accounts → Drivers tab', body: 'Click "Accounts" in the sidebar, then make sure the "Drivers" tab is selected.' },
      { title: 'Click "+ Register Driver"', body: 'Press the green button. A registration form will slide in.' },
      { title: 'Fill in driver details', body: 'Enter full name, mobile number (e.g. 09XX XXX XXXX), and shift. The system auto-generates a 4-digit PIN.', tip: 'The mobile number is the driver\'s login username — use the number on their device.' },
      { title: 'Save', body: 'Click "Register Driver". The driver can now log in with their mobile + PIN.' },
      { title: 'Share the PIN', body: 'Tell the driver their PIN securely. You can view or regenerate PINs anytime from the Accounts table.', warning: 'Don\'t share PINs over public channels. Use a direct call or in-person handover.' },
    ],
  },
  {
    id: 'add-truck',
    category: 'Accounts',
    title: 'Register a Truck',
    summary: 'Add a truck to your fleet with plate number, classification, and payload capacity.',
    icon: Truck,
    iconColor: 'text-teal-600',
    iconBg: 'bg-teal-100',
    tags: ['truck', 'register', 'fleet', 'plate'],
    steps: [
      { title: 'Go to Accounts → Trucks tab', body: 'Click "Accounts" in the sidebar, then switch to the "Trucks" tab.' },
      { title: 'Click "+ Register Truck"', body: 'Opens the 3-step truck wizard.' },
      { title: 'Step 1 — Plate Number', body: 'Type the plate (e.g. "ABC 1234"). Must be unique across your fleet.' },
      { title: 'Step 2 — Classification', body: 'Choose from Micro, Light, Medium, Heavy, or Extravehicular. Selected card gets a blue border and checkmark.' },
      { title: 'Step 3 — Capacity & Confirm', body: 'Select payload capacity from the dropdown, review the summary, then click "Register truck".', tip: 'Capacity is used in reports and helps dispatchers pick the right truck.' },
    ],
  },
  {
    id: 'assign-task',
    category: 'Monitor',
    title: 'Assign a Delivery Task',
    summary: 'Dispatch a driver and truck for a route with full trip details.',
    icon: ClipboardList,
    iconColor: 'text-blue-600',
    iconBg: 'bg-blue-100',
    tags: ['assign', 'task', 'delivery', 'dispatch'],
    steps: [
      { title: 'Go to Monitor', body: 'Click "Monitor" in the sidebar — this is the main dispatch board.' },
      { title: 'Click "Assign Task"', body: 'The green button opens a 2-step wizard.' },
      { title: 'Step 1 — Driver, truck & route', body: 'Choose an available driver, an available truck, then fill in Origin, Destination, Client, and Pickup Location.', tip: 'Only drivers and trucks not currently assigned appear in the dropdowns.' },
      { title: 'Step 2 — Schedule & notes', body: 'Set Delivery Date, Pickup Date, Pickup Time, ETA, and any remarks.' },
      { title: 'Confirm', body: 'Click "Assign Task". The driver sees the job immediately on their phone.' },
    ],
  },
  {
    id: 'monitor',
    category: 'Monitor',
    title: 'Monitor Active Deliveries',
    summary: 'Track real-time status of all ongoing deliveries from a single board.',
    icon: MonitorCheck,
    iconColor: 'text-green-600',
    iconBg: 'bg-green-100',
    tags: ['monitor', 'track', 'status', 'real-time'],
    steps: [
      { title: 'Open Monitor', body: 'Each active assignment shows as a card: truck plate, driver, route, and status badge.' },
      { title: 'Status badge colours', body: 'Assigned (green) · Picked Up (blue) · In Transit (amber) · Delivered (gray) · Failed/Issue (red).' },
      { title: 'View details', body: 'Click "View Details" on any card for the full trip record: documents, photos, timestamps, delay notes.' },
      { title: 'Search & filter', body: 'Use the search bar to filter by plate, driver name, route, client, or status.', tip: 'The board refreshes automatically every 12 seconds.' },
    ],
  },
  {
    id: 'documents',
    category: 'Documents',
    title: 'Review & Approve Documents',
    summary: 'Approve or reject delivery documents submitted by drivers from the field.',
    icon: FileText,
    iconColor: 'text-amber-600',
    iconBg: 'bg-amber-100',
    tags: ['documents', 'approve', 'reject', 'pod'],
    steps: [
      { title: 'Go to Documents', body: 'All assignments with their document status are listed here.' },
      { title: 'Find pending docs', body: 'Amber "In Review" badges = documents waiting for your action.' },
      { title: 'Review', body: 'Click "View" on a document to see the full photo. Check it\'s legible and complete.' },
      { title: 'Approve or Reject', body: 'Approve to accept. Reject with a reason so the driver knows what to fix.', warning: 'Clear rejection reasons speed up resubmission — avoid vague notes.' },
      { title: 'Track completion', body: 'The progress bar shows how many of the 6 required documents are approved.', tip: 'Required: Proof of Delivery, Receiving Acknowledgement, Dispatch Slip, Sales Invoice, Bill of Lading, Waybill / Delivery Receipt.' },
    ],
  },
  {
    id: 'reports',
    category: 'Reports',
    title: 'Reports & Analytics',
    summary: 'Understand fleet performance — on-time rate, delays, document completion, driver stats.',
    icon: BarChart3,
    iconColor: 'text-rose-600',
    iconBg: 'bg-rose-100',
    tags: ['reports', 'analytics', 'on-time', 'export', 'csv'],
    steps: [
      { title: 'Go to Reports', body: 'Live KPI cards at the top: Total Deliveries, On-Time Rate, Delay Incidents, Active Assignments.' },
      { title: 'On-Time Rate', body: 'Shows "—" until at least one delivery is marked completed. Green = good, no colour = no data.' },
      { title: 'Report sections', body: 'Delivery Summary, On-Time Analysis, Delay Reports, Document Review, Driver Performance — each has a preview table.' },
      { title: 'Export CSV', body: 'Click the download icon on any section to get a CSV for Excel or Google Sheets.', tip: 'Use the Eye icon (Preview) to check data before exporting.' },
    ],
  },
  {
    id: 'driver-login',
    category: 'Drivers',
    title: 'Driver Login Guide',
    summary: 'Step-by-step for drivers to log in to the mobile interface.',
    icon: Phone,
    iconColor: 'text-indigo-600',
    iconBg: 'bg-indigo-100',
    tags: ['driver', 'login', 'mobile', 'pin'],
    steps: [
      { title: 'Open the app', body: 'Drivers go to the 360 Logistics URL on their phone. The Driver tab is shown by default.' },
      { title: 'Enter mobile number', body: 'Type the number the admin registered (e.g. 09XX XXX XXXX).', tip: 'Use the exact number registered — including the leading 0.' },
      { title: 'Enter 4-digit PIN', body: 'Tap each box and enter the PIN provided by the admin.' },
      { title: 'Tap Login', body: 'Correct credentials → task dashboard appears immediately.' },
      { title: 'Forgot PIN?', body: 'Tap "Forgot PIN" — contact the admin to regenerate it from the Accounts page.', warning: 'Drivers cannot reset their own PIN. Only admins can regenerate it.' },
    ],
  },
  {
    id: 'driver-updates',
    category: 'Drivers',
    title: 'Driver Status Updates & Documents',
    summary: 'How drivers submit status changes, photos, and delivery documents.',
    icon: Package,
    iconColor: 'text-orange-600',
    iconBg: 'bg-orange-100',
    tags: ['driver', 'status', 'photo', 'document'],
    steps: [
      { title: 'View assigned task', body: 'After login, the current assignment shows at the top: pickup, destination, client, ETA.' },
      { title: 'Update status', body: 'Tap "Update Status" and select the next step: Picked Up → In Transit → Delivered. Each step may prompt for a photo.', tip: 'Keep updates timely — admins monitor these in real time.' },
      { title: 'Upload documents', body: 'Go to the Documents section of the task, tap each type, and upload a clear photo of the signed document.', warning: 'Blurry or incomplete photos will be rejected — resubmission is needed.' },
      { title: 'Report a delay or issue', body: 'Use "Report Delay" or "Report Issue". Select a reason and add details — admin is notified immediately.' },
    ],
  },
  {
    id: 'security',
    category: 'Admin',
    title: 'Access Roles & Security',
    summary: 'Three admin roles control what each user can see and do.',
    icon: Shield,
    iconColor: 'text-green-600',
    iconBg: 'bg-green-100',
    tags: ['security', 'roles', 'access', 'admin', 'viewer'],
    steps: [
      { title: 'Admin (full access)', body: 'Can register/delete drivers & trucks, assign tasks, approve/reject documents, reset all data.' },
      { title: 'Demo/CSR', body: 'Can assign tasks and view all data. Cannot delete accounts or reset the system.' },
      { title: 'Viewer (read-only)', body: 'Can browse all pages but cannot make any changes. Good for auditors and stakeholders.' },
      { title: 'Separate accounts', body: 'Each CSR/admin should use their own login — shared accounts make activity log attribution impossible.', warning: 'Never share login credentials. All actions are logged against the account that performed them.' },
    ],
  },
];

const CATEGORIES = ['All', ...Array.from(new Set(TOPICS.map((t) => t.category)))];

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function HelpPanel({ open, onClose }: Props) {
  const [search,      setSearch]      = useState('');
  const [category,    setCategory]    = useState('All');
  const [activeTopic, setActiveTopic] = useState<Topic | null>(null);

  const detailRef = useRef<HTMLDivElement>(null);

  /* ── Close on Esc — back first if in detail, then close panel ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (activeTopic) setActiveTopic(null);
        else onClose();
      }
    };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose, activeTopic]);

  /* ── Body scroll lock ── */
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  /* ── Scroll detail to top when topic changes ── */
  useEffect(() => {
    if (activeTopic && detailRef.current) {
      detailRef.current.scrollTo({ top: 0 });
    }
  }, [activeTopic]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return TOPICS.filter((t) => {
      const matchCat = category === 'All' || t.category === category;
      if (!q) return matchCat;
      return matchCat && (
        t.title.toLowerCase().includes(q) ||
        t.summary.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.includes(q))
      );
    });
  }, [search, category]);

  const openTopic = (topic: Topic) => setActiveTopic(topic);
  const goBack    = ()            => setActiveTopic(null);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full z-50 w-full sm:w-[580px] bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-250">

        {/* ── Panel header ── */}
        {activeTopic ? (
          /* Detail header */
          <div className="flex items-center gap-3 px-4 py-4 border-b border-border flex-shrink-0">
            <button
              onClick={goBack}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors flex-shrink-0"
              title="Back to guides"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className={`${activeTopic.iconBg} ${activeTopic.iconColor} w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0`}>
              <activeTopic.icon className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider leading-none mb-0.5">{activeTopic.category}</p>
              <h2 className="text-sm font-semibold text-foreground leading-tight truncate">{activeTopic.title}</h2>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors flex-shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        ) : (
          /* List header */
          <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-gradient-to-r from-blue-500/8 to-transparent flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                <HelpCircle className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-foreground leading-tight">Help &amp; Guide</h2>
                <p className="text-xs text-muted-foreground">{TOPICS.length} step-by-step guides</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* ── Body ── */}
        {activeTopic ? (
          /* ── Detail view ── */
          <div ref={detailRef} className="flex-1 overflow-y-auto">
            {/* Summary banner */}
            <div className="px-6 py-4 border-b border-border/60 bg-[#f9fafb]">
              <p className="text-xs text-muted-foreground leading-relaxed">{activeTopic.summary}</p>
              <p className="text-[11px] text-muted-foreground mt-1.5 font-medium">{activeTopic.steps.length} steps</p>
            </div>

            {/* Steps */}
            <div className="px-6 py-5 space-y-0">
              {activeTopic.steps.map((step, idx) => (
                <div key={idx} className="flex gap-4">
                  {/* Step number + connector line */}
                  <div className="flex flex-col items-center flex-shrink-0">
                    <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-[11px] font-bold flex items-center justify-center flex-shrink-0">
                      {idx + 1}
                    </div>
                    {idx < activeTopic.steps.length - 1 && (
                      <div className="w-px flex-1 bg-border/60 my-1.5" />
                    )}
                  </div>

                  {/* Content */}
                  <div className={`flex-1 min-w-0 ${idx < activeTopic.steps.length - 1 ? 'pb-6' : 'pb-2'}`}>
                    <p className="text-sm font-semibold text-foreground mb-1 leading-snug">{step.title}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{step.body}</p>
                    {step.tip && (
                      <div className="mt-2.5 flex items-start gap-2 p-3 bg-blue-50 border border-blue-100 rounded-xl">
                        <Lightbulb className="w-3.5 h-3.5 text-blue-500 flex-shrink-0 mt-0.5" />
                        <p className="text-[11px] text-blue-700 leading-relaxed">{step.tip}</p>
                      </div>
                    )}
                    {step.warning && (
                      <div className="mt-2.5 flex items-start gap-2 p-3 bg-amber-50 border border-amber-100 rounded-xl">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                        <p className="text-[11px] text-amber-700 leading-relaxed">{step.warning}</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* End of guide */}
            <div className="mx-6 mb-4 flex items-center gap-2 py-3 px-4 bg-green-50 border border-green-100 rounded-xl">
              <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
              <p className="text-xs text-green-700 font-medium">End of guide</p>
            </div>

            {/* Back link */}
            <div className="px-6 pb-8">
              <button
                onClick={goBack}
                className="flex items-center gap-2 text-xs text-primary hover:text-primary/80 font-medium transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back to all guides
              </button>
            </div>
          </div>
        ) : (
          /* ── List view ── */
          <>
            {/* Search + filter — sticky */}
            <div className="px-6 py-4 border-b border-border/60 flex-shrink-0 space-y-3">
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search guides by topic or keyword…"
                  className="w-full pl-10 pr-9 py-2.5 bg-[#f9fafb] border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                {search && (
                  <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setCategory(cat)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
                      category === cat
                        ? 'bg-primary text-white border-primary'
                        : 'bg-white text-muted-foreground border-border hover:border-primary/40 hover:text-primary'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Topic list */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
              {filtered.length === 0 ? (
                <div className="py-12 text-center">
                  <HelpCircle className="w-10 h-10 text-muted-foreground/25 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No guides found</p>
                  <button
                    onClick={() => { setSearch(''); setCategory('All'); }}
                    className="mt-3 text-xs text-primary hover:text-primary/80 underline"
                  >
                    Clear search
                  </button>
                </div>
              ) : (
                <>
                  {search && (
                    <p className="text-xs text-muted-foreground pb-1">
                      <span className="font-semibold text-foreground">{filtered.length}</span> guide{filtered.length !== 1 ? 's' : ''} found
                    </p>
                  )}
                  {filtered.map((topic) => (
                    <button
                      key={topic.id}
                      onClick={() => openTopic(topic)}
                      className="w-full text-left rounded-xl border border-border bg-white px-4 py-3.5 hover:border-primary/30 hover:bg-accent/20 hover:shadow-sm transition-all group"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`${topic.iconBg} ${topic.iconColor} p-2 rounded-lg flex-shrink-0`}>
                          <topic.icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">{topic.category}</p>
                          <p className="text-sm font-semibold text-foreground leading-tight group-hover:text-primary transition-colors">{topic.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-snug line-clamp-1">{topic.summary}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                            <ArrowRight className="w-2.5 h-2.5" />{topic.steps.length} steps
                          </span>
                        </div>
                      </div>
                    </button>
                  ))}
                </>
              )}

              {/* Footer */}
              <div className="flex items-start gap-2.5 p-4 bg-primary/5 border border-primary/15 rounded-xl mt-2">
                <BookOpen className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <span className="font-semibold text-foreground">Need more help?</span> Contact your 360 Logistics system administrator or reach out to support.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
