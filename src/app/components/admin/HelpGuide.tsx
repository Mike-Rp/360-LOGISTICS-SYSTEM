import { useState, useMemo } from 'react';
import {
  Search, X, ChevronRight, ChevronDown,
  Truck, ClipboardList, FileText, BarChart3,
  UserCog, MonitorCheck, Package, HelpCircle,
  CheckCircle2, AlertTriangle, KeyRound, Phone,
  ArrowRight, BookOpen, Lightbulb, Shield,
} from 'lucide-react';

interface Topic {
  id: string;
  category: string;
  title: string;
  summary: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  steps: {
    title: string;
    body: string;
    tip?: string;
    warning?: string;
  }[];
  tags: string[];
}

const TOPICS: Topic[] = [
  {
    id: 'add-driver',
    category: 'Accounts',
    title: 'How to Register a Driver',
    summary: 'Add a new driver to the system with a mobile number and PIN so they can log in.',
    icon: UserCog,
    iconColor: 'text-purple-600',
    iconBg: 'bg-purple-100',
    tags: ['driver', 'register', 'add', 'account', 'pin', 'mobile'],
    steps: [
      {
        title: 'Go to the Accounts page',
        body: 'Click "Accounts" in the left sidebar. Make sure the "Drivers" tab is selected at the top right of the page.',
      },
      {
        title: 'Click "Add Driver"',
        body: 'Press the green "+ Add Driver" button. A registration form will appear.',
      },
      {
        title: 'Fill in driver details',
        body: 'Enter the driver\'s full name, mobile number (e.g. 09XX XXX XXXX), and their assigned shift. The system will auto-generate a 4-digit PIN — you can regenerate it if needed.',
        tip: 'The mobile number is what the driver uses to log in. Make sure it matches the number on their device.',
      },
      {
        title: 'Save the driver',
        body: 'Click "Register Driver" to save. The driver will now appear in the Accounts table and can log in with their mobile number and PIN.',
      },
      {
        title: 'Share the PIN with the driver',
        body: 'The driver will need their 4-digit PIN to log in. You can view or regenerate PINs at any time from the Accounts table.',
        warning: 'Do not share PINs over public channels. Use a secure method like a direct call or in-person.',
      },
    ],
  },
  {
    id: 'add-truck',
    category: 'Accounts',
    title: 'How to Register a Truck',
    summary: 'Add a truck to your fleet including its plate number, classification, and capacity.',
    icon: Truck,
    iconColor: 'text-teal-600',
    iconBg: 'bg-teal-100',
    tags: ['truck', 'register', 'fleet', 'plate', 'add'],
    steps: [
      {
        title: 'Go to Accounts → Trucks tab',
        body: 'Click "Accounts" in the sidebar, then switch to the "Trucks" tab using the tab switcher in the top-right area.',
      },
      {
        title: 'Click "Add Truck"',
        body: 'Press the "+ Add Truck" button to open the 3-step truck registration wizard.',
      },
      {
        title: 'Step 1 — Enter Plate Number',
        body: 'Type the plate number (e.g. "ABC 1234"). The plate must be unique — you cannot register two trucks with the same plate.',
      },
      {
        title: 'Step 2 — Choose Classification',
        body: 'Select the truck type from the classification cards: Micro, Light, Medium, Heavy, or Extravehicular. Your selection is highlighted with a blue border and checkmark.',
      },
      {
        title: 'Step 3 — Set Capacity and Confirm',
        body: 'Choose the payload capacity from the dropdown. Review the summary, then click "Register truck" to save.',
        tip: 'Capacity is used in reports and helps dispatchers select the right truck for each delivery.',
      },
    ],
  },
  {
    id: 'assign-task',
    category: 'Monitor',
    title: 'How to Assign a Delivery Task',
    summary: 'Dispatch a driver and truck for a delivery route with full trip details.',
    icon: ClipboardList,
    iconColor: 'text-blue-600',
    iconBg: 'bg-blue-100',
    tags: ['assign', 'task', 'delivery', 'dispatch', 'driver', 'truck', 'route'],
    steps: [
      {
        title: 'Go to Monitor',
        body: 'Click "Monitor" in the sidebar. This is the main dispatch board showing all active assignments.',
      },
      {
        title: 'Click "Assign Task"',
        body: 'Press the green "Assign Task" button in the top-right corner of the monitoring board.',
      },
      {
        title: 'Step 1 — Select driver and truck',
        body: 'Choose an available driver from the dropdown. Then select an available truck. Both lists only show drivers and trucks that are currently free.',
        tip: 'If a driver or truck is missing from the list, they may be already assigned to another delivery. Check their current status on the monitoring board.',
      },
      {
        title: 'Enter route details',
        body: 'Fill in the Origin, Destination, Client Name, and Pickup Location. The destination field supports a "From → To" format for routes with multiple stops.',
      },
      {
        title: 'Step 2 — Set schedule and notes',
        body: 'Enter the Delivery Date, Pickup Date, Pickup Time, and ETA. Add any special remarks for the driver.',
      },
      {
        title: 'Click "Assign Task"',
        body: 'Review the details and confirm. The driver will see the assignment immediately when they log in on their mobile device.',
        tip: 'You can view the assignment on the monitoring board as soon as it\'s created.',
      },
    ],
  },
  {
    id: 'monitor-deliveries',
    category: 'Monitor',
    title: 'Monitoring Active Deliveries',
    summary: 'Track the real-time status of all ongoing deliveries and driver activity.',
    icon: MonitorCheck,
    iconColor: 'text-green-600',
    iconBg: 'bg-green-100',
    tags: ['monitor', 'track', 'status', 'delivery', 'active', 'real-time'],
    steps: [
      {
        title: 'Open the Monitor page',
        body: 'Click "Monitor" in the sidebar. Each active assignment is displayed as a card showing the truck plate, driver name, route, and current status.',
      },
      {
        title: 'Understanding status badges',
        body: 'Each card shows a coloured status badge: Assigned (green) = task created; Picked Up (blue) = driver collected the goods; In Transit (amber) = delivery underway; Delivered (gray) = completed; Failed / Issue (red) = driver reported a problem.',
      },
      {
        title: 'View delivery details',
        body: 'Click "View Details" on any card to see the full trip record: route, documents, photos, timestamps, delay reports, and issue notes.',
      },
      {
        title: 'Search and filter',
        body: 'Use the search bar at the top to filter cards by truck plate, driver name, destination, client, or status.',
        tip: 'The monitoring board automatically refreshes every 12 seconds — no need to manually reload.',
      },
    ],
  },
  {
    id: 'review-documents',
    category: 'Documents',
    title: 'Reviewing and Approving Documents',
    summary: 'Approve or reject delivery documents submitted by drivers from the field.',
    icon: FileText,
    iconColor: 'text-amber-600',
    iconBg: 'bg-amber-100',
    tags: ['documents', 'approve', 'reject', 'pod', 'waybill', 'review'],
    steps: [
      {
        title: 'Go to Documents',
        body: 'Click "Documents" in the sidebar. You\'ll see a list of all assignments with their document submission status.',
      },
      {
        title: 'Find documents pending review',
        body: 'Assignments with amber "In Review" badges have documents awaiting your approval. Click on any row to expand and see individual document files.',
      },
      {
        title: 'Review each document',
        body: 'Click "View" to open the document photo in full size. Check that the document is legible, dated, and matches the delivery.',
      },
      {
        title: 'Approve or Reject',
        body: 'Click the green "Approve" button to accept. To reject, click "Reject" and enter a reason — this will notify the driver to resubmit.',
        warning: 'Rejections with clear reasons help drivers understand what needs to be fixed. Avoid vague rejection reasons.',
      },
      {
        title: 'Track document completion',
        body: 'The progress bar on each assignment shows how many of the required documents have been approved. A delivery is fully documented when all documents are approved.',
        tip: 'Required documents: Proof of Delivery, Receiving Acknowledgement, Dispatch Slip, Sales Invoice, Bill of Lading, Waybill / Delivery Receipt.',
      },
    ],
  },
  {
    id: 'view-reports',
    category: 'Reports',
    title: 'Using Reports & Analytics',
    summary: 'Understand your fleet performance metrics, on-time rates, and delay patterns.',
    icon: BarChart3,
    iconColor: 'text-rose-600',
    iconBg: 'bg-rose-100',
    tags: ['reports', 'analytics', 'performance', 'on-time', 'delay', 'export'],
    steps: [
      {
        title: 'Go to Reports',
        body: 'Click "Reports" in the sidebar. The page shows live performance metrics at the top, followed by detailed breakdowns for deliveries, delays, documents, and drivers.',
      },
      {
        title: 'Reading the KPI cards',
        body: 'The top stat cards show: Total Deliveries, On-Time Rate, Delay Incidents, and Active Assignments. The On-Time Rate shows "—" until at least one delivery is completed.',
      },
      {
        title: 'Exploring report sections',
        body: 'Each section (Delivery Summary, On-Time Analysis, Delay Reports, Document Review, Driver Performance) shows a preview table and can be exported as a CSV file.',
      },
      {
        title: 'Export a report',
        body: 'Click the download icon (FileDown) button on any report section to download a CSV file. Open it in Excel, Google Sheets, or any spreadsheet app.',
        tip: 'Use the Preview button (Eye icon) to review the data before exporting.',
      },
      {
        title: 'Delay Reason Breakdown',
        body: 'The Delay Reason chart shows which delay categories occur most frequently. If no delays have been reported, you\'ll see a placeholder chart — this is normal.',
      },
    ],
  },
  {
    id: 'driver-login',
    category: 'Drivers',
    title: 'Driver Login Instructions',
    summary: 'Step-by-step guide for drivers to log in to the mobile app.',
    icon: Phone,
    iconColor: 'text-indigo-600',
    iconBg: 'bg-indigo-100',
    tags: ['driver', 'login', 'mobile', 'pin', 'access'],
    steps: [
      {
        title: 'Open the 360 Logistics app',
        body: 'Drivers access the system from their mobile browser. The login screen shows a "Driver" tab by default.',
      },
      {
        title: 'Enter mobile number',
        body: 'Type the mobile number registered by the admin (e.g. 09XX XXX XXXX). This is the phone number the admin entered when creating your driver account.',
        tip: 'Make sure to use the exact mobile number that was registered — including the leading 0.',
      },
      {
        title: 'Enter 4-digit PIN',
        body: 'Tap each PIN box and enter your 4-digit PIN. Your admin will provide this when your account is created. You can ask them to regenerate it if forgotten.',
      },
      {
        title: 'Tap Login',
        body: 'If both the mobile number and PIN are correct, you\'ll be taken to your task dashboard immediately.',
      },
      {
        title: 'Forgot PIN?',
        body: 'Tap "Forgot PIN" below the login button. A message will appear reminding you to contact your admin, who can regenerate the PIN from the Accounts page.',
        warning: 'Drivers cannot reset their own PIN — only the admin can. Contact your dispatcher or admin to get a new one.',
      },
    ],
  },
  {
    id: 'driver-update-status',
    category: 'Drivers',
    title: 'How Drivers Update Delivery Status',
    summary: 'Guide for drivers on submitting status updates, photos, and documents from the field.',
    icon: Package,
    iconColor: 'text-orange-600',
    iconBg: 'bg-orange-100',
    tags: ['driver', 'status', 'update', 'photo', 'document', 'delivery'],
    steps: [
      {
        title: 'Log in and view your task',
        body: 'After logging in, you\'ll see your current assignment at the top of the screen — including pickup location, destination, client, and ETA.',
      },
      {
        title: 'Update your status',
        body: 'Tap the "Update Status" button. Select the new status from the flow: Picked Up → In Transit → Delivered. Each update may prompt you to add a photo and current location.',
        tip: 'Keep status updates timely — the admin monitors these in real time on the monitoring board.',
      },
      {
        title: 'Upload delivery photos',
        body: 'Some status steps require a photo (e.g. proof of pickup or delivery). Tap the camera icon to take or upload a photo directly from your phone.',
      },
      {
        title: 'Submit required documents',
        body: 'Go to the "Documents" section of your task. Tap each document type (e.g. Proof of Delivery) and upload a clear photo of the signed document.',
        warning: 'Make sure photos are clear and the text is readable. Blurry or incomplete documents will be rejected and you\'ll need to resubmit.',
      },
      {
        title: 'Report a delay or issue',
        body: 'If something goes wrong, use "Report Delay" or "Report Issue" from the task menu. Select a reason from the list and add details. The admin will be notified immediately.',
      },
    ],
  },
  {
    id: 'activity-log',
    category: 'Admin',
    title: 'Using the Activity Log',
    summary: 'Track all admin and CSR actions across the system in one consolidated log.',
    icon: ClipboardList,
    iconColor: 'text-gray-600',
    iconBg: 'bg-gray-100',
    tags: ['activity', 'log', 'audit', 'history', 'admin', 'csr'],
    steps: [
      {
        title: 'Open Activity Log',
        body: 'Click "Activity Log" in the left sidebar. All admin and CSR actions are recorded here — logins, task assignments, document approvals/rejections, and driver deletions.',
      },
      {
        title: 'Filter by action type',
        body: 'Use the filter chips at the top to narrow down to a specific action: Logins, Assignments, Completions, Cancellations, Approved, Rejected, or Deletions.',
      },
      {
        title: 'Search the log',
        body: 'Use the search bar to find activity by driver name, truck plate, document type, or admin email.',
      },
      {
        title: 'Reading log entries',
        body: 'Each entry shows the action type (coloured icon), a description of what happened, any associated truck plate or assignment ID as a chip, and the exact date and time.',
        tip: 'Every entry is tagged with the admin account that performed the action — making it easy to audit who did what.',
      },
    ],
  },
  {
    id: 'security',
    category: 'Admin',
    title: 'Account Security & Access Roles',
    summary: 'Understand the three admin roles and how access is controlled.',
    icon: Shield,
    iconColor: 'text-green-600',
    iconBg: 'bg-green-100',
    tags: ['security', 'roles', 'access', 'admin', 'operation manager', 'csr', 'viewer', 'permissions'],
    steps: [
      {
        title: 'Account roles',
        body: 'Admin (full access, reserved for system administration), Operation Manager (manages the team via Workspace Settings — invites CSR and Viewer accounts), CSR (full read/write — can create, edit, and assign tasks), and Viewer (read-only — can browse all data but cannot make changes).',
      },
      {
        title: 'Admin role',
        body: 'Admins have full control: register drivers and trucks, assign tasks, approve/reject documents, delete accounts, and reset data.',
      },
      {
        title: 'Operation Manager role',
        body: 'The Operation Manager has the same read-only access as a Viewer over deliveries, plus exclusive access to Workspace Settings, where they invite CSR and Viewer team members and review the company activity log.',
      },
      {
        title: 'CSR role',
        body: 'CSR accounts are invited individually by the Operation Manager in Workspace Settings. They have full read/write access — assigning tasks, approving documents — attributed to their own real login.',
      },
      {
        title: 'Viewer role',
        body: 'Viewers can see all pages but cannot make any changes. Invited by the Operation Manager for supervisors, auditors, or stakeholders who need read-only visibility.',
      },
      {
        title: 'Keeping accounts separate',
        body: 'Each CSR should use their own individual login, invited by the Operation Manager. Shared logins make it impossible to attribute actions in the Activity Log.',
        warning: 'Never share login credentials between staff. All actions are logged against the account that performed them.',
      },
    ],
  },
];

