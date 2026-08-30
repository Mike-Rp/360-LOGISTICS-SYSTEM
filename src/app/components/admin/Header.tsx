import { useState, useRef, useEffect } from 'react';
import {
  User, ChevronDown, Bell, BellOff, Settings, HelpCircle, LogOut,
  Truck, CheckCheck, Trash2, X, Users,
  FileText, AlertTriangle, AlertCircle,
} from 'lucide-react';
import type { AppNotification } from '../../data/assignmentTypes';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover';

interface Props {
  notifications: AppNotification[];
  setNotifications: React.Dispatch<React.SetStateAction<AppNotification[]>>;
  onNavigate: (page: string) => void;
  onLogout: () => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  notifEnabled: boolean;
  isOperationManager: boolean;
  adminEmail?: string | null;
  adminName?: string;
  onOpenWorkspaceSettings?: () => void;
}

const NOTIF_ICON: Record<AppNotification['type'], React.ElementType> = {
  doc_upload:    FileText,
  status_update: Truck,
  delay_report:  AlertTriangle,
  issue_report:  AlertCircle,
};

const NOTIF_NAV: Record<AppNotification['type'], string> = {
  doc_upload:    'Documents',
  status_update: 'Monitor',
  delay_report:  'Monitor',
  issue_report:  'Monitor',
};

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
  notifications, setNotifications, onNavigate, onLogout, onOpenSettings, onOpenHelp, notifEnabled,
  isOperationManager, adminEmail, adminName, onOpenWorkspaceSettings,
}: Props) {
  const [bellOpen,    setBellOpen]    = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  const accountRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

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

  const clearAll = () => setNotifications([]);

  return (
    <header className="bg-white border-b border-border px-4 sm:px-6 py-3.5">
      <div className="flex items-center justify-end gap-3 pl-10 lg:pl-0">

        {/* ── Bell button ── */}
        <Popover open={bellOpen} onOpenChange={setBellOpen}>
          <PopoverTrigger asChild>
            <button
              onClick={() => setAccountOpen(false)}
              title={notifEnabled ? 'Notifications' : 'Notifications muted'}
              className="relative w-9 h-9 flex items-center justify-center rounded-full hover:bg-accent transition-colors"
            >
              {notifEnabled
                ? <Bell className="w-5 h-5 text-muted-foreground" />
                : <BellOff className="w-5 h-5 text-muted-foreground/50" />
              }
              {notifEnabled && unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-green-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 leading-none">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
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
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-green-500 flex-shrink-0" />
                  <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
                  {unreadCount > 0 && (
                    <span className="min-w-[18px] h-[18px] bg-green-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 leading-none">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {unreadCount > 0 && (
                    <button
                      onClick={markAllRead}
                      className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                    >
                      <CheckCheck className="w-3.5 h-3.5" /> Mark all read
                    </button>
                  )}
                  {notifications.length > 0 && (
                    <button
                      onClick={clearAll}
                      className="flex items-center gap-1 text-xs text-red-500 hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Clear all
                    </button>
                  )}
                </div>
              </div>

              {/* Notification list */}
              <div className="max-h-72 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="py-10 text-center">
                    <Bell className="w-8 h-8 text-muted-foreground/25 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No notifications yet</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border/60">
                    {notifications.slice(0, 12).map((n) => {
                      const Icon    = NOTIF_ICON[n.type];
                      const navPage = NOTIF_NAV[n.type];
                      return (
                        <div
                          key={n.id}
                          className={`relative group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-accent/40 ${!n.read ? 'bg-primary/[0.03]' : ''}`}
                        >
                          {/* Type icon — gray rounded square */}
                          <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <Icon className="w-4 h-4 text-gray-500" />
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0 pr-6">
                            {/* Truck icon + plate in teal */}
                            <div className="flex items-center gap-1 mb-0.5">
                              <Truck className="w-3 h-3 text-teal-600 flex-shrink-0" />
                              <span className="text-[11px] font-semibold text-teal-600 font-mono tracking-wide">{n.truckPlate}</span>
                            </div>
                            {/* Description */}
                            <p className={`text-xs leading-snug ${!n.read ? 'font-medium text-foreground' : 'text-foreground/80'}`}>
                              {n.message}
                            </p>
                            {/* Timestamp + nav link */}
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <p className="text-[10px] text-muted-foreground">{fmtTimestamp(n.timestamp)}</p>
                              <button
                                onClick={() => { onNavigate(navPage); setBellOpen(false); }}
                                className="text-[10px] text-teal-600 hover:text-teal-700 font-medium opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap"
                              >
                                Go to {navPage} →
                              </button>
                            </div>
                          </div>

                          {/* X dismiss button — appears on hover */}
                          <button
                            onClick={() => setNotifications((p) => p.filter((x) => x.id !== n.id))}
                            className="absolute top-2.5 right-3 w-5 h-5 rounded-full bg-white border border-border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50 hover:border-red-200"
                          >
                            <X className="w-3 h-3 text-muted-foreground hover:text-red-500" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="border-t border-border">
                {unreadCount === 0 && notifications.length > 0 ? (
                  <p className="w-full py-2.5 text-xs font-medium text-muted-foreground text-center">
                    All caught up!
                  </p>
                ) : (
                  <button
                    onClick={() => { onOpenSettings(); setBellOpen(false); }}
                    className="w-full py-2.5 text-xs font-medium text-primary hover:bg-accent/50 transition-colors"
                  >
                    View all activity
                  </button>
                )}
              </div>
          </PopoverContent>
        </Popover>

        {/* ── Admin User pill ── */}
        <div className="relative" ref={accountRef}>
          <button
            onClick={() => { setAccountOpen((v) => !v); setBellOpen(false); }}
            className="flex items-center gap-2.5 px-3 py-1.5 rounded-full border border-border hover:bg-accent transition-colors"
          >
            <div className="w-7 h-7 bg-black rounded-full flex items-center justify-center flex-shrink-0">
              <User className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-medium text-foreground">{adminName ?? 'Admin User'}</span>
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-150 ${accountOpen ? 'rotate-180' : ''}`} />
          </button>

          {accountOpen && (
            <div className="absolute right-0 top-full mt-2 w-[min(288px,calc(100vw-1rem))] bg-white border border-border rounded-2xl shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">

              {/* User info */}
              <div className="flex items-center gap-3 px-4 py-4">
                <div className="w-10 h-10 bg-black rounded-full flex items-center justify-center flex-shrink-0">
                  <User className="w-5 h-5 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground leading-tight">{adminName ?? 'Admin User'}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{adminEmail ?? '—'}</p>
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
                  onClick={() => { onOpenSettings(); setAccountOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-accent/50 transition-colors text-left"
                >
                  <Settings className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm text-foreground">Settings</span>
                </button>

                <button
                  onClick={() => { onOpenHelp(); setAccountOpen(false); }}
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
    </header>
  );
}
