import { useState } from 'react';
import {
  Users, Truck, Plus, Eye, EyeOff, RefreshCw,
  CheckCircle2, Shield, KeyRound, Phone,
  Package, Weight, Trash2, AlertTriangle,
} from 'lucide-react';
import type { LocalDriver, LocalTruck, AdminRole, AdminActivityInput } from '../../data/assignmentTypes';
import { RegisterDriverModal, RegisterTruckModal } from './RegisterModals';

/* ── Helpers ── */
const generatePin = () => String(Math.floor(1000 + Math.random() * 9000));

/* "Assigned" = driver has an active task → Unavailable; everything else → Available */
const isAvailable = (status: string) => status !== 'Assigned';

/* ── PIN Cell — hold eye to reveal, auto-hides on release/mouse-leave ── */
function PinCell({ pin }: { pin?: string }) {
  const [visible, setVisible] = useState(false);
  if (!pin) return <span className="text-xs text-muted-foreground italic">No PIN</span>;
  return (
    <div className="flex items-center gap-2">
      <span
        className="font-mono tracking-widest text-sm select-none w-10"
        style={visible ? { color: 'inherit' } : { color: 'transparent', textShadow: '0 0 8px rgba(0,0,0,0.35)' }}
      >
        {visible ? pin : '••••'}
      </span>
      <button
        onMouseDown={() => setVisible(true)}
        onMouseUp={() => setVisible(false)}
        onMouseLeave={() => setVisible(false)}
        onTouchStart={() => setVisible(true)}
        onTouchEnd={() => setVisible(false)}
        className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors select-none cursor-pointer"
        title="Hold to reveal PIN"
      >
        {visible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

/* ── Props ── */
interface Props {
  drivers: LocalDriver[];
  setDrivers: React.Dispatch<React.SetStateAction<LocalDriver[]>>;
  trucks: LocalTruck[];
  setTrucks: React.Dispatch<React.SetStateAction<LocalTruck[]>>;
  isViewOnly?: boolean;
  onResetAll?: () => Promise<void>;
  adminRole?: AdminRole | null;
  savingToDb?: boolean;
  onLogActivity?: (entry: AdminActivityInput) => void;
}

const ROLE_LABEL: Record<string, string> = {
  admin:  'Admin',
  demo:   'Demo',
  viewer: 'View only',
};

type TabView = 'Drivers' | 'Trucks';

export default function AccountsPanel({ drivers, setDrivers, trucks, setTrucks, isViewOnly = false, onResetAll, adminRole, savingToDb, onLogActivity }: Props) {
  const [tab, setTab] = useState<TabView>('Drivers');

  /* ── Reset All confirmation state ── */
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetLoading,     setResetLoading]     = useState(false);
  const [resetDone,        setResetDone]        = useState(false);

  const handleConfirmReset = async () => {
    setResetLoading(true);
    try {
      await onResetAll?.();
      setResetDone(true);
      setTimeout(() => {
        setShowResetConfirm(false);
        setResetDone(false);
      }, 2000);
    } finally {
      setResetLoading(false);
    }
  };

  /* ── Register Driver / Truck modals (shared components) ── */
  const [showAddDriver, setShowAddDriver] = useState(false);
  const [showAddTruck,  setShowAddTruck]  = useState(false);

  /* ── Delete driver state ── */
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const handleDeleteDriver = () => {
    if (!deleteTarget) return;
    setDrivers((p) => p.filter((d) => d.id !== deleteTarget.id));
    onLogActivity?.({ type: 'driver_deleted', driverName: deleteTarget.name });
    setDeleteTarget(null);
  };

  /* ── Handlers: drivers ── */
  const handleRegeneratePinFor = (id: string) =>
    setDrivers((p) => p.map((d) => d.id === id ? { ...d, pin: generatePin() } : d));

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Accounts</h2>
          <p className="text-sm text-muted-foreground mt-1">Register drivers with PINs and manage truck fleet</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Reset All Data — only for non-viewer */}
          {!isViewOnly && onResetAll && (
            <button
              onClick={() => setShowResetConfirm(true)}
              className="flex items-center gap-2 px-3.5 py-2 bg-red-50 text-red-600 border border-red-200 rounded-xl hover:bg-red-100 transition-colors text-sm"
            >
              <Trash2 className="w-4 h-4" />
              Reset All Data
            </button>
          )}
          <div className="flex items-center bg-muted/40 border border-border rounded-xl p-1 gap-1">
            {(['Drivers', 'Trucks'] as TabView[]).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  tab === t
                    ? 'bg-white shadow-sm text-foreground border border-border'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t === 'Drivers' ? <Users className="w-4 h-4" /> : <Truck className="w-4 h-4" />}
                {t}
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                  tab === t ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                }`}>
                  {t === 'Drivers' ? drivers.length : trucks.length}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ══ RESET CONFIRM MODAL ══ */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !resetLoading && setShowResetConfirm(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col items-center gap-4">
            {resetDone ? (
              <>
                <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle2 className="w-7 h-7 text-green-600" />
                </div>
                <p className="text-base font-semibold text-foreground">All Data Cleared</p>
                <p className="text-sm text-muted-foreground text-center">Drivers, trucks, assignments, and history have been removed from the database.</p>
              </>
            ) : (
              <>
                <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
                  <AlertTriangle className="w-7 h-7 text-red-600" />
                </div>
                <div className="text-center space-y-1.5">
                  <p className="text-base font-semibold text-foreground">Reset All Data?</p>
                  <p className="text-sm text-muted-foreground">
                    This will permanently delete all <span className="font-medium text-foreground">drivers</span>, <span className="font-medium text-foreground">trucks</span>, <span className="font-medium text-foreground">assignments</span>, and history from the database.
                  </p>
                  <p className="text-xs text-red-500 font-medium pt-1">Admin accounts are NOT affected. This cannot be undone.</p>
                </div>
                <div className="flex gap-3 w-full pt-1">
                  <button
                    onClick={() => setShowResetConfirm(false)}
                    disabled={resetLoading}
                    className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors text-sm font-medium disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmReset}
                    disabled={resetLoading}
                    className="flex-1 py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors text-sm font-medium disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {resetLoading
                      ? <><RefreshCw className="w-4 h-4 animate-spin" /> Resetting…</>
                      : <><Trash2 className="w-4 h-4" /> Yes, Reset</>}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ════ DRIVERS TAB ════ */}
      {tab === 'Drivers' && (
        <div className="space-y-4">
          {/* Bar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                <span>{drivers.filter((d) => isAvailable(d.status)).length} Available</span>
              </div>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />
                <span>{drivers.filter((d) => !isAvailable(d.status)).length} Unavailable</span>
              </div>
            </div>
            {!isViewOnly && (
              <button onClick={() => setShowAddDriver(true)}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors text-sm">
                <Plus className="w-4 h-4" /> Register Driver
              </button>
            )}
          </div>

          {/* Empty state */}
          {drivers.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-border p-16 text-center">
              <div className="w-16 h-16 bg-muted/50 rounded-full flex items-center justify-center mx-auto mb-4">
                <Users className="w-8 h-8 text-muted-foreground/40" />
              </div>
              <p className="font-medium text-foreground mb-1">No Drivers Registered Yet</p>
              <p className="text-sm text-muted-foreground mb-5">Register a driver to generate their login PIN.</p>
              {!isViewOnly && (
                <button onClick={() => setShowAddDriver(true)}
                  className="px-5 py-2.5 bg-primary text-white rounded-lg text-sm hover:bg-primary/90 transition-colors">
                  + Register Driver
                </button>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
              {/* Table head */}
              <div className="grid grid-cols-[minmax(160px,2fr)_minmax(130px,1.5fr)_120px_115px_auto] gap-3 px-5 py-3 bg-muted/30 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wide min-w-[600px]">
                <span>Driver</span>
                <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> Contact</span>
                <span>Availability</span>
                <span className="flex items-center gap-1"><KeyRound className="w-3.5 h-3.5" /> PIN</span>
                {!isViewOnly && <span>Action</span>}
              </div>
              {/* Table rows */}
              <div className="divide-y divide-border">
                {drivers.map((d) => {
                  const avail = isAvailable(d.status);
                  return (
                    <div key={d.id}
                      className="grid grid-cols-[minmax(160px,2fr)_minmax(130px,1.5fr)_120px_115px_auto] gap-3 items-center px-5 py-4 hover:bg-muted/10 transition-colors min-w-[600px]">
                      {/* Name */}
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 bg-[#0d9488]/15 rounded-full flex items-center justify-center flex-shrink-0 border border-[#0d9488]/20">
                          <Users className="w-4 h-4 text-[#0d9488]" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{d.name}</p>
                          <p className="text-xs text-muted-foreground">{d.id}</p>
                        </div>
                      </div>

                      {/* Contact / Phone */}
                      <div className="min-w-0">
                        {d.phone && d.phone !== '—' ? (
                          <a href={`tel:${d.phone}`}
                            className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 hover:underline transition-colors font-medium truncate"
                            title={`Call ${d.name}`}>
                            <Phone className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate">{d.phone}</span>
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">No number</span>
                        )}
                      </div>

                      {/* Available / Unavailable badge */}
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-medium w-fit ${
                        avail
                          ? 'bg-green-100 text-green-700 border-green-200'
                          : 'bg-red-100 text-red-600 border-red-200'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${avail ? 'bg-green-500' : 'bg-red-400'}`} />
                        {avail ? 'Available' : 'Unavailable'}
                      </span>

                      {/* PIN */}
                      <PinCell pin={d.pin} />

                      {/* Actions — hidden for view-only */}
                      {!isViewOnly && (
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleRegeneratePinFor(d.id)}
                            title="Regenerate PIN"
                            className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors whitespace-nowrap"
                          >
                            <RefreshCw className="w-3.5 h-3.5" /> New PIN
                          </button>
                          <button
                            onClick={() => setDeleteTarget({ id: d.id, name: d.name })}
                            title="Delete Driver"
                            className="flex items-center gap-1.5 px-3 py-1.5 border border-red-200 rounded-lg text-xs text-red-500 hover:bg-red-50 hover:text-red-600 hover:border-red-300 transition-colors whitespace-nowrap"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Delete
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              </div>{/* end overflow-x-auto */}
            </div>
          )}

          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5" />
            Status is <strong className="text-red-500">Unavailable</strong> when the driver has an active task. Hold the eye icon to reveal a PIN.
          </p>
        </div>
      )}

      {/* ════ TRUCKS TAB ════ */}
      {tab === 'Trucks' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Truck className="w-4 h-4 text-green-500" />
                <span>{trucks.filter((t) => t.status === 'Available').length} Available</span>
              </div>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Truck className="w-4 h-4 text-red-400" />
                <span>{trucks.filter((t) => t.status === 'Assigned').length} Unavailable</span>
              </div>
            </div>
            {!isViewOnly && (
              <button onClick={() => setShowAddTruck(true)}
                className="flex items-center gap-2 px-4 py-2 bg-secondary text-white rounded-lg hover:bg-secondary/90 transition-colors text-sm">
                <Plus className="w-4 h-4" /> Register Truck
              </button>
            )}
          </div>

          {trucks.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-border p-16 text-center">
              <div className="w-16 h-16 bg-muted/50 rounded-full flex items-center justify-center mx-auto mb-4">
                <Truck className="w-8 h-8 text-muted-foreground/40" />
              </div>
              <p className="font-medium text-foreground mb-1">No Trucks Registered Yet</p>
              <p className="text-sm text-muted-foreground mb-5">Register trucks so they can be assigned to deliveries.</p>
              {!isViewOnly && (
                <button onClick={() => setShowAddTruck(true)}
                  className="px-5 py-2.5 bg-secondary text-white rounded-lg text-sm hover:bg-secondary/90 transition-colors">
                  + Register Truck
                </button>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
              <div className="grid grid-cols-[minmax(140px,1.2fr)_minmax(160px,1.5fr)_minmax(170px,1.5fr)_130px] gap-4 px-5 py-3 bg-muted/30 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wide min-w-[560px]">
                <span>Plate Number</span>
                <span className="flex items-center gap-1"><Package className="w-3.5 h-3.5" /> Classification</span>
                <span className="flex items-center gap-1"><Weight className="w-3.5 h-3.5" /> Payload Capacity</span>
                <span>Status</span>
              </div>
              <div className="divide-y divide-border">
                {trucks.map((t) => (
                  <div key={t.id}
                    className="grid grid-cols-[minmax(140px,1.2fr)_minmax(160px,1.5fr)_minmax(170px,1.5fr)_130px] gap-4 items-center px-5 py-4 hover:bg-muted/10 transition-colors min-w-[560px]">
                    {/* Plate */}
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-[#0d9488]/15 rounded-full flex items-center justify-center flex-shrink-0 border border-[#0d9488]/20">
                        <Truck className="w-4 h-4 text-[#0d9488]" />
                      </div>
                      <div>
                        <p className="font-mono font-semibold text-foreground tracking-wider">{t.plateNumber}</p>
                        <p className="text-xs text-muted-foreground">{t.id}</p>
                      </div>
                    </div>
                    {/* Classification */}
                    <div>
                      {t.classification ? (
                        <span className="text-sm text-foreground font-medium">{t.classification}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">—</span>
                      )}
                    </div>
                    {/* Capacity */}
                    <div>
                      {t.capacity ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-full">
                          <Weight className="w-3 h-3" /> {t.capacity}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">—</span>
                      )}
                    </div>
                    {/* Status */}
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-medium w-fit ${t.status === 'Available' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-red-100 text-red-600 border-red-200'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${t.status === 'Available' ? 'bg-green-500' : 'bg-red-400'}`} />
                      {t.status === 'Available' ? 'Available' : 'Unavailable'}
                    </span>
                  </div>
                ))}
              </div>
              </div>{/* end overflow-x-auto */}
            </div>
          )}
        </div>
      )}

      {/* ════ MODAL: Confirm Delete Driver ════ */}
      {deleteTarget && !isViewOnly && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteTarget(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Top accent bar */}
            <div className="h-1.5 w-full bg-red-500 rounded-t-2xl" />

            <div className="p-6 space-y-4">
              {/* Icon + title */}
              <div className="flex items-start gap-4">
                <div className="w-11 h-11 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                  <AlertTriangle className="w-5 h-5 text-red-500" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-foreground">Delete Driver</h3>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    This action cannot be undone.
                  </p>
                </div>
              </div>

              {/* Driver info card */}
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-3">
                <div className="w-9 h-9 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0 border border-red-200">
                  <Users className="w-4 h-4 text-red-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-red-700">{deleteTarget.name}</p>
                  <p className="text-xs text-red-500">{deleteTarget.id}</p>
                </div>
              </div>

              <p className="text-sm text-muted-foreground">
                Are you sure you want to permanently remove <span className="font-medium text-foreground">{deleteTarget.name}</span> from the system? Their account and PIN will be deleted.
              </p>

              {/* Buttons */}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="flex-1 px-4 py-2.5 border border-border rounded-xl hover:bg-accent transition-colors text-sm font-medium text-foreground"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteDriver}
                  className="flex-1 px-4 py-2.5 bg-red-500 text-white rounded-xl hover:bg-red-600 transition-colors text-sm font-medium flex items-center justify-center gap-2"
                >
                  <Trash2 className="w-4 h-4" /> Yes, Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════ MODAL: Register Driver ════ */}
      {showAddDriver && !isViewOnly && (
        <RegisterDriverModal
          setDrivers={setDrivers}
          onClose={() => setShowAddDriver(false)}
        />
      )}

      {/* ════ MODAL: Register Truck ════ */}
      {showAddTruck && !isViewOnly && (
        <RegisterTruckModal
          trucks={trucks}
          setTrucks={setTrucks}
          onClose={() => setShowAddTruck(false)}
        />
      )}
    </div>
  );
}