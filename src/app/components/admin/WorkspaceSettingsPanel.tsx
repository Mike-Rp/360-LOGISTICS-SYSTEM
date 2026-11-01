import { useState, useEffect, useRef } from 'react';
import {
  X, Users, UserPlus, Clock, ClipboardList, Search, ChevronRight,
  LogIn, CheckCircle, XCircle, FileCheck, FileX, UserX, UserMinus,
  RefreshCw, Shield, Mail, Pencil, Archive, KeyRound, Truck, CalendarClock, Phone, Wrench, UserCheck,
} from 'lucide-react';
import { listTeamMembers, createTeamMember, archiveTeamMember, restoreTeamMember, listCsrPasswordResetRequests, reviewCsrPasswordReset, createCsrPasswordResetLink, resolveAvatarUrls,
  listFleetDelegations, grantFleetDelegation, revokeFleetDelegation } from '../../lib/db';
import type { CsrPasswordResetRequest } from '../../lib/db';
import { checkNewCoverageWindow, delegationScopeLabel, delegationStatus, formatContactPhone, formatWindowLength, normalizeContactPhone, toLocalInputValue,
  type DelegationStatus, type FleetDelegation } from '../../lib/fleetDelegation';
import ConfirmPasswordDialog from './ConfirmPasswordDialog';
import type { AdminActivityEntry, AdminActivityType, AdminActivityInput, TeamMember } from '../../data/assignmentTypes';
import { PaginationFooter } from './Pagination';
import { pushAdminNavigation } from '../../lib/adminNavigation';
import { pageForPasswordResetRequest } from '../../lib/pendingPasswordResetRequests';
import { subscriberProblem } from '../../lib/philippineMobile';
import MobileNumberField from './MobileNumberField';
import { TeamMemberCreationError, teamMemberNameError, teamMemberEmailError, validateTeamMemberFields, type TeamMemberFieldErrors } from '../../lib/teamMemberValidation';
import { useCoverageLookup } from '../../lib/useCoverageLookup';
import { DateField, TimeField } from './ScheduleFields';
import { formatPhilippineTimestamp, PHILIPPINE_TIME_LABEL } from '../../lib/philippineTime';
import { useModalFocus } from './useModalFocus';
import DiscardChangesDialog from './DiscardChangesDialog';

/* ── Activity log helpers — moved here from SettingsPanel.tsx, extended for member events ── */
const ACT_CONFIG: Record<AdminActivityType, { label: string; icon: React.ElementType; color: string }> = {
  login:               { label: 'Admin Login',    icon: LogIn,        color: 'text-blue-500'   },
  task_assigned:       { label: 'Task Assigned',  icon: ClipboardList, color: 'text-purple-500' },
  task_completed:      { label: 'Task Completed', icon: CheckCircle,  color: 'text-green-500'  },
  task_cancelled:      { label: 'Delivery Cancelled', icon: XCircle, color: 'text-red-500' },
  task_edited:         { label: 'Task Edited',    icon: Pencil,       color: 'text-amber-500'  },
  driver_added:        { label: 'Driver Added',    icon: UserPlus,    color: 'text-blue-500'   },
  issue_reported:      { label: 'Issue Reported',  icon: XCircle,      color: 'text-red-600'    },
  issue_resolved:      { label: 'Issue Resolved',  icon: CheckCircle,  color: 'text-green-600'  },
  driver_archived:     { label: 'Driver Archived', icon: Archive,     color: 'text-orange-500' },
  driver_pin_reset:    { label: 'Driver PIN Reset', icon: KeyRound,   color: 'text-blue-600'   },
  truck_added:         { label: 'Truck Added',     icon: Truck,       color: 'text-blue-500'   },
  truck_archived:      { label: 'Truck Archived',  icon: Archive,     color: 'text-orange-500' },
  doc_approved:        { label: 'Document Approved', icon: FileCheck, color: 'text-teal-500' },
  doc_rejected:        { label: 'Document Rejected', icon: FileX, color: 'text-red-500' },
  driver_deleted:      { label: 'Driver Removed', icon: UserX,        color: 'text-orange-500' },
  member_added:        { label: 'Member Added',   icon: UserPlus,     color: 'text-blue-500'   },
  member_archived:     { label: 'Member Archived', icon: UserMinus,   color: 'text-red-500'    },
  member_restored:     { label: 'Member Restored', icon: RefreshCw,   color: 'text-green-600'  },
  password_reset_requested: { label: 'Password Reset Requested', icon: Mail, color: 'text-amber-600' },
  password_reset_approved:  { label: 'Password Reset Approved', icon: CheckCircle, color: 'text-green-600' },
  password_reset_link_generated: { label: 'Password Reset Link Generated', icon: ClipboardList, color: 'text-blue-600' },
  password_reset_rejected:  { label: 'Password Reset Rejected', icon: XCircle, color: 'text-red-600' },
  password_changed:         { label: 'Password Changed', icon: Shield, color: 'text-blue-600' },
  delegation_granted:       { label: 'Leave Coverage Granted', icon: CalendarClock, color: 'text-blue-600' },
  delegation_revoked:       { label: 'Leave Coverage Ended', icon: CalendarClock, color: 'text-orange-500' },
  driver_help_phone_changed: { label: 'Driver Help Number Changed', icon: Phone, color: 'text-blue-600' },
  driver_unavailable:        { label: 'Driver Unavailable', icon: UserX, color: 'text-amber-600' },
  driver_available_again:    { label: 'Driver Available Again', icon: UserCheck, color: 'text-green-600' },
  truck_maintenance_started: { label: 'Truck Under Maintenance', icon: Wrench, color: 'text-amber-600' },
  truck_maintenance_ended:   { label: 'Truck Back In Service', icon: Truck, color: 'text-green-600' },
  unavailability_updated:    { label: 'Unavailability Updated', icon: Pencil, color: 'text-blue-600' },
};

function fmtTs(ts: string): string {
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return ts; }
}

// The retained legacy admin account has CSR permissions; OPM is a separate role.
function activityRole(role?: string): 'OPM' | 'CSR' | null {
  switch (role?.trim().toLowerCase()) {
    case 'opm':
    case 'operational_manager': return 'OPM';
    case 'csr':
    case 'admin':
    case 'administrator': return 'CSR';
    default: return null;
  }
}

