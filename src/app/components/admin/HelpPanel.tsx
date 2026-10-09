import { useState, useMemo, useEffect, useRef } from 'react';
import {
  X, Search, HelpCircle, ChevronRight, ChevronDown, ArrowLeft,
  Truck, ClipboardList, FileText, BarChart3, UserCog,
  MonitorCheck, Package, Phone, Shield, Lightbulb,
  AlertTriangle, CheckCircle2, BookOpen,
} from 'lucide-react';
import { useModalFocus } from './useModalFocus';

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
    category: 'Drivers & Trucks',
    title: 'Register a Driver',
    summary: 'Add a new driver with a mobile number and PIN so they can log in on their phone.',
    icon: UserCog,
    iconColor: 'text-purple-600',
    iconBg: 'bg-purple-100',
    tags: ['driver', 'register', 'add', 'pin', 'mobile'],
    steps: [
      { title: 'Go to Drivers & Trucks → Drivers tab', body: 'Click "Drivers & Trucks" in the sidebar, then make sure the "Drivers" tab is selected.' },
      { title: 'Click "+ Register Driver"', body: 'Press the green button. A registration form will slide in.' },
      { title: 'Fill in driver details', body: 'Enter the driver\'s first name, surname, and mobile number, then click "Generate PIN" for a 4-digit PIN.', tip: 'The mobile number is the driver\'s login username — use the number on their device.' },
      { title: 'Save', body: 'Click "Register Driver". The driver can now log in with their mobile + PIN.' },
      { title: 'Share the PIN', body: 'Tell the driver their PIN securely. You can view or regenerate PINs anytime from the Drivers & Trucks table.', warning: 'Don\'t share PINs over public channels. Use a direct call or in-person handover.' },
    ],
  },
  {
    id: 'add-truck',
    category: 'Drivers & Trucks',
    title: 'Register a Truck',
    summary: 'Add a truck to your fleet with plate number, classification, and payload capacity.',
    icon: Truck,
    iconColor: 'text-teal-600',
    iconBg: 'bg-teal-100',
    tags: ['truck', 'register', 'fleet', 'plate'],
    steps: [
      { title: 'Go to Drivers & Trucks → Trucks tab', body: 'Click "Drivers & Trucks" in the sidebar, then switch to the "Trucks" tab.' },
      { title: 'Click "+ Register Truck"', body: 'Opens the 3-step truck wizard.' },
      { title: 'Step 1 — Plate Number', body: 'Type the plate (e.g. "ABC 1234"). Must be unique across your fleet.' },
      { title: 'Step 2 — Classification', body: 'Choose the truck classification from the available cards. The selected type determines its capacity.' },
      { title: 'Step 3 — Review & Confirm', body: 'Review the plate, classification, and automatically assigned capacity, then click "Register truck".', tip: 'Capacity helps dispatchers pick the right truck for each delivery.' },
    ],
  },
  {
    id: 'assign-task',
    category: 'Dispatch',
    title: 'Assign a Delivery Task',
    summary: 'Dispatch a driver and truck for a route with full trip details.',
    icon: ClipboardList,
    iconColor: 'text-blue-600',
    iconBg: 'bg-blue-100',
    tags: ['assign', 'task', 'delivery', 'dispatch'],
    steps: [
      { title: 'Go to Dispatch', body: 'Click "Dispatch" in the sidebar — this is the main dispatch board.' },
      { title: 'Click "Dispatch Truck"', body: 'The green button opens a 2-step assignment form.' },
      { title: 'Step 1 — Driver, truck & route', body: 'Choose an available driver, an available truck, then fill in Origin, Destination, Client, and Pickup Location.', tip: 'Only drivers and trucks not currently assigned appear in the dropdowns.' },
      { title: 'Step 2 — Schedule & notes', body: 'Set Delivery Date, Pickup Date, Pickup Time, ETA, and any remarks.' },
      { title: 'Confirm', body: 'Click "Dispatch Truck". The driver sees the job on their phone.' },
    ],
  },
  {
    id: 'monitor',
    category: 'Dispatch',
    title: 'Monitor Active Deliveries',
    summary: 'Track real-time status of all ongoing deliveries from a single board.',
    icon: MonitorCheck,
    iconColor: 'text-green-600',
    iconBg: 'bg-green-100',
    tags: ['monitor', 'track', 'status', 'real-time'],
    steps: [
      { title: 'Open Dispatch', body: 'Each active assignment shows as a card: truck plate, driver, route, and status badge.' },
      { title: 'Status badge colours', body: 'Assigned (purple — light purple until the driver opens it) · Picked Up (light blue) · In Transit (blue) · Delivered (green) · Failed/Issue (red) · Cancelled (gray).' },
      { title: 'View details', body: 'Click "View Shipment" on any card for the full trip record: documents, photos, timestamps, delay notes.' },
      { title: 'Search & filter', body: 'Use the search bar to filter by plate, driver name, route, client, or status.', tip: 'The board refreshes automatically every 12 seconds.' },
    ],
  },
  {
    id: 'review-documents',
    category: 'Dispatch',
    title: 'Review Pending Documents',
    summary: 'Use Dispatch to approve or reject documents waiting for a decision.',
    icon: ClipboardList,
    iconColor: 'text-blue-600',
    iconBg: 'bg-blue-100',
    tags: ['documents', 'review', 'approve', 'reject', 'pending'],
    steps: [
      { title: 'Open Dispatch', body: 'Open the assignment that has documents pending review. The review queue groups pending documents under each assignment.' },
      { title: 'Open the review section', body: 'Click "Review documents" in the review queue, or open the assignment with "View Shipment" to find its documents.' },
      { title: 'Check each file', body: 'Preview the uploaded document and confirm it is legible and belongs to the delivery.' },
      { title: 'Approve or Reject', body: 'Use the existing Approve or Reject controls in Dispatch. Give a clear reason when rejecting so the driver knows what to correct.', warning: 'Document Archive is for viewing and tracking files; review decisions happen in Dispatch.' },
    ],
  },
  {
    id: 'deliveries',
    category: 'Deliveries',
    title: 'View Delivery Status',
    summary: 'Find active, completed, and cancelled assignments and open their documents.',
    icon: Package,
    iconColor: 'text-blue-600',
    iconBg: 'bg-blue-100',
    tags: ['delivery', 'status', 'active', 'completed', 'cancelled', 'documents'],
    steps: [
      { title: 'Open Deliveries', body: 'Select "Deliveries" in the sidebar to see the assignment list.' },
      { title: 'Choose a tab', body: 'Use Active, Completed, or Cancelled to narrow the list. Search and the date filter can help find a specific assignment.' },
      { title: 'Check the status', body: 'Read the Status badge for the assignment workflow. Delivered does not automatically mean its document review is complete.' },
      { title: 'Open documents', body: 'When available, click the Documents control on the delivery to open that assignment in Document Archive.' },
    ],
  },
  {
    id: 'documents',
    category: 'Documents',
    title: 'View and Track Documents',
    summary: 'Browse uploaded delivery files and follow their review status.',
    icon: FileText,
    iconColor: 'text-amber-600',
    iconBg: 'bg-amber-100',
    tags: ['documents', 'archive', 'status', 'pod'],
    steps: [
      { title: 'Go to Documents', body: 'Assignments with uploaded documents and their review status are listed in Document Archive.' },
      { title: 'Find a status', body: 'Use All, Pending review, All approved, or Rejected to filter documents, then expand an assignment to see its files.' },
      { title: 'View a document', body: 'Click "View" on a document to see the full photo and its current review status.' },
      { title: 'Track completion', body: 'The document summary shows approved, pending, and rejected files. For approval or rejection, open the assignment in Dispatch.', tip: 'Required: Proof of Delivery, Receiving Acknowledgement, Dispatch Slip, Sales Invoice, Bill of Lading, Waybill / Delivery Receipt.' },
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
      { title: 'Go to Reports', body: 'Open Reports & Analytics from the sidebar.' },
      { title: 'Choose a report', body: 'Select Weekly Performance, Monthly Delivery Summary, or Delay & Issues.' },
      { title: 'Preview', body: 'Click "Preview" on a report card to inspect its detailed table.' },
      { title: 'Export CSV', body: 'Click "Export" on a report card to download a CSV for Excel or Google Sheets.', tip: 'The Analytics date range below the report cards filters the charts, not the report cards.' },
    ],
  },
  {
    id: 'driver-login',
    category: 'Drivers & Trucks',
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
      { title: 'Forgot PIN?', body: 'Tap "Forgot PIN" — contact the admin to regenerate it from Drivers & Trucks.', warning: 'Drivers cannot reset their own PIN. Only admins can regenerate it.' },
    ],
  },
  {
    id: 'driver-updates',
    category: 'Drivers & Trucks',
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
    id: 'settings',
    category: 'Settings',
    title: 'Update Profile and Preferences',
    summary: 'Edit your profile, change your password, and manage notifications.',
    icon: UserCog,
    iconColor: 'text-slate-600',
    iconBg: 'bg-slate-100',
    tags: ['settings', 'profile', 'password', 'notifications'],
    steps: [
      { title: 'Open Settings', body: 'Open the account menu in the header and select Settings.' },
      { title: 'Save profile changes', body: 'Edit your display name or photo, preview the change, then click "Save Changes" in the Profile section.' },
      { title: 'Update your password', body: 'Use the separate "Update Password" action in the Password section.' },
      { title: 'Manage notifications', body: 'Use the notification preference control in Settings to turn notifications on or off.' },
    ],
  },
  {
    id: 'security',
    category: 'Admin',
    title: 'Access Roles & Security',
    summary: 'Understand Operation Manager, CSR, and Viewer access.',
    icon: Shield,
    iconColor: 'text-green-600',
    iconBg: 'bg-green-100',
    tags: ['security', 'roles', 'access', 'admin', 'viewer'],
    steps: [
      { title: 'Operation Manager', body: 'Can manage workspace members in Workspace Settings and use the admin operations pages.' },
      { title: 'CSR', body: 'Can use the operational pages according to their assigned permissions, including dispatch and document review.' },
      { title: 'Viewer (read-only)', body: 'Can browse all pages but cannot make any changes. Good for auditors and stakeholders.' },
      { title: 'Separate accounts', body: 'Each team member should use their own login so activity can be attributed correctly.', warning: 'Never share login credentials.' },
    ],
  },
];

