import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  LogOut, Package, CheckCircle2, XCircle, Camera, WifiOff,
  Clock, MapPin, Truck, AlertTriangle, FileText, Building2,
  Calendar, ChevronRight, ChevronLeft, Lock, ArrowDown,
  RefreshCw, Timer, RotateCcw, X, Phone,
} from 'lucide-react';
import type { Assignment, TaskStatus, StatusPhoto, DocStatus } from '../../data/assignmentTypes';
import { taskStatusConfig } from '../../data/assignmentTypes';
import { SERVER } from '../../lib/supabaseClient';
import { publicAnonKey } from '/utils/supabase/info';

/* ── Types ── */
interface CompletedHistoryItem {
  id: string; destination: string; company: string;
  deliveryDate: string; completedAt: string; truckPlate: string; taskStatus: string;
}
interface DriverData {
  driver: { id: string; name: string; phone: string; status: string; currentLocation: string };
  assignment: Assignment | null;
  completedHistory?: CompletedHistoryItem[];
}
interface NormDoc {
  type: string; uploaded: boolean; docStatus: DocStatus; rejectReason?: string; fileUrl?: string;
}
interface DriverNotif {
  id: string; type: 'rejection' | 'approval'; title: string; body: string;
}

/* ── Constants ── */
const LINEAR_FLOW: TaskStatus[] = ['Assigned', 'Picked Up', 'In Transit', 'Delivered'];
const NEEDS_PHOTO: TaskStatus[] = ['Picked Up', 'In Transit'];

const REQUIRED_DOCS = [
  'Proof of Delivery',
  'Receiving Acknowledgement Report',
  'Dispatch Slip',
  'Sales Invoice',
  'Bill of Lading',
  'Waybill / Delivery Receipt',
];

const PICKUP_DELAY_REASONS   = ['Heavy traffic','Vehicle breakdown','Waiting for cargo','Weather conditions','Driver health issue','Other...'];
const DELIVERY_DELAY_REASONS = ['Heavy traffic','Wrong address / rerouting','Customer unavailable','Vehicle breakdown','Weather conditions','Other...'];
const ISSUE_REASONS          = ['Cargo damaged in transit','Wrong delivery address','Customer refused delivery','Vehicle breakdown','Cargo lost or missing','Accident / road incident','Other...'];

/* ── Mock data ── */
const MOCK_DATA: DriverData = {
  driver: { id: 'DRIVER-PREVIEW', name: 'Preview Driver', phone: '+1 555-0100', status: 'Active', currentLocation: 'Warehouse A' },
  assignment: {
    id: 'DEL-2026-0042', truckPlate: 'TRK-8847',
    destination: 'Industrial Compressor Units × 3', company: 'Apex Manufacturing Ltd.',
    pickupLocation: 'Warehouse A — Bay 4, Industrial Park Rd.',
    deliveryDate: new Date(Date.now() + 86_400_000).toISOString().split('T')[0],
    pickupTime: '09:00 AM', ata: '02:30 PM', eta: '01:45 PM',
    remarks: 'Handle with care. Fragile hydraulic seals inside.',
    taskStatus: 'In Transit' as TaskStatus, delayReports: [], statusPhotos: {}, documents: [],
  } as unknown as Assignment,
  completedHistory: [
    { id: 'DEL-2026-0038', destination: 'Office Furniture Set', company: 'TechCorp Solutions', deliveryDate: '2026-04-25', completedAt: 'Apr 25, 11:42 AM', truckPlate: 'TRK-8847', taskStatus: 'Delivered' },
    { id: 'DEL-2026-0031', destination: 'Medical Supplies × 50 boxes', company: 'City Hospital Group', deliveryDate: '2026-04-20', completedAt: 'Apr 20, 03:15 PM', truckPlate: 'TRK-8847', taskStatus: 'Delivered' },
  ],
};

