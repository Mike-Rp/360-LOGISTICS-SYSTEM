import { useState, useEffect } from 'react';
import {
  X, Users, UserPlus, Trash2, Clock, ClipboardList, Search,
  LogIn, CheckCircle, XCircle, FileCheck, FileX, UserX, UserMinus,
  RefreshCw, Shield, Eye, EyeOff, AlertTriangle, Mail, Pencil, Archive,
} from 'lucide-react';
import { listTeamMembers, createTeamMember, removeTeamMember, listCsrPasswordResetRequests, reviewCsrPasswordReset, createCsrPasswordResetLink } from '../../lib/db';
import type { CsrPasswordResetRequest } from '../../lib/db';
import type { AdminActivityEntry, AdminActivityType, AdminActivityInput, TeamMember } from '../../data/assignmentTypes';

/* ── Activity log helpers — moved here from SettingsPanel.tsx, extended for member events ── */
const ACT_CONFIG: Record<AdminActivityType, { label: string; icon: React.ElementType; color: string }> = {
  login:               { label: 'Admin Login',    icon: LogIn,        color: 'text-blue-500'   },
  task_assigned:       { label: 'Task Assigned',  icon: ClipboardList, color: 'text-purple-500' },
  task_completed:      { label: 'Task Completed', icon: CheckCircle,  color: 'text-green-500'  },
  task_cancelled:      { label: 'Task Cancelled', icon: XCircle,      color: 'text-gray-500'   },
  task_edited:         { label: 'Task Edited',    icon: Pencil,       color: 'text-amber-500'  },
  driver_archived:     { label: 'Driver Archived', icon: Archive,     color: 'text-orange-500' },
  truck_archived:      { label: 'Truck Archived',  icon: Archive,     color: 'text-orange-500' },
  doc_approved:        { label: 'Doc Approved',   icon: FileCheck,    color: 'text-teal-500'   },
  doc_rejected:        { label: 'Doc Rejected',   icon: FileX,        color: 'text-red-500'    },
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
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return ts; }
}