const CATEGORY_ORDER = ['Dispatch', 'Deliveries', 'Documents', 'Reports', 'Drivers & Trucks', 'Settings', 'Admin'];
const CATEGORIES = ['All', ...CATEGORY_ORDER.filter((name) => TOPICS.some((topic) => topic.category === name))];
const COMMON_TASK_IDS = ['add-driver', 'add-truck', 'assign-task', 'review-documents'];
const CATEGORY_DETAILS: Record<string, { icon: React.ElementType; description: string }> = {
  Dispatch: { icon: ClipboardList, description: 'Assign, track, and review deliveries.' },
  Deliveries: { icon: Package, description: 'Find assignments and follow their progress.' },
  Documents: { icon: FileText, description: 'Browse files and their review status.' },
  Reports: { icon: BarChart3, description: 'Preview reports and understand performance.' },
  'Drivers & Trucks': { icon: Truck, description: 'Manage the people and vehicles in your fleet.' },
  Settings: { icon: UserCog, description: 'Update your profile and preferences.' },
  Admin: { icon: Shield, description: 'Understand workspace access and roles.' },
};

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function HelpPanel({ open, onClose }: Props) {
  const [search,      setSearch]      = useState('');
  const [category,    setCategory]    = useState('All');
  const [activeTopic, setActiveTopic] = useState<Topic | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<string[]>([]);

  const detailRef = useRef<HTMLDivElement>(null);

  /* Focus moves into the modal on open, Tab stays inside, returns to the opener on close */
  const modalRef = useRef<HTMLDivElement>(null);
  useModalFocus(open, modalRef);

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
        t.category.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.includes(q))
      );
    });
  }, [search, category]);

  useEffect(() => {
    if (search.trim()) {
      setExpandedCategories(CATEGORIES.filter((name) => filtered.some((topic) => topic.category === name)));
    }
  }, [search, filtered]);

  const commonTasks = filtered.filter((topic) => COMMON_TASK_IDS.includes(topic.id));
  const groupedTopics = CATEGORIES.slice(1)
    .map((name) => ({ name, topics: filtered.filter((topic) => topic.category === name) }))
    .filter((group) => group.topics.length > 0);

  const toggleCategory = (name: string) => setExpandedCategories((current) =>
    current.includes(name) ? current.filter((item) => item !== name) : [...current, name]);

  const openTopic = (topic: Topic) => setActiveTopic(topic);
  const goBack    = ()            => setActiveTopic(null);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />

      {/* Centred modal — the wrapper ignores clicks so they fall through to the backdrop.
          Fixed height (not max) so it doesn't resize between the list and a guide's steps. */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 pointer-events-none">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        className="pointer-events-auto w-full max-w-[720px] h-[calc(100dvh-24px)] sm:h-[85vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
      >

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
              <p className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider leading-none mb-0.5">{activeTopic.category}</p>
              <h2 id="help-title" className="text-sm font-semibold text-foreground leading-tight truncate">{activeTopic.title}</h2>
            </div>
            <button
              onClick={onClose}
              aria-label="Close help"
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
                <h2 id="help-title" className="text-base font-semibold text-foreground leading-tight">Help &amp; Guide</h2>
                <p className="text-xs text-muted-foreground">Quick help for common admin tasks.</p>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close help"
              className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* ── Body ── */}
        {activeTopic ? (
          /* ── Detail view ── */
          <div ref={detailRef} className="flex-1 min-h-0 overflow-y-auto">
            {/* Summary banner */}
            <div className="px-6 py-4 border-b border-border/60 bg-[#f9fafb]">
              <p className="text-xs text-muted-foreground leading-relaxed">{activeTopic.summary}</p>
              <p className="text-[12px] text-muted-foreground mt-1.5 font-medium">{activeTopic.steps.length} steps</p>
            </div>

            {/* Steps */}
            <div className="px-6 py-5 space-y-0">
              {activeTopic.steps.map((step, idx) => (
                <div key={idx} className="flex gap-4">
                  {/* Step number + connector line */}
                  <div className="flex flex-col items-center flex-shrink-0">
                    <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-[12px] font-bold flex items-center justify-center flex-shrink-0">
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
                        <p className="text-[12px] text-blue-700 leading-relaxed">{step.tip}</p>
                      </div>
                    )}
                    {step.warning && (
                      <div className="mt-2.5 flex items-start gap-2 p-3 bg-amber-50 border border-amber-100 rounded-xl">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                        <p className="text-[12px] text-amber-700 leading-relaxed">{step.warning}</p>
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
            <div className="px-4 sm:px-6 py-3 border-b border-border/60 flex-shrink-0 space-y-2.5">
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search help guides..."
                  aria-label="Search help guides"
                  className="w-full pl-10 pr-9 py-2.5 bg-[#f9fafb] border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                {search && (
                  <button onClick={() => setSearch('')} aria-label="Clear help search" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => { setCategory(cat); setExpandedCategories(cat === 'All' ? [] : [cat]); }}
                    aria-pressed={category === cat}
                    className={`min-h-9 shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
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

            {/* Common tasks and compact category list */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4 space-y-5">
              {filtered.length === 0 ? (
                <div className="py-12 text-center">
                  <HelpCircle className="w-10 h-10 text-muted-foreground/25 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No guides found</p>
                  <button
                    onClick={() => { setSearch(''); setCategory('All'); setExpandedCategories([]); }}
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
                  {commonTasks.length > 0 && (
                    <section aria-labelledby="common-tasks-title">
                      <h3 id="common-tasks-title" className="text-sm font-semibold text-foreground">Common Tasks</h3>
                      <p className="text-xs text-muted-foreground mt-0.5 mb-2.5">Quick access to common admin tasks.</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {commonTasks.map((topic) => (
                          <button key={topic.id} type="button" onClick={() => openTopic(topic)}
                            className="min-w-0 flex items-start gap-2.5 rounded-xl border border-border bg-white p-3 text-left hover:border-primary/30 hover:bg-accent/20 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary group">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><topic.icon className="h-4 w-4" /></span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-semibold text-foreground group-hover:text-primary">{topic.title}</span>
                              <span className="mt-0.5 block text-xs leading-snug text-muted-foreground line-clamp-2">{topic.summary}</span>
                              <span className="mt-2 flex flex-wrap gap-x-2 text-[12px] text-muted-foreground"><span>{topic.category}</span><span>{topic.steps.length} steps</span></span>
                            </span>
                            <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-muted-foreground" />
                          </button>
                        ))}
                      </div>
                    </section>
                  )}

                  <section aria-labelledby="all-guides-title">
                    <h3 id="all-guides-title" className="mb-2.5 text-sm font-semibold text-foreground">All Guides</h3>
                    <div className="space-y-2">
                      {groupedTopics.map(({ name, topics }) => {
                        const details = CATEGORY_DETAILS[name];
                        const expanded = expandedCategories.includes(name);
                        const panelId = `help-category-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`;
                        return (
                          <div key={name} className="overflow-hidden rounded-xl border border-border bg-white">
                            <button type="button" onClick={() => toggleCategory(name)} aria-expanded={expanded} aria-controls={panelId}
                              className="flex w-full min-w-0 items-center gap-3 p-3 text-left hover:bg-accent/20 focus-visible:outline-2 focus-visible:outline-primary">
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/5 text-primary"><details.icon className="h-4 w-4" /></span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-semibold text-foreground">{name}</span>
                                <span className="block text-xs text-muted-foreground leading-snug line-clamp-1">{details.description}</span>
                              </span>
                              <span className="hidden sm:block shrink-0 text-xs text-muted-foreground">{topics.length} guide{topics.length === 1 ? '' : 's'}</span>
                              <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
                            </button>
                            <div id={panelId} hidden={!expanded} className="divide-y divide-border/60 border-t border-border/60">
                              {topics.map((topic) => (
                                  <button key={topic.id} type="button" onClick={() => openTopic(topic)}
                                    className="flex w-full min-w-0 items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/20 focus-visible:outline-2 focus-visible:outline-primary group">
                                    <span className="min-w-0 flex-1">
                                      <span className="block text-sm font-medium text-foreground group-hover:text-primary">{topic.title}</span>
                                      <span className="block text-xs leading-snug text-muted-foreground line-clamp-2">{topic.summary}</span>
                                    </span>
                                    <span className="shrink-0 text-[12px] text-muted-foreground">{topic.steps.length} steps</span>
                                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                                  </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
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
      </div>
    </>
  );
}
