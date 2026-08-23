/* Shared types for assignments — used by both Admin and Driver views */

export const DOCUMENT_TYPES = [
  'Proof of Delivery',
  'Receiving Acknowledgement Report',
  'Dispatch Slip',
  'Sales Invoice',
  'Bill of Lading',
  'Waybill / Delivery Receipt',
] as const;

export type TaskStatus = 'Assigned' | 'Picked Up' | 'In Transit' | 'Delivered' | 'Failed / Issue' | 'Cancelled';
export type DocStatus  = 'pending' | 'approved' | 'rejected';

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
  company: string;
  pickupLocation: string;
  pickupTime: string;
  pickedUpDate: string;
  eta: string;
  ata: string;
  deliveryDate: string;
  remarks: string;
  taskStatus: TaskStatus;
  documents: AssignmentDoc[];
  assignedAt: string;
  /* Driver-submitted data */
  statusPhotos?: Record<string, StatusPhoto>;
  issueReason?: string;
  delayReports?: DelayReport[];
}

export interface CompletedTask extends Assignment {
  completedAt: string;
}

export interface LocalDriver {
  id: string;
  name: string;
  phone: string;
  truckNumber: string;
  status: 'Assigned' | 'Pending' | 'Complete';
  currentLocation: string;
  deliveriesToday: number;
  rating: number;
  pin?: string;
  shift?: string;
}

export interface LocalTruck {
  id: string;
  plateNumber: string;
  status: 'Available' | 'Assigned';
  classification?: string;
  capacity?: string;
}

/* dot = small colored circle (used inline, no emoji circles) */
export const taskStatusConfig: Record<TaskStatus, { badge: string; dot: string; label: string }> = {
  'Assigned':       { badge: 'bg-green-100 text-green-700 border-green-200',   dot: 'bg-green-500',   label: 'Assigned' },
  'Picked Up':      { badge: 'bg-blue-100 text-blue-700 border-blue-200',      dot: 'bg-blue-500',    label: 'Picked Up' },
  'In Transit':     { badge: 'bg-amber-100 text-amber-700 border-amber-200',   dot: 'bg-amber-400',   label: 'In Transit' },
  'Delivered':      { badge: 'bg-gray-100 text-gray-600 border-gray-200',      dot: 'bg-gray-400',    label: 'Delivered' },
  'Failed / Issue': { badge: 'bg-red-100 text-red-700 border-red-200',         dot: 'bg-red-500',     label: 'Failed / Issue' },
  'Cancelled':      { badge: 'bg-gray-100 text-gray-600 border-gray-200',      dot: 'bg-gray-400',    label: 'Cancelled' },
};

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
  navigateTo?: string;
}

export type AdminRole = 'admin' | 'demo' | 'viewer';

export type AdminActivityType =
  | 'login'
  | 'task_assigned'
  | 'task_completed'
  | 'task_cancelled'
  | 'doc_approved'
  | 'doc_rejected'
  | 'driver_deleted';

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
}

export type AdminActivityInput = Omit<AdminActivityEntry, 'id' | 'timestamp'>;