import { useState, useRef, useEffect } from 'react';
import {
  User, ChevronDown, Bell, CalendarDays, Search, ArrowLeft, Settings, HelpCircle, LogOut,
  Truck, CheckCheck, X, Users,
  FileText, AlertTriangle, AlertCircle, KeyRound,
} from 'lucide-react';
import type { AdminRole, AppNotification } from '../../data/assignmentTypes';
import type { CsrPasswordResetRequest } from '../../lib/db';
import AccountRoleBadge from './AccountRoleBadge';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover';
import { adminHref, followAdminLink } from '../../lib/adminNavigation';
import { notificationDestination } from '../../lib/notificationEvents';
import { groupNotifications } from '../../lib/notificationGrouping';

interface Props {
  notifications: AppNotification[];
  pendingResetRequests: CsrPasswordResetRequest[];
  resetRequestLoadError: boolean;
  onRetryResetRequests: () => void;
  onReviewResetRequest: (id: string) => void;
  setNotifications: React.Dispatch<React.SetStateAction<AppNotification[]>>;
  onOpenNotification: (notification: AppNotification) => void;
  onLogout: () => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  isOperationManager: boolean;
  adminRole: AdminRole | null;
  adminEmail?: string | null;
  adminName?: string;
  avatarUrl?: string;
  onOpenWorkspaceSettings?: () => void;
  searchPlaceholder?: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
}

const NOTIF_ICON: Record<AppNotification['type'], React.ElementType> = {
  doc_upload:    FileText,
  status_update: Truck,
  delay_report:  AlertTriangle,
  issue_report:  AlertCircle,
};

const manilaDateFull = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
const manilaDateShort = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric' });
const manilaDateCompact = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' });

function fmtTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    return `${date}, ${time}`;
  } catch { return ts; }
}