const CATEGORIES = ['All', ...Array.from(new Set(TOPICS.map((t) => t.category)))];

export default function HelpGuide() {
  const [search,      setSearch]      = useState('');
  const [category,    setCategory]    = useState('All');
  const [expandedId,  setExpandedId]  = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return TOPICS.filter((t) => {
      const matchesCat = category === 'All' || t.category === category;
      if (!q) return matchesCat;
      const matchesQ =
        t.title.toLowerCase().includes(q) ||
        t.summary.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.includes(q));
      return matchesCat && matchesQ;
    });
  }, [search, category]);

  const expanded = expandedId ? TOPICS.find((t) => t.id === expandedId) ?? null : null;

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Help &amp; Guide</h2>
          <p className="text-sm text-muted-foreground mt-1">Step-by-step instructions for using 360 Logistics</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-white border border-border rounded-lg px-3 py-1.5">
          <BookOpen className="w-3.5 h-3.5 text-primary" />
          <span>{TOPICS.length} guides available</span>
        </div>
      </div>

      {/* ── Search + category filter ── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setExpandedId(null); }}
            placeholder="Search guides by topic, keyword, or feature…"
            className="w-full pl-10 pr-9 py-3 bg-white border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 shadow-sm"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => { setCategory(cat); setExpandedId(null); }}
              className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors border whitespace-nowrap ${
                category === cat
                  ? 'bg-primary text-white border-primary shadow-sm'
                  : 'bg-white text-muted-foreground border-border hover:border-primary/40 hover:text-primary'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* ── Topic detail panel ── */}
      {expanded && (
        <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
          {/* Panel header */}
          <div className="flex items-start gap-4 p-6 border-b border-border">
            <div className={`${expanded.iconBg} ${expanded.iconColor} p-3 rounded-xl flex-shrink-0`}>
              <expanded.icon className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{expanded.category}</span>
              <h3 className="text-lg font-semibold text-foreground mt-0.5">{expanded.title}</h3>
              <p className="text-sm text-muted-foreground mt-1">{expanded.summary}</p>
            </div>
            <button
              onClick={() => setExpandedId(null)}
              className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-lg hover:bg-accent flex-shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Steps */}
          <div className="p-6 space-y-5">
            {expanded.steps.map((step, idx) => (
              <div key={idx} className="flex gap-4">
                {/* Step number */}
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center mt-0.5">
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0 pb-5 border-b border-border/60 last:border-0 last:pb-0">
                  <p className="text-sm font-semibold text-foreground mb-1">{step.title}</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">{step.body}</p>
                  {step.tip && (
                    <div className="mt-3 flex items-start gap-2 p-3 bg-blue-50 border border-blue-100 rounded-lg">
                      <Lightbulb className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-blue-700 leading-relaxed">{step.tip}</p>
                    </div>
                  )}
                  {step.warning && (
                    <div className="mt-3 flex items-start gap-2 p-3 bg-amber-50 border border-amber-100 rounded-lg">
                      <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-700 leading-relaxed">{step.warning}</p>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Done indicator */}
            <div className="flex items-center gap-2 pt-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <p className="text-xs text-muted-foreground">End of guide for: <span className="font-medium text-foreground">{expanded.title}</span></p>
            </div>
          </div>
        </div>
      )}

      {/* ── Topic grid ── */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-border p-16 text-center">
          <HelpCircle className="w-12 h-12 text-muted-foreground/25 mx-auto mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No guides found</p>
          <p className="text-xs text-muted-foreground/70 mt-1">Try a different keyword or clear your search.</p>
          <button
            onClick={() => { setSearch(''); setCategory('All'); }}
            className="mt-4 px-4 py-2 bg-muted text-foreground rounded-lg text-sm hover:bg-muted/80 transition-colors"
          >
            Show all guides
          </button>
        </div>
      ) : (
        <>
          {search && (
            <p className="text-sm text-muted-foreground -mt-2">
              <span className="font-semibold text-foreground">{filtered.length}</span> guide{filtered.length !== 1 ? 's' : ''} found for "<span className="font-semibold text-foreground">{search}</span>"
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((topic) => {
              const isOpen = expandedId === topic.id;
              return (
                <button
                  key={topic.id}
                  onClick={() => setExpandedId(isOpen ? null : topic.id)}
                  className={`group text-left bg-white rounded-2xl border shadow-sm p-5 transition-all hover:shadow-md hover:border-primary/30 ${
                    isOpen ? 'border-primary ring-2 ring-primary/15 shadow-md' : 'border-border'
                  }`}
                >
                  <div className="flex items-start gap-3 mb-3">
                    <div className={`${topic.iconBg} ${topic.iconColor} p-2.5 rounded-xl flex-shrink-0`}>
                      <topic.icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{topic.category}</span>
                      <p className="text-sm font-semibold text-foreground leading-tight mt-0.5 group-hover:text-primary transition-colors">{topic.title}</p>
                    </div>
                    <div className="flex-shrink-0 text-muted-foreground group-hover:text-primary transition-colors mt-0.5">
                      {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{topic.summary}</p>
                  <div className="mt-3 flex items-center gap-1 text-xs text-primary font-medium">
                    <ArrowRight className="w-3.5 h-3.5" />
                    <span>{topic.steps.length} steps</span>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* ── Footer tip ── */}
      <div className="flex items-start gap-3 p-4 bg-primary/5 border border-primary/15 rounded-xl">
        <Lightbulb className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-semibold text-foreground">Need more help?</span> Contact your system administrator or reach out to the 360 Logistics support team. You can also access this guide at any time from the account menu at the top right.
        </p>
      </div>

    </div>
  );
}
