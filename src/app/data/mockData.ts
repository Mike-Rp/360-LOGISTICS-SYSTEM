export type DeliveryStatus = 'Pending' | 'In Transit' | 'Delivered' | 'Delayed' | 'Cancelled';

export interface Delivery {
  id: string;
  trackingNumber: string;
  driver: string;
  destination: string;
  origin: string;
  status: DeliveryStatus;
  estimatedDelivery: string;
  actualDelivery?: string;
  distance: string;
  priority: 'High' | 'Medium' | 'Low';
  customer: string;
  phone: string;
  cargo: string;
  weight: string;
}

export interface Driver {
  id: string;
  name: string;
  phone: string;
  truckNumber: string;
  status: 'Assigned' | 'Pending' | 'Complete';
  currentLocation: string;
  deliveriesToday: number;
  rating: number;
  pin: string;
}

export interface Document {
  id: string;
  type: 'POD' | 'Invoice' | 'Bill of Lading' | 'Customs';
  deliveryId: string;
  uploadedBy: string;
  uploadedAt: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  fileName: string;
  location?: string;
}

export interface Activity {
  id: string;
  timestamp: string;
  user: string;
  action: string;
  details: string;
}

export const mockDeliveries: Delivery[] = [
  {
    id: 'D001',
    trackingNumber: 'TRK-2026-001',
    driver: 'John Martinez',
    destination: 'Los Angeles, CA',
    origin: 'San Francisco, CA',
    status: 'In Transit',
    estimatedDelivery: '2026-02-05 14:30',
    distance: '380 miles',
    priority: 'High',
    customer: 'ABC Retail Corp',
    phone: '+1 (555) 123-4567',
    cargo: 'Electronics',
    weight: '2,500 lbs',
  },
  {
    id: 'D002',
    trackingNumber: 'TRK-2026-002',
    driver: 'Sarah Chen',
    destination: 'San Diego, CA',
    origin: 'Oakland, CA',
    status: 'Delivered',
    estimatedDelivery: '2026-02-05 10:00',
    actualDelivery: '2026-02-05 09:45',
    distance: '500 miles',
    priority: 'Medium',
    customer: 'Fresh Foods LLC',
    phone: '+1 (555) 234-5678',
    cargo: 'Perishable Goods',
    weight: '3,200 lbs',
  },
  {
    id: 'D003',
    trackingNumber: 'TRK-2026-003',
    driver: 'Mike Johnson',
    destination: 'Sacramento, CA',
    origin: 'San Jose, CA',
    status: 'Delayed',
    estimatedDelivery: '2026-02-05 12:00',
    distance: '120 miles',
    priority: 'High',
    customer: 'Tech Solutions Inc',
    phone: '+1 (555) 345-6789',
    cargo: 'Computer Hardware',
    weight: '1,800 lbs',
  },
  {
    id: 'D004',
    trackingNumber: 'TRK-2026-004',
    driver: 'Emily Davis',
    destination: 'Fresno, CA',
    origin: 'Palo Alto, CA',
    status: 'Pending',
    estimatedDelivery: '2026-02-05 16:00',
    distance: '170 miles',
    priority: 'Low',
    customer: 'General Supplies Co',
    phone: '+1 (555) 456-7890',
    cargo: 'Office Supplies',
    weight: '950 lbs',
  },
  {
    id: 'D005',
    trackingNumber: 'TRK-2026-005',
    driver: 'Robert Kim',
    destination: 'Bakersfield, CA',
    origin: 'Mountain View, CA',
    status: 'In Transit',
    estimatedDelivery: '2026-02-05 15:30',
    distance: '280 miles',
    priority: 'Medium',
    customer: 'Industrial Parts Ltd',
    phone: '+1 (555) 567-8901',
    cargo: 'Machinery Parts',
    weight: '4,100 lbs',
  },
  {
    id: 'D006',
    trackingNumber: 'TRK-2026-006',
    driver: 'Linda Torres',
    destination: 'Stockton, CA',
    origin: 'Sunnyvale, CA',
    status: 'Delivered',
    estimatedDelivery: '2026-02-05 11:00',
    actualDelivery: '2026-02-05 10:55',
    distance: '85 miles',
    priority: 'High',
    customer: 'Medical Equipment Inc',
    phone: '+1 (555) 678-9012',
    cargo: 'Medical Supplies',
    weight: '1,200 lbs',
  },
  {
    id: 'D007',
    trackingNumber: 'TRK-2026-007',
    driver: 'James Wilson',
    destination: 'Modesto, CA',
    origin: 'Fremont, CA',
    status: 'Cancelled',
    estimatedDelivery: '2026-02-05 13:00',
    distance: '95 miles',
    priority: 'Low',
    customer: 'Furniture Depot',
    phone: '+1 (555) 789-0123',
    cargo: 'Furniture',
    weight: '2,800 lbs',
  },
  {
    id: 'D008',
    trackingNumber: 'TRK-2026-008',
    driver: 'Maria Garcia',
    destination: 'Santa Rosa, CA',
    origin: 'Berkeley, CA',
    status: 'In Transit',
    estimatedDelivery: '2026-02-05 17:00',
    distance: '65 miles',
    priority: 'Medium',
    customer: 'Wine Distributors Co',
    phone: '+1 (555) 890-1234',
    cargo: 'Beverages',
    weight: '3,600 lbs',
  },
];

