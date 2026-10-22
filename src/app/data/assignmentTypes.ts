/* Shared types for assignments — used by both Admin and Driver views */

import { statusColors } from './statusColors';

export const DOCUMENT_TYPES = [
  'Proof of Delivery',
  'Receiving Acknowledgement Report',
  'Dispatch Slip',
  'Sales Invoice',
  'Bill of Lading',
  'Waybill / Delivery Receipt',
] as const;

/* ── Reading back a stored timestamp ──────────────────────────────────────────
   Notification timestamps and `completedAt` are stored as DISPLAY strings such as
   "Sep 19, 02:30 PM" (see timeLabel() in lib/db.ts). They carry NO year, and
   JavaScript defaults a missing year to 2001 — so passing one straight to
   new Date() made the dashboard's Recent activity read "Sep 19, 2001" and the
   monthly report group under "September 2001".

   This resolves a yearless stamp against the current year, stepping back a year
   when that would land in the future, so an event from last December read in
   January dates to last year rather than next year. Strings that already carry a
   year — a delivery date like "Sep 19, 2026", or an ISO timestamp — are trusted
   and returned as-is. Returns null when the string cannot be parsed at all. */
export function parseStoredTimestamp(ts: string): Date | null {
  if (!ts) return null;
  const parsed = new Date(ts);
  if (isNaN(parsed.getTime())) return null;
  if (/\d{4}/.test(ts)) return parsed;
  const now = new Date();
  parsed.setFullYear(now.getFullYear());
  /* A minute of slack absorbs small clock differences between stamp and now. */
  if (parsed.getTime() > now.getTime() + 60_000) parsed.setFullYear(now.getFullYear() - 1);
  return parsed;
}

export type TaskStatus = 'Assigned' | 'Picked Up' | 'In Transit' | 'Delivered' | 'Failed / Issue' | 'Cancelled';
export type DocStatus  = 'pending' | 'approved' | 'rejected';
export type OperationalStage = 'pickup_arrived' | 'loading' | 'loaded' | 'destination_arrived' | 'unloading' | 'unloaded';

export interface AssignmentDoc {
  type: string;
  uploaded: boolean;
  docStatus: DocStatus;
  fileUrl?: string;
  rejectReason?: string;
}

export interface StatusPhoto {
  url: string;
  timestamp: string;
  location: string;
  coords?: { lat: number; lng: number };
}

export interface DelayReport {
  type: 'pickup' | 'delivery';
  reason: string;
  reportedAt: string;
}

export interface Assignment {
  id: string;
  driverName: string;
  driverId: string;
  truckPlate: string;
  truckId: string;
  destination: string;
  /** General destination area; null for assignments created before this field existed. */
  destinationArea?: string | null;
  company: string;
  pickupLocation: string;
  /* REQ-005 exact selected stops (Mapbox). Latitude/longitude always come as a pair;
     null for assignments created before coordinates were stored — fall back to the
     address text (pickupLocation / getDeliveryLocation(destination)). Never invented. */
  pickupLatitude?: number | null;
  pickupLongitude?: number | null;
  /** Exact delivery address; null on older assignments, whose address lives inside `destination`. */
  deliveryLocation?: string | null;
  deliveryLatitude?: number | null;
  deliveryLongitude?: number | null;
  pickupTime: string;
  pickedUpDate: string;
  eta: string;
  ata: string;
  deliveryDate: string;
  remarks: string;
  taskStatus: TaskStatus;
  documents: AssignmentDoc[];
  assignedAt: string;
  /* REQ-002 server-owned progress. These values are read-only in the client. */
  operationalStage?: OperationalStage | null;
  pickupArrivedAt?: string | null;
  loadingStartedAt?: string | null;
  loadingCompletedAt?: string | null;
  /** Persisted reason for historical cancelled assignments (REQ-003). */
  cancelReason?: string | null;
  /** Read from the existing cancellation audit record for historical detail. */
  cancelledBy?: string | null;
  cancelledAt?: string | null;
  departedAt?: string | null;
  destinationArrivedAt?: string | null;
  unloadingStartedAt?: string | null;
  unloadingCompletedAt?: string | null;
  /* Driver-submitted data */
  statusPhotos?: Record<string, StatusPhoto>;
  issueReason?: string;
  delayReports?: DelayReport[];
  /* Set the moment the driver's app first displays this assignment — lets
     admin see whether a driver has actually seen a freshly assigned task. */
  driverAcknowledgedAt?: string;
  /* When the delivery was created — ISO timestamp from assignments.created_at (read-only,
     never written back). Used by the Deliveries table to sort and filter by time. */
  createdAt?: string;
}