export default function Header({
  notifications, pendingResetRequests, resetRequestLoadError, onRetryResetRequests, onReviewResetRequest,
  setNotifications, onOpenNotification, onLogout, onOpenSettings, onOpenHelp,
  isOperationManager, adminRole, adminEmail, adminName, avatarUrl, onOpenWorkspaceSettings,
  searchPlaceholder, searchValue, onSearchChange,
}: Props) {
  const [bellOpen,    setBellOpen]    = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const mobileSearchRef = useRef<HTMLInputElement>(null);
  const knownNotificationIds = useRef(new Set(notifications.map((n) => n.id)));
  const [enteringNotificationIds, setEnteringNotificationIds] = useState<Set<string>>(() => new Set());
  const entranceTimer = useRef<number | null>(null);

  useEffect(() => {
    const incoming = bellOpen ? notifications.filter((n) => !knownNotificationIds.current.has(n.id)).map((n) => n.id) : [];
    knownNotificationIds.current = new Set(notifications.map((n) => n.id));
    if (!bellOpen) {
      if (entranceTimer.current !== null) window.clearTimeout(entranceTimer.current);
      entranceTimer.current = null;
      setEnteringNotificationIds((current) => current.size ? new Set() : current);
      return;
    }
    if (incoming.length === 0) return;
    setEnteringNotificationIds((current) => new Set([...current, ...incoming]));
    if (entranceTimer.current !== null) window.clearTimeout(entranceTimer.current);
    entranceTimer.current = window.setTimeout(() => {
      setEnteringNotificationIds(new Set());
      entranceTimer.current = null;
    }, 350);
  }, [bellOpen, notifications]);

  useEffect(() => () => {
    if (entranceTimer.current !== null) window.clearTimeout(entranceTimer.current);
  }, []);

  useEffect(() => setSearchOpen(false), [searchPlaceholder]);
  useEffect(() => { if (searchOpen) mobileSearchRef.current?.focus(); }, [searchOpen]);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const accountRef = useRef<HTMLDivElement>(null);
  /* The account menu unmounts when a row is clicked, so Settings / Help hand focus to this
     button first — the modal returns focus here when it closes. */
  const accountBtnRef = useRef<HTMLButtonElement>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const fullDate = manilaDateFull.format(now);
  const shortDate = manilaDateShort.format(now);
  const compactDate = manilaDateCompact.format(now);
  const notificationGroups = groupNotifications(notifications, now);

  /* Bell panel's open/outside-click/positioning is handled by Popover itself
     now (see below) — only the account menu still needs a manual listener. */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) setAccountOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const markAllRead = () =>
    setNotifications((p) => p.map((n) => ({ ...n, read: true })));

  return (
    <header className="relative bg-white border-b border-border px-4 sm:px-6 py-3.5">
      <div className="flex min-w-0 items-center justify-end gap-2 sm:gap-3">

        <div title={`${fullDate} · Asia/Manila (Philippine Time)`} aria-label={`Today in the Philippines: ${fullDate}`}
          className="flex h-9 min-w-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-white px-2.5 text-sm font-semibold text-foreground shadow-sm sm:px-3">
          <CalendarDays aria-hidden="true" className="hidden h-4 w-4 shrink-0 lg:block" />
          <span className="hidden truncate lg:block">{fullDate}</span>
          <span className="hidden truncate min-[360px]:block lg:hidden">{shortDate}</span>
          <span className="truncate min-[360px]:hidden">{compactDate}</span>
        </div>

        {searchPlaceholder && (
          <>
            <div className="hidden h-9 min-w-0 items-center gap-2 rounded-full border border-border bg-white px-3 text-sm shadow-sm focus-within:border-primary lg:flex lg:w-48 xl:w-72">
              <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input value={searchValue} onChange={(event) => onSearchChange(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Escape') onSearchChange(''); }}
                aria-label={searchPlaceholder} placeholder={searchPlaceholder}
                className="min-w-0 flex-1 truncate bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60" />
              {searchValue && <button type="button" onClick={() => onSearchChange('')} aria-label="Clear search" className="shrink-0 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>}
            </div>
            <button type="button" onClick={() => setSearchOpen((open) => !open)}
              aria-label={searchOpen ? 'Close search' : 'Open search'} aria-expanded={searchOpen}
              className="fixed right-4 top-[calc(0.75rem+env(safe-area-inset-top))] z-40 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-white text-muted-foreground shadow-sm hover:bg-accent sm:static sm:h-9 sm:w-9 lg:hidden">
              <Search className="h-4 w-4" />
            </button>
          </>
        )}

        {/* ── Bell button ── */}
        <Popover open={bellOpen} onOpenChange={(open) => {
          setBellOpen(open);
          if (open && isOperationManager) onRetryResetRequests();
        }}>
          <PopoverTrigger asChild>
            <button
              onClick={() => setAccountOpen(false)}
              title={isOperationManager && pendingResetRequests.length ? `Notifications · ${pendingResetRequests.length} pending password reset requests` : 'Notifications'}
              aria-label={isOperationManager && pendingResetRequests.length ? `Notifications, ${pendingResetRequests.length} password reset requests pending review` : 'Notifications'}
              className="relative w-9 h-9 shrink-0 flex items-center justify-center rounded-full hover:bg-accent transition-colors"
            >
              <Bell className="w-5 h-5 text-muted-foreground" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[20px] h-[20px] bg-green-500 text-white text-[12px] font-bold rounded-full flex items-center justify-center px-1 leading-none">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
              {isOperationManager && pendingResetRequests.length > 0 && (
                <span aria-hidden="true" className="absolute -bottom-1 -right-1 flex h-2.5 w-2.5 rounded-full border border-white bg-amber-500" />
              )}
            </button>
          </PopoverTrigger>

          <PopoverContent
            align="end"
            sideOffset={8}
            collisionPadding={8}
            className="w-[min(400px,calc(100vw-1rem))] bg-white border border-border rounded-2xl shadow-xl p-0 overflow-hidden"
          >
              {/* Panel header */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-white px-4 py-3">
                <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
                <button type="button" onClick={markAllRead} disabled={unreadCount === 0}
                  className="inline-flex min-h-9 items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary/80 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default disabled:opacity-50">
                  <CheckCheck className="h-3.5 w-3.5" /> Mark all as read
                </button>
              </div>

              {/* Notification list */}
              <div className="max-h-72 overflow-x-hidden overflow-y-auto overscroll-contain">
                {isOperationManager && pendingResetRequests.length > 0 && (
                  <section aria-label="Pending password reset requests">
                    <h4 className="border-b border-border/60 bg-amber-50/60 px-4 pb-1.5 pt-3 text-xs font-semibold text-amber-900">
                      Pending Password Reset Requests · {pendingResetRequests.length}
                    </h4>
                    <div className="divide-y divide-border/60">
                      {pendingResetRequests.map((request) => (
                        <div key={request.id} className="flex min-w-0 items-start gap-2 px-4 py-3">
                          <KeyRound aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-foreground">Password Reset Request</p>
                            <p className="break-all text-sm text-foreground/90">{request.email} requested a password reset.</p>
                            <p className="mt-1 text-xs text-muted-foreground">Pending OPM review · {fmtTimestamp(request.requestedAt)}</p>
                            <button type="button" onClick={() => { setBellOpen(false); onReviewResetRequest(request.id); }}
                              aria-label={`Review password reset request for ${request.email}`}
                              className="mt-1 inline-flex min-h-9 items-center rounded-md text-sm font-medium text-primary hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                              Review Request →
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
                {isOperationManager && resetRequestLoadError && (
                  <div role="alert" className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 text-sm text-muted-foreground">
                    <span>Could not refresh password reset requests.</span>
                    <button type="button" onClick={onRetryResetRequests} className="min-h-9 shrink-0 font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary">Retry</button>
                  </div>
                )}
                {notifications.length === 0 && (!isOperationManager || pendingResetRequests.length === 0) && !resetRequestLoadError ? (
                  <div className="px-4 py-8 text-center">
                    <p className="text-sm text-muted-foreground">No notifications yet</p>
                  </div>
                ) : (
                  <div>
                    {notificationGroups.map((group) => (
                      <section key={group.label} aria-label={`${group.label} notifications`}>
                        <h4 className="border-b border-border/60 bg-muted/20 px-4 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</h4>
                        <div className="divide-y divide-border/60">
                          {group.items.map((n) => {
                            const Icon = n.statusUpdate === 'cancelled' ? AlertCircle : NOTIF_ICON[n.type];
                            const { page: navPage, target, actionLabel } = notificationDestination(n);
                            const identifier = n.truckPlate || n.assignmentId;
                            const prefix = `[${n.truckPlate}] `;
                            const message = n.message.startsWith(prefix) ? n.message.slice(prefix.length) : n.message;
                            const activityKey = target.activityKey;
                            const actionAria = n.type === 'doc_upload' ? `Review ${n.docType ?? 'documents'} for ${identifier}`
                              : activityKey ? `View ${activityKey.replace(/_/g, ' ')} activity for ${identifier}` : `View shipment for ${identifier}`;
                            const openDestination = () => {
                              onOpenNotification(n);
                              setBellOpen(false);
                            };
                            return (
                              <div key={n.id} className={`flex min-w-0 items-start gap-2 px-4 py-3 transition-colors hover:bg-accent/30 ${n.read ? 'bg-white' : 'bg-primary/[0.035]'} ${enteringNotificationIds.has(n.id) ? 'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 motion-safe:duration-300' : ''}`}>
                                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" style={{ visibility: n.read ? 'hidden' : 'visible' }} />
                                {!n.read && <span className="sr-only">Unread notification</span>}
                                <Icon aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 ${n.statusUpdate === 'cancelled' || n.type === 'issue_report' ? 'text-red-600' : 'text-muted-foreground'}`} />
                                <div className="min-w-0 flex-1">
                                  <div className="flex min-w-0 items-start justify-between gap-2">
                                    <span className="min-w-0 break-words text-sm font-semibold text-foreground">{identifier}</span>
                                    <a href={adminHref(navPage, target)} onClick={(event) => { event.stopPropagation(); followAdminLink(event, openDestination); }} aria-label={actionAria}
                                      className="hidden min-h-8 shrink-0 items-center whitespace-nowrap text-xs font-medium text-primary hover:text-primary/80 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:inline-flex">
                                      {actionLabel} →
                                    </a>
                                  </div>
                                  <p className="break-words text-sm leading-snug text-foreground/90">{message}</p>
                                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                                    <span className="text-xs text-muted-foreground">{fmtTimestamp(n.timestamp)}</span>
                                    <a href={adminHref(navPage, target)} onClick={(event) => { event.stopPropagation(); followAdminLink(event, openDestination); }} aria-label={actionAria}
                                      className="inline-flex min-h-8 items-center text-xs font-medium text-primary hover:text-primary/80 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:hidden">
                                      {actionLabel} →
                                    </a>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </div>

          </PopoverContent>
        </Popover>

        {/* ── Admin User pill ── */}
        <div className="relative" ref={accountRef}>
          <button
            ref={accountBtnRef}
            onClick={() => { setAccountOpen((v) => !v); setBellOpen(false); }}
            className="flex min-w-0 max-w-[calc(100vw-9rem)] shrink-0 items-center gap-2.5 rounded-full border border-border px-3 py-1.5 transition-colors hover:bg-accent sm:max-w-none"
          >
            <div className="w-7 h-7 bg-black rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden">
              {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : <User className="w-4 h-4 text-white" />}
            </div>
            <span className="min-w-0 truncate text-sm font-medium text-foreground">{adminName ?? 'Admin User'}</span>
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-150 ${accountOpen ? 'rotate-180' : ''}`} />
          </button>

          {accountOpen && (
            <div className="absolute right-0 top-full mt-2 w-[min(288px,calc(100vw-1rem))] bg-white border border-border rounded-2xl shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">

              {/* User info */}
              <div className="flex min-w-0 items-center gap-3 px-4 py-4">
                <div className="w-10 h-10 bg-black rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : <User className="w-5 h-5 text-white" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-semibold leading-tight text-foreground" title={adminName ?? 'Admin User'}>{adminName ?? 'Admin User'}</p>
                    <AccountRoleBadge role={adminRole} />
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground" title={adminEmail ?? undefined}>{adminEmail ?? '—'}</p>
                </div>
              </div>

              <div className="mx-4 h-px bg-border" />

              {/* Menu rows */}
              <div className="py-1.5">
                {isOperationManager && onOpenWorkspaceSettings && (
                  <button
                    onClick={() => { onOpenWorkspaceSettings(); setAccountOpen(false); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-accent/50 transition-colors text-left"
                  >
                    <Users className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm text-foreground">Workspace Settings</span>
                  </button>
                )}

                <button
                  onClick={() => { accountBtnRef.current?.focus(); onOpenSettings(); setAccountOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-accent/50 transition-colors text-left"
                >
                  <Settings className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm text-foreground">Settings</span>
                </button>

                <button
                  onClick={() => { accountBtnRef.current?.focus(); onOpenHelp(); setAccountOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-accent/50 transition-colors text-left"
                >
                  <HelpCircle className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm text-foreground">Help / Guide</span>
                </button>

                <button
                  onClick={() => { onLogout(); setAccountOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-red-50 transition-colors text-left"
                >
                  <LogOut className="w-4 h-4 text-red-500 flex-shrink-0" />
                  <span className="text-sm text-red-500">Log out</span>
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
      {searchPlaceholder && searchOpen && (
        <div className="absolute inset-x-0 top-full z-50 border-b border-border bg-white p-3 shadow-lg lg:hidden">
          <div className="flex min-w-0 items-center gap-2">
            <button type="button" onClick={() => setSearchOpen(false)} aria-label="Close search" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground"><ArrowLeft className="h-4 w-4" /></button>
            <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-border px-3 focus-within:border-primary">
              <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input ref={mobileSearchRef} value={searchValue} onChange={(event) => onSearchChange(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Escape') { onSearchChange(''); setSearchOpen(false); } }}
                aria-label={searchPlaceholder} placeholder={searchPlaceholder}
                className="min-w-0 flex-1 truncate bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60" />
              {searchValue && <button type="button" onClick={() => { onSearchChange(''); mobileSearchRef.current?.focus(); }} aria-label="Clear search" className="shrink-0 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
