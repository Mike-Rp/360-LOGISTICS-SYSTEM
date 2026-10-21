import { useState, useEffect, useRef } from 'react';
import {
  X, Users, UserPlus, Clock, ClipboardList, Search, ChevronRight,
  LogIn, CheckCircle, XCircle, FileCheck, FileX, UserX, UserMinus,
  RefreshCw, Shield, Eye, EyeOff, Mail, Pencil, Archive,
} from 'lucide-react';
import { listTeamMembers, createTeamMember, listCsrPasswordResetRequests, reviewCsrPasswordReset, createCsrPasswordResetLink } from '../../lib/db';
import type { CsrPasswordResetRequest } from '../../lib/db';
import type { AdminActivityEntry, AdminActivityType, AdminActivityInput, TeamMember } from '../../data/assignmentTypes';
import { PaginationFooter } from './Pagination';
import { pushAdminNavigation } from '../../lib/adminNavigation';

/* ── Activity log helpers — moved here from SettingsPanel.tsx, extended for member events ── */
const ACT_CONFIG: Record<AdminActivityType, { label: string; icon: React.ElementType; color: string }> = {
  login:               { label: 'Admin Login',    icon: LogIn,        color: 'text-blue-500'   },
  task_assigned:       { label: 'Task Assigned',  icon: ClipboardList, color: 'text-purple-500' },
  task_completed:      { label: 'Task Completed', icon: CheckCircle,  color: 'text-green-500'  },
  task_cancelled:      { label: 'Delivery Cancelled', icon: XCircle, color: 'text-red-500' },
  task_edited:         { label: 'Task Edited',    icon: Pencil,       color: 'text-amber-500'  },
  driver_archived:     { label: 'Driver Archived', icon: Archive,     color: 'text-orange-500' },
  truck_archived:      { label: 'Truck Archived',  icon: Archive,     color: 'text-orange-500' },
  doc_approved:        { label: 'Document Approved', icon: FileCheck, color: 'text-teal-500' },
  doc_rejected:        { label: 'Document Rejected', icon: FileX, color: 'text-red-500' },
  driver_deleted:      { label: 'Driver Removed', icon: UserX,        color: 'text-orange-500' },
  member_added:        { label: 'Member Added',   icon: UserPlus,     color: 'text-blue-500'   },
  member_removed:      { label: 'Member Removed', icon: UserMinus,    color: 'text-red-500'    },
  password_reset_requested: { label: 'Password Reset Requested', icon: Mail, color: 'text-amber-600' },
  password_reset_approved:  { label: 'Password Reset Approved', icon: CheckCircle, color: 'text-green-600' },
  password_reset_link_generated: { label: 'Password Reset Link Generated', icon: ClipboardList, color: 'text-blue-600' },
  password_reset_rejected:  { label: 'Password Reset Rejected', icon: XCircle, color: 'text-red-600' },
  password_changed:         { label: 'Password Changed', icon: Shield, color: 'text-blue-600' },
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
    case 'doc_approved':         return `Approved "${e.docType ?? 'document'}" for ${e.driverName ?? '—'}`;
    case 'doc_rejected':         return `Rejected "${e.docType ?? 'document'}" for ${e.driverName ?? '—'}`;
    case 'driver_deleted':       return `Removed driver "${e.driverName ?? '—'}"`;
    case 'driver_archived':      return `Moved driver "${e.driverName ?? '—'}" to archive`;
    case 'truck_archived':       return `Moved truck ${e.truckPlate ?? '—'} to archive`;
    case 'member_added':         return `Added ${e.memberName ?? e.memberEmail ?? 'a member'} to the team`;
    case 'member_removed':       return `Removed ${e.memberName ?? e.memberEmail ?? 'a member'}`;
    case 'password_reset_requested': return `Reset requested for ${e.memberName ?? e.memberEmail ?? 'a CSR member'}`;
    case 'password_reset_approved': return `Approved reset request for ${e.memberName ?? e.memberEmail ?? 'a CSR member'}`;
    case 'password_reset_link_generated': return `Generated reset link for ${e.memberName ?? e.memberEmail ?? 'a CSR member'}`;
    case 'password_reset_rejected': return `Rejected reset request for ${e.memberName ?? e.memberEmail ?? 'a CSR member'}`;
    case 'password_changed': return `Password changed by ${e.memberName ?? e.memberEmail ?? 'a CSR member'}`;
  }
}

const generatePassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
};