export interface CompletedTask extends Assignment {
  completedAt: string;
  /** Full timestamp from the persisted task_completed audit event, when available. */
  completedEventAt?: string | null;
}

export interface LocalDriver {
  id: string;
  /* Read-only timestamp from drivers.created_at; excluded from save payloads. */
  createdAt?: string;
  name: string;
  phone: string;
  truckNumber: string;
  status: 'Assigned' | 'Pending' | 'Complete';
  currentLocation: string;
  deliveriesToday: number;
  rating: number;
  pin?: string;
  shift?: string;
  /* Set only on records in the Archived tab (archive_driver() database function) */
  archivedAt?: string;
}

export interface LocalTruck {
  id: string;
  plateNumber: string;
  status: 'Available' | 'Assigned';
  classification?: string;
  capacity?: string;
  /* Set only on records in the Archived tab (archive_truck() database function) */
  archivedAt?: string;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  password: string;
  role: 'csr' | 'viewer';
  status: 'active' | 'removed';
  invitedAt: string;
  lastActive?: string;
}

/* The one hardcoded Operation Manager account — mirrors supabase/functions/server/index.tsx's
   derived OM_EMAIL. Distinct from any Viewer-role team member (both share role: 'viewer'). */
export const OM_EMAIL = 'operationmanager@360logistics.ph';

/* Presentation-only "admin abuse" account — mirrors index.tsx. Unlocks
   demo-only overrides (e.g. simulating a late driver) in the admin UI,
   never available to the real admin/OM/CSR/Viewer accounts. */
export const DEMO_ADMIN_EMAIL = 'adminabuse@360logistics.ph';

/* Legacy task statuses share the same presentation colors as operational and
   document statuses. Picked Up intentionally aliases At Pickup. */
export const taskStatusConfig: Record<TaskStatus, { badge: string; dot: string; label: string }> = {
  'Assigned':       { ...statusColors.Assigned, label: 'Assigned' },
  'Picked Up':      { ...statusColors['Picked Up'], label: 'Picked Up' },
  'In Transit':     { ...statusColors['In Transit'], label: 'In Transit' },
  'Delivered':      { ...statusColors.Delivered, label: 'Delivered' },
  'Failed / Issue': { ...statusColors['Failed / Issue'], label: 'Failed / Issue' },
  'Cancelled':      { ...statusColors.Cancelled, label: 'Cancelled' },
};

/* Driver / truck availability as shown on screen. Display only — the stored values
   don't change: a driver is 'Assigned' | 'Pending' | 'Complete' (Pending and Complete
   both mean "not on a delivery"), a truck is 'Available' | 'Assigned'. */
export const availabilityConfig = {
  available:  { label: 'Available',   badge: 'bg-green-100 text-green-700 border-green-200', dot: 'bg-green-500' },
  onDelivery: { label: 'On Delivery', badge: 'bg-blue-100 text-blue-700 border-blue-200',   dot: 'bg-blue-500' },
} as const;

export const DRIVER_STATUS_FLOW: TaskStatus[] = [
  'Assigned', 'Picked Up', 'In Transit', 'Delivered', 'Failed / Issue',
];

export interface AppNotification {
  id: string;
  type: 'doc_upload' | 'status_update' | 'delay_report' | 'issue_report';
  message: string;
  assignmentId: string;
  driverName: string;
  truckPlate: string;
  docType?: string;
  statusUpdate?: string;
  photoUrl?: string;
  reason?: string;
  read: boolean;
  timestamp: string;
  /** Database event time; unlike the display label, this retains the year and timezone. */
  createdAt?: string;
  navigateTo?: string;
}

export type AdminRole = 'admin' | 'csr' | 'opm';

export type AdminActivityType =
  | 'login'
  | 'task_assigned'
  | 'task_completed'
  | 'task_cancelled'
  | 'task_edited'
  | 'doc_approved'
  | 'doc_rejected'
  | 'driver_deleted'
  | 'driver_archived'
  | 'truck_archived'
  | 'member_added'
  | 'member_removed'
  | 'password_reset_requested'
  | 'password_reset_approved'
  | 'password_reset_link_generated'
  | 'password_reset_rejected'
  | 'password_changed';

export interface AdminActivityEntry {
  id: string;
  type: AdminActivityType;
  timestamp: string;
  adminEmail?: string;
  adminRole?: string;
  driverName?: string;
  truckPlate?: string;
  assignmentId?: string;
  docType?: string;
  rejectReason?: string;
  destination?: string;
  company?: string;
  memberName?: string;
  memberEmail?: string;
  /* task_edited and task_cancelled — written by their database functions */
  reason?: string;
  changes?: Record<string, { old: string | null; new: string | null }>;
}

export type AdminActivityInput = Omit<AdminActivityEntry, 'id' | 'timestamp'>;