function getDesc(e: AdminActivityEntry): string {
  switch (e.type) {
    case 'login':                return `${e.adminEmail ?? 'Admin'} signed in`;
    case 'task_assigned':        return `Assigned to ${e.driverName ?? '—'} · ${e.destination ?? ''}`;
    case 'task_completed':       return 'Delivery marked complete';
    case 'task_cancelled':       return 'Assignment cancelled';
    case 'task_edited':          return `Edited ${e.assignmentId ?? 'delivery'} (${Object.keys(e.changes ?? {}).length} field${Object.keys(e.changes ?? {}).length === 1 ? '' : 's'}) — ${e.reason ?? 'no reason'}`;
    case 'issue_reported':       return `Driver reported an issue${e.reason ? `: ${e.reason}` : ''}`;
    case 'issue_resolved':       return `Blocking issue resolved${e.reason ? ` · Note: ${e.reason}` : ''}`;
    case 'doc_approved':         return `Approved "${e.docType ?? 'document'}" for ${e.driverName ?? '—'}`;
    case 'doc_rejected':         return `Rejected "${e.docType ?? 'document'}" for ${e.driverName ?? '—'}`;
    case 'driver_deleted':       return `Removed driver "${e.driverName ?? '—'}"`;
    case 'driver_archived':      return `Moved driver "${e.driverName ?? '—'}" to archive`;
    case 'driver_pin_reset':     return `New PIN set for "${e.driverName ?? '—'}"${underDelegation(e)}`;
    case 'driver_added':         return `Registered driver ${e.driverName ?? '—'}${underDelegation(e)}`;
    case 'truck_added':          return `Registered truck ${e.truckPlate ?? '—'}${underDelegation(e)}`;
    case 'truck_archived':       return `Moved truck ${e.truckPlate ?? '—'} to archive`;
    case 'member_added':         return `Added ${e.memberName ?? e.memberEmail ?? 'a member'} to the team`;
    case 'member_archived':      return `Archived ${e.memberName ?? e.memberEmail ?? 'a member'}`;
    case 'member_restored':      return `Restored ${e.memberName ?? e.memberEmail ?? 'a member'}`;
    case 'password_reset_requested': return `Reset requested for ${e.memberName ?? e.memberEmail ?? 'a CSR member'}`;
    case 'password_reset_approved': return `Approved reset request for ${e.memberName ?? e.memberEmail ?? 'a CSR member'}`;
    case 'password_reset_link_generated': return `Generated reset link for ${e.memberName ?? e.memberEmail ?? 'a CSR member'}`;
    case 'password_reset_rejected': return `Rejected reset request for ${e.memberName ?? e.memberEmail ?? 'a CSR member'}`;
    case 'password_changed': return `Password changed by ${e.memberName ?? e.memberEmail ?? 'a CSR member'}`;
    case 'delegation_granted': return `Leave coverage for ${e.memberName ?? e.memberEmail ?? 'a CSR member'}${e.reason ? ` — ${e.reason}` : ''}`;
    case 'delegation_revoked': return `Ended leave coverage for ${e.memberName ?? e.memberEmail ?? 'a CSR member'}`;
    case 'driver_help_phone_changed': return `Driver Forgot-PIN number: ${e.reason ?? 'changed'}`;
    case 'driver_unavailable':        return `${e.driverName ?? 'A driver'} marked unavailable — ${e.reason ?? 'no reason given'}`;
    case 'driver_available_again':    return `${e.driverName ?? 'A driver'} is available again`;
    case 'truck_maintenance_started': return `Truck ${e.truckPlate ?? '—'} put under maintenance${e.reason ? ` — ${e.reason.replace(/^Maintenance — /, '')}` : ''}`;
    case 'truck_maintenance_ended':   return `Truck ${e.truckPlate ?? '—'} is back in service`;
    case 'unavailability_updated':    return `Unavailability updated for ${e.driverName ?? (e.truckPlate ? 'truck ' + e.truckPlate : 'a driver or truck')}${e.reason ? ` — ${e.reason.replace(/^Updated — ?/, '') || 'details changed'}` : ''}`;
  }
}

/* Rows a CSR wrote while covering for the OPM are marked by the database function. */
function underDelegation(e: AdminActivityEntry): string {
  return e.reason === 'Under OPM delegation' ? ' · under OPM delegation' : '';
}