function getDesc(e: AdminActivityEntry): string {
  switch (e.type) {
    case 'login':                return `${e.adminEmail ?? 'Admin'} signed in`;
    case 'task_assigned':        return `Assigned to ${e.driverName ?? '—'} · ${e.destination ?? ''}`;
    case 'task_completed':       return `Completed by ${e.driverName ?? '—'} · ${e.destination ?? ''}`;
    case 'task_cancelled':       return `Cancelled — ${e.driverName ?? '—'}`;
    case 'task_edited':          return `Edited ${e.assignmentId ?? 'delivery'} (${Object.keys(e.changes ?? {}).length} field${Object.keys(e.changes ?? {}).length === 1 ? '' : 's'}) — ${e.reason ?? 'no reason'}`;
    case 'doc_approved':         return `Approved "${e.docType ?? 'document'}" for ${e.driverName ?? '—'}`;
    case 'doc_rejected':         return `Rejected "${e.docType ?? 'document'}" for ${e.driverName ?? '—'}`;
    case 'driver_deleted':       return `Removed driver "${e.driverName ?? '—'}"`;
    case 'driver_archived':      return `Moved driver "${e.driverName ?? '—'}" to archive`;
    case 'truck_archived':       return `Moved truck ${e.truckPlate ?? '—'} to archive`;
    case 'member_added':         return `Added ${e.memberName ?? e.memberEmail ?? 'a member'} as ${e.adminRole ?? 'a team member'}`;
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
                  className="w-full pl-10 pr-10 py-3 rounded-xl border border-border bg-white text-sm font-mono tracking-wide focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
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

/* ── Remove confirmation ── */
function RemoveConfirmModal({ member, onCancel, onConfirm, removing }: {
  member: TeamMember; onCancel: () => void; onConfirm: () => void; removing: boolean;
}) {
  return (
    <ModalShell title="Remove Member" onClose={onCancel}>
      <div className="text-center space-y-4">
        <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto">
          <AlertTriangle className="w-7 h-7 text-red-500" />
        </div>
        <p className="text-sm text-foreground">
          Remove <strong>{member.name}</strong> ({member.email})? Their login will stop working immediately.
        </p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 px-4 py-2.5 border border-border rounded-xl hover:bg-accent transition-colors text-sm">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={removing}
            className="flex-1 px-4 py-2.5 bg-red-500 text-white rounded-xl hover:bg-red-600 transition-colors text-sm font-medium disabled:opacity-50"
          >
            {removing ? 'Removing…' : 'Yes, Remove'}
          </button>
        </div>
      </div>
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
}

export default function WorkspaceSettingsPanel({ open, onClose, activityLog, onLogActivity, adminEmail }: Props) {
  const [members,     setMembers]     = useState<TeamMember[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [loadError,   setLoadError]   = useState('');
  /* Separate from loadError: that one REPLACES the member list, which would hide
     the very list this message refers to. This sits above it instead. */
  const [actionError, setActionError] = useState('');
  const [showAddMember,  setShowAddMember]  = useState(false);
  const [removeTarget, setRemoveTarget] = useState<TeamMember | null>(null);
  const [removing,    setRemoving]    = useState(false);
  const [logSearch,   setLogSearch]   = useState('');
  const [resetRequests, setResetRequests] = useState<CsrPasswordResetRequest[]>([]);
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
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !showAddMember && !removeTarget) onClose(); };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose, showAddMember, removeTarget]);

  /* ── Body scroll lock ── */
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const handleRemove = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    setActionError('');
    try {
      await removeTeamMember(removeTarget.id);   // deletes their login; their access ends immediately
      setMembers((p) => p.filter((m) => m.id !== removeTarget.id));
      onLogActivity({ type: 'member_removed', adminEmail: adminEmail ?? undefined, memberName: removeTarget.name, memberEmail: removeTarget.email });
    } catch (e) {
      console.error('[removeTeamMember] error:', e);
      /* The dialog closes either way (see finally), so without this the removal
         looked like it worked and the member reappeared on the next load. */
      setActionError(`Could not remove ${removeTarget.name}. Something went wrong, please try again.`);
    } finally {
      setRemoving(false);
      setRemoveTarget(null);
    }
  };

  const handleMemberAdded = (member: TeamMember) => {
    setMembers((p) => [...p, member]);
    onLogActivity({ type: 'member_added', adminEmail: adminEmail ?? undefined, memberName: member.name, memberEmail: member.email, adminRole: member.role });
  };

  const filteredLog = logSearch.trim()
    ? activityLog.filter((e) =>
        ACT_CONFIG[e.type].label.toLowerCase().includes(logSearch.toLowerCase()) ||
        getDesc(e).toLowerCase().includes(logSearch.toLowerCase()) ||
        (e.adminEmail ?? '').toLowerCase().includes(logSearch.toLowerCase()) ||
        (e.memberEmail ?? '').toLowerCase().includes(logSearch.toLowerCase()) ||
        (e.memberName ?? '').toLowerCase().includes(logSearch.toLowerCase())
      )
    : activityLog;
  const logPageCount = Math.max(1, Math.ceil(filteredLog.length / logPageSize));
  useEffect(() => { setLogPage((page) => Math.min(page, logPageCount)); }, [logPageCount]);
  const currentLogPage = Math.min(logPage, logPageCount);
  const visibleLog = filteredLog.slice((currentLogPage - 1) * logPageSize, currentLogPage * logPageSize);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />

      <div role="dialog" aria-modal="true" aria-labelledby="workspace-settings-title" className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 pointer-events-none">
      <div className="pointer-events-auto flex h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-2xl sm:h-auto sm:max-h-[88vh] sm:w-[min(940px,calc(100vw-32px))] sm:rounded-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-gradient-to-r from-[#0d9488]/8 to-transparent flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#0d9488]/15 flex items-center justify-center">
              <Users className="w-4 h-4 text-[#0d9488]" />
            </div>
            <div>
              <h2 id="workspace-settings-title" className="text-base font-semibold text-foreground leading-tight">Workspace Settings</h2>
              <p className="text-xs text-muted-foreground">Manage team members and activity</p>
            </div>
          </div>
          <button type="button" aria-label="Close Workspace Settings" onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-7">

          {/* ── Members ── */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest whitespace-nowrap">Members</span>
                <div className="flex-1 h-px bg-border" />
              </div>
            </div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-muted-foreground">{members.length} member{members.length === 1 ? '' : 's'}</p>
              <button
                onClick={() => setShowAddMember(true)}
                className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white text-xs font-medium rounded-xl hover:bg-primary/90 transition-colors"
              >
                <UserPlus className="w-3.5 h-3.5" /> Add Team Member
              </button>
            </div>

            {actionError && (
              <p className="text-sm text-red-500 mb-2">{actionError}</p>
            )}

            {loading ? (
              <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>
            ) : loadError ? (
              <p className="text-sm text-red-500 text-center py-6">{loadError}</p>
            ) : members.length === 0 ? (
              <div className="py-8 text-center">
                <Users className="w-8 h-8 text-muted-foreground/25 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No team members yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {members.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border">
                    <div className="w-8 h-8 bg-black rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-semibold">
                      {m.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{m.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                    </div>
                    <span className="flex-shrink-0 text-xs font-medium px-2.5 py-1 rounded-lg border bg-blue-50 text-blue-700 border-blue-200">
                      CSR
                    </span>
                    <div className="text-right flex-shrink-0 hidden sm:block">
                      <p className="text-[12px] text-muted-foreground">
                        {m.lastActive ? fmtTs(m.lastActive) : 'Never logged in'}
                      </p>
                    </div>
                    <button
                      onClick={() => setRemoveTarget(m)}
                      className="p-1.5 rounded-lg text-muted-foreground hover:bg-red-50 hover:text-red-500 transition-colors flex-shrink-0"
                      title="Remove member"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── Password Reset Requests ── */}
          <section>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Password Reset Requests</h3>
              {!resetError && <span className="text-xs text-muted-foreground">{resetRequests.filter((request) => request.status === 'pending').length} pending</span>}
            </div>
            {resetError && <p role="status" className="text-sm text-muted-foreground mb-2">{resetError}</p>}
            {resetNotice && <p role="status" className="text-sm text-green-700 mb-2">{resetNotice}</p>}
            {!resetError && (resetRequests.length === 0 ? <p className="text-sm text-muted-foreground">No password reset requests.</p> :
              <div className="space-y-2">
                {resetRequests.map((request) => {
                  const expired = request.status === 'approved' && (!request.expiresAt || new Date(request.expiresAt).getTime() <= resetClock);
                  const effectiveStatus = expired ? 'expired' : request.status;
                  return <div key={request.id} className="flex flex-col gap-3 rounded-xl border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{members.find((member) => member.id === request.userId)?.name ?? request.email}</p>
                    <p className="text-xs text-muted-foreground break-all">{request.email}</p>
                    <p className="text-xs text-muted-foreground">Requested {fmtTs(request.requestedAt)} · <span className="capitalize">{effectiveStatus}</span></p>
                  </div>
                  {(effectiveStatus === 'pending' || effectiveStatus === 'approved') && <div className="flex gap-2 sm:shrink-0">
                    {request.status === 'pending' && <button type="button" disabled={resetBusyId === request.id} onClick={() => handleResetReview(request, false)} className="min-h-10 flex-1 rounded-lg border px-3 text-sm sm:flex-none">Reject</button>}
                    {request.status === 'pending' && <button type="button" disabled={resetBusyId === request.id} onClick={() => handleResetReview(request, true)} className="min-h-10 flex-1 rounded-lg bg-primary px-3 text-sm font-medium text-white disabled:opacity-50 sm:flex-none">Approve</button>}
                    {effectiveStatus === 'approved' && <button type="button" disabled={resetBusyId === request.id} onClick={() => handleCopyResetLink(request)} className="min-h-10 flex-1 rounded-lg border border-primary px-3 text-sm font-medium text-primary disabled:opacity-50 sm:flex-none">{resetBusyId === request.id ? 'Copying…' : 'Copy Reset Link'}</button>}
                  </div>}
                </div>; })}
              </div>)}
          </section>

          {/* ── Activity Log ── */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest whitespace-nowrap">Activity Log</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                value={logSearch}
                onChange={(e) => { setLogSearch(e.target.value); setLogPage(1); }}
                placeholder="Search actions, members, emails…"
                className="w-full pl-9 pr-8 py-2 bg-[#f9fafb] border border-border rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              {logSearch && (
                <button onClick={() => { setLogSearch(''); setLogPage(1); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="w-3 h-3" />
                </button>
              )}
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
                  const cfg  = ACT_CONFIG[entry.type];
                  const Icon = cfg.icon;
                  return (
                    <div key={entry.id} className="flex items-start gap-3 py-2.5 px-3 rounded-xl hover:bg-accent/40 transition-colors">
                      <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${cfg.color}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground leading-tight">{cfg.label}</p>
                        <p className="text-[12px] text-muted-foreground mt-0.5 leading-snug truncate">{getDesc(entry)}</p>
                        {entry.adminEmail && (
                          <p className="text-[12px] text-muted-foreground/70 mt-0.5 truncate">{entry.adminEmail}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-[12px] text-muted-foreground flex-shrink-0 whitespace-nowrap">
                        <Clock className="w-3 h-3" />
                        {fmtTs(entry.timestamp)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {filteredLog.length > 0 && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3 mt-3 text-xs text-muted-foreground">
              <span>Showing {(currentLogPage - 1) * logPageSize + 1}–{Math.min(currentLogPage * logPageSize, filteredLog.length)} of {filteredLog.length} activities</span>
              <div className="flex items-center gap-1">
                <button type="button" disabled={currentLogPage === 1} onClick={() => setLogPage((page) => page - 1)} className="rounded-md border px-2 py-1 disabled:opacity-40">Previous</button>
                <span className="px-2">{currentLogPage} / {logPageCount}</span>
                <button type="button" disabled={currentLogPage === logPageCount} onClick={() => setLogPage((page) => page + 1)} className="rounded-md border px-2 py-1 disabled:opacity-40">Next</button>
              </div>
            </div>}
          </section>
        </div>

        <div className="px-6 py-4 border-t border-border bg-muted/20 flex-shrink-0">
          <p className="text-[12px] text-muted-foreground text-center">
            Team members get real individual logins. Removing one revokes access immediately.
          </p>
        </div>
      </div>
      </div>

      {showAddMember && (
        <AddMemberModal
          onClose={() => setShowAddMember(false)}
          onAdded={handleMemberAdded}
        />
      )}
      {removeTarget && (
        <RemoveConfirmModal
          member={removeTarget}
          onCancel={() => setRemoveTarget(null)}
          onConfirm={handleRemove}
          removing={removing}
        />
      )}
    </>
  );
}