/* ── Image helpers ── */
function compressImage(dataUrl: string, maxPx = 600, quality = 0.65): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const ratio  = Math.min(maxPx / img.width, maxPx / img.height, 1);
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width  * ratio);
      canvas.height = Math.round(img.height * ratio);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function uploadToStorage(dataUrl: string, path: string): Promise<string> {
  try {
    const res = await fetch(`${SERVER}/upload-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${publicAnonKey}` },
      body: JSON.stringify({ data: dataUrl, path }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { url } = await res.json();
    if (!url) throw new Error('No URL returned');
    return url as string;
  } catch (err) {
    console.warn('[uploadToStorage] failed, falling back to data-URL:', err);
    return dataUrl;
  }
}

/* ════════════════════════════════════════════════════════════
   SLIDE-TO-CONFIRM CONTROL
   ════════════════════════════════════════════════════════════ */
function SlideToConfirm({ label, onConfirm, disabled = false }: {
  label: string; onConfirm: () => void; disabled?: boolean;
}) {
  const [dragX,      setDragX]      = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [triggered,  setTriggered]  = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const startRef = useRef(0);

  const THUMB_W = 64;
  const PAD     = 4;

  const getMax = useCallback(() => (trackRef.current?.offsetWidth ?? 300) - THUMB_W - PAD * 2, []);

  const fire = useCallback(() => {
    setTriggered(true);
    setTimeout(() => { onConfirm(); setDragX(0); setTriggered(false); }, 380);
  }, [onConfirm]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || triggered) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    startRef.current = e.clientX - dragX;
    setIsDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setDragX(Math.max(0, Math.min(e.clientX - startRef.current, getMax())));
  };
  const onPointerUp = () => {
    if (!isDragging) return;
    setIsDragging(false);
    if (dragX >= getMax() * 0.82) fire();
    else setDragX(0);
  };

  return (
    <div
      ref={trackRef}
      className={`relative h-[68px] rounded-2xl overflow-hidden select-none ${
        disabled ? 'bg-gray-100' : triggered ? 'bg-green-200' : 'bg-green-100'
      }`}
    >
      {/* Fill */}
      {!disabled && !triggered && (
        <div
          className="absolute inset-y-0 left-0 bg-green-200 pointer-events-none"
          style={{ width: `${dragX + THUMB_W + PAD}px` }}
        />
      )}
      {/* Label */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span className={`text-base font-bold ${disabled ? 'text-gray-400' : 'text-green-900'}`}>
          {triggered ? 'Confirmed! ✓' : label}
        </span>
      </div>
      {/* Thumb */}
      {!disabled && (
        <div
          className="absolute top-[4px] bottom-[4px] flex items-center justify-center bg-green-700 rounded-xl shadow-lg cursor-grab active:cursor-grabbing"
          style={{
            left: `${dragX + PAD}px`,
            width: `${THUMB_W}px`,
            touchAction: 'none',
            transition: isDragging ? 'none' : 'left 0.3s cubic-bezier(0.4,0,0.2,1)',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {triggered
            ? <CheckCircle2 className="w-7 h-7 text-white" />
            : <ChevronRight className="w-7 h-7 text-white" />
          }
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   VERTICAL 6-STAGE TRACKER
   ════════════════════════════════════════════════════════════ */
function VerticalTracker({ stepIdx, isDelivered, uploadedCt, approvedCt, totalDocs }: {
  stepIdx: number; isDelivered: boolean;
  uploadedCt: number; approvedCt: number; totalDocs: number;
}) {
  type S = 'done' | 'current' | 'upcoming' | 'locked';
  const allApproved = totalDocs > 0 && approvedCt >= totalDocs;

  const stages: Array<{ label: string; status: S; sub?: string }> = [
    { label: 'Assigned',          status: 'done' },
    { label: 'Picked up',         status: stepIdx >= 1 ? 'done' : 'current' },
    { label: 'In transit',        status: stepIdx >= 2 ? 'done' : stepIdx === 1 ? 'current' : 'upcoming' },
    { label: 'Delivered',         status: stepIdx >= 3 ? 'done' : stepIdx === 2 ? 'current' : 'upcoming' },
    {
      label: 'Upload documents',
      status: !isDelivered ? 'locked' : allApproved ? 'done' : 'current',
      sub:   isDelivered && !allApproved ? `${uploadedCt} of ${totalDocs} submitted` : undefined,
    },
    {
      label: 'Complete',
      status: allApproved ? 'done' : 'upcoming',
      sub:   isDelivered && !allApproved ? 'Waiting for admin approval' : undefined,
    },
  ];

  return (
    <div>
      {stages.map((stage, i) => {
        const isLast   = i === stages.length - 1;
        const isDone   = stage.status === 'done';
        const isCurr   = stage.status === 'current';
        const isLocked = stage.status === 'locked';

        return (
          <div key={stage.label} className="flex gap-5">
            {/* Circle + connector */}
            <div className="flex flex-col items-center" style={{ width: 36, flexShrink: 0 }}>
              <div className={`w-9 h-9 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                isDone   ? 'bg-green-500 border-green-500' :
                isCurr   ? 'bg-white border-green-500 ring-4 ring-green-100' :
                isLocked ? 'bg-gray-50 border-gray-200' :
                           'bg-white border-gray-200'
              }`}>
                {isDone   ? <CheckCircle2 className="w-5 h-5 text-white" /> :
                 isCurr   ? <span className="w-3 h-3 bg-green-500 rounded-full animate-pulse" /> :
                 isLocked ? <Lock className="w-4 h-4 text-gray-300" /> :
                            <span className="text-sm font-bold text-gray-300">{i + 1}</span>}
              </div>
              {!isLast && (
                <div className={`w-0.5 flex-1 min-h-[32px] my-1.5 rounded-full ${isDone ? 'bg-green-400' : 'bg-gray-200'}`} />
              )}
            </div>

            {/* Text */}
            <div className={`flex-1 min-w-0 ${isLast ? 'pb-1' : 'pb-6'} mt-1`}>
              <p className={`text-base font-bold leading-tight ${
                isDone   ? 'text-green-700' :
                isCurr   ? 'text-gray-900' :
                isLocked ? 'text-gray-300' :
                           'text-gray-400'
              }`}>{stage.label}</p>
              {stage.sub && (
                <p className={`text-sm mt-1 leading-snug ${isCurr ? 'text-gray-500' : 'text-gray-400'}`}>{stage.sub}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   PHOTO CAPTURE SHEET (redesigned — receipt-style meta)
   ════════════════════════════════════════════════════════════ */
function PhotoSheet({ status, onConfirm, onCancel }: {
  status: TaskStatus; onConfirm: (photo: StatusPhoto) => void; onCancel: () => void;
}) {
  const cfg = taskStatusConfig[status];
  const [photo,      setPhoto]      = useState<string | null>(null);
  const [meta,       setMeta]       = useState<StatusPhoto | null>(null);
  const [locLoading, setLocLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const compressed = await compressImage(reader.result as string);
      setPhoto(compressed);
      const ts = new Date().toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
      setLocLoading(true);
      if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            const { latitude, longitude } = pos.coords;
            let locationLabel = `${latitude.toFixed(5)}° N, ${longitude.toFixed(5)}° E`;
            try {
              const res = await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=16&addressdetails=1`,
                { headers: { 'Accept-Language': 'en' } }
              );
              if (res.ok) {
                const data = await res.json();
                const addr = data.address ?? {};
                const parts: string[] = [];
                const road = addr.road || addr.amenity || addr.building;
                const area = addr.suburb || addr.village || addr.neighbourhood;
                const city = addr.city || addr.town || addr.municipality;
                if (road) parts.push(road);
                if (area) parts.push(area);
                if (city) parts.push(city);
                if (parts.length) locationLabel = parts.join(', ');
                else if (data.display_name) locationLabel = data.display_name.split(',').slice(0, 3).join(', ');
              }
            } catch { /* fallback to coords */ }
            setMeta({ url: compressed, timestamp: ts, location: locationLabel, coords: { lat: latitude, lng: longitude } });
            setLocLoading(false);
          },
          () => { setMeta({ url: compressed, timestamp: ts, location: 'Location unavailable' }); setLocLoading(false); },
          { timeout: 10000 }
        );
      } else {
        setMeta({ url: compressed, timestamp: ts, location: 'Location not supported' });
        setLocLoading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const canConfirm = !!meta && !locLoading;

  return (
    <div className="fixed inset-0 z-50 flex items-end">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative bg-white w-full rounded-t-3xl shadow-2xl animate-in slide-in-from-bottom duration-300 max-h-[90vh] flex flex-col">
        <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mt-3 mb-1 flex-shrink-0" />

        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between border-b border-gray-100 flex-shrink-0">
          <div>
            <h3 className="text-xl font-bold text-foreground">Take a Photo</h3>
            <p className="text-sm text-gray-500 mt-0.5">Required to confirm <strong>{cfg.label}</strong></p>
          </div>
          <button onClick={onCancel} className="w-11 h-11 bg-gray-100 rounded-full flex items-center justify-center">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          <input
            ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
          />

          {!photo ? (
            <button
              onClick={() => inputRef.current?.click()}
              className="w-full border-2 border-dashed border-gray-200 rounded-2xl py-16 flex flex-col items-center gap-4 bg-gray-50 active:bg-gray-100 transition-colors"
            >
              <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center">
                <Camera className="w-12 h-12 text-green-600" />
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-foreground">Open camera</p>
                <p className="text-base text-gray-400 mt-1">or choose from gallery</p>
              </div>
            </button>
          ) : (
            <>
              {/* Photo preview */}
              <div className="rounded-2xl overflow-hidden border border-gray-200 bg-black">
                <img src={photo} alt="Captured" className="w-full max-h-60 object-cover" />
              </div>

              {/* Retake */}
              <button
                onClick={() => { setPhoto(null); setMeta(null); }}
                className="flex items-center gap-2 text-base text-gray-500 font-semibold py-1"
              >
                <RotateCcw className="w-4 h-4" /> Retake photo
              </button>

              {/* Receipt-style meta */}
              {locLoading ? (
                <div className="bg-gray-50 border border-gray-200 rounded-2xl px-5 py-5 flex items-center gap-3">
                  <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                  <span className="text-base text-gray-500">Getting your location…</span>
                </div>
              ) : meta && (
                <div className="bg-green-50 border border-green-200 rounded-2xl px-5 py-5 space-y-4">
                  <div>
                    <p className="text-xs font-bold text-green-600 uppercase tracking-widest">Date &amp; Time</p>
                    <p className="text-lg font-bold text-foreground mt-1">{meta.timestamp}</p>
                  </div>
                  <div className="h-px bg-green-200" />
                  <div>
                    <p className="text-xs font-bold text-green-600 uppercase tracking-widest">Location</p>
                    <p className="text-lg font-bold text-foreground mt-1 break-words leading-snug">{meta.location}</p>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Confirm button */}
          <button
            disabled={!canConfirm}
            onClick={() => meta && onConfirm(meta)}
            className={`w-full py-5 rounded-2xl font-bold text-xl transition-all ${
              canConfirm
                ? 'bg-green-700 text-white active:bg-green-800 shadow-md'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            {!photo       ? 'Take a photo first'  :
             locLoading   ? 'Getting location…'    :
             'Confirm'}
          </button>
        </div>
        <div className="h-4 flex-shrink-0" />
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   REASON SHEET
   ════════════════════════════════════════════════════════════ */
function ReasonSheet({ title, subtitle, reasons, variant, onSubmit, onCancel }: {
  title: string; subtitle: string; reasons: string[];
  variant: 'amber' | 'red';
  onSubmit: (reason: string) => void; onCancel: () => void;
}) {
  const [selected, setSelected] = useState('');
  const [other,    setOther]    = useState('');
  const isOther = selected === 'Other...';
  const canSend = isOther ? other.trim().length > 0 : selected !== '';
  const btn     = variant === 'amber' ? 'bg-amber-500' : 'bg-red-600';

  return (
    <div className="fixed inset-0 z-50 flex items-end">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative bg-white w-full rounded-t-3xl shadow-2xl animate-in slide-in-from-bottom duration-300">
        <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mt-3 mb-1" />
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-xl font-bold text-foreground">{title}</h3>
          <p className="text-sm text-gray-400 mt-0.5">{subtitle}</p>
        </div>
        <div className="px-5 py-4 space-y-3">
          <select value={selected} onChange={(e) => setSelected(e.target.value)}
            className="w-full px-4 py-4 bg-gray-50 border border-gray-200 rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-primary/30">
            <option value="">Choose a reason…</option>
            {reasons.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          {isOther && (
            <textarea autoFocus value={other} onChange={(e) => setOther(e.target.value)}
              placeholder="Describe the situation…" rows={3}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-base resize-none focus:outline-none focus:ring-2 focus:ring-primary/30" />
          )}
        </div>
        <div className="px-5 pb-6 flex gap-3">
          <button onClick={onCancel} className="flex-1 py-4 border border-gray-200 rounded-2xl text-base font-semibold text-gray-600">
            Cancel
          </button>
          <button disabled={!canSend} onClick={() => onSubmit(isOther ? other.trim() : selected)}
            className={`flex-1 py-4 text-white rounded-2xl text-base font-bold transition-colors ${canSend ? btn : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>
            Submit
          </button>
        </div>
        <div className="h-4" />
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   DELIVERED CONFIRMATION SHEET
   ════════════════════════════════════════════════════════════ */
function DeliveredSheet({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative bg-white w-full rounded-t-3xl shadow-2xl animate-in slide-in-from-bottom duration-300 px-5 py-7 space-y-5">
        <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto -mt-3 mb-2" />
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-11 h-11 text-green-600" />
        </div>
        <div className="text-center space-y-2">
          <h3 className="text-2xl font-bold text-foreground">Confirm Delivery</h3>
          <p className="text-base text-gray-500">Mark this delivery as <strong>Delivered</strong>?<br />This cannot be undone.</p>
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={onCancel} className="flex-1 py-5 border border-gray-200 rounded-2xl text-base font-semibold text-gray-600">Not yet</button>
          <button onClick={onConfirm} className="flex-1 py-5 bg-green-700 text-white rounded-2xl text-base font-bold">Yes, Delivered!</button>
        </div>
        <div className="h-4" />
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   DOCUMENT ROW (redesigned)
   ════════════════════════════════════════════════════════════ */
function DocRow({ doc, onUpload, isDelivered }: {
  doc: NormDoc; onUpload: (type: string, file: File) => void; isDelivered: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isApproved  = doc.uploaded && doc.docStatus === 'approved';
  const isRejected  = doc.uploaded && doc.docStatus === 'rejected';
  const isPending   = doc.uploaded && doc.docStatus === 'pending';
  const canUpload   = isDelivered && (!doc.uploaded || isRejected);

  return (
    <div className={`rounded-2xl border p-4 space-y-3 ${
      isApproved  ? 'bg-green-50 border-green-200' :
      isRejected  ? 'bg-red-50 border-red-200' :
      isPending   ? 'bg-amber-50 border-amber-200' :
      !isDelivered? 'bg-gray-50 border-gray-100 opacity-60' :
                    'bg-white border-gray-200'
    }`}>
      <div className="flex items-start gap-3">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
          isApproved  ? 'bg-green-100' :
          isRejected  ? 'bg-red-100' :
          isPending   ? 'bg-amber-100' :
          !isDelivered? 'bg-gray-100' :
                        'bg-green-100'
        }`}>
          {!isDelivered ? <Lock className="w-5 h-5 text-gray-300" /> :
           isApproved   ? <CheckCircle2 className="w-6 h-6 text-green-600" /> :
           isRejected   ? <XCircle className="w-6 h-6 text-red-500" /> :
           isPending    ? <Clock className="w-6 h-6 text-amber-500" /> :
                          <Camera className="w-6 h-6 text-green-600" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-base font-semibold leading-snug ${!isDelivered ? 'text-gray-400' : 'text-foreground'}`}>
            {doc.type}
          </p>
          <p className={`text-sm mt-0.5 font-medium ${
            isApproved  ? 'text-green-700' :
            isRejected  ? 'text-red-600' :
            isPending   ? 'text-amber-600' :
            !isDelivered? 'text-gray-400' :
                          'text-green-700'
          }`}>
            {!isDelivered ? 'Available after delivery' :
             isApproved   ? 'Approved ✓' :
             isRejected   ? 'Rejected — new photo needed' :
             isPending    ? 'Submitted, waiting for review' :
                            'Tap to add photo →'}
          </p>
        </div>
      </div>

      {/* Rejection reason */}
      {isRejected && doc.rejectReason && (
        <div className="bg-red-100 rounded-xl px-4 py-3">
          <p className="text-sm text-red-700 leading-snug">
            <span className="font-bold">Reason: </span>{doc.rejectReason}
          </p>
        </div>
      )}

      {/* Upload button */}
      {canUpload && (
        <>
          <input
            ref={inputRef} type="file" accept="image/*,application/pdf" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(doc.type, f); e.target.value = ''; }}
          />
          <button
            onClick={() => inputRef.current?.click()}
            className={`w-full py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 ${
              isRejected ? 'bg-red-600 text-white active:bg-red-700' : 'bg-green-700 text-white active:bg-green-800'
            }`}
          >
            <Camera className="w-5 h-5" />
            {isRejected ? 'Retake and re-upload' : 'Take photo to upload'}
          </button>
        </>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   STATUS BADGE
   ════════════════════════════════════════════════════════════ */
function StatusBadge({ status }: { status: TaskStatus | string }) {
  const cfg = taskStatusConfig[status as TaskStatus] ?? { badge: 'bg-gray-100 text-gray-600 border-gray-200', dot: 'bg-gray-400', label: status };
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold border ${cfg.badge}`}>
      <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

/* ════════════════════════════════════════════════════════════
   DETAIL ROW (flat, always-visible)
   ════════════════════════════════════════════════════════════ */
function DetailRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="py-4 border-b border-gray-100 last:border-0">
      <p className="text-sm font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="text-lg font-semibold text-foreground mt-1 leading-snug break-words">{value}</p>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ════════════════════════════════════════════════════════════ */
interface Props { driverId: string; driverName: string; onLogout: () => void; }

export default function DriverInterface({ driverId, driverName, onLogout }: Props) {
  /* ── Server state ── */
  const [data,     setData]     = useState<DriverData | null>(null);
  const [online,   setOnline]   = useState(true);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [syncing,  setSyncing]  = useState(false);
  const [updating, setUpdating] = useState(false);

  /* ── Screen state: 'dashboard' or 'task' ── */
  const [screen, setScreen] = useState<'dashboard' | 'task'>('dashboard');

  /* ── Overlay sheet state ── */
  const [photoTarget,  setPhotoTarget]  = useState<TaskStatus | null>(null);
  const [deliveredDlg, setDeliveredDlg] = useState(false);
  const [delaySheet,   setDelaySheet]   = useState<'pickup' | 'delivery' | null>(null);
  const [issueSheet,   setIssueSheet]   = useState(false);
  const [logoutDlg,    setLogoutDlg]    = useState(false);

  /* ── Delay gate local flags ── */
  const [pickupDelayDone,   setPickupDelayDone]   = useState(false);
  const [deliveryDelayDone, setDeliveryDelayDone] = useState(false);

  /* ── Fetch data ── */
  const fetchData = useCallback(async (quiet = false) => {
    if (!driverId) return;
    if (!quiet) setSyncing(true);
    try {
      const res = await fetch(`${SERVER}/driver-data?driverId=${encodeURIComponent(driverId)}`, {
        headers: { 'Authorization': `Bearer ${publicAnonKey}` },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      setData(json); setOnline(true); setLastSync(new Date());
    } catch {
      setOnline(false);
      setData((prev) => prev ?? MOCK_DATA);
    } finally { setSyncing(false); }
  }, [driverId]);

  useEffect(() => {
    fetchData();
    const id = setInterval(() => fetchData(true), 5000);
    return () => clearInterval(id);
  }, [fetchData]);

  /* ── Push update ── */
  const pushUpdate = async (updates: Partial<Assignment>, notif?: Record<string, unknown>) => {
    const a = data?.assignment;
    if (!a) return;
    setUpdating(true);
    setData((prev) => prev ? { ...prev, assignment: { ...prev.assignment!, ...updates } } : prev);
    if (!online) { await new Promise((r) => setTimeout(r, 400)); setUpdating(false); return; }
    try {
      const res = await fetch(`${SERVER}/driver-update`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${publicAnonKey}` },
        body: JSON.stringify({ driverId, assignmentId: a.id, updates, notif }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      await fetchData(true);
    } catch { setOnline(false); }
    finally { setUpdating(false); }
  };

  /* ── Handlers ── */
  const handlePhotoConfirmed = async (photo: StatusPhoto) => {
    if (!photoTarget || !data?.assignment) return;
    const status = photoTarget; setPhotoTarget(null);
    const path      = `photos/${data.assignment.id}/${status.replace(/[\s/]+/g, '_')}_${Date.now()}.jpg`;
    const storedUrl = await uploadToStorage(photo.url, path);
    await pushUpdate(
      { taskStatus: status, statusPhotos: { ...(data.assignment.statusPhotos ?? {}), [status]: { ...photo, url: storedUrl } } },
      { type: 'status_update', message: `[${data.assignment.truckPlate}] Marked as ${taskStatusConfig[status].label}`, assignmentId: data.assignment.id, truckPlate: data.assignment.truckPlate, statusUpdate: status, photoUrl: storedUrl, navigateTo: 'Monitor' }
    );
  };

  const handleDelivered = async () => {
    if (!data?.assignment) return;
    setDeliveredDlg(false);
    await pushUpdate(
      { taskStatus: 'Delivered' },
      { type: 'status_update', message: `[${data.assignment.truckPlate}] Marked as Delivered`, assignmentId: data.assignment.id, truckPlate: data.assignment.truckPlate, statusUpdate: 'Delivered', navigateTo: 'Monitor' }
    );
  };

  const handleDelaySubmit = async (type: 'pickup' | 'delivery', reason: string) => {
    if (!data?.assignment) return;
    setDelaySheet(null);
    const reportedAt = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    await pushUpdate(
      { delayReports: [...(data.assignment.delayReports ?? []), { type, reason, reportedAt }] },
      { type: 'delay_report', message: `[${data.assignment.truckPlate}] ${type === 'pickup' ? 'Pickup' : 'Delivery'} delay: ${reason}`, assignmentId: data.assignment.id, truckPlate: data.assignment.truckPlate, reason, navigateTo: 'Monitor' }
    );
    if (type === 'pickup') setPickupDelayDone(true); else setDeliveryDelayDone(true);
  };

  const handleIssueSubmit = async (reason: string) => {
    if (!data?.assignment) return;
    setIssueSheet(false);
    await pushUpdate(
      { taskStatus: 'Failed / Issue', issueReason: reason },
      { type: 'issue_report', message: `[${data.assignment.truckPlate}] Issue: ${reason}`, assignmentId: data.assignment.id, truckPlate: data.assignment.truckPlate, reason, navigateTo: 'Monitor' }
    );
  };

  const handleDocUpload = async (docType: string, file: File) => {
    if (!data?.assignment) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const compressed = await compressImage(reader.result as string);
      let fileUrl = compressed;
      if (online) {
        const path = `docs/${data.assignment!.id}/${encodeURIComponent(docType.replace(/\s+/g, '_'))}_${Date.now()}.jpg`;
        fileUrl = await uploadToStorage(compressed, path);
      }
      await pushUpdate(
        { documents: data.assignment!.documents.map((d) => d.type === docType ? { ...d, uploaded: true, docStatus: 'pending' as DocStatus, fileUrl } : d) },
        { type: 'doc_upload', message: `[${data.assignment!.truckPlate}] "${docType}" uploaded`, assignmentId: data.assignment!.id, truckPlate: data.assignment!.truckPlate, docType, navigateTo: 'Documents' }
      );
    };
    reader.readAsDataURL(file);
  };

  /* ── Derived values ── */
  const a           = data?.assignment ?? null;
  const stepIdx     = a ? LINEAR_FLOW.indexOf(a.taskStatus as TaskStatus) : -1;
  const nextStatus  = stepIdx >= 0 && stepIdx < LINEAR_FLOW.length - 1 ? LINEAR_FLOW[stepIdx + 1] : null;
  const isDelivered = a?.taskStatus === 'Delivered';
  const isFailed    = a?.taskStatus === 'Failed / Issue';
  const isCancelled = a?.taskStatus === 'Cancelled';
  const isTerminal  = isDelivered || isFailed || isCancelled;

  /* Normalized docs (all 6 required, merged with actual data) */
  const normalizedDocs: NormDoc[] = useMemo(() => {
    if (!a) return [];
    return REQUIRED_DOCS.map((type) => {
      const found = a.documents?.find((d) => d.type === type);
      return found ?? { type, uploaded: false, docStatus: 'pending' as DocStatus };
    });
  }, [a]);

  const uploadedCt = normalizedDocs.filter((d) => d.uploaded).length;
  const approvedCt = normalizedDocs.filter((d) => d.docStatus === 'approved' && d.uploaded).length;

  /* Driver-facing notifications (derived from doc statuses) */
  const driverNotifs = useMemo((): DriverNotif[] => {
    const notifs: DriverNotif[] = [];
    normalizedDocs.forEach((doc) => {
      if (doc.uploaded && doc.docStatus === 'rejected') {
        notifs.push({
          id: `reject-${doc.type}`, type: 'rejection',
          title: `${doc.type} was rejected`,
          body: doc.rejectReason
            ? `Reason: "${doc.rejectReason}" — Please take a new photo and re-upload.`
            : 'Please re-upload a clearer photo.',
        });
      }
    });
    normalizedDocs.forEach((doc) => {
      if (doc.uploaded && doc.docStatus === 'approved') {
        notifs.push({
          id: `approve-${doc.type}`, type: 'approval',
          title: `${doc.type} approved ✓`,
          body: 'Your document has been reviewed and accepted.',
        });
      }
    });
    return notifs;
  }, [normalizedDocs]);

  /* Delay gates */
  const isPickupLate = (() => {
    if (!a || a.taskStatus !== 'Assigned' || isFailed) return false;
    try {
      const m = a.pickupTime?.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
      if (!m) return false;
      let h = parseInt(m[1]);
      if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
      if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
      const t = new Date(); t.setHours(h, parseInt(m[2]), 0, 0);
      return t < new Date();
    } catch { return false; }
  })();

  const isDeliveryLate = (() => {
    if (!a || a.taskStatus !== 'In Transit' || isFailed) return false;
    try {
      const m = a.ata?.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
      if (!m) return false;
      let h = parseInt(m[1]);
      if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
      if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
      const t = new Date(); t.setHours(h, parseInt(m[2]), 0, 0);
      return t < new Date();
    } catch { return false; }
  })();

  const hasPickupReport   = (a?.delayReports ?? []).some((r) => r.type === 'pickup');
  const hasDeliveryReport = (a?.delayReports ?? []).some((r) => r.type === 'delivery');
  const showPickupDelay   = isPickupLate   && !hasPickupReport   && !pickupDelayDone   && a?.taskStatus === 'Assigned';
  const showDeliveryDelay = isDeliveryLate && !hasDeliveryReport && !deliveryDelayDone && a?.taskStatus === 'In Transit';
  const blockSlider       = showPickupDelay || showDeliveryDelay;

  /* ────────────────────────────────────────────────────────
     LOADING / OFFLINE SPLASHES
  ──────────────────────────────────────────────────────── */
  if (!data && syncing) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-50 to-white flex flex-col items-center justify-center gap-5 px-6 text-center">
        <div className="w-14 h-14 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-xl font-bold text-foreground">Loading your tasks…</p>
        <p className="text-base text-gray-400">Welcome, {driverName}</p>
      </div>
    );
  }
  if (!data && !syncing) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-red-50 to-white flex flex-col items-center justify-center gap-5 px-6 text-center">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
          <WifiOff className="w-9 h-9 text-red-500" />
        </div>
        <div>
          <p className="text-xl font-bold text-foreground">No Connection</p>
          <p className="text-base text-gray-400 mt-1">Check your internet and try again.</p>
        </div>
        <button onClick={() => fetchData()} className="px-8 py-4 bg-green-700 text-white rounded-2xl font-bold text-base">Try Again</button>
        <button onClick={() => { setData(MOCK_DATA); setOnline(false); }} className="text-base text-primary underline font-medium">Preview with demo data</button>
        <button onClick={onLogout} className="text-base text-gray-400 underline">Log out</button>
      </div>
    );
  }

  /* ── Shared logout dialog ── */
  const LogoutDialog = logoutDlg && (
    <div className="fixed inset-0 z-50 flex items-end">
      <div className="absolute inset-0 bg-black/60" onClick={() => setLogoutDlg(false)} />
      <div className="relative bg-white w-full rounded-t-3xl p-6 space-y-5 animate-in slide-in-from-bottom duration-200">
        <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto -mt-2 mb-2" />
        <p className="text-2xl font-bold text-center text-foreground">Log out?</p>
        <p className="text-base text-gray-400 text-center">You'll be returned to the login screen.</p>
        <div className="flex gap-3">
          <button onClick={() => setLogoutDlg(false)} className="flex-1 py-5 border border-gray-200 rounded-2xl font-semibold text-base text-gray-600">Stay logged in</button>
          <button onClick={onLogout} className="flex-1 py-5 bg-red-600 text-white rounded-2xl font-bold text-base">Log Out</button>
        </div>
        <div className="h-4" />
      </div>
    </div>
  );

  /* ── Logout pill button (shared style) ── */
  const LogoutPill = (
    <button
      onClick={() => setLogoutDlg(true)}
      className="flex items-center gap-2 px-4 py-2.5 bg-gray-100 rounded-full border border-gray-200 text-sm font-bold text-gray-700 flex-shrink-0 active:bg-gray-200 transition-colors"
    >
      <LogOut className="w-4 h-4" />
      <span>Log out</span>
    </button>
  );

  /* ════════════════════════════════════════════════════════════
     DASHBOARD SCREEN
  ════════════════════════════════════════════════════════════ */
  if (screen === 'dashboard') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {/* Header */}
        <header className="bg-white border-b border-gray-200 px-5 py-4 sticky top-0 z-20 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-gray-400 font-bold uppercase tracking-widest leading-none">360 Logistics</p>
              <p className="text-2xl font-bold text-foreground mt-0.5 truncate">{driverName}</p>
            </div>
            {LogoutPill}
          </div>
        </header>

        {updating && <div className="h-1 bg-primary/20"><div className="h-full w-1/2 bg-primary animate-pulse rounded-full" /></div>}

        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-7 pb-10">

          {/* ── TODAY'S TASK ── */}
          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">Today's Task</h2>
            {a ? (
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                {/* Task header */}
                <div className="bg-gradient-to-r from-green-50 to-teal-50 px-5 py-3 flex items-center justify-between gap-2 border-b border-gray-100">
                  <span className="text-xs font-mono font-bold text-gray-400">{a.id}</span>
                  <StatusBadge status={a.taskStatus as TaskStatus} />
                </div>
                {/* Route */}
                <div className="px-5 py-5 space-y-4">
                  <div>
                    <p className="text-sm font-bold text-gray-400 uppercase tracking-wide">Pick up at</p>
                    <p className="text-lg font-bold text-foreground mt-1 leading-snug">{a.pickupLocation}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-gray-200" />
                    <ArrowDown className="w-5 h-5 text-gray-400 flex-shrink-0" />
                    <div className="flex-1 h-px bg-gray-200" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-400 uppercase tracking-wide">Deliver to</p>
                    <p className="text-lg font-bold text-green-700 mt-1 leading-snug">{a.company}</p>
                  </div>
                </div>
                {/* View task button */}
                <div className="px-5 pb-5">
                  <button
                    onClick={() => setScreen('task')}
                    className="w-full py-5 bg-green-700 text-white rounded-2xl font-bold text-xl flex items-center justify-center gap-3 active:bg-green-800 shadow-md"
                  >
                    View Task <ChevronRight className="w-6 h-6" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-200 p-9 text-center">
                <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Package className="w-9 h-9 text-blue-300" />
                </div>
                <p className="text-xl font-bold text-gray-500">No task assigned yet</p>
                <p className="text-base text-gray-400 mt-2 leading-relaxed">Check back later —<br />your admin will assign one soon.</p>
              </div>
            )}
          </section>

          {/* ── NOTIFICATIONS ── */}
          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">Notifications</h2>
            {driverNotifs.length > 0 ? (
              <div className="space-y-3">
                {driverNotifs.map((n) => (
                  <div key={n.id} className={`rounded-2xl border p-4 flex items-start gap-4 ${
                    n.type === 'rejection' ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'
                  }`}>
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      n.type === 'rejection' ? 'bg-red-100' : 'bg-green-100'
                    }`}>
                      {n.type === 'rejection'
                        ? <XCircle className="w-7 h-7 text-red-500" />
                        : <CheckCircle2 className="w-7 h-7 text-green-500" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-bold text-foreground">{n.title}</p>
                      <p className="text-sm text-gray-600 mt-1 leading-relaxed">{n.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-200 px-5 py-7 text-center">
                <p className="text-base text-gray-400">No new notifications</p>
              </div>
            )}
          </section>

          {/* ── TASK HISTORY ── */}
          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">Past Deliveries</h2>
            {(data?.completedHistory ?? []).length > 0 ? (
              <div className="space-y-3">
                {data!.completedHistory!.map((item) => (
                  <div key={item.id} className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-mono font-bold text-gray-400">{item.id}</span>
                      <span className="text-sm font-bold text-green-700 bg-green-50 border border-green-200 px-3 py-1 rounded-full flex-shrink-0">
                        Completed ✓
                      </span>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2.5">
                        <Truck className="w-5 h-5 text-gray-400 flex-shrink-0" />
                        <span className="text-base font-bold text-foreground">{item.truckPlate}</span>
                      </div>
                      <div className="flex items-start gap-2.5">
                        <MapPin className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />
                        <span className="text-base text-gray-600 leading-snug">{item.company}</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <Calendar className="w-5 h-5 text-gray-400 flex-shrink-0" />
                        <span className="text-base text-gray-500">{item.deliveryDate}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-200 px-5 py-7 text-center">
                <p className="text-base text-gray-400">No past deliveries yet</p>
              </div>
            )}
          </section>

          {/* Offline notice */}
          {!online && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-center gap-3">
              <WifiOff className="w-5 h-5 text-amber-500 flex-shrink-0" />
              <p className="text-sm text-amber-700 font-semibold">Offline — showing last saved data</p>
            </div>
          )}
        </div>

        {LogoutDialog}
      </div>
    );
  }

  /* ════════════════════════════════════════════════════════════
     TASK SCREEN
  ════════════════════════════════════════════════════════════ */
  const showSlider = a && !isTerminal && nextStatus && !updating;
  const sliderLabel = nextStatus
    ? `Slide to confirm ${taskStatusConfig[nextStatus]?.label.toLowerCase() ?? nextStatus}`
    : '';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* ── Task Header ── */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20 shadow-sm">
        <div className="px-4 py-3 flex items-center gap-3">
          {/* Back */}
          <button
            onClick={() => setScreen('dashboard')}
            className="flex items-center gap-1.5 text-gray-600 font-bold text-sm flex-shrink-0 py-1 pr-2"
          >
            <ChevronLeft className="w-5 h-5" /> Back
          </button>

          {/* Driver name + plate */}
          <div className="flex-1 min-w-0">
            <p className="text-base font-bold text-foreground truncate leading-tight">{driverName}</p>
            {a?.truckPlate && (
              <div className="flex items-center gap-1.5 mt-0.5">
                <Truck className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-sm text-gray-500 font-mono font-bold">{a.truckPlate}</span>
              </div>
            )}
          </div>

          {/* Live badge */}
          <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-bold flex-shrink-0 ${online ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
            <span className={`w-2 h-2 rounded-full ${online ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            {online ? 'Live' : 'Offline'}
          </div>

          {LogoutPill}
        </div>
      </header>

      {/* Update indicator */}
      {updating && <div className="h-1 bg-primary/20"><div className="h-full w-1/2 bg-primary animate-pulse rounded-full" /></div>}

      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5 pb-36">

        {/* No assignment edge case */}
        {!a && (
          <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center mt-4">
            <Package className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-lg font-bold text-gray-500">No active task</p>
            <button onClick={() => setScreen('dashboard')} className="mt-4 text-primary font-semibold text-base underline">
              Back to Dashboard
            </button>
          </div>
        )}

        {a && (
          <>
            {/* ── Route Summary ── */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-5 py-5 space-y-4">
              <div>
                <p className="text-sm font-bold text-gray-400 uppercase tracking-wide">Pick up at</p>
                <p className="text-xl font-bold text-foreground mt-1 leading-snug">{a.pickupLocation}</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-gray-200" />
                <ArrowDown className="w-5 h-5 text-gray-400 flex-shrink-0" />
                <div className="flex-1 h-px bg-gray-200" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-400 uppercase tracking-wide">Deliver to</p>
                <p className="text-xl font-bold text-green-700 mt-1 leading-snug">{a.company}</p>
              </div>
            </div>

            {/* ── Overdue warning ── */}
            {a.deliveryDate && !isDelivered && !isFailed && (() => {
              try {
                const d = new Date(a.deliveryDate); const today = new Date(); today.setHours(0,0,0,0);
                if (d < today) return (
                  <div className="bg-red-50 border border-red-200 rounded-2xl px-5 py-4 flex items-center gap-3">
                    <Timer className="w-6 h-6 text-red-500 flex-shrink-0" />
                    <div>
                      <p className="text-base font-bold text-red-700">Delivery Overdue</p>
                      <p className="text-sm text-red-500 mt-0.5">Due {new Date(a.deliveryDate).toLocaleDateString()}</p>
                    </div>
                  </div>
                );
              } catch { return null; }
              return null;
            })()}

            {/* ── Failed / Cancelled banner ── */}
            {(isFailed || isCancelled) && (
              <div className={`rounded-2xl px-5 py-4 flex items-start gap-3 ${isFailed ? 'bg-red-50 border border-red-200' : 'bg-gray-100 border border-gray-200'}`}>
                <AlertTriangle className={`w-6 h-6 flex-shrink-0 mt-0.5 ${isFailed ? 'text-red-500' : 'text-gray-400'}`} />
                <div>
                  <p className={`text-base font-bold ${isFailed ? 'text-red-700' : 'text-gray-600'}`}>
                    {isFailed ? 'Issue Reported' : 'Delivery Cancelled'}
                  </p>
                  {a.issueReason && <p className="text-sm text-gray-500 mt-0.5 leading-snug">{a.issueReason}</p>}
                </div>
              </div>
            )}

            {/* ── Delay prompts (when active) ── */}
            {showPickupDelay && (
              <div className="bg-amber-50 border-2 border-amber-400 rounded-2xl p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5 animate-pulse" />
                  <div>
                    <p className="text-lg font-bold text-amber-800">Pickup Time Passed</p>
                    <p className="text-base text-amber-600 mt-0.5">You need to report a reason before continuing.</p>
                  </div>
                </div>
                <button onClick={() => setDelaySheet('pickup')} className="w-full py-4 bg-amber-500 text-white rounded-2xl font-bold text-base">
                  Report Pickup Delay
                </button>
              </div>
            )}
            {showDeliveryDelay && (
              <div className="bg-amber-50 border-2 border-amber-400 rounded-2xl p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5 animate-pulse" />
                  <div>
                    <p className="text-lg font-bold text-amber-800">Delivery Time Passed</p>
                    <p className="text-base text-amber-600 mt-0.5">You need to report a reason before continuing.</p>
                  </div>
                </div>
                <button onClick={() => setDelaySheet('delivery')} className="w-full py-4 bg-amber-500 text-white rounded-2xl font-bold text-base">
                  Report Delivery Delay
                </button>
              </div>
            )}

            {/* ── Progress tracker (6 stages, vertical) ── */}
            {!isFailed && !isCancelled && (
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-5 py-5">
                <h3 className="text-base font-bold text-foreground mb-5">Delivery Progress</h3>
                <VerticalTracker
                  stepIdx={stepIdx}
                  isDelivered={isDelivered}
                  uploadedCt={uploadedCt}
                  approvedCt={approvedCt}
                  totalDocs={REQUIRED_DOCS.length}
                />
              </div>
            )}

            {/* ── Task Details (flat, always visible) ── */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-5 py-3">
              <h3 className="text-base font-bold text-foreground py-3 border-b border-gray-100 mb-1">Delivery Details</h3>
              <DetailRow label="Task ID"        value={a.id} />
              <DetailRow label="Truck"           value={a.truckPlate} />
              <DetailRow label="Cargo"           value={a.destination} />
              <DetailRow label="Pickup Date"     value={a.deliveryDate} />
              <DetailRow label="Pickup Time"     value={a.pickupTime} />
              <DetailRow label="Delivery Due"    value={a.ata ?? a.eta} />
              {a.pickedUpDate && <DetailRow label="Picked Up"    value={a.pickedUpDate} />}
              <DetailRow label="Instructions"   value={a.remarks} />
            </div>

            {/* ── Delay reports history ── */}
            {(a.delayReports ?? []).length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 space-y-3">
                <p className="text-sm font-bold text-amber-700 uppercase tracking-wide">Delay Reports</p>
                {a.delayReports!.map((r, i) => (
                  <div key={i} className="bg-white border border-amber-100 rounded-xl px-4 py-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-xs font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${r.type === 'pickup' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                        {r.type}
                      </span>
                      <span className="text-xs text-gray-400">{r.reportedAt}</span>
                    </div>
                    <p className="text-sm text-gray-600">{r.reason}</p>
                  </div>
                ))}
              </div>
            )}

            {/* ── Documents (always visible; locked until delivered) ── */}
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-xl font-bold text-foreground">Documents</h3>
                <span className="text-base text-gray-500 font-semibold">{approvedCt} of {REQUIRED_DOCS.length} approved</span>
              </div>
              {!isDelivered && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 flex items-center gap-3">
                  <Lock className="w-5 h-5 text-amber-500 flex-shrink-0" />
                  <p className="text-base text-amber-700 font-semibold">
                    Upload available after marking as <strong>Delivered</strong>
                  </p>
                </div>
              )}
              {normalizedDocs.map((doc) => (
                <DocRow key={doc.type} doc={doc} onUpload={handleDocUpload} isDelivered={isDelivered} />
              ))}
            </div>

            {/* ── Report a problem (subtle, away from slider) ── */}
            {!isTerminal && (
              <div className="px-1 pb-2">
                <button
                  onClick={() => setIssueSheet(true)}
                  className="flex items-center gap-2 text-sm text-red-400 font-semibold py-2"
                >
                  <AlertTriangle className="w-4 h-4" /> Having a problem? Report it here
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Sticky bottom action ── */}
      {a && !isTerminal && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 pt-4 pb-6 shadow-[0_-4px_20px_rgba(0,0,0,0.10)] z-20">
          {blockSlider ? (
            <SlideToConfirm label="Report the delay above first" onConfirm={() => {}} disabled />
          ) : (
            <SlideToConfirm
              label={updating ? 'Updating…' : sliderLabel}
              disabled={updating}
              onConfirm={() => {
                if (!nextStatus) return;
                if (nextStatus === 'Delivered')         setDeliveredDlg(true);
                else if (NEEDS_PHOTO.includes(nextStatus)) setPhotoTarget(nextStatus);
                else pushUpdate({ taskStatus: nextStatus });
              }}
            />
          )}
        </div>
      )}

      {/* ── Sheets / Modals ── */}
      {photoTarget  && <PhotoSheet    status={photoTarget}  onConfirm={handlePhotoConfirmed} onCancel={() => setPhotoTarget(null)} />}
      {deliveredDlg && <DeliveredSheet onConfirm={handleDelivered}     onCancel={() => setDeliveredDlg(false)} />}
      {delaySheet   && (
        <ReasonSheet
          title={delaySheet === 'pickup' ? 'Pickup Delay' : 'Delivery Delay'}
          subtitle="Select the reason for the delay"
          reasons={delaySheet === 'pickup' ? PICKUP_DELAY_REASONS : DELIVERY_DELAY_REASONS}
          variant="amber"
          onSubmit={(r) => handleDelaySubmit(delaySheet, r)}
          onCancel={() => setDelaySheet(null)}
        />
      )}
      {issueSheet && (
        <ReasonSheet
          title="Report a Problem"
          subtitle="What happened?"
          reasons={ISSUE_REASONS}
          variant="red"
          onSubmit={handleIssueSubmit}
          onCancel={() => setIssueSheet(false)}
        />
      )}
      {LogoutDialog}
    </div>
  );
}
