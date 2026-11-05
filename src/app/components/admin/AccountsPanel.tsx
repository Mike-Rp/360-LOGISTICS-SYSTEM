import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import {
  Users, Truck, Plus, Eye, EyeOff, RefreshCw,
  Shield, KeyRound, Phone,
  Package, Weight, Trash2, AlertTriangle, Archive, ChevronDown,
  UserX, UserCheck, Wrench, Pencil,
} from 'lucide-react';
import type { LocalDriver, LocalTruck, AdminActivityInput, Assignment } from '../../data/assignmentTypes';
import { availabilityConfig } from '../../data/assignmentTypes';
import { RegisterDriverModal, RegisterTruckModal } from './RegisterModals';
import TruckImage from '../TruckImage';
import ConfirmPasswordDialog from './ConfirmPasswordDialog';
import {
  archiveDriver, archiveTruck, resetDriverPin, delegatedResetDriverPin, AssignmentActionError,
  markDriverUnavailable, markDriverAvailable, markTruckMaintenance, markTruckAvailable, updateUnavailability,
} from '../../lib/db';
import type { FleetCoverage } from '../../lib/useMyFleetDelegation';
import UnavailabilityDialog, { type UnavailabilityDraft } from './UnavailabilityDialog';
import {
  driverState, truckState, describeReturn, describeUnavailability, openEndedFor,
  type DriverUnavailableReason, type FleetState, type Unavailability, type UnavailabilityKind,
} from '../../lib/unavailability';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { PaginationFooter, usePagination, useStablePageHeight } from './Pagination';
import { sortNewestFirst, markLocalRecordAdded, useLocalAddedHighlight, newRecordHighlight } from '../../lib/recordOrdering';
import { capacityKgOnly } from '../../data/truckTypes';
import ASNWithCopy from './ASNWithCopy';
import type { ActionFeedbackToast } from '../../lib/notificationEvents';
import { parsePhilippineMobile } from '../../lib/philippineMobile';
import { formatPhilippineTimestamp } from '../../lib/philippineTime';

/* Plain-language text for the errors the archive / PIN database functions can return */
const accountActionError = (err: unknown): string => {
  const code = err instanceof AssignmentActionError ? err.code : 'network';
  switch (code) {
    case 'reauth_required':  return 'Please enter your password again.';
    case 'driver_busy':      return 'This driver has an active delivery and can\'t be archived. Complete or cancel it first.';
    case 'truck_busy':       return 'This truck is on an active delivery and can\'t be archived. Complete or cancel it first.';
    case 'already_archived': return 'This record is already archived. Refresh the page.';
    case 'not_authorized':   return 'Your account is not allowed to make this change.';
    case 'not_deployed':     return 'This feature isn\'t set up on the database yet (the archive migration hasn\'t been applied).';
    case 'invalid':          return 'This record no longer exists. Refresh the page.';
    default:                 return 'Couldn\'t reach the server. Check your connection and try again.';
  }
};

const fmtArchived = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso
    : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/* Active / Archived switch shown inside the Drivers and Trucks tabs */
function StatusTabs({ value, onChange, activeCount, archivedCount }: {
  value: 'active' | 'archived'; onChange: (v: 'active' | 'archived') => void;
  activeCount: number; archivedCount: number;
}) {
  return (
    <div className="inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5">
      {(['active', 'archived'] as const).map((v) => (
        <button key={v} onClick={() => onChange(v)}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
            value === v ? 'bg-white shadow-sm text-foreground border border-border' : 'text-muted-foreground hover:text-foreground'}`}>
          {v === 'active' ? 'Active' : 'Archived'}
          <span className="tabular-nums text-muted-foreground">{v === 'active' ? activeCount : archivedCount}</span>
        </button>
      ))}
    </div>
  );
}

type AvailabilityFilter = 'all' | 'available' | 'onDelivery' | 'unavailable';

function AvailabilityFilters({ value, onChange, allCount, availableCount, onDeliveryCount, unavailableCount, unavailableLabel = 'Unavailable', label }: {
  value: AvailabilityFilter;
  onChange: (value: AvailabilityFilter) => void;
  allCount: number;
  availableCount: number;
  onDeliveryCount: number;
  /* REQ-019: shown when given — Unavailable (drivers) / Maintenance (trucks) */
  unavailableCount?: number;
  unavailableLabel?: string;
  label: string;
}) {
  const chips: Array<[AvailabilityFilter, string, number]> = [
    ['all', 'All', allCount],
    ['available', 'Available', availableCount],
    ['onDelivery', 'On Delivery', onDeliveryCount],
    ...(unavailableCount === undefined ? [] : [['unavailable', unavailableLabel, unavailableCount] as [AvailabilityFilter, string, number]]),
  ];
  const dot = (filter: AvailabilityFilter) => filter === 'available' ? 'bg-green-500' : filter === 'onDelivery' ? 'bg-blue-500' : 'bg-amber-500';
  return (
    <div role="group" aria-label={label} className="flex max-w-full flex-wrap items-center gap-1.5 lg:border-l lg:border-border lg:pl-3">
      {chips.map(([filter, text, count]) => (
        <button key={filter} type="button" aria-pressed={value === filter}
          onClick={() => onChange(filter)}
          className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-sm font-medium shadow-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${value === filter ? 'border-primary bg-primary text-white' : 'border-border bg-white text-foreground hover:bg-muted/50'}`}>
          {filter !== 'all' && <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot(filter)} ${value === filter ? 'ring-2 ring-white' : ''}`} />}
          {text} <span className="ml-1 tabular-nums">{count}</span>
        </button>
      ))}
    </div>
  );
}

function IdentifierCopy({ value, description, className = '' }: { value: string; description: string; className?: string }) {
  return <span className={`inline-flex max-w-full shrink-0 whitespace-nowrap ${className}`}>
    <ASNWithCopy value={value} copyDescription={description} alignTextStart readableFeedback noWrap>{value}</ASNWithCopy>
  </span>;
}

const truckPlateTextClass = 'text-base font-semibold leading-6 tracking-normal text-foreground [&_.asn-copy-target]:min-h-6 [&_.asn-copy-target]:py-0';
const truckIdTextClass = 'whitespace-nowrap text-sm font-medium leading-5 tracking-normal text-muted-foreground';

function PhoneContact({ driver }: { driver: LocalDriver }) {
  if (!driver.phone || driver.phone === '—') return <span className="text-sm italic text-muted-foreground">No number</span>;
  const mobile = parsePhilippineMobile(driver.phone);
  if (!mobile) return <span className="inline-flex max-w-full flex-wrap items-center gap-x-2 text-sm text-foreground">
    <span className="break-all">{driver.phone}</span>
    <span className="text-amber-700" title="Check this phone number before copying or calling">Check number</span>
  </span>;
  return <div className="driver-phone-contact grid w-max grid-cols-[2rem_8.5rem_2.5rem] items-center gap-1 whitespace-nowrap tabular-nums">
    <span className="text-sm font-medium text-muted-foreground">+63</span>
    <span className="text-[15px] font-medium text-foreground">
      <ASNWithCopy value={mobile.subscriber} copyDescription="driver mobile number" alignTextStart readableFeedback noWrap>
        <span className="inline-block w-[10ch] text-left tabular-nums">{mobile.subscriber}</span>
      </ASNWithCopy>
    </span>
    <a href={`tel:${mobile.international}`} aria-label={`Call ${driver.name}`} title={`Call ${driver.name}`}
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-primary hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
      <Phone className="h-4 w-4" aria-hidden="true" />
    </a>
  </div>;
}

/* ── Helpers ── */
const generatePin = () => String(Math.floor(1000 + Math.random() * 9000));

/* A driver / truck is Available, On Delivery (has an active task) or — REQ-019 — Unavailable / Under maintenance. */

/* Badge for a driver or truck; an unavailable one also shows why and until when, right under it. */
function AvailabilityBadge({ kind, state, unavailable }: { kind: UnavailabilityKind; state: FleetState; unavailable?: Unavailability }) {
  const cfg = state === 'unavailable' ? (kind === 'truck' ? availabilityConfig.maintenance : availabilityConfig.unavailable)
    : availabilityConfig[state];
  const open = state === 'unavailable' && unavailable ? openEndedFor(unavailable, Date.now()) : null;
  return (
    <div className="min-w-0">
      <span className={`inline-flex w-fit max-w-full items-center rounded-full border px-2.5 py-1 text-sm font-medium ${cfg.badge}`}>
        <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${cfg.dot}`} />
        {cfg.label}
      </span>
      {state === 'unavailable' && unavailable && (
        <p className="mt-1 break-words [overflow-wrap:anywhere] text-sm leading-snug text-muted-foreground" title={unavailable.note || undefined}>
          {/* The badge already says "Maintenance" for a truck, so only the return is added there */}
          {kind === 'truck'
            ? describeReturn(unavailable.expectedReturnAt).replace(/^./, (c) => c.toUpperCase())
            : describeUnavailability(unavailable)}
          {open && <span className="block font-medium text-amber-700">Unavailable for {open}</span>}
          {unavailable.note && <span className="block italic">{unavailable.note}</span>}
        </p>
      )}
    </div>
  );
}