/* ── Modal shell (mirrors RegisterModals.tsx's local ModalShell) ── */
function ModalShell({ title, onClose, children, footer }: {
  title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  useModalFocus(true, modalRef, onClose);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div ref={modalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="relative bg-white rounded-2xl shadow-2xl min-w-0 w-full max-w-md flex flex-col max-h-[90dvh] animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none">
        <div className="flex items-center justify-between gap-2 px-5 sm:px-6 py-4 border-b border-border flex-shrink-0">
          <h3 className="min-w-0 text-lg font-semibold text-foreground">{title}</h3>
          <button type="button" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-accent transition-colors text-muted-foreground focus-visible:outline-2 focus-visible:outline-primary">
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>
        <div className="min-h-0 p-5 sm:p-6 overflow-y-auto overflow-x-hidden flex-1">{children}</div>
        {footer && <div className="px-6 pb-5 pt-3 border-t border-border flex-shrink-0">{footer}</div>}
      </div>
    </div>
  );
}

/* ── Add Member Modal ── */
function AddMemberModal({ onClose, onAdded }: {
  onClose: () => void;
  onAdded: (member: TeamMember) => void;
}) {
  const [name,       setName]       = useState('');
  const [email,      setEmail]      = useState('');
  const [error,      setError]      = useState('');
  const [fieldErrors, setFieldErrors] = useState<TeamMemberFieldErrors>({});
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [created,    setCreated]    = useState<(TeamMember & { setupToken: string }) | null>(null);
  const [copied,     setCopied]     = useState(false);
  const [copyError,  setCopyError]  = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const requestClose = () => {
    if (submittingRef.current) return;
    if (!created && (name || email)) setConfirmDiscard(true);
    else onClose();
  };

  const handleAdd = async () => {
    if (submittingRef.current || created) return;
    setError('');
    const errors = validateTeamMemberFields(name, email);
    setFieldErrors(errors);
    if (errors.name || errors.email) {
      (errors.name ? nameRef : emailRef).current?.focus();
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      /* Creates the Supabase Auth login + the profile row in one database call (only the
         Operation Manager is allowed — the function checks). No password is set by this
         screen at all — the RPC issues a one-time setup link instead (same mechanism as
         the CSR password reset link), so nothing ever has to be relayed out-of-band. */
      const member = await createTeamMember({ name: name.trim(), email: email.trim(), role: 'csr' });
      setCreated(member);
      onAdded(member);
    } catch (e) {
      console.error('[createTeamMember] error:', e);
      if (e instanceof TeamMemberCreationError && e.field !== 'general') {
        setFieldErrors({ [e.field]: e.message });
        (e.field === 'name' ? nameRef : emailRef).current?.focus();
      } else {
        setError(e instanceof TeamMemberCreationError ? e.message : 'Could not add this team member. Please try again.');
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleCopyLink = async () => {
    if (!created) return;
    setCopyError('');
    const link = `${window.location.origin}/reset-password?token=${encodeURIComponent(created.setupToken)}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const input = document.createElement('textarea');
      input.value = link;
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      const ok = document.execCommand('copy');
      input.remove();
      if (!ok) { setCopyError('Could not copy automatically — select and copy the link manually.'); return; }
    }
    setCopied(true);
  };

  return (
    <><ModalShell title="Add Team Member" onClose={requestClose}>
      {!created ? (
        <form noValidate onSubmit={(event) => { event.preventDefault(); void handleAdd(); }} className="space-y-5">
          <div>
            <label htmlFor="team-member-name" className="block text-sm font-medium text-foreground mb-1.5">Name <span className="text-red-500">*</span></label>
            <input
              id="team-member-name" ref={nameRef} type="text" value={name} disabled={submitting} required
              aria-invalid={!!fieldErrors.name || undefined} aria-describedby={fieldErrors.name ? 'team-member-name-error' : undefined}
              onChange={(e) => {
                setName(e.target.value); setError('');
                setFieldErrors((previous) => previous.name ? { ...previous, name: teamMemberNameError(e.target.value) } : previous);
              }}
              placeholder="e.g. Sofia Petrov"
              className={`w-full px-4 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 ${fieldErrors.name ? 'border-red-400 bg-red-50' : 'border-border bg-white'}`}
            />
            {fieldErrors.name && <p id="team-member-name-error" role="alert" className="mt-1.5 text-sm text-red-600">{fieldErrors.name}</p>}
          </div>

          <div>
            <label htmlFor="team-member-email" className="block text-sm font-medium text-foreground mb-1.5">
              <span className="flex items-center gap-1.5"><Mail className="w-4 h-4 text-primary/70" /> Email <span className="text-red-500">*</span></span>
            </label>
            <input
              id="team-member-email" ref={emailRef} type="email" value={email} disabled={submitting} required
              aria-invalid={!!fieldErrors.email || undefined} aria-describedby={fieldErrors.email ? 'team-member-email-error' : undefined}
              onChange={(e) => {
                setEmail(e.target.value); setError('');
                setFieldErrors((previous) => previous.email ? { ...previous, email: teamMemberEmailError(e.target.value) } : previous);
              }}
              placeholder="name@company.com"
              className={`w-full px-4 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 ${fieldErrors.email ? 'border-red-400 bg-red-50' : 'border-border bg-white'}`}
            />
            {fieldErrors.email && <p id="team-member-email-error" role="alert" className="mt-1.5 text-sm text-red-600">{fieldErrors.email}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Role</label>
            <div className="px-3 py-3 rounded-xl border border-border bg-muted/20">
              <p className="text-sm font-semibold text-foreground">CSR</p>
              <p className="text-xs text-muted-foreground mt-0.5">Full read/write access. CSR is the only role OPM can create.</p>
            </div>
          </div>

          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={requestClose} disabled={submitting} className="flex-1 px-4 py-2.5 border border-border rounded-xl hover:bg-accent transition-colors text-sm disabled:opacity-50">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2.5 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <UserPlus className="w-4 h-4" /> {submitting ? 'Adding…' : 'Add Member'}
            </button>
          </div>
        </form>
      ) : (
        <div className="text-center py-4 space-y-4">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle className="w-8 h-8 text-green-500" />
          </div>
          <div>
            <h4 className="font-semibold text-foreground text-lg">{created.name} added!</h4>
            <p className="text-sm text-muted-foreground mt-1">Share this setup link with them privately. It lets them choose their own password and expires in 7 days.</p>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-left space-y-1">
            <p className="text-xs font-semibold text-amber-700 flex items-center gap-1.5 mb-2">
              <Shield className="w-3.5 h-3.5" /> Account Setup
            </p>
            <p className="text-xs text-amber-600">Email: <strong>{created.email}</strong></p>
            <p className="text-xs text-amber-600">Role: <strong>CSR</strong></p>
          </div>
          {copyError && <p className="text-xs text-red-500">{copyError}</p>}
          <button onClick={handleCopyLink} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors text-sm font-medium">
            {copied ? 'Copied!' : 'Copy Setup Link'}
          </button>
          <button onClick={onClose} className="w-full px-4 py-2.5 border border-border rounded-xl hover:bg-accent transition-colors text-sm font-medium">
            Done
          </button>
        </div>
      )}
    </ModalShell>
    <DiscardChangesDialog open={confirmDiscard} onKeepEditing={() => setConfirmDiscard(false)} onDiscard={onClose} /></>
  );
}

/* ── Leave coverage (REQ-018): the OPM lets one CSR reset PINs / register drivers and trucks for a window ── */
interface CoverageDraft {
  csr: TeamMember;
  startsAt: Date;
  endsAt: Date;
  length: string;
  canResetPin: boolean;
  canRegister: boolean;
  /** Local form 09XXXXXXXXX — what drivers are shown on "Forgot your PIN?"; only set with PIN-reset coverage. */
  contactPhone: string | null;
}

const COVERAGE_BADGE: Record<DelegationStatus, { label: string; className: string }> = {
  active:    { label: 'Active',    className: 'border-green-200 bg-green-50 text-green-700' },
  scheduled: { label: 'Scheduled', className: 'border-blue-200 bg-blue-50 text-blue-700' },
  ended:     { label: 'Ended',     className: 'border-border bg-muted/50 text-muted-foreground' },
  revoked:   { label: 'Ended early', className: 'border-orange-200 bg-orange-50 text-orange-700' },
};

function CoverageModal({ members, onClose, onContinue }: {
  members: TeamMember[];
  onClose: () => void;
  onContinue: (draft: CoverageDraft) => void;
}) {
  const csrs = members.filter((member) => member.status === 'active');
  const [csrId,       setCsrId]       = useState('');
  const [start,       setStart]       = useState(() => toLocalInputValue(new Date()));
  const [end,         setEnd]         = useState('');
  const [canResetPin, setCanResetPin] = useState(true);
  const [canRegister, setCanRegister] = useState(true);
  /* The 10 digits after +63 (same field behaviour as Register Driver: digits only, stops at 10). */
  const [phone,       setPhone]       = useState('');
  const [phoneError,  setPhoneError]  = useState('');
  const [error,       setError]       = useState('');
  const [now, setNow] = useState(Date.now());
  const [errorField, setErrorField] = useState<'csr' | 'scopes' | 'window' | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const original = useRef({ start, end, csrId, canResetPin, canRegister, phone });
  const requestClose = () => {
    const initial = original.current;
    if (start !== initial.start || end !== initial.end || csrId !== initial.csrId || canResetPin !== initial.canResetPin || canRegister !== initial.canRegister || phone !== initial.phone) setConfirmDiscard(true);
    else onClose();
  };
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);
  const today = toLocalInputValue(new Date(now)).slice(0, 10);
  const [startDate = '', startTime = ''] = start.split('T');
  const [endDate = '', endTime = ''] = end.split('T');
  const windowCheck = checkNewCoverageWindow(start, end, now);

  const handleContinue = () => {
    const csr = csrs.find((member) => member.id === csrId);
    if (!csr) { setErrorField('csr'); setError('Choose which CSR will cover for you.'); document.getElementById('coverage-csr')?.focus(); return; }
    if (!canResetPin && !canRegister) { setErrorField('scopes'); setError('Choose at least one thing the CSR may do.'); document.getElementById('coverage-reset-pin')?.focus(); return; }
    if (canResetPin && subscriberProblem(phone)) { setPhoneError(subscriberProblem(phone)); document.getElementById('coverage-phone')?.focus(); return; }
    const contactPhone = canResetPin ? normalizeContactPhone(`+63${phone}`) : null;
    if (canResetPin && !contactPhone) { setPhoneError('Enter a valid 10-digit mobile number.'); document.getElementById('coverage-phone')?.focus(); return; }
    const checked = checkNewCoverageWindow(start, end, Date.now());
    if (!checked.ok) { setErrorField('window'); setError(checked.error); document.getElementById(end ? 'coverage-start' : 'coverage-end')?.focus(); return; }
    onContinue({ csr, startsAt: checked.startsAt, endsAt: checked.endsAt, length: checked.length, canResetPin, canRegister, contactPhone });
  };

  const inputClass = 'w-full px-4 py-3 rounded-xl border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/30';
  return (
    <><ModalShell title="Add Leave Coverage" onClose={requestClose}>
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">
          The CSR gets only what you tick, only between these times. They can never view existing PINs, archive anyone, or manage the team.
        </p>

        <div>
          <label htmlFor="coverage-csr" className="block text-sm font-medium text-foreground mb-1.5">CSR covering for you <span className="text-red-500">*</span></label>
          <select id="coverage-csr" value={csrId} aria-invalid={!!error && errorField === 'csr' || undefined} aria-describedby={error && errorField === 'csr' ? 'coverage-csr-error' : undefined} onChange={(e) => { setCsrId(e.target.value); setError(''); }} className={inputClass}>
            <option value="">{csrs.length === 0 ? 'No active CSR members' : 'Choose a CSR…'}</option>
            {csrs.map((member) => <option key={member.id} value={member.id}>{member.name} — {member.email}</option>)}
          </select>
          {error && errorField === 'csr' && <p id="coverage-csr-error" role="alert" className="mt-1 text-sm text-red-600">{error}</p>}
        </div>

        <fieldset aria-describedby={error && errorField === 'scopes' ? 'coverage-scopes-error' : undefined}>
          <legend className="block text-sm font-medium text-foreground mb-2">They may</legend>
          <div className="space-y-2">
            <label className="flex items-start gap-3 rounded-xl border border-border px-3 py-2.5 text-sm">
              <input id="coverage-reset-pin" type="checkbox" checked={canResetPin} aria-invalid={!!error && errorField === 'scopes' || undefined} aria-describedby={error && errorField === 'scopes' ? 'coverage-scopes-error' : undefined} onChange={(e) => { setCanResetPin(e.target.checked); setError(''); }} className="mt-0.5 h-4 w-4" />
              <span><span className="font-medium text-foreground">Set new driver PINs</span>
                <span className="block text-sm text-muted-foreground">They see only the PIN they just set, once.</span></span>
            </label>
            <label className="flex items-start gap-3 rounded-xl border border-border px-3 py-2.5 text-sm">
              <input type="checkbox" checked={canRegister} aria-invalid={!!error && errorField === 'scopes' || undefined} aria-describedby={error && errorField === 'scopes' ? 'coverage-scopes-error' : undefined} onChange={(e) => { setCanRegister(e.target.checked); setError(''); }} className="mt-0.5 h-4 w-4" />
              <span><span className="font-medium text-foreground">Register new drivers and trucks</span>
                <span className="block text-sm text-muted-foreground">For when someone new joins while you are away.</span></span>
            </label>
          </div>
          {error && errorField === 'scopes' && <p id="coverage-scopes-error" role="alert" className="mt-1 text-sm text-red-600">{error}</p>}
        </fieldset>

        {canResetPin && (
          <div>
            <label htmlFor="coverage-phone" className="block text-sm font-medium text-foreground mb-1.5">Number drivers should call <span className="text-red-500">*</span></label>
            <MobileNumberField id="coverage-phone" value={phone} error={phoneError} ariaLabel="Mobile number drivers should call, ten digits after +63"
              onChange={(digits) => { setPhone(digits); setError(''); }} onError={setPhoneError}
              onBlur={() => { if (phone && subscriberProblem(phone)) setPhoneError(subscriberProblem(phone)); }} />
            <p className="mt-1 text-sm text-muted-foreground">
              A driver who forgot their PIN sees this number on the login screen while this coverage is active (usually the covering CSR&apos;s mobile). Afterwards the screen goes back to the usual number.
            </p>
          </div>
        )}

        <p className="text-sm text-muted-foreground">{PHILIPPINE_TIME_LABEL}</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="coverage-start" className="block text-sm font-medium text-foreground mb-1.5">Starts <span className="text-red-500">*</span></label>
            <div className="space-y-2">
              <DateField id="coverage-start" label="Coverage start date" value={startDate} minIso={today} calendarToday={today} restrictToday layer
                hasError={(!!startDate && startDate < today) || (!!error && errorField === 'window')} describedBy={error && errorField === 'window' ? 'coverage-window-error' : undefined}
                onChange={(date) => { setStart(`${date}T${startTime}`); setError(''); }} />
              <TimeField label="Coverage start time" value={startTime} layer hasError={!!error && errorField === 'window'} describedBy={error && errorField === 'window' ? 'coverage-window-error' : undefined}
                onChange={(time) => { setStart(`${startDate}T${time}`); setError(''); }} />
            </div>
          </div>
          <div>
            <label htmlFor="coverage-end" className="block text-sm font-medium text-foreground mb-1.5">Ends <span className="text-red-500">*</span></label>
            <div className="space-y-2">
              <DateField id="coverage-end" label="Coverage end date" value={endDate} minIso={startDate > today ? startDate : today} calendarToday={today} restrictToday layer
                hasError={!!error && errorField === 'window'} describedBy={error && errorField === 'window' ? 'coverage-window-error' : undefined}
                onChange={(date) => { setEnd(`${date}T${endTime}`); setError(''); }} />
              <TimeField label="Coverage end time" value={endTime} layer hasError={!!error && errorField === 'window'} describedBy={error && errorField === 'window' ? 'coverage-window-error' : undefined}
                onChange={(time) => { setEnd(`${endDate}T${time}`); setError(''); }} />
            </div>
          </div>
        </div>
        {start && end && (windowCheck.ok
          ? <p role="status" className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">That is <strong>{windowCheck.length}</strong> of coverage. Check the dates are right.</p>
          : !error && <p role="status" className="text-sm text-red-600">{windowCheck.error}</p>)}

        {error && errorField === 'window' && <p id="coverage-window-error" role="alert" className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={requestClose} className="flex-1 px-4 py-2.5 border border-border rounded-xl hover:bg-accent transition-colors text-sm">Cancel</button>
          <button type="button" onClick={handleContinue}
            className="flex-1 px-4 py-2.5 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors text-sm font-medium">
            Continue
          </button>
        </div>
      </div>
    </ModalShell>
    <DiscardChangesDialog open={confirmDiscard} onKeepEditing={() => setConfirmDiscard(false)} onDiscard={onClose} /></>
  );
}

/* ── Main panel ── */
interface Props {
  open: boolean;
  onClose: () => void;
  targetRequestId?: string | null;
  onRequestsChanged?: () => void;
  activityLog: AdminActivityEntry[];
  onLogActivity: (entry: AdminActivityInput) => void;
  adminEmail: string | null;
  adminName?: string;
}

export default function WorkspaceSettingsPanel({ open, onClose, targetRequestId, onRequestsChanged, activityLog, onLogActivity, adminEmail, adminName }: Props) {
  const [tab, setTab] = useState<'members' | 'resets' | 'coverage' | 'activity'>('members');
  const contentScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (contentScrollRef.current) contentScrollRef.current.scrollTop = 0;
  }, [tab]);
  const [memberStatus, setMemberStatus] = useState<'active' | 'removed'>('active');
  const [memberSearch, setMemberSearch] = useState('');
  const [memberPage, setMemberPage] = useState(1);
  const [members,     setMembers]     = useState<TeamMember[]>([]);
  const [memberAvatars, setMemberAvatars] = useState<Map<string, string>>(new Map());
  const [loading,     setLoading]     = useState(false);
  const [loadError,   setLoadError]   = useState('');
  const [showAddMember,  setShowAddMember]  = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<TeamMember | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<TeamMember | null>(null);
  const [logSearch,   setLogSearch]   = useState('');
  const [logAction, setLogAction] = useState<AdminActivityType | 'all'>('all');
  const [logRole, setLogRole] = useState<'all' | 'csr' | 'opm'>('all');
  const [logDate, setLogDate] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [resetRequests, setResetRequests] = useState<CsrPasswordResetRequest[]>([]);
  const [resetLoaded, setResetLoaded] = useState(false);
  const resetFetchEpoch = useRef(0);
  const [resetStatus, setResetStatus] = useState<CsrPasswordResetRequest['status'] | 'all'>('all');
  const [resetSearch, setResetSearch] = useState('');
  const [resetPage, setResetPage] = useState(1);
  const [resetBusyId, setResetBusyId] = useState<string | null>(null);
  const [resetError, setResetError] = useState('');
  /* A failed Approve / Reject / Copy shows a message but keeps the list on screen;
     resetError is only for when the list itself could not be loaded. */
  const [resetActionError, setResetActionError] = useState('');
  const [resetNotice, setResetNotice] = useState('');
  const [resetClock, setResetClock] = useState(Date.now());
  const [logPage, setLogPage] = useState(1);
  const logPageSize = 10;

  /* Leave coverage (REQ-018) */
  const coverageQuery = useCoverageLookup(open, adminEmail ?? '', listFleetDelegations, 30_000);
  const coverage = coverageQuery.data ?? [];
  const coverageVerified = coverageQuery.status === 'success';
  const [coverageNotice, setCoverageNotice] = useState('');
  const [coverageClock, setCoverageClock] = useState(Date.now());
  const [coverageView, setCoverageView] = useState<'current' | 'past'>('current');
  const [showCoverageModal, setShowCoverageModal] = useState(false);
  const [coverageDraft, setCoverageDraft] = useState<CoverageDraft | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<FleetDelegation | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  useModalFocus(open, workspaceRef, onClose);

  useEffect(() => { if (open) setResetLoaded(false); }, [open]);

  useEffect(() => { if (coverageVerified) setCoverageClock(Date.now()); }, [coverageQuery.data, coverageVerified]);

  useEffect(() => {
    if (!open || !targetRequestId) return;
    setTab('resets');
    setResetStatus('all');
    setResetSearch('');
    setResetPage(1);
    setResetNotice('');
  }, [open, targetRequestId]);

  const fetchMembers = async () => {
    setLoading(true);
    setLoadError('');
    try {
      setMembers(await listTeamMembers());
    } catch (e) {
      console.error('[listTeamMembers] error:', e);
      setLoadError('Could not load team members. Something went wrong, please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (open) fetchMembers(); }, [open]);
  /* One batched signing call for every member's avatar, rather than one request per row. */
  useEffect(() => {
    let alive = true;
    resolveAvatarUrls(members.map((m) => m.avatarPath)).then((map) => { if (alive) setMemberAvatars(map); });
    return () => { alive = false; };
  }, [members]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const refresh = () => {
      const epoch = ++resetFetchEpoch.current;
      setResetClock(Date.now());
      listCsrPasswordResetRequests().then((requests) => {
        if (!cancelled && epoch === resetFetchEpoch.current) { setResetRequests(requests); setResetError(''); setResetLoaded(true); }
      }).catch((error: unknown) => {
        if (!cancelled && epoch === resetFetchEpoch.current) { setResetError(error instanceof Error ? error.message : 'Could not load password reset requests.'); setResetLoaded(true); }
      });
    };
    refresh();
    window.addEventListener('focus', refresh);
    const interval = window.setInterval(refresh, 30_000);
    return () => { cancelled = true; resetFetchEpoch.current++; window.removeEventListener('focus', refresh); window.clearInterval(interval); };
  }, [open]);

  const handleResetReview = async (request: CsrPasswordResetRequest, approve: boolean) => {
    setResetBusyId(request.id);
    setResetError('');
    setResetActionError('');
    setResetNotice('');
    try {
      if (request.status !== 'pending') return;
      await reviewCsrPasswordReset(request.id, approve);
      resetFetchEpoch.current++;
      onRequestsChanged?.();
      try {
        const requests = await listCsrPasswordResetRequests();
        setResetRequests(requests);
        setResetNotice(approve ? 'Request approved. Copy the reset link to share it with the CSR.' : 'Request rejected.');
      } catch {
        setResetError('Request reviewed, but the latest list could not be loaded. Reopen Workspace Settings to refresh.');
      }
    } catch (error) {
      setResetActionError(error instanceof Error ? error.message : 'Could not review this request.');
    } finally {
      setResetBusyId(null);
    }
  };

  const handleCopyResetLink = async (request: CsrPasswordResetRequest) => {
    if (request.status !== 'approved' || !request.expiresAt || new Date(request.expiresAt).getTime() <= Date.now()) return;
    setResetBusyId(request.id);
    setResetError('');
    setResetActionError('');
    setResetNotice('');
    try {
      const token = await createCsrPasswordResetLink(request.id);
      const link = `${window.location.origin}/reset-password?token=${encodeURIComponent(token)}`;
      // The RPC is asynchronous; some browsers may expire clipboard permission while it runs.
      try {
        await navigator.clipboard.writeText(link);
      } catch {
        const input = document.createElement('textarea');
        input.value = link;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand('copy');
        input.remove();
        if (!copied) throw new Error('clipboard_unavailable');
      }
      setResetNotice('Reset link copied to clipboard. Share this latest link with the CSR.');
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : '';
      const messages: Record<string, string> = {
        request_not_approved: 'This request is not approved.',
        request_expired: 'This reset approval has expired. The CSR must submit a new request.',
        member_not_eligible: 'This CSR account is no longer eligible for password reset.',
        reset_in_progress: 'A reset link is already being generated. Try again shortly.',
        not_authorized: 'Only an OPM administrator can copy reset links.',
      };
      setResetActionError(messages[code] ?? 'Could not copy the reset link. Click again to generate a new link.');
    } finally {
      setResetBusyId(null);
    }
  };

  /* ── Body scroll lock ── */
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const handleMemberAdded = (member: TeamMember) => {
    setMembers((p) => [...p, member]);
    onLogActivity({ type: 'member_added', memberName: member.name, memberEmail: member.email });
  };

  const handleArchiveMember = async () => {
    if (!archiveTarget) return;
    await archiveTeamMember(archiveTarget.id);
    await fetchMembers();
    setArchiveTarget(null);
  };

  const handleRestoreMember = async () => {
    if (!restoreTarget) return;
    await restoreTeamMember(restoreTarget.id);
    await fetchMembers();
    setRestoreTarget(null);
  };

  /* The database writes the activity-log row for a grant or revoke itself. */
  const handleGrantCoverage = async () => {
    if (!coverageDraft) return;
    const current = await coverageQuery.runUpdate(() => grantFleetDelegation({
      csrId: coverageDraft.csr.id, startsAt: coverageDraft.startsAt, endsAt: coverageDraft.endsAt,
      canResetPin: coverageDraft.canResetPin, canRegister: coverageDraft.canRegister, contactPhone: coverageDraft.contactPhone,
    }));
    if (!current) return;
    setCoverageNotice(`Leave coverage set for ${coverageDraft.csr.name}.`);
    setCoverageView('current');
    setCoverageDraft(null);
    setShowCoverageModal(false);
  };

  const handleRevokeCoverage = async () => {
    if (!revokeTarget) return;
    const who = members.find((member) => member.id === revokeTarget.csrId)?.name ?? 'the CSR';
    const current = await coverageQuery.runUpdate(() => revokeFleetDelegation(revokeTarget.id));
    if (!current) return;
    setCoverageNotice(`Leave coverage for ${who} has ended.`);
    setRevokeTarget(null);
  };

  const coverageErrorText = (err: unknown): string => {
    const m = err instanceof Error ? err.message : '';
    if (m.includes('coverage_not_verified')) return 'Leave coverage is not verified. Close this confirmation and retry loading coverage.';
    if (m.includes('reauth_required'))       return 'Please enter your password again.';
    if (m.includes('invalid_window'))        return 'The end must be after the start and still in the future.';
    if (m.includes('no_scope'))              return 'Choose at least one thing the CSR may do.';
    if (m.includes('invalid_phone'))         return 'Enter a valid Philippine mobile number for drivers to call.';
    if (m.includes('member_not_found'))      return 'That CSR is no longer active. Close this and refresh the page.';
    if (m.includes('not_authorized'))        return 'Only the Operation Manager can do this.';
    if (m.includes('delegation_not_active')) return 'This coverage has already ended. Refresh the page.';
    if (m.includes('delegation_not_found'))  return 'This coverage could not be found. Refresh the page.';
    return 'Something went wrong. Please try again.';
  };

  /* Plain-language text for the errors archive/restore can return */
  const memberActionErrorText = (err: unknown): string => {
    const m = err instanceof Error ? err.message : '';
    if (m.includes('wrong_password'))    return 'Incorrect password. Please try again.';
    if (m.includes('reauth_required'))   return 'Please enter your password again.';
    if (m.includes('already_archived'))  return 'This member is already archived. Refresh the page.';
    if (m.includes('already_active'))    return 'This member is already active. Refresh the page.';
    if (m.includes('member_not_found'))  return 'This member could not be found. Refresh the page.';
    if (m.includes('not_authorized'))    return 'Only the Operation Manager can do this.';
    return m || 'Something went wrong. Please try again.';
  };

  const pageSize = 10;
  const filteredMembers = members.filter((member) => member.status === memberStatus &&
    `${member.name} ${member.email}`.toLowerCase().includes(memberSearch.trim().toLowerCase()));
  const currentMemberPage = Math.min(memberPage, Math.max(1, Math.ceil(filteredMembers.length / pageSize)));
  const visibleMembers = filteredMembers.slice((currentMemberPage - 1) * pageSize, currentMemberPage * pageSize);
  const effectiveResetStatus = (request: CsrPasswordResetRequest) => request.status === 'approved' &&
    (!request.expiresAt || new Date(request.expiresAt).getTime() <= resetClock) ? 'expired' : request.status;
  const filteredResets = resetRequests.filter((request) => {
    const matchesStatus = resetStatus === 'all' || effectiveResetStatus(request) === resetStatus;
    const name = members.find((member) => member.id === request.userId)?.name ?? '';
    return matchesStatus && `${name} ${request.email}`.toLowerCase().includes(resetSearch.trim().toLowerCase());
  });
  const currentResetPage = Math.min(resetPage, Math.max(1, Math.ceil(filteredResets.length / pageSize)));
  const visibleResets = filteredResets.slice((currentResetPage - 1) * pageSize, currentResetPage * pageSize);
  useEffect(() => {
    if (!open || tab !== 'resets' || !targetRequestId || !resetLoaded || resetError) return;
    const page = pageForPasswordResetRequest(filteredResets, targetRequestId, pageSize);
    if (page === null) return;
    if (currentResetPage !== page) { setResetPage(page); return; }
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`reset-request-${targetRequestId}`)?.scrollIntoView({ block: 'nearest' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, tab, targetRequestId, resetLoaded, resetError, currentResetPage, resetRequests, resetStatus, resetSearch]);
  const filteredLog = activityLog.filter((entry) => {
    if (logAction !== 'all' && entry.type !== logAction) return false;
    if (logRole !== 'all' && activityRole(entry.adminRole)?.toLowerCase() !== logRole) return false;
    if (logDate !== 'all') {
      const when = new Date(entry.timestamp);
      const now = new Date();
      if (!Number.isFinite(when.getTime())) return false;
      if (logDate === 'today' && when.toDateString() !== now.toDateString()) return false;
      if (logDate === 'week' && (when.getTime() > now.getTime() || when.getTime() < now.getTime() - 7 * 24 * 60 * 60 * 1000)) return false;
      if (logDate === 'month' && (when.getFullYear() !== now.getFullYear() || when.getMonth() !== now.getMonth())) return false;
    }
    const searchable = [ACT_CONFIG[entry.type]?.label, getDesc(entry), entry.assignmentId,
      entry.adminEmail, activityRole(entry.adminRole), entry.memberEmail, entry.memberName,
      entry.driverName, entry.truckPlate, entry.docType, entry.reason, entry.rejectReason].join(' ').toLowerCase();
    return searchable.includes(logSearch.trim().toLowerCase());
  });
  const logPageCount = Math.max(1, Math.ceil(filteredLog.length / logPageSize));
  useEffect(() => { setLogPage((page) => Math.min(page, logPageCount)); }, [logPageCount]);
  const currentLogPage = Math.min(logPage, logPageCount);
  const visibleLog = filteredLog.slice((currentLogPage - 1) * logPageSize, currentLogPage * logPageSize);
  const actorFor = (entry: AdminActivityEntry) => {
    if (entry.type === 'task_cancelled' && entry.memberName) return entry.memberName;
    if ((entry.type === 'password_reset_requested' || entry.type === 'password_changed') && entry.memberName) return entry.memberName;
    if (!entry.adminEmail) return 'System';
    if (entry.adminEmail.toLowerCase() === adminEmail?.toLowerCase() && adminName) return adminName;
    return members.find((member) => member.email.toLowerCase() === entry.adminEmail?.toLowerCase())?.name ?? entry.adminEmail;
  };
  const activityAction = (entry: AdminActivityEntry) => {
    if (!entry.assignmentId) return null;
    if (entry.type === 'task_cancelled') return { label: 'View Activity', open: () => pushAdminNavigation('Monitor', { assignmentId: entry.assignmentId!, activityKey: 'cancelled' }) };
    if (entry.type === 'doc_approved' || entry.type === 'doc_rejected') return { label: 'View Document', open: () => pushAdminNavigation('Documents', { assignmentId: entry.assignmentId!, docType: entry.docType }) };
    if (entry.type === 'task_completed') return { label: 'View Summary', open: () => pushAdminNavigation('Deliveries', { assignmentId: entry.assignmentId!, summary: true }, 'completed') };
    return { label: 'View Shipment', open: () => pushAdminNavigation('Monitor', { assignmentId: entry.assignmentId! }) };
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />

      <div ref={workspaceRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="workspace-settings-title" className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 pointer-events-none">
      <div className="pointer-events-auto flex h-[94dvh] w-[calc(100vw-16px)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:h-[min(84dvh,840px)] sm:w-[min(950px,calc(100vw-32px))]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-gradient-to-r from-[#0d9488]/8 to-transparent flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#0d9488]/15 flex items-center justify-center">
              <Users className="w-4 h-4 text-[#0d9488]" />
            </div>
            <div>
              <h2 id="workspace-settings-title" className="text-base font-semibold text-foreground leading-tight">Workspace Settings</h2>
              <p className="text-xs text-muted-foreground">Manage workspace access and audit history</p>
            </div>
          </div>
          <button type="button" aria-label="Close Workspace Settings" onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div role="tablist" aria-label="Workspace sections" onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          const sections = ['members', 'resets', 'coverage', 'activity'] as const;
          const next = sections[(sections.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : 2)) % sections.length];
          setTab(next);
          document.getElementById(`workspace-tab-${next}`)?.focus();
        }} className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-3 py-2 sm:px-6">
          {([['members', 'Team Members'], ['resets', 'Password Reset Requests'], ['coverage', 'Leave Coverage'], ['activity', 'Activity Log']] as const).map(([key, label]) => (
            <button key={key} id={`workspace-tab-${key}`} type="button" role="tab" aria-selected={tab === key}
              aria-controls={`workspace-panel-${key}`} tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)}
              className={`min-h-10 shrink-0 rounded-lg px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary ${tab === key ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}`}>
              {label}{key === 'resets' && resetRequests.some((request) => request.status === 'pending') &&
                <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">{resetRequests.filter((request) => request.status === 'pending').length}</span>}
              {key === 'coverage' && coverageVerified && coverage.some((item) => delegationStatus(item, coverageClock) === 'active') &&
                <span className="ml-1.5 rounded-full bg-green-100 px-1.5 py-0.5 text-xs text-green-800">{coverage.filter((item) => delegationStatus(item, coverageClock) === 'active').length} active</span>}
            </button>
          ))}
        </div>

        <div ref={contentScrollRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 [scrollbar-gutter:stable] sm:px-6 sm:py-5">

          {/* ── Members ── */}
          {tab === 'members' && <section id="workspace-panel-members" role="tabpanel" aria-labelledby="workspace-tab-members" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Team Members</h3>
              <button type="button" onClick={() => setShowAddMember(true)} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-white hover:bg-primary/90">
                <UserPlus className="h-4 w-4" /> Add Team Member
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {(['active', 'removed'] as const).map((status) => <button key={status} type="button"
                onClick={() => { setMemberStatus(status); setMemberPage(1); }}
                className={`min-h-9 rounded-lg border px-3 text-sm font-medium ${memberStatus === status ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-white text-foreground hover:bg-muted/40'}`}>
                {status === 'active' ? 'Active' : 'Archived'}
              </button>)}
            </div>
            <input type="search" aria-label="Search team members" placeholder="Search members…" value={memberSearch}
              onChange={(event) => { setMemberSearch(event.target.value); setMemberPage(1); }}
              className="min-h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-primary" />
            {loading ? <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
              : loadError ? <p role="alert" className="py-6 text-center text-sm text-red-600">{loadError}</p>
              : visibleMembers.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No {memberStatus === 'active' ? 'active' : 'archived'} members found.</p>
              : <div className="space-y-2">{visibleMembers.map((member) => <div key={member.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-3 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-800 text-xs font-semibold text-white">
                    {member.avatarPath && memberAvatars.get(member.avatarPath)
                      ? <img src={memberAvatars.get(member.avatarPath)} alt="" className="h-full w-full object-cover" />
                      : member.name.split(' ').map((part) => part[0]).join('').toUpperCase().slice(0, 2)}
                  </span>
                  <div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{member.name}</p><p className="break-all text-xs text-muted-foreground">{member.email}</p></div>
                  <div className="text-xs text-muted-foreground"><span className="font-medium text-foreground">CSR</span><span className="mx-1.5">·</span>{memberStatus === 'active' ? `Last login: ${member.lastActive ? fmtTs(member.lastActive) : 'Never'}` : 'Access inactive'}</div>
                  {memberStatus === 'active'
                    ? <button type="button" onClick={() => setArchiveTarget(member)}
                        className="min-h-9 shrink-0 rounded-lg border border-red-200 bg-white px-3 text-sm font-medium text-red-600 hover:bg-red-50">
                        Archive
                      </button>
                    : <button type="button" onClick={() => setRestoreTarget(member)}
                        className="min-h-9 shrink-0 rounded-lg border border-border bg-white px-3 text-sm font-medium text-foreground hover:bg-muted/40">
                        Restore
                      </button>}
                </div>)}</div>}
            <p className="text-xs text-muted-foreground">Archiving a member revokes their access immediately; it does not delete their login, and can be undone from the Archived tab.</p>
          </section>}

          {/* ── Password Reset Requests ── */}
          {tab === 'resets' && <section id="workspace-panel-resets" role="tabpanel" aria-labelledby="workspace-tab-resets" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Password Reset Requests</h3>
              <span className="text-xs text-muted-foreground">{resetRequests.filter((request) => request.status === 'pending').length} pending</span>
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {(['all', 'pending', 'approved', 'rejected', 'completed', 'expired'] as const).map((status) => <button key={status} type="button"
                onClick={() => { setResetStatus(status); setResetPage(1); }}
                className={`min-h-9 shrink-0 rounded-lg border px-3 text-sm font-medium capitalize ${resetStatus === status ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-white text-foreground hover:bg-muted/40'}`}>
                {status}
              </button>)}
            </div>
            <input type="search" aria-label="Search password reset requests" placeholder="Search member or email…" value={resetSearch}
              onChange={(event) => { setResetSearch(event.target.value); setResetPage(1); }}
              className="min-h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-primary" />
            {resetError && <p role="alert" className="text-sm text-red-600">{resetError}</p>}
            {resetActionError && <p role="alert" className="text-sm text-red-600">{resetActionError}</p>}
            {resetNotice && <p role="status" className="text-sm text-green-700">{resetNotice}</p>}
            {targetRequestId && resetLoaded && !resetError && !resetRequests.some((request) => request.id === targetRequestId) &&
              <p role="status" className="text-sm text-muted-foreground">This request is no longer available. The list below shows the latest requests.</p>}
            {!resetError && (!resetLoaded ? <p className="py-8 text-center text-sm text-muted-foreground">Loading requests…</p> : visibleResets.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No matching password reset requests.</p> :
              <div className="space-y-2">{visibleResets.map((request) => {
                const effectiveStatus = effectiveResetStatus(request);
                return <div key={request.id} id={`reset-request-${request.id}`} className={`flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between ${targetRequestId === request.id ? 'border-amber-300 bg-amber-50/40' : 'border-border'}`}>
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold">{members.find((member) => member.id === request.userId)?.name ?? request.email}</p>
                    <p className="break-all text-xs text-muted-foreground">{request.email}</p>
                    <p className="text-xs text-muted-foreground">Requested {fmtTs(request.requestedAt)} · <span className="capitalize">{effectiveStatus}</span></p>
                    {effectiveStatus === 'approved' && request.expiresAt && <p className="text-xs text-muted-foreground">Expires {fmtTs(request.expiresAt)}</p>}
                  </div>
                  {(effectiveStatus === 'pending' || effectiveStatus === 'approved') && <div className="flex gap-2 sm:shrink-0">
                    {effectiveStatus === 'pending' && <button type="button" disabled={resetBusyId === request.id} onClick={() => handleResetReview(request, false)} className="min-h-10 flex-1 rounded-lg border border-border bg-white px-3 text-sm font-medium hover:bg-muted/40 sm:flex-none">Reject</button>}
                    {effectiveStatus === 'pending' && <button type="button" disabled={resetBusyId === request.id} onClick={() => handleResetReview(request, true)} className="min-h-10 flex-1 rounded-lg bg-primary px-3 text-sm font-medium text-white disabled:opacity-50 sm:flex-none">Approve</button>}
                    {effectiveStatus === 'approved' && <button type="button" disabled={resetBusyId === request.id} onClick={() => handleCopyResetLink(request)} className="min-h-10 flex-1 rounded-lg border border-border bg-white px-3 text-sm font-medium text-foreground hover:bg-muted/40 disabled:opacity-50 sm:flex-none">{resetBusyId === request.id ? 'Copying…' : 'Copy Reset Link'}</button>}
                  </div>}
                </div>; })}</div>)}
          </section>}

          {/* ── Leave Coverage ── */}
          {tab === 'coverage' && <section id="workspace-panel-coverage" role="tabpanel" aria-labelledby="workspace-tab-coverage" className="space-y-4">
            <p className="text-sm text-muted-foreground">{PHILIPPINE_TIME_LABEL}</p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Leave Coverage</h3>
              <button type="button" disabled={!coverageVerified} onClick={() => { setCoverageNotice(''); setShowCoverageModal(true); }}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50">
                <CalendarClock className="h-4 w-4" /> Add Coverage
              </button>
            </div>
            <p className="text-sm text-muted-foreground">
              Going on leave? Let one CSR set new driver PINs and/or register drivers and trucks while you are away. Access starts and ends on the dates you choose and can be ended early.
              Archiving and team management are never included, and the CSR can never view existing PINs. Every action is recorded in the Activity Log.
            </p>
            <div className="flex flex-wrap gap-2">
              {(['current', 'past'] as const).map((view) => <button key={view} type="button" onClick={() => setCoverageView(view)}
                className={`min-h-9 rounded-lg border px-3 text-sm font-medium ${coverageView === view ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-white text-foreground hover:bg-muted/40'}`}>
                {view === 'current' ? 'Current & upcoming' : 'Past'}
              </button>)}
            </div>
            {coverageNotice && <p role="status" className="text-sm text-green-700">{coverageNotice}</p>}
            {coverageQuery.status === 'error' && <div className="flex flex-wrap items-center gap-2 text-sm text-red-600">
              <p role="alert">Could not verify leave coverage.{coverageQuery.data !== undefined && ' Previously loaded records may be out of date.'}</p>
              <button type="button" onClick={() => void coverageQuery.refresh()} className="min-h-10 rounded-lg px-2 font-medium underline focus-visible:outline-2 focus-visible:outline-primary">Retry</button>
            </div>}
            {(coverageQuery.status === 'loading' || coverageQuery.status === 'refreshing') && <p role="status" className="text-sm text-muted-foreground">{coverageQuery.status === 'refreshing' ? 'Refreshing coverage… Previously loaded records are not yet verified.' : 'Loading coverage…'}</p>}
            {(coverageVerified || coverage.length > 0) && (() => {
              const shown = coverage.filter((item) => {
                const status = delegationStatus(item, coverageClock);
                return coverageView === 'current' ? status === 'active' || status === 'scheduled' : status === 'ended' || status === 'revoked';
              });
              if (shown.length === 0) {
                if (!coverageVerified) return null;
                return <p className="py-8 text-center text-sm text-muted-foreground">{coverageView === 'current' ? 'No leave coverage is set. If you are going away, add one before you leave.' : 'No past coverage.'}</p>;
              }
              return <div className="space-y-2">{shown.map((item) => {
                const status = delegationStatus(item, coverageClock);
                const badge = COVERAGE_BADGE[status];
                const member = members.find((m) => m.id === item.csrId);
                return <div key={item.id} className="flex flex-col gap-3 rounded-xl border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="break-words text-sm font-semibold">{member?.name ?? 'Unknown CSR'}</p>
                      <span className={`rounded-full border px-2 py-0.5 text-sm font-medium ${coverageVerified ? badge.className : 'border-border bg-muted/40 text-muted-foreground'}`}>{coverageVerified ? badge.label : 'Not verified'}</span>
                    </div>
                    {member && <p className="break-all text-xs text-muted-foreground">{member.email}</p>}
                    <p className="mt-1 break-words text-sm text-foreground">{delegationScopeLabel(item)}</p>
                    {item.contactPhone && <p className="text-sm text-muted-foreground">Drivers call {formatContactPhone(item.contactPhone)}</p>}
                    <p className="break-words text-sm text-muted-foreground">
                      {formatPhilippineTimestamp(item.startsAt)} → {formatPhilippineTimestamp(item.endsAt)} · {formatWindowLength(new Date(item.endsAt).getTime() - new Date(item.startsAt).getTime())}
                      {item.revokedAt ? ` · ended early ${formatPhilippineTimestamp(item.revokedAt)}` : ''}
                    </p>
                  </div>
                  {(status === 'active' || status === 'scheduled') &&
                    <button type="button" disabled={!coverageVerified} onClick={() => { setCoverageNotice(''); setRevokeTarget(item); }}
                      className="min-h-10 shrink-0 rounded-lg border border-red-200 bg-white px-3 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">
                      {status === 'scheduled' ? 'Cancel' : 'End now'}
                    </button>}
                </div>;
              })}</div>;
            })()}
          </section>}

          {/* ── Activity Log ── */}
          {tab === 'activity' &&<section id="workspace-panel-activity" role="tabpanel" aria-labelledby="workspace-tab-activity" className="space-y-4">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Activity Log</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                value={logSearch}
                onChange={(e) => { setLogSearch(e.target.value); setLogPage(1); }}
                placeholder="Search actions, members, ASN…"
                className="min-h-10 w-full pl-9 pr-8 bg-[#f9fafb] border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              {logSearch && (
                <button onClick={() => { setLogSearch(''); setLogPage(1); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <select aria-label="Filter activity action" value={logAction} onChange={(event) => { setLogAction(event.target.value as AdminActivityType | 'all'); setLogPage(1); }}
                className="min-h-9 min-w-0 rounded-lg border border-border bg-white px-2 text-sm">
                <option value="all">All Actions</option>
                {(Object.keys(ACT_CONFIG) as AdminActivityType[]).map((type) => <option key={type} value={type}>{ACT_CONFIG[type].label}</option>)}
              </select>
              <select aria-label="Filter activity role" value={logRole} onChange={(event) => { setLogRole(event.target.value as typeof logRole); setLogPage(1); }}
                className="min-h-9 min-w-0 rounded-lg border border-border bg-white px-2 text-sm">
                <option value="all">All Roles</option><option value="opm">OPM</option><option value="csr">CSR</option>
              </select>
              <select aria-label="Filter activity date" value={logDate} onChange={(event) => { setLogDate(event.target.value as typeof logDate); setLogPage(1); }}
                className="min-h-9 min-w-0 rounded-lg border border-border bg-white px-2 text-sm">
                <option value="all">All Time</option><option value="today">Today</option><option value="week">Last 7 Days</option><option value="month">This Month</option>
              </select>
            </div>

            {filteredLog.length === 0 ? (
              <div className="py-10 text-center">
                <ClipboardList className="w-8 h-8 text-muted-foreground/25 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  {activityLog.length === 0 ? 'No activity recorded yet' : 'No matching activities'}
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {visibleLog.map((entry) => {
                  const cfg  = ACT_CONFIG[entry.type] ?? { label: entry.type, icon: ClipboardList, color: 'text-slate-500' };
                  const Icon = cfg.icon;
                  const action = activityAction(entry);
                  return (
                    <div key={entry.id} className="flex flex-wrap items-start gap-3 rounded-xl border-b border-border/60 px-2 py-3 last:border-0 hover:bg-accent/40">
                      <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${cfg.color}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold leading-tight text-foreground">{cfg.label}</p>
                        {entry.assignmentId && <p className="mt-1 break-words text-sm font-semibold text-foreground">{entry.assignmentId}{entry.docType ? ` · ${entry.docType}` : ''}</p>}
                        <p className="mt-0.5 break-words text-sm leading-snug text-muted-foreground">{getDesc(entry)}</p>
                        {(entry.type === 'task_cancelled' && entry.reason || entry.type === 'doc_rejected' && entry.rejectReason) &&
                          <p className="mt-0.5 break-words text-sm text-foreground">Reason: {entry.type === 'task_cancelled' ? entry.reason : entry.rejectReason}</p>}
                        <p className="mt-1 break-words text-xs text-muted-foreground">{actorFor(entry)}{activityRole(entry.adminRole) ? ` · ${activityRole(entry.adminRole)}` : entry.type === 'password_reset_requested' || entry.type === 'password_changed' ? ' · CSR' : ''}{entry.adminEmail && actorFor(entry) !== entry.adminEmail ? ` · ${entry.adminEmail}` : ''}</p>
                        <p className="text-xs text-muted-foreground">{fmtTs(entry.timestamp)}</p>
                      </div>
                      {action && <button type="button" onClick={() => { onClose(); action.open(); }}
                        className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg border border-border bg-white px-2.5 text-xs font-medium text-foreground hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-primary">
                        {action.label}<ChevronRight className="h-3.5 w-3.5" />
                      </button>}
                    </div>
                  );
                })}
              </div>
            )}
          </section>}
        </div>
        <div className="min-h-14 shrink-0 border-t border-border bg-white px-4 sm:px-6">
          {tab === 'members' && <PaginationFooter page={currentMemberPage} totalItems={filteredMembers.length} pageSize={pageSize}
            onPageChange={setMemberPage} singular="member" plural="members" className="px-0" />}
          {tab === 'resets' && <PaginationFooter page={currentResetPage} totalItems={filteredResets.length} pageSize={pageSize}
            onPageChange={setResetPage} singular="request" plural="requests" className="px-0" />}
          {tab === 'activity' && <PaginationFooter page={currentLogPage} totalItems={filteredLog.length} pageSize={logPageSize}
            onPageChange={setLogPage} singular="activity" plural="activities" className="px-0" />}
        </div>
      </div>
      </div>

      {showAddMember && (
        <AddMemberModal
          onClose={() => setShowAddMember(false)}
          onAdded={handleMemberAdded}
        />
      )}

      {archiveTarget && (
        <ConfirmPasswordDialog
          title="Archive this member?"
          message={<>
            <span className="font-medium text-foreground">{archiveTarget.name}</span> will lose access immediately.
            This doesn't delete their login, and can be undone from the Archived tab.
          </>}
          confirmLabel="Archive"
          busyLabel="Archiving…"
          onConfirm={handleArchiveMember}
          onCancel={() => setArchiveTarget(null)}
          errorText={memberActionErrorText}
        />
      )}

      {restoreTarget && (
        <ConfirmPasswordDialog
          tone="primary"
          title="Restore this member?"
          message={<>
            <span className="font-medium text-foreground">{restoreTarget.name}</span> will regain access immediately.
          </>}
          confirmLabel="Restore"
          busyLabel="Restoring…"
          onConfirm={handleRestoreMember}
          onCancel={() => setRestoreTarget(null)}
          errorText={memberActionErrorText}
        />
      )}

      {/* ── Leave coverage: pick, then confirm with the password ── */}
      {showCoverageModal && (
        <CoverageModal
          members={members}
          onClose={() => { setShowCoverageModal(false); setCoverageDraft(null); }}
          onContinue={setCoverageDraft}
        />
      )}

      {coverageDraft && (
        <ConfirmPasswordDialog
          tone="primary"
          title="Give this CSR leave coverage?"
          message={<>
            <span className="font-medium text-foreground">{coverageDraft.csr.name}</span> will be allowed to:{' '}
            <span className="font-medium text-foreground">{delegationScopeLabel({ canResetPin: coverageDraft.canResetPin, canRegister: coverageDraft.canRegister })}</span>
            {' '}from <span className="font-medium text-foreground">{formatPhilippineTimestamp(coverageDraft.startsAt.toISOString())}</span> to{' '}
            <span className="font-medium text-foreground">{formatPhilippineTimestamp(coverageDraft.endsAt.toISOString())}</span> ({coverageDraft.length}).
            {coverageDraft.contactPhone && <> Drivers who forgot their PIN will be shown <span className="font-medium text-foreground">{formatContactPhone(coverageDraft.contactPhone)}</span> to call.</>}
          </>}
          confirmLabel="Give Coverage"
          busyLabel="Saving…"
          onConfirm={handleGrantCoverage}
          onCancel={() => setCoverageDraft(null)}
          errorText={coverageErrorText}
        />
      )}

      {revokeTarget && (
        <ConfirmPasswordDialog
          requirePassword={false}
          title={delegationStatus(revokeTarget, Date.now()) === 'scheduled' ? 'Cancel this coverage?' : 'End coverage now?'}
          message={<>
            <span className="font-medium text-foreground">{members.find((member) => member.id === revokeTarget.csrId)?.name ?? 'The CSR'}</span>{' '}
            will lose this access immediately.
          </>}
          confirmLabel={delegationStatus(revokeTarget, Date.now()) === 'scheduled' ? 'Cancel Coverage' : 'End Coverage'}
          busyLabel="Saving…"
          onConfirm={handleRevokeCoverage}
          onCancel={() => setRevokeTarget(null)}
          errorText={coverageErrorText}
        />
      )}
    </>
  );
}