/* ── Modal shell (mirrors RegisterModals.tsx's local ModalShell) ── */
function ModalShell({ title, onClose, children, footer }: {
  title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto flex-1">{children}</div>
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
  const [password,   setPassword]   = useState('');
  const [showPass,   setShowPass]   = useState(false);
  const [error,      setError]      = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [created,    setCreated]    = useState<TeamMember | null>(null);

  const handleAdd = async () => {
    setError('');
    if (!name.trim()) { setError('Name is required.'); return; }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError('Enter a valid email address.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }

    setSubmitting(true);
    try {
      /* Creates the Supabase Auth login + the profile row in one database call (only the Operation
         Manager is allowed — the function checks). The password is shown ONCE below because Auth
         stores only a hash; nobody, including this app, can read it back later. */
      const member = await createTeamMember({ name: name.trim(), email: email.trim(), password, role: 'csr' });
      setCreated(member);
      onAdded(member);
    } catch (e) {
      console.error('[createTeamMember] error:', e);
      setError(e instanceof Error && e.message ? e.message : 'Something went wrong, please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title="Add Team Member" onClose={onClose}>
      {!created ? (
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Name <span className="text-red-500">*</span></label>
            <input
              type="text" value={name}
              onChange={(e) => { setName(e.target.value); setError(''); }}
              placeholder="e.g. Sofia Petrov"
              className="w-full px-4 py-3 rounded-xl border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              <span className="flex items-center gap-1.5"><Mail className="w-4 h-4 text-primary/70" /> Email <span className="text-red-500">*</span></span>
            </label>
            <input
              type="email" value={email}
              onChange={(e) => { setEmail(e.target.value); setError(''); }}
              placeholder="name@company.com"
              className="w-full px-4 py-3 rounded-xl border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Role</label>
            <div className="px-3 py-3 rounded-xl border border-border bg-muted/20">
              <p className="text-sm font-semibold text-foreground">CSR</p>
              <p className="text-xs text-muted-foreground mt-0.5">Full read/write access. CSR is the only role OPM can create.</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Password <span className="text-xs text-muted-foreground">(set your own, or use a suggestion)</span>
            </label>
            <div className="flex items-center gap-3">
              <div className="flex-1 relative">
                <Shield className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(''); }}
                  placeholder="Enter a password"
                  className="w-full pl-10 pr-12 py-3 rounded-xl border border-border bg-white text-sm font-mono tracking-wide focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setShowPass((v) => !v)}
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                  className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <button
                onClick={() => { setPassword(generatePassword()); setShowPass(true); }}
                className="flex items-center gap-2 px-4 py-3 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors text-sm font-medium whitespace-nowrap"
              >
                <RefreshCw className="w-4 h-4" /> Suggest
              </button>
            </div>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 px-4 py-2.5 border border-border rounded-xl hover:bg-accent transition-colors text-sm">
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={submitting}
              className="flex-1 px-4 py-2.5 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <UserPlus className="w-4 h-4" /> {submitting ? 'Adding…' : 'Add Member'}
            </button>
          </div>
        </div>
      ) : (
        <div className="text-center py-4 space-y-4">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle className="w-8 h-8 text-green-500" />
          </div>
          <div>
            <h4 className="font-semibold text-foreground text-lg">{created.name} added!</h4>
            <p className="text-sm text-muted-foreground mt-1">Share these credentials with them privately.</p>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-left space-y-1">
            <p className="text-xs font-semibold text-amber-700 flex items-center gap-1.5 mb-2">
              <Shield className="w-3.5 h-3.5" /> Login Credentials
            </p>
            <p className="text-xs text-amber-600">Email: <strong>{created.email}</strong></p>
            <p className="text-xs text-amber-600">Password: <strong className="font-mono tracking-wide">{created.password}</strong></p>
            <p className="text-xs text-amber-600">Role: <strong>CSR</strong></p>
          </div>
          <button onClick={onClose} className="w-full px-4 py-2.5 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors text-sm font-medium">
            Done
          </button>
        </div>
      )}
    </ModalShell>
  );
}

/* ── Main panel ── */
interface Props {
  open: boolean;
  onClose: () => void;
  activityLog: AdminActivityEntry[];
  onLogActivity: (entry: AdminActivityInput) => void;
  adminEmail: string | null;
  adminName?: string;
}

export default function WorkspaceSettingsPanel({ open, onClose, activityLog, onLogActivity, adminEmail, adminName }: Props) {
  const [tab, setTab] = useState<'members' | 'resets' | 'activity'>('members');
  const contentScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (contentScrollRef.current) contentScrollRef.current.scrollTop = 0;
  }, [tab]);
  const [memberStatus, setMemberStatus] = useState<'active' | 'removed'>('active');
  const [memberSearch, setMemberSearch] = useState('');
  const [memberPage, setMemberPage] = useState(1);
  const [members,     setMembers]     = useState<TeamMember[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [loadError,   setLoadError]   = useState('');
  const [showAddMember,  setShowAddMember]  = useState(false);
  const [logSearch,   setLogSearch]   = useState('');
  const [logAction, setLogAction] = useState<AdminActivityType | 'all'>('all');
  const [logRole, setLogRole] = useState<'all' | 'csr' | 'opm'>('all');
  const [logDate, setLogDate] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [resetRequests, setResetRequests] = useState<CsrPasswordResetRequest[]>([]);
  const [resetStatus, setResetStatus] = useState<CsrPasswordResetRequest['status'] | 'all'>('all');
  const [resetSearch, setResetSearch] = useState('');
  const [resetPage, setResetPage] = useState(1);
  const [resetBusyId, setResetBusyId] = useState<string | null>(null);
  const [resetError, setResetError] = useState('');
  const [resetNotice, setResetNotice] = useState('');
  const [resetClock, setResetClock] = useState(Date.now());
  const [logPage, setLogPage] = useState(1);
  const logPageSize = 10;

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
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const refresh = () => {
      setResetClock(Date.now());
      listCsrPasswordResetRequests().then((requests) => {
        if (!cancelled) { setResetRequests(requests); setResetError(''); }
      }).catch((error: unknown) => { if (!cancelled) setResetError(error instanceof Error ? error.message : 'Could not load password reset requests.'); });
    };
    refresh();
    window.addEventListener('focus', refresh);
    const interval = window.setInterval(refresh, 30_000);
    return () => { cancelled = true; window.removeEventListener('focus', refresh); window.clearInterval(interval); };
  }, [open]);

  const handleResetReview = async (request: CsrPasswordResetRequest, approve: boolean) => {
    setResetBusyId(request.id);
    setResetError('');
    setResetNotice('');
    try {
      if (request.status !== 'pending') return;
      await reviewCsrPasswordReset(request.id, approve);
      setResetRequests(await listCsrPasswordResetRequests());
      setResetNotice(approve ? 'Request approved. Copy the reset link to share it with the CSR.' : 'Request rejected.');
    } catch (error) {
      setResetError(error instanceof Error ? error.message : 'Could not review this request.');
    } finally {
      setResetBusyId(null);
    }
  };

  const handleCopyResetLink = async (request: CsrPasswordResetRequest) => {
    if (request.status !== 'approved' || !request.expiresAt || new Date(request.expiresAt).getTime() <= Date.now()) return;
    setResetBusyId(request.id);
    setResetError('');
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
      setResetError(messages[code] ?? 'Could not copy the reset link. Click again to generate a new link.');
    } finally {
      setResetBusyId(null);
    }
  };

  /* ── Close on Esc ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !showAddMember) onClose(); };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose, showAddMember]);

  /* ── Body scroll lock ── */
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const handleMemberAdded = (member: TeamMember) => {
    setMembers((p) => [...p, member]);
    onLogActivity({ type: 'member_added', memberName: member.name, memberEmail: member.email });
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

      <div role="dialog" aria-modal="true" aria-labelledby="workspace-settings-title" className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 pointer-events-none">
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
          const sections = ['members', 'resets', 'activity'] as const;
          const next = sections[(sections.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : 2)) % sections.length];
          setTab(next);
          document.getElementById(`workspace-tab-${next}`)?.focus();
        }} className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-3 py-2 sm:px-6">
          {([['members', 'Team Members'], ['resets', 'Password Reset Requests'], ['activity', 'Activity Log']] as const).map(([key, label]) => (
            <button key={key} id={`workspace-tab-${key}`} type="button" role="tab" aria-selected={tab === key}
              aria-controls={`workspace-panel-${key}`} tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)}
              className={`min-h-10 shrink-0 rounded-lg px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary ${tab === key ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}`}>
              {label}{key === 'resets' && resetRequests.some((request) => request.status === 'pending') &&
                <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">{resetRequests.filter((request) => request.status === 'pending').length}</span>}
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
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-white">
                    {member.name.split(' ').map((part) => part[0]).join('').toUpperCase().slice(0, 2)}
                  </span>
                  <div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{member.name}</p><p className="break-all text-xs text-muted-foreground">{member.email}</p></div>
                  <div className="text-xs text-muted-foreground"><span className="font-medium text-foreground">CSR</span><span className="mx-1.5">·</span>{memberStatus === 'active' ? `Last login: ${member.lastActive ? fmtTs(member.lastActive) : 'Never'}` : 'Access inactive'}</div>
                </div>)}</div>}
            <p className="text-xs text-muted-foreground">Member archive and restore require backend support. The existing Remove action permanently deletes the login.</p>
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
            {resetNotice && <p role="status" className="text-sm text-green-700">{resetNotice}</p>}
            {!resetError && (visibleResets.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No matching password reset requests.</p> :
              <div className="space-y-2">{visibleResets.map((request) => {
                const effectiveStatus = effectiveResetStatus(request);
                return <div key={request.id} className="flex flex-col gap-3 rounded-xl border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
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

          {/* ── Activity Log ── */}
          {tab === 'activity' && <section id="workspace-panel-activity" role="tabpanel" aria-labelledby="workspace-tab-activity" className="space-y-4">
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
    </>
  );
}