/* OPM only: "Status ▾" — mark unavailable / under maintenance, or edit / mark back. Not offered on a delivery. */
function StatusMenu({ kind, state, onMark, onEdit, onBack, block = false }: {
  kind: UnavailabilityKind; state: FleetState; onMark: () => void; onEdit: () => void; onBack: () => void; block?: boolean;
}) {
  const driver = kind === 'driver';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`Change ${driver ? 'driver' : 'truck'} status`}
          className={`flex min-h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary ${block ? 'flex-1' : ''}`}>
          Status <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-[70] min-w-52">
        {state === 'unavailable' ? (<>
          <DropdownMenuItem onSelect={onBack}>
            <UserCheck aria-hidden="true" />{driver ? 'Mark available again' : 'Back in service'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onEdit}><Pencil aria-hidden="true" />Edit details</DropdownMenuItem>
        </>) : (
          <DropdownMenuItem onSelect={onMark} disabled={state === 'onDelivery'}>
            {driver ? <UserX aria-hidden="true" /> : <Wrench aria-hidden="true" />}
            {driver ? 'Mark unavailable' : 'Put under maintenance'}{state === 'onDelivery' ? ' (on a delivery)' : ''}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* Plain-language text for the errors the unavailable / maintenance database functions can return */
const unavailabilityErrorText = (err: unknown): string => {
  const code = err instanceof AssignmentActionError ? err.code : 'network';
  switch (code) {
    case 'driver_busy':          return 'This driver has an active delivery. Complete or cancel it first.';
    case 'truck_busy':           return 'This truck is on an active delivery. Complete or cancel it first.';
    case 'already_unavailable':  return 'This is already marked. Refresh the page.';
    case 'not_unavailable':      return 'This is no longer marked unavailable. Refresh the page.';
    case 'invalid_return':       return 'The return time must be in the future.';
    case 'note_required':        return 'Add a short note for "Other".';
    case 'note_too_long':        return 'The note is too long (200 characters at most).';
    case 'invalid_reason':       return 'Choose a reason.';
    case 'driver_archived':
    case 'truck_archived':
    case 'already_archived':     return 'This record has been archived. Refresh the page.';
    case 'not_authorized':       return 'Only the Operation Manager can do this.';
    case 'not_deployed':         return 'This feature isn\'t set up on the database yet (the migration hasn\'t been applied).';
    default:                     return 'Couldn\'t reach the server. Check your connection and try again.';
  }
};

/* ── PIN Cell — hold eye to reveal, auto-hides on release/mouse-leave ── */
function PinCell({ pin }: { pin?: string }) {
  const [visible, setVisible] = useState(false);
  if (!pin) return <span className="text-sm italic text-muted-foreground">No PIN</span>;
  return (
    <div className="flex items-center gap-2">
      <span
        className="font-mono tracking-widest text-sm select-none w-10"
        style={visible ? { color: 'inherit' } : { color: 'transparent', textShadow: '0 0 8px rgba(0,0,0,0.35)' }}
      >
        {visible ? pin : '••••'}
      </span>
      <button
        type="button"
        onMouseDown={() => setVisible(true)}
        onMouseUp={() => setVisible(false)}
        onMouseLeave={() => setVisible(false)}
        onTouchStart={() => setVisible(true)}
        onTouchEnd={() => setVisible(false)}
        className="inline-flex h-10 w-10 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground select-none cursor-pointer"
        title="Hold to reveal PIN"
        aria-label="Hold to reveal PIN"
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
  /* Needed to block deleting a driver who still has an open task (see activeTaskFor). */
  assignments?: Assignment[];
  canManageFleetAccounts: boolean;
  onResetAll?: () => Promise<void>;
  savingToDb?: boolean;
  onLogActivity?: (entry: AdminActivityInput) => void;
  /* Runs a database-function change (archive / new PIN), then reloads — see App.tsx */
  onServerChange: (action: () => Promise<void>) => Promise<void>;
  onActionFeedback: (message: string, tone?: ActionFeedbackToast['tone'], presentation?: ActionFeedbackToast['presentation']) => void;
  archivedDrivers?: LocalDriver[];
  archivedTrucks?: LocalTruck[];
  search: string;
  /* REQ-018: what a CSR covering for the OPM may do right now (nothing for everyone else). */
  coverage?: FleetCoverage;
}

const NO_COVERAGE: FleetCoverage = { canResetPin: false, canRegister: false, pinUntil: null, registerUntil: null, status: 'idle', retry: () => {} };

const ROLE_LABEL: Record<string, string> = {
  admin:  'Admin',
  demo:   'Demo',
  viewer: 'View only',
};

type TabView = 'Drivers' | 'Trucks';

export default function AccountsPanel({ drivers, setDrivers, trucks, setTrucks, assignments = [], canManageFleetAccounts, onResetAll, savingToDb, onLogActivity, onServerChange, onActionFeedback, archivedDrivers = [], archivedTrucks = [], search, coverage = NO_COVERAGE }: Props) {
  /* The OPM does everything. A covering CSR gets only the pieces the OPM granted — never the PIN
     column, never archive. The database re-checks the window on every call. */
  const canResetPins = canManageFleetAccounts || coverage.canResetPin;
  const canResetPinsRef = useRef(canResetPins);
  canResetPinsRef.current = canResetPins;
  const canRegisterFleet = canManageFleetAccounts || coverage.canRegister;
  const covering = !canManageFleetAccounts && (coverage.canResetPin || coverage.canRegister);
  const coverageUnverified = !canManageFleetAccounts && ['loading', 'refreshing', 'error'].includes(coverage.status);
  const coverageBlock = coverageUnverified
    ? coverage.status === 'error' ? 'Temporary access could not be verified. Retry the coverage check before continuing.' : 'Checking temporary access. Please wait before submitting.'
    : undefined;
  const registrationAccessEnded = !canManageFleetAccounts && coverage.status === 'success' && !coverage.canRegister;
  const [tab, setTab] = useState<TabView>('Drivers');
  const [driverView, setDriverView] = useState<'active' | 'archived'>('active');
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>('all');
  const [truckView,  setTruckView]  = useState<'active' | 'archived'>('active');
  const [truckStatusFilter, setTruckStatusFilter] = useState<AvailabilityFilter>('all');
  const [truckClassificationFilter, setTruckClassificationFilter] = useState('');
  const truckClassifications = [...new Set([...trucks, ...archivedTrucks]
    .map(truck => truck.classification?.trim()).filter((value): value is string => !!value))]
    .sort((a, b) => a.localeCompare(b));
  const query = search.trim().toLowerCase();
  const matches = (fields: (string | undefined)[]) => !query || fields.some((field) => field?.toLowerCase().includes(query));
  const availableCount = drivers.filter((driver) => driverState(driver) === 'available').length;
  const onDeliveryCount = drivers.filter((driver) => driverState(driver) === 'onDelivery').length;
  const unavailableDriverCount = drivers.filter((driver) => driverState(driver) === 'unavailable').length;
  const availableTruckCount = trucks.filter((truck) => truckState(truck) === 'available').length;
  const onDeliveryTruckCount = trucks.filter((truck) => truckState(truck) === 'onDelivery').length;
  const maintenanceTruckCount = trucks.filter((truck) => truckState(truck) === 'unavailable').length;
  const visibleDrivers = sortNewestFirst(tab === 'Drivers' && driverView === 'active' ? drivers.filter((driver) =>
    matches([driver.name, driver.id, driver.phone]) &&
    (availabilityFilter === 'all' || driverState(driver) === availabilityFilter)
  ) : drivers, (driver) => driver.id, 'driver');
  const visibleArchivedDrivers = sortNewestFirst(tab === 'Drivers' && driverView === 'archived' ? archivedDrivers.filter((driver) => matches([driver.name, driver.id, driver.phone])) : archivedDrivers, (driver) => driver.id, 'driver');
  const visibleTrucks = tab === 'Trucks' && truckView === 'active' ? trucks.filter((truck) =>
    matches([truck.plateNumber, truck.id, truck.classification, truck.capacity]) &&
    (!truckClassificationFilter || truck.classification?.trim() === truckClassificationFilter) &&
    (truckStatusFilter === 'all' || truckState(truck) === truckStatusFilter)
  ) : trucks;
  const visibleArchivedTrucks = tab === 'Trucks' && truckView === 'archived' ? archivedTrucks.filter((truck) =>
    matches([truck.plateNumber, truck.id, truck.classification, truck.capacity]) &&
    (!truckClassificationFilter || truck.classification?.trim() === truckClassificationFilter)) : archivedTrucks;
  const activeDriversPage = usePagination(visibleDrivers);
  const archivedDriversPage = usePagination(visibleArchivedDrivers);
  const activeTrucksPage = usePagination(visibleTrucks);
  const archivedTrucksPage = usePagination(visibleArchivedTrucks);
  const newDriverId = useLocalAddedHighlight('driver', () => activeDriversPage.setPage(1));
  useLayoutEffect(() => {
    activeDriversPage.setPage(1);
    archivedDriversPage.setPage(1);
    activeTrucksPage.setPage(1);
    archivedTrucksPage.setPage(1);
  }, [search]);
  const activeDriversArea = useStablePageHeight(activeDriversPage.page, visibleDrivers.length, 10, `${tab}|${driverView}|${availabilityFilter}|${search}`);
  const archivedDriversArea = useStablePageHeight(archivedDriversPage.page, visibleArchivedDrivers.length, 10, `${tab}|${driverView}|${search}`);
  const activeTrucksArea = useStablePageHeight(activeTrucksPage.page, visibleTrucks.length, 10, `${tab}|${truckView}|${truckStatusFilter}|${truckClassificationFilter}|${search}`);
  const archivedTrucksArea = useStablePageHeight(archivedTrucksPage.page, visibleArchivedTrucks.length, 10, `${tab}|${truckView}|${truckClassificationFilter}|${search}`);
  const resetPages = () => {
    activeDriversPage.setPage(1);
    archivedDriversPage.setPage(1);
    activeTrucksPage.setPage(1);
    archivedTrucksPage.setPage(1);
  };
  const driverTableLayout = canManageFleetAccounts
    ? { gridTemplateColumns: 'minmax(160px, 1.6fr) minmax(220px, 1.6fr) 170px 115px 310px', minWidth: '1030px' }
    : canResetPins
      ? { gridTemplateColumns: 'minmax(160px, 1.5fr) minmax(220px, 1.6fr) 170px minmax(130px, 1fr) 130px', minWidth: '900px' }
      : { gridTemplateColumns: 'minmax(160px, 1.5fr) minmax(220px, 1.6fr) minmax(120px, 1fr) minmax(130px, 1fr)', minWidth: '710px' };

  /* The "Reset All Data" button was removed from this page. The backend is untouched:
     resetAllData() in lib/db.ts and the reset_all_data() database function both still
     exist, and `onResetAll` is still passed down, so the feature can be restored by
     re-adding a trigger here. */

  /* ── Register Driver / Truck modals (shared components) ── */
  const [showAddDriver, setShowAddDriver] = useState(false);
  const [showAddTruck,  setShowAddTruck]  = useState(false);

  /* ── Archive driver / new PIN / archive truck — each opens a confirmation dialog ── */
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [pinTarget,    setPinTarget]    = useState<{ id: string; name: string } | null>(null);
  /* A covering CSR is shown the PIN the server just chose — once, then it is gone. */
  const [issuedPin,    setIssuedPin]    = useState<{ name: string; pin: string } | null>(null);
  const [truckTarget,  setTruckTarget]  = useState<{ id: string; plate: string } | null>(null);
  /* REQ-019: mark unavailable / under maintenance (or edit the open period), and mark back */
  const [unavailTarget, setUnavailTarget] = useState<{ kind: UnavailabilityKind; id: string; name: string; period?: Unavailability } | null>(null);
  const [backTarget,    setBackTarget]    = useState<{ kind: UnavailabilityKind; id: string; name: string } | null>(null);

  /* A driver counts as "on a task" while they hold any assignment the admin has not yet
     closed out. `assignments` holds only state='active' rows — completed and cancelled
     ones live in separate arrays — so membership here is the whole test, whatever the
     task_status is. That deliberately includes 'Delivered' and 'Failed / Issue', because
     those are still open (documents pending approval) and deleting the driver would
     strand the assignment: the database nulls its driver_id and the Monitor page then
     filters it out of sight permanently. */
  const activeTaskFor = (driverId: string) => assignments.find((a) => a.driverId === driverId) ?? null;
  const currentTruckFor = (driverId: string) => activeTaskFor(driverId)?.truckPlate || 'Not assigned';

  /* Shown in the dialog (and the action disabled) while the driver still has an open task.
     archive_driver() refuses it on the server too. */
  const driverBlockedReason = (driverId: string, name: string) => {
    const blocking = activeTaskFor(driverId);
    return blocking
      ? `${name} has an active task (${blocking.id} — ${blocking.taskStatus}) and can't be archived. Complete or cancel that task first.`
      : undefined;
  };
  const truckBlockedReason = (truckId: string, plate: string) => {
    const blocking = assignments.find((a) => a.truckId === truckId);
    return blocking
      ? `${plate} is on an active task (${blocking.id} — ${blocking.taskStatus}) and can't be archived. Complete or cancel that task first.`
      : undefined;
  };

  /* All three go through database functions (not the auto-save); the password step
     in ConfirmPasswordDialog runs first for the two driver actions. */
  const handleArchiveDriver = async (target: { id: string; name: string }) => {
    await onServerChange(() => archiveDriver(target.id));
    setDeleteTarget(null);
    onActionFeedback(`${target.name} moved to archive.`, 'success', 'solid');
  };
  const handleNewPin = async (target: { id: string; name: string }) => {
    if (!canResetPinsRef.current) throw new Error('coverage_not_verified');
    if (canManageFleetAccounts) {
      await onServerChange(() => resetDriverPin(target.id, generatePin()));
    } else {
      let pin = '';
      await onServerChange(async () => {
        if (!canResetPinsRef.current) throw new Error('coverage_not_verified');
        pin = await delegatedResetDriverPin(target.id);
      });
      setIssuedPin({ name: target.name, pin });
    }
    setPinTarget(null);
    onActionFeedback(`PIN successfully changed for ${target.name}.`, 'success', 'solid');
  };
  const handleUnavailableSubmit = async (draft: UnavailabilityDraft) => {
    const target = unavailTarget;
    if (!target) return;
    const input = { note: draft.note, expectedReturn: draft.expectedReturn };
    await onServerChange(async () => {
      if (target.period) await updateUnavailability(target.period.id, input);
      else if (target.kind === 'driver') await markDriverUnavailable(target.id, { ...input, reason: draft.reason as DriverUnavailableReason });
      else await markTruckMaintenance(target.id, input);
    });
    setUnavailTarget(null);
    onActionFeedback(target.period ? `Details updated for ${target.name}.`
      : target.kind === 'driver' ? `${target.name} marked unavailable.` : `${target.name} put under maintenance.`, 'success', 'solid');
  };
  const handleMarkBack = async (target: { kind: UnavailabilityKind; id: string; name: string }) => {
    await onServerChange(() => target.kind === 'driver' ? markDriverAvailable(target.id) : markTruckAvailable(target.id));
    setBackTarget(null);
    onActionFeedback(target.kind === 'driver' ? `${target.name} is available again.` : `${target.name} is back in service.`, 'success', 'solid');
  };
  const handleArchiveTruck = async (target: { id: string; plate: string }) => {
    await onServerChange(() => archiveTruck(target.id));
    setTruckTarget(null);
    onActionFeedback(`${target.plate} moved to archive.`, 'success', 'solid');
  };

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Drivers &amp; Trucks</h2>
          <p className="text-sm text-muted-foreground mt-1">{canManageFleetAccounts ? 'Manage driver accounts, availability, and truck records.' : 'View driver and truck availability for dispatch.'}</p>
        </div>
        <div className="flex items-center flex-wrap gap-3">
          <div role="group" aria-label="Drivers or trucks" className="relative grid w-full grid-cols-2 items-center rounded-xl border border-border bg-muted/40 p-1 sm:w-auto">
            <span aria-hidden="true" className={`pointer-events-none absolute inset-y-1 left-1 w-[calc(50%_-_4px)] rounded-lg border border-primary bg-primary shadow-sm transition-transform duration-300 ease-out motion-reduce:transition-none ${tab === 'Trucks' ? 'translate-x-full' : 'translate-x-0'}`} />
            {(['Drivers', 'Trucks'] as TabView[]).map((t) => (
              <button key={t} type="button" aria-pressed={tab === t} onClick={() => { setTab(t); resetPages(); }}
                className={`relative z-10 flex min-w-0 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none ${
                  tab === t
                    ? 'text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t === 'Drivers' ? <Users className="w-4 h-4" /> : <Truck className="w-4 h-4" />}
                {t}
                <span className={`rounded-full px-1.5 py-0.5 text-sm font-semibold ${
                  tab === t ? 'bg-white/20 text-primary-foreground' : 'bg-muted text-muted-foreground'
                }`}>
                  {t === 'Drivers' ? drivers.length : trucks.length}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Leave coverage notice (a CSR covering for the OPM) ── */}
      {coverageUnverified && <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <p role={coverage.status === 'error' ? 'alert' : 'status'}>{coverage.status === 'error'
          ? 'Could not verify temporary fleet access. Any previously loaded coverage is not verified; temporary actions are disabled.'
          : coverage.status === 'refreshing' ? 'Refreshing temporary fleet access… Temporary actions are paused until verification completes.' : 'Checking temporary fleet access…'}</p>
        {coverage.status === 'error' && <button type="button" onClick={coverage.retry} className="min-h-10 rounded-lg px-2 font-medium text-primary underline focus-visible:outline-2 focus-visible:outline-primary">Retry</button>}
      </div>}
      {!canManageFleetAccounts && coverage.status === 'success' && !covering && <p role="status" className="text-sm text-muted-foreground">No temporary fleet access is currently active.</p>}
      {covering && (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <Shield aria-hidden="true" className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
          <div className="min-w-0 text-sm text-amber-900">
            <p className="font-semibold">Covering for the Operation Manager</p>
            <p className="mt-0.5">
              {coverage.canResetPin && <>You can set new driver PINs until {formatPhilippineTimestamp(coverage.pinUntil)}. </>}
              {coverage.canRegister && <>You can register drivers and trucks until {formatPhilippineTimestamp(coverage.registerUntil)}. </>}
              Everything you do here is recorded in the activity log.
            </p>
          </div>
        </div>
      )}

      {/* ════ DRIVERS TAB ════ */}
      {tab === 'Drivers' && (
        <div className="space-y-4">
          {/* Bar */}
          <div className="flex flex-wrap items-center gap-3">
            <StatusTabs value={driverView} onChange={(view) => { setDriverView(view); setAvailabilityFilter('all'); resetPages(); }}
              activeCount={drivers.length} archivedCount={archivedDrivers.length} />
            {driverView === 'active' && <>
              <AvailabilityFilters value={availabilityFilter} label="Driver availability"
                allCount={drivers.length} availableCount={availableCount} onDeliveryCount={onDeliveryCount}
                unavailableCount={unavailableDriverCount} unavailableLabel="Unavailable"
                onChange={(value) => { setAvailabilityFilter(value); activeDriversPage.setPage(1); }} />
              {canRegisterFleet && <button onClick={() => setShowAddDriver(true)}
                className="ml-auto flex min-h-10 w-full sm:w-auto items-center justify-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors text-sm">
                <Plus className="w-4 h-4" /> Register Driver
              </button>}
            </>}
          </div>

          {/* Archived drivers — read-only, with the archive date */}
          {driverView === 'archived' && (
            visibleArchivedDrivers.length === 0 ? (
              <div className="bg-white rounded-2xl border border-dashed border-border p-12 text-center">
                <Archive className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
                <p className="font-medium text-foreground">{query ? 'No accounts found' : 'No archived drivers'}</p>
                <p className="text-sm text-muted-foreground mt-1">{query ? 'Try a different search term.' : 'Archived drivers appear here with the date they were archived.'}</p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-border shadow-sm divide-y divide-border">
                <div ref={archivedDriversArea} className="divide-y divide-border">
                {archivedDriversPage.pageItems.map((d) => (
                  <div key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 sm:px-5 py-3.5">
                    <div className="flex items-center gap-3 min-w-0 flex-1 basis-48">
                      <div className="w-9 h-9 bg-muted rounded-full flex items-center justify-center flex-shrink-0 border border-border">
                        <Users className="w-4 h-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="break-words text-base font-bold text-foreground">{d.name}</p>
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm">
                          <span className="whitespace-nowrap font-medium text-muted-foreground">{d.id}</span>
                          {d.phone && d.phone !== '—' ? <PhoneContact driver={d} /> : <span className="text-muted-foreground">—</span>}
                        </div>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-sm text-muted-foreground">
                      <Archive className="w-3 h-3" /> Archived {fmtArchived(d.archivedAt)}
                    </span>
                  </div>
                ))}
                </div>
                <PaginationFooter page={archivedDriversPage.page} totalItems={visibleArchivedDrivers.length} readable
                  onPageChange={archivedDriversPage.setPage} singular="driver" plural="drivers" className="bg-muted/20" />
              </div>
            )
          )}

          {/* Keep empty/list trees distinct: pagination's measured min-height must not carry into the icon. */}
          {driverView === 'active' && (visibleDrivers.length === 0 ? (
            <div key="drivers-empty" className="bg-white rounded-2xl border border-dashed border-border p-16 text-center">
              <div className="w-16 h-16 bg-muted/50 rounded-full flex items-center justify-center mx-auto mb-4">
                <Users className="w-8 h-8 text-muted-foreground/40" />
              </div>
              <p className="font-medium text-foreground mb-1">{availabilityFilter === 'available' ? (query ? 'No available drivers match your search.' : 'No available drivers found.') : availabilityFilter === 'onDelivery' ? (query ? 'No drivers on delivery match your search.' : 'No drivers are currently on delivery.') : availabilityFilter === 'unavailable' ? (query ? 'No unavailable drivers match your search.' : 'No drivers are marked unavailable.') : query ? 'No accounts found' : 'No Drivers Registered Yet'}</p>
              <p className="text-sm text-muted-foreground mb-5">{query ? 'Try a different search term.' : availabilityFilter === 'all' ? canRegisterFleet ? 'Register a driver to generate their login PIN.' : 'Drivers will appear here when registered by OPM.' : 'Choose All to see every active driver.'}</p>
              {!query && availabilityFilter === 'all' && canRegisterFleet && (
                <button onClick={() => setShowAddDriver(true)}
                  className="px-5 py-2.5 bg-primary text-white rounded-lg text-sm hover:bg-primary/90 transition-colors">
                  + Register Driver
                </button>
              )}
            </div>
          ) : (
            <div key="drivers-list" className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
              <div ref={activeDriversArea}>
              {/* Wide-screen table */}
              <div className="hidden xl:block overflow-x-auto">
              {/* Table head */}
              <div style={driverTableLayout} className="grid gap-3 border-b border-border bg-muted/30 px-5 py-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <span>Driver</span>
                <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> Contact</span>
                <span>Availability</span>
                {canManageFleetAccounts
                  ? <span className="flex items-center gap-1"><KeyRound className="w-3.5 h-3.5" /> PIN</span>
                  : <span>Current Truck</span>}
                {canResetPins && <span className="text-right">Action</span>}
              </div>
              {/* Table rows */}
              <div className="divide-y divide-border">
                {activeDriversPage.pageItems.map((d) => {
                  const state = driverState(d);
                  return (
                    <div key={d.id}
                      style={{ ...driverTableLayout, ...newRecordHighlight(d.id, newDriverId) }}
                      className="grid gap-3 items-center px-5 py-3.5 hover:bg-muted/10 transition-colors">
                      {/* Name */}
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 bg-[#0d9488]/15 rounded-full flex items-center justify-center flex-shrink-0 border border-[#0d9488]/20">
                          <Users className="w-4 h-4 text-[#0d9488]" />
                        </div>
                        <div className="min-w-0">
                          <p className="break-words text-base font-bold text-foreground">{d.name}</p>
                          <p className="mt-0.5 whitespace-nowrap text-sm font-medium text-muted-foreground">{d.id}</p>
                        </div>
                      </div>

                      {/* Contact / Phone */}
                      <div className="min-w-0">
                        <PhoneContact driver={d} />
                      </div>

                      {/* Available / On Delivery badge */}
                      <AvailabilityBadge kind="driver" state={state} unavailable={d.unavailable} />

                      {canManageFleetAccounts ? <PinCell pin={d.pin} />
                        : <span className="text-sm text-foreground break-words">{currentTruckFor(d.id)}</span>}

                      {/* Actions — hidden for view-only; a covering CSR gets New PIN only */}
                      {canResetPins && (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setPinTarget({ id: d.id, name: d.name })}
                            title="Regenerate PIN"
                            className="flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            <RefreshCw className="w-3.5 h-3.5" /> New PIN
                          </button>
                          {canManageFleetAccounts && <StatusMenu kind="driver" state={state}
                            onMark={() => setUnavailTarget({ kind: 'driver', id: d.id, name: d.name })}
                            onEdit={() => d.unavailable && setUnavailTarget({ kind: 'driver', id: d.id, name: d.name, period: d.unavailable })}
                            onBack={() => setBackTarget({ kind: 'driver', id: d.id, name: d.name })} />}
                          {canManageFleetAccounts && <button
                            onClick={() => setDeleteTarget({ id: d.id, name: d.name })}
                            title="Move driver to archive"
                            className="flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:border-red-300 hover:bg-red-50"
                          >
                            <Archive className="w-3.5 h-3.5" /> Archive
                          </button>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              </div>{/* end overflow-x-auto */}

              {/* Mobile and tablet card list */}
              <div className="divide-y divide-border xl:hidden">
                {activeDriversPage.pageItems.map((d) => {
                  const state = driverState(d);
                  return (
                    <div key={d.id} style={newRecordHighlight(d.id, newDriverId)} className="p-4">
                      <div className="flex flex-wrap items-start gap-3">
                        <div className="w-9 h-9 bg-[#0d9488]/15 rounded-full flex items-center justify-center flex-shrink-0 border border-[#0d9488]/20">
                          <Users className="w-4 h-4 text-[#0d9488]" />
                        </div>
                        <div className="min-w-[140px] flex-1">
                          <p className="break-words text-base font-bold text-foreground">{d.name}</p>
                          <p className="mt-0.5 whitespace-nowrap text-sm font-medium text-muted-foreground">{d.id}</p>
                        </div>
                        <AvailabilityBadge kind="driver" state={state} unavailable={d.unavailable} />
                      </div>

                      <div className="mt-3 grid grid-cols-1 gap-3 border-t border-border/60 pt-3 text-sm sm:grid-cols-2">
                        <div>
                          <p className="mb-1 font-medium text-muted-foreground">Contact</p>
                          <PhoneContact driver={d} />
                        </div>
                        <div>
                          <p className="mb-1 font-medium text-muted-foreground">{canManageFleetAccounts ? 'PIN' : 'Current Truck'}</p>
                          {canManageFleetAccounts ? <PinCell pin={d.pin} />
                            : <span className="text-foreground font-medium break-words">{currentTruckFor(d.id)}</span>}
                        </div>
                      </div>

                      {canResetPins && (
                        <div className="flex gap-2 mt-2.5">
                          <button
                            onClick={() => setPinTarget({ id: d.id, name: d.name })}
                            className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            <RefreshCw className="w-3.5 h-3.5" /> New PIN
                          </button>
                          {canManageFleetAccounts && <StatusMenu block kind="driver" state={state}
                            onMark={() => setUnavailTarget({ kind: 'driver', id: d.id, name: d.name })}
                            onEdit={() => d.unavailable && setUnavailTarget({ kind: 'driver', id: d.id, name: d.name, period: d.unavailable })}
                            onBack={() => setBackTarget({ kind: 'driver', id: d.id, name: d.name })} />}
                          {canManageFleetAccounts && <button
                            onClick={() => setDeleteTarget({ id: d.id, name: d.name })}
                            className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:border-red-300 hover:bg-red-50"
                          >
                            <Archive className="w-3.5 h-3.5" /> Archive
                          </button>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              </div>
              <PaginationFooter page={activeDriversPage.page} totalItems={visibleDrivers.length} readable
                onPageChange={activeDriversPage.setPage} singular="driver" plural="drivers"
                className="border-t border-border bg-muted/20" />
            </div>
          ))}

          {driverView === 'active' && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Shield className="w-3.5 h-3.5" />
            Status is <strong className="text-blue-600">On Delivery</strong> when the driver has an active task.{canManageFleetAccounts && ' Hold the eye icon to reveal a PIN.'}
          </p>
          )}
        </div>
      )}

      {/* ════ TRUCKS TAB ════ */}
      {tab === 'Trucks' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <StatusTabs value={truckView} onChange={(view) => { setTruckView(view); setTruckStatusFilter('all'); resetPages(); }}
              activeCount={trucks.length} archivedCount={archivedTrucks.length} />
            {truckView === 'active' && <>
              <AvailabilityFilters value={truckStatusFilter} label="Truck availability"
                allCount={trucks.length} availableCount={availableTruckCount} onDeliveryCount={onDeliveryTruckCount}
                unavailableCount={maintenanceTruckCount} unavailableLabel="Maintenance"
                onChange={(value) => { setTruckStatusFilter(value); activeTrucksPage.setPage(1); }} />
            </>}
            <div className="relative w-full min-w-0 sm:w-52">
              <select aria-label="Truck classification" value={truckClassificationFilter}
                onChange={(event) => { setTruckClassificationFilter(event.target.value); activeTrucksPage.setPage(1); archivedTrucksPage.setPage(1); }}
                className="min-h-10 w-full appearance-none rounded-xl border border-border bg-white py-2 pl-3 pr-9 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                <option value="">All Classifications</option>
                {truckClassifications.map(classification => <option key={classification} value={classification}>{classification}</option>)}
              </select>
              <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            </div>
            {truckView === 'active' && <>
              {canRegisterFleet && <button onClick={() => setShowAddTruck(true)}
                className="ml-auto flex min-h-10 w-full sm:w-auto items-center justify-center gap-2 px-4 py-2 bg-secondary text-white rounded-lg hover:bg-secondary/90 transition-colors text-sm">
                <Plus className="w-4 h-4" /> Register Truck
              </button>}
            </>}
          </div>

          {/* Archived trucks — read-only, with the archive date */}
          {truckView === 'archived' && (
            visibleArchivedTrucks.length === 0 ? (
              <div className="bg-white rounded-2xl border border-dashed border-border p-12 text-center">
                <Archive className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
                <p className="font-medium text-foreground">{query || truckClassificationFilter ? 'No archived trucks match these filters' : 'No archived trucks'}</p>
                <p className="text-sm text-muted-foreground mt-1">{query || truckClassificationFilter ? 'Try a different search term or classification.' : 'Archived trucks appear here with the date they were archived.'}</p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-border shadow-sm divide-y divide-border">
                <div ref={archivedTrucksArea} className="divide-y divide-border">
                {archivedTrucksPage.pageItems.map((t) => (
                  <div key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 sm:px-5 py-3.5">
                    <div className="flex items-center gap-3 min-w-0 flex-1 basis-48">
                      <div className="h-13 w-13 flex-shrink-0 overflow-hidden rounded-lg border border-border bg-muted p-0.5 grayscale">
                        <TruckImage className="h-full w-full" classification={t.classification} iconClassName="w-5 h-5 text-muted-foreground" />
                      </div>
                      <div className="flex min-w-0 flex-col items-start justify-center gap-0.5">
                        <IdentifierCopy value={t.plateNumber} description="truck plate number" className={truckPlateTextClass} />
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm">
                          <span className={truckIdTextClass}>{t.id}</span>
                          <span className="break-words text-[15px] font-medium text-muted-foreground">{t.classification || 'Type not set'}</span>
                        </div>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-sm text-muted-foreground">
                      <Archive className="w-3 h-3" /> Archived {fmtArchived(t.archivedAt)}
                    </span>
                  </div>
                ))}
                </div>
                <PaginationFooter page={archivedTrucksPage.page} totalItems={visibleArchivedTrucks.length} readable
                  onPageChange={archivedTrucksPage.setPage} singular="truck" plural="trucks" className="bg-muted/20" />
              </div>
            )
          )}

          {truckView === 'active' && (visibleTrucks.length === 0 ? (
            <div key="trucks-empty" className="bg-white rounded-2xl border border-dashed border-border p-16 text-center">
              <div className="w-16 h-16 bg-muted/50 rounded-full flex items-center justify-center mx-auto mb-4">
                <Truck className="w-8 h-8 text-muted-foreground/40" />
              </div>
              <p className="font-medium text-foreground mb-1">{truckClassificationFilter ? 'No trucks match this classification.' : truckStatusFilter === 'available' ? (query ? 'No available trucks match your search.' : 'No available trucks found.') : truckStatusFilter === 'onDelivery' ? (query ? 'No trucks on delivery match your search.' : 'No trucks are currently on delivery.') : truckStatusFilter === 'unavailable' ? (query ? 'No trucks under maintenance match your search.' : 'No trucks are under maintenance.') : query ? 'No accounts found' : 'No Trucks Registered Yet'}</p>
              <p className="text-sm text-muted-foreground mb-5">{query || truckClassificationFilter ? 'Try a different search term or filter.' : truckStatusFilter === 'all' ? canRegisterFleet ? 'Register trucks so they can be assigned to deliveries.' : 'Trucks will appear here when registered by OPM.' : 'Choose All to see every active truck.'}</p>
              {!query && !truckClassificationFilter && truckStatusFilter === 'all' && canRegisterFleet && (
                <button onClick={() => setShowAddTruck(true)}
                  className="px-5 py-2.5 bg-secondary text-white rounded-lg text-sm hover:bg-secondary/90 transition-colors">
                  + Register Truck
                </button>
              )}
            </div>
          ) : (
            <div key="trucks-list" className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
              <div ref={activeTrucksArea}>
              {/* Wide-screen table */}
              <div className="hidden overflow-x-auto xl:block">
              <div className={`grid ${!canManageFleetAccounts ? 'grid-cols-[minmax(180px,1.2fr)_minmax(160px,1.5fr)_minmax(170px,1.5fr)_170px] min-w-[680px]' : 'grid-cols-[minmax(180px,1.2fr)_minmax(160px,1.5fr)_minmax(170px,1.5fr)_170px_auto] min-w-[780px]'} gap-4 border-b border-border bg-muted/30 px-5 py-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground`}>
                <span>Plate Number</span>
                <span className="flex items-center gap-1"><Package className="w-3.5 h-3.5" /> Classification</span>
                <span className="flex items-center gap-1"><Weight className="w-3.5 h-3.5" /> Payload Capacity</span>
                <span>Status</span>
                {canManageFleetAccounts && <span>Action</span>}
              </div>
              <div className="divide-y divide-border">
                {activeTrucksPage.pageItems.map((t) => (
                  <div key={t.id}
                    className={`grid ${!canManageFleetAccounts ? 'grid-cols-[minmax(180px,1.2fr)_minmax(160px,1.5fr)_minmax(170px,1.5fr)_170px] min-w-[680px]' : 'grid-cols-[minmax(180px,1.2fr)_minmax(160px,1.5fr)_minmax(170px,1.5fr)_170px_auto] min-w-[780px]'} gap-4 items-center px-5 py-3.5 hover:bg-muted/10 transition-colors`}>
                    {/* Plate */}
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="h-13 w-13 flex-shrink-0 overflow-hidden rounded-lg border border-[#0d9488]/20 bg-[#0d9488]/15 p-0.5">
                        <TruckImage className="h-full w-full" classification={t.classification} iconClassName="w-5 h-5 text-[#0d9488]" />
                      </div>
                      <div className="flex min-w-0 flex-col items-start justify-center gap-0.5">
                        <IdentifierCopy value={t.plateNumber} description="truck plate number" className={truckPlateTextClass} />
                        <p className={truckIdTextClass}>{t.id}</p>
                      </div>
                    </div>
                    {/* Classification */}
                    <div>
                      {t.classification ? (
                        <span className="break-words text-[15px] font-medium text-foreground">{t.classification}</span>
                      ) : (
                        <span className="text-sm italic text-muted-foreground">—</span>
                      )}
                    </div>
                    {/* Capacity */}
                    <div>
                      {t.capacity ? (
                        <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-sm font-medium text-blue-700">
                          <Weight className="w-3 h-3" /> {capacityKgOnly(t.capacity)}
                        </span>
                      ) : (
                        <span className="text-sm italic text-muted-foreground">—</span>
                      )}
                    </div>
                    {/* Status */}
                    <AvailabilityBadge kind="truck" state={truckState(t)} unavailable={t.unavailable} />
                    {canManageFleetAccounts && (
                      <div className="flex items-center gap-1.5">
                        <StatusMenu kind="truck" state={truckState(t)}
                          onMark={() => setUnavailTarget({ kind: 'truck', id: t.id, name: t.plateNumber })}
                          onEdit={() => t.unavailable && setUnavailTarget({ kind: 'truck', id: t.id, name: t.plateNumber, period: t.unavailable })}
                          onBack={() => setBackTarget({ kind: 'truck', id: t.id, name: t.plateNumber })} />
                        <button
                          onClick={() => setTruckTarget({ id: t.id, plate: t.plateNumber })}
                          title="Move truck to archive"
                          className="flex min-h-10 w-fit items-center gap-1.5 whitespace-nowrap rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:border-red-300 hover:bg-red-50"
                        >
                          <Archive className="w-3.5 h-3.5" /> Archive
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              </div>{/* end overflow-x-auto */}

              {/* Mobile and tablet card list */}
              <div className="divide-y divide-border xl:hidden">
                {activeTrucksPage.pageItems.map((t) => (
                  <div key={t.id} className="p-4">
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="h-13 w-13 flex-shrink-0 overflow-hidden rounded-lg border border-[#0d9488]/20 bg-[#0d9488]/15 p-0.5">
                        <TruckImage className="h-full w-full" classification={t.classification} iconClassName="w-5 h-5 text-[#0d9488]" />
                      </div>
                      <div className="flex min-w-[150px] flex-1 flex-col items-start justify-center gap-0.5">
                        <IdentifierCopy value={t.plateNumber} description="truck plate number" className={truckPlateTextClass} />
                        <p className={truckIdTextClass}>{t.id}</p>
                      </div>
                      <AvailabilityBadge kind="truck" state={truckState(t)} unavailable={t.unavailable} />
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-3 border-t border-border/60 pt-3 text-sm sm:grid-cols-2">
                      <div>
                        <p className="mb-1 flex items-center gap-1 font-medium text-muted-foreground"><Package className="w-3.5 h-3.5" /> Classification</p>
                        {t.classification ? (
                          <span className="break-words text-[15px] font-medium text-foreground">{t.classification}</span>
                        ) : (
                          <span className="text-muted-foreground italic">—</span>
                        )}
                      </div>
                      <div>
                        <p className="mb-1 flex items-center gap-1 font-medium text-muted-foreground"><Weight className="w-3.5 h-3.5" /> Capacity</p>
                        {t.capacity ? (
                          <span className="inline-flex max-w-full items-center gap-1.5 break-words rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-sm font-medium text-blue-700">
                            {capacityKgOnly(t.capacity)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground italic">—</span>
                        )}
                      </div>
                    </div>
                    {canManageFleetAccounts && (
                      <div className="mt-3 flex gap-2">
                        <StatusMenu block kind="truck" state={truckState(t)}
                          onMark={() => setUnavailTarget({ kind: 'truck', id: t.id, name: t.plateNumber })}
                          onEdit={() => t.unavailable && setUnavailTarget({ kind: 'truck', id: t.id, name: t.plateNumber, period: t.unavailable })}
                          onBack={() => setBackTarget({ kind: 'truck', id: t.id, name: t.plateNumber })} />
                        <button
                          onClick={() => setTruckTarget({ id: t.id, plate: t.plateNumber })}
                          className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:border-red-300 hover:bg-red-50"
                        >
                          <Archive className="w-3.5 h-3.5" /> Archive
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              </div>
              <PaginationFooter page={activeTrucksPage.page} totalItems={visibleTrucks.length} readable
                onPageChange={activeTrucksPage.setPage} singular="truck" plural="trucks"
                className="border-t border-border bg-muted/20" />
            </div>
          ))}
        </div>
      )}

      {/* ════ DIALOG: Archive driver (password required) ════ */}
      {deleteTarget && canManageFleetAccounts && (
        <ConfirmPasswordDialog
          title="Move driver to archive?"
          message={<>
            <span className="font-medium text-foreground">{deleteTarget.name}</span> will be moved to the archive.
            They'll no longer be able to log in or be assigned deliveries. Their past deliveries stay in the records.
          </>}
          blockedReason={driverBlockedReason(deleteTarget.id, deleteTarget.name)}
          confirmLabel="Move to Archive"
          busyLabel="Archiving…"
          onConfirm={() => handleArchiveDriver(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
          errorText={accountActionError}
        />
      )}

      {/* ════ DIALOG: New PIN (password required) ════ */}
      {pinTarget && (canResetPins || coverageUnverified) && (
        <ConfirmPasswordDialog
          blockedReason={coverageBlock}
          tone="primary"
          title="Set a new PIN?"
          message={<>
            A new 4-digit PIN will be generated for <span className="font-medium text-foreground">{pinTarget.name}</span>.
            Their current PIN will stop working.{!canManageFleetAccounts && ' You will see the new PIN once, to give to the driver.'}
          </>}
          confirmLabel="Set New PIN"
          busyLabel="Saving…"
          onConfirm={() => handleNewPin(pinTarget)}
          onCancel={() => setPinTarget(null)}
          errorText={(err) => err instanceof Error && err.message === 'coverage_not_verified' ? 'Temporary fleet access is not verified. Retry the coverage check.' : !canManageFleetAccounts && err instanceof AssignmentActionError && err.code === 'not_authorized'
            ? 'Your leave coverage has ended or was revoked.'
            : accountActionError(err)}
        />
      )}

      {/* ════ DIALOG: the new PIN a covering CSR just set (shown once) ════ */}
      {issuedPin && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div role="dialog" aria-modal="true" aria-labelledby="issued-pin-title"
            className="relative w-full max-w-[360px] rounded-2xl border border-border bg-white p-5 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-[#1DBF73]/25 bg-[#1DBF73]/10">
              <KeyRound className="h-5 w-5 text-[#1DBF73]" />
            </div>
            <p id="issued-pin-title" className="text-center text-base font-semibold text-foreground">New PIN for {issuedPin.name}</p>
            <p className="mt-3 rounded-xl border border-primary/30 bg-muted/20 py-3 text-center font-mono text-3xl font-semibold tracking-[0.35em] text-primary">{issuedPin.pin}</p>
            <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
              <Shield className="mt-0.5 h-3 w-3 flex-shrink-0" />
              Give this PIN to the driver privately. It is shown only now and cannot be viewed again.
            </p>
            <button type="button" autoFocus onClick={() => setIssuedPin(null)}
              className="mt-4 w-full rounded-xl bg-[#1DBF73] py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#19a865]">
              Done
            </button>
          </div>
        </div>
      )}

      {/* ════ DIALOG: Archive truck (no password) ════ */}
      {truckTarget && canManageFleetAccounts && (
        <ConfirmPasswordDialog
          requirePassword={false}
          title="Move truck to archive?"
          message={<>
            <span className="font-mono font-semibold text-foreground">{truckTarget.plate}</span> will be moved to the archive
            and can no longer be assigned to deliveries. Its past deliveries stay in the records.
          </>}
          blockedReason={truckBlockedReason(truckTarget.id, truckTarget.plate)}
          confirmLabel="Move to Archive"
          busyLabel="Archiving…"
          onConfirm={() => handleArchiveTruck(truckTarget)}
          onCancel={() => setTruckTarget(null)}
          errorText={accountActionError}
        />
      )}

      {/* ════ DIALOG: mark unavailable / under maintenance, or edit the open period (OPM only) ════ */}
      {unavailTarget && canManageFleetAccounts && (
        <UnavailabilityDialog
          key={`${unavailTarget.kind}-${unavailTarget.id}-${unavailTarget.period?.id ?? 'new'}`}
          kind={unavailTarget.kind}
          name={unavailTarget.name}
          mode={unavailTarget.period ? 'edit' : 'mark'}
          initial={unavailTarget.period}
          onSubmit={handleUnavailableSubmit}
          onCancel={() => setUnavailTarget(null)}
          errorText={unavailabilityErrorText}
        />
      )}

      {/* ════ DIALOG: mark back (no password — it only restores access) ════ */}
      {backTarget && canManageFleetAccounts && (
        <ConfirmPasswordDialog
          requirePassword={false}
          tone="primary"
          title={backTarget.kind === 'driver' ? 'Mark driver available again?' : 'Put truck back in service?'}
          message={<>
            <span className="font-medium text-foreground">{backTarget.name}</span>{' '}
            {backTarget.kind === 'driver' ? 'can be given deliveries again straight away.' : 'can be assigned to deliveries again straight away.'}
          </>}
          confirmLabel={backTarget.kind === 'driver' ? 'Mark Available' : 'Back in Service'}
          busyLabel="Saving…"
          onConfirm={() => handleMarkBack(backTarget)}
          onCancel={() => setBackTarget(null)}
          errorText={unavailabilityErrorText}
        />
      )}

      {/* ════ MODAL: Register Driver ════ */}
      {showAddDriver && (
        <RegisterDriverModal
          submissionBlockedReason={coverageBlock}
          temporaryAccessEnded={registrationAccessEnded}
          temporaryAccess={!canManageFleetAccounts}
          onRetryVerification={coverage.status === 'error' ? coverage.retry : undefined}
          drivers={drivers}
          onServerChange={onServerChange}
          onCreated={(driver) => { setAvailabilityFilter('all'); markLocalRecordAdded('driver', driver.id); activeDriversPage.setPage(1); }}
          onClose={() => setShowAddDriver(false)}
        />
      )}

      {/* ════ MODAL: Register Truck ════ */}
      {showAddTruck && (
        <RegisterTruckModal
          submissionBlockedReason={coverageBlock}
          temporaryAccessEnded={registrationAccessEnded}
          temporaryAccess={!canManageFleetAccounts}
          onRetryVerification={coverage.status === 'error' ? coverage.retry : undefined}
          trucks={trucks}
          onServerChange={onServerChange}
          onClose={() => setShowAddTruck(false)}
        />
      )}
    </div>
  );
}