export const mockDrivers: Driver[] = [
  {
    id: 'DR001',
    name: 'John Martinez',
    phone: '+1 (555) 100-0001',
    truckNumber: 'TRK-101',
    status: 'Assigned',
    currentLocation: 'Los Angeles, CA',
    deliveriesToday: 3,
    rating: 4.8,
    pin: '4821',
  },
  {
    id: 'DR002',
    name: 'Sarah Chen',
    phone: '+1 (555) 100-0002',
    truckNumber: 'TRK-102',
    status: 'Complete',
    currentLocation: 'San Diego, CA',
    deliveriesToday: 2,
    rating: 4.9,
    pin: '7305',
  },
  {
    id: 'DR003',
    name: 'Mike Johnson',
    phone: '+1 (555) 100-0003',
    truckNumber: 'TRK-103',
    status: 'Assigned',
    currentLocation: 'Sacramento, CA',
    deliveriesToday: 1,
    rating: 4.5,
    pin: '2964',
  },
  {
    id: 'DR004',
    name: 'Emily Davis',
    phone: '+1 (555) 100-0004',
    truckNumber: 'TRK-104',
    status: 'Pending',
    currentLocation: 'Palo Alto, CA',
    deliveriesToday: 0,
    rating: 4.7,
    pin: '1537',
  },
  {
    id: 'DR005',
    name: 'Robert Kim',
    phone: '+1 (555) 100-0005',
    truckNumber: 'TRK-105',
    status: 'Assigned',
    currentLocation: 'Mountain View, CA',
    deliveriesToday: 2,
    rating: 4.6,
    pin: '6092',
  },
];

export const mockDocuments: Document[] = [
  {
    id: 'DOC001',
    type: 'POD',
    deliveryId: 'D002',
    uploadedBy: 'Sarah Chen',
    uploadedAt: '2026-02-05 09:50',
    status: 'Approved',
    fileName: 'pod_trk_2026_002.jpg',
    location: 'San Diego, CA',
  },
  {
    id: 'DOC002',
    type: 'POD',
    deliveryId: 'D006',
    uploadedBy: 'Linda Torres',
    uploadedAt: '2026-02-05 11:00',
    status: 'Pending',
    fileName: 'pod_trk_2026_006.jpg',
    location: 'Stockton, CA',
  },
  {
    id: 'DOC003',
    type: 'Invoice',
    deliveryId: 'D001',
    uploadedBy: 'John Martinez',
    uploadedAt: '2026-02-05 08:30',
    status: 'Approved',
    fileName: 'invoice_trk_2026_001.pdf',
  },
  {
    id: 'DOC004',
    type: 'Bill of Lading',
    deliveryId: 'D005',
    uploadedBy: 'Robert Kim',
    uploadedAt: '2026-02-05 10:15',
    status: 'Pending',
    fileName: 'bol_trk_2026_005.pdf',
  },
  {
    id: 'DOC005',
    type: 'POD',
    deliveryId: 'D003',
    uploadedBy: 'Mike Johnson',
    uploadedAt: '2026-02-05 12:45',
    status: 'Rejected',
    fileName: 'pod_trk_2026_003.jpg',
    location: 'Sacramento, CA',
  },
];

export const mockActivities: Activity[] = [
  {
    id: 'ACT001',
    timestamp: '2026-02-05 11:30',
    user: 'Sarah Chen',
    action: 'Document Upload',
    details: 'POD uploaded for TRK-2026-002',
  },
  {
    id: 'ACT002',
    timestamp: '2026-02-05 11:15',
    user: 'Admin',
    action: 'Status Update',
    details: 'Approved document DOC001',
  },
  {
    id: 'ACT003',
    timestamp: '2026-02-05 10:45',
    user: 'Mike Johnson',
    action: 'Status Update',
    details: 'Delivery D003 marked as Delayed',
  },
  {
    id: 'ACT004',
    timestamp: '2026-02-05 10:30',
    user: 'John Martinez',
    action: 'Status Update',
    details: 'Delivery D001 status updated to In Transit',
  },
  {
    id: 'ACT005',
    timestamp: '2026-02-05 10:00',
    user: 'Linda Torres',
    action: 'Delivery Complete',
    details: 'Delivery D006 completed successfully',
  },
  {
    id: 'ACT006',
    timestamp: '2026-02-05 09:50',
    user: 'Sarah Chen',
    action: 'Delivery Complete',
    details: 'Delivery D002 completed successfully',
  },
  {
    id: 'ACT007',
    timestamp: '2026-02-05 09:30',
    user: 'Admin',
    action: 'Driver Assignment',
    details: 'Assigned Emily Davis to delivery D004',
  },
  {
    id: 'ACT008',
    timestamp: '2026-02-05 09:00',
    user: 'Robert Kim',
    action: 'Delivery Started',
    details: 'Started delivery D005',
  },
];

export const weeklyDeliveryData = [
  { day: 'Mon', delivered: 45, inTransit: 18, pending: 8,  delayed: 4,  cancelled: 3 },
  { day: 'Tue', delivered: 52, inTransit: 14, pending: 11, delayed: 6,  cancelled: 2 },
  { day: 'Wed', delivered: 48, inTransit: 21, pending: 7,  delayed: 9,  cancelled: 5 },
  { day: 'Thu', delivered: 58, inTransit: 16, pending: 13, delayed: 3,  cancelled: 1 },
  { day: 'Fri', delivered: 38, inTransit: 22, pending: 9,  delayed: 7,  cancelled: 4 },
  { day: 'Sat', delivered: 25, inTransit: 9,  pending: 5,  delayed: 5,  cancelled: 2 },
  { day: 'Sun', delivered: 15, inTransit: 5,  pending: 3,  delayed: 2,  cancelled: 1 },
];

export const statusBreakdown = [
  { name: 'Delivered',  value: 45, color: '#10b981' },
  { name: 'In Transit', value: 28, color: '#3b82f6' },
  { name: 'Pending',    value: 18, color: '#eab308' },
  { name: 'Delayed',    value: 12, color: '#ef4444' },
  { name: 'Cancelled',  value: 4,  color: '#6b7280' },
];