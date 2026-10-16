import { useState, useEffect, useRef, useCallback, type Dispatch, type SetStateAction } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { supabase } from './lib/supabaseClient';
import { loadAdminData, syncAdminData, markNotificationsRead, resetAllData, restoreSession, signOut, readRecordCreationTimes } from './lib/db';
import { rememberNotificationReads, restoreNotificationReads } from './lib/notificationReadState';
import type { StaffSession } from './lib/db';
import AdminDashboard from './components/admin/AdminDashboard';
import DriverInterface from './components/driver/DriverInterface';
import LoginScreen from './components/auth/LoginScreen';
import { ADMIN_PATHS, ADMIN_NAVIGATION_EVENT, adminPageFromUrl, startAdminNavigation, redirectToAdminLogin } from './lib/adminNavigation';
import { pendingLocalRecordIds, confirmLocalRecordCreated } from './lib/recordOrdering';
import type { Assignment, CompletedTask, LocalDriver, LocalTruck, AppNotification, AdminRole, AdminActivityEntry, AdminActivityInput } from './data/assignmentTypes';

type AppView = 'login' | 'admin' | 'driver';
type NavItem = 'Dashboard' | 'Monitor' | 'Deliveries' | 'Documents' | 'Reports' | 'Accounts';

export default function App() {
  const [view,      setView]      = useState<AppView>('login');  // ← back to login
  const [activeNav, setActiveNav] = useState<NavItem>(() => adminPageFromUrl());

  useEffect(() => {
    localStorage.setItem('360_active_nav', activeNav);
  }, [activeNav]);

  /* Auth state. The session itself (who is signed in) is kept by Supabase Auth in the browser and
     restored on refresh via restoreSession() — we no longer hand-roll tokens in localStorage. */
  const [adminRole,    setAdminRole]    = useState<AdminRole | null>(null);
  const [adminEmail,   setAdminEmail]   = useState<string | null>(null);
  const [adminIsOm,    setAdminIsOm]    = useState(false);
  const [signedIn,     setSignedIn]     = useState(false);
  const [restoring,    setRestoring]    = useState(true);   // true until the "am I already signed in?" check finishes
  const [dataLoading,  setDataLoading]  = useState(false);
  const [adminLoadFinished, setAdminLoadFinished] = useState(false);
  const [savingToDb,   setSavingToDb]   = useState(false);

  /* Driver session (separate from admin) */
  const [driverInfo, setDriverInfo] = useState<{ id: string; name: string } | null>(null);

  /* Shared app state */
  const [drivers,       setDrivers]       = useState<LocalDriver[]>([]);
  const [trucks,        setTrucks]        = useState<LocalTruck[]>([]);
  const [assignments,   setAssignments]   = useState<Assignment[]>([]);
  const [completed,     setCompleted]     = useState<CompletedTask[]>([]);
  const [cancelled,     setCancelled]     = useState<Assignment[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [activityLog,   setActivityLog]   = useState<AdminActivityEntry[]>([]);
  /* Archived drivers/trucks — read-only lists for the Accounts "Archived" tabs (never auto-saved) */
  const [archivedDrivers, setArchivedDrivers] = useState<LocalDriver[]>([]);
  const [archivedTrucks,  setArchivedTrucks]  = useState<LocalTruck[]>([]);

  /* Refs so timers/closures always see the latest values */
  const saveTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted      = useRef(false);
  const isPollUpdate   = useRef(false);   // ← flag: skip auto-save during poll merges
  const signedInRef    = useRef(false);
  const savingRef      = useRef(false);
  const adminEmailRef  = useRef<string | null>(null);
  const adminRoleRef   = useRef<AdminRole | null>(null);
  const [saveError,     setSaveError]     = useState<string | null>(null);
  const [loadError,     setLoadError]     = useState<string | null>(null);
  const [loginSuccess,  setLoginSuccess]  = useState<string | null>(null);
  const notificationsRef = useRef(notifications);
  notificationsRef.current = notifications;
  const pendingReadWrites = useRef(new Set<string>());

  const flushNotificationReads = useCallback((account: string, ids: string[]) => {
    if (!signedInRef.current || adminEmailRef.current !== account
      || (adminRoleRef.current !== 'admin' && adminRoleRef.current !== 'csr')) return;
    const pending = ids.filter((id) => !pendingReadWrites.current.has(`${account}:${id}`));
    if (!pending.length) return;
    pending.forEach((id) => pendingReadWrites.current.add(`${account}:${id}`));
    const failureMessage = 'Could not save notification read status to the server. It will retry when data refreshes.';
    void markNotificationsRead(pending).then(() => {
      if (signedInRef.current && adminEmailRef.current === account) {
        setSaveError((current) => current === failureMessage ? null : current);
      }
    }).catch((err) => {
      console.error('[notification read] save failed:', err);
      if (signedInRef.current && adminEmailRef.current === account) {
        setSaveError(failureMessage);
      }
    }).finally(() => {
      pending.forEach((id) => pendingReadWrites.current.delete(`${account}:${id}`));
    });
  }, []);

  const restoreNotifications = useCallback((loaded: AppNotification[]) => {
    const account = adminEmailRef.current;
    const restored = account ? restoreNotificationReads(account, loaded) : null;
    const next = restored?.notifications ?? loaded;
    notificationsRef.current = next;
    setNotifications(next);
    if (restored?.storageError) {
      setSaveError('Browser storage is unavailable. Notification read status may not survive refresh until saved to the server.');
    }
    if (account && restored) flushNotificationReads(account, restored.pendingIds);
  }, [flushNotificationReads]);

  // Header uses this same setter for individual reads and Mark all as read.
  const persistNotificationReads: Dispatch<SetStateAction<AppNotification[]>> = useCallback((update) => {
    const previous = notificationsRef.current;
    const next = typeof update === 'function' ? update(previous) : update;
    const unreadIds = new Set(previous.filter((notification) => !notification.read).map((notification) => notification.id));
    const ids = next.filter((notification) => notification.read && unreadIds.has(notification.id)).map((notification) => notification.id);
    const account = adminEmailRef.current;
    if (account && ids.length && rememberNotificationReads(account, ids).storageError) {
      setSaveError('Browser storage is unavailable. Notification read status may not survive refresh until saved to the server.');
    }
    notificationsRef.current = next;
    setNotifications(next);
    if (account) flushNotificationReads(account, ids);
  }, [flushNotificationReads]);

  /* ── Admin activity logging — auto-tags the signed-in account. (The database also stamps the
     real email/role on insert, so this can't be spoofed from the browser.) ── */
  const onLogActivity = useCallback((entry: AdminActivityInput) => {
    const fullEntry: AdminActivityEntry = {
      ...entry,
      adminEmail: entry.adminEmail ?? adminEmailRef.current ?? undefined,
      adminRole:  entry.adminRole  ?? adminRoleRef.current  ?? undefined,
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
    };
    setActivityLog((prev) => [fullEntry, ...prev]);
  }, []);

  /* ── Load data from the database (all tables the signed-in user is allowed to see) ── */
  const loadData = useCallback(async () => {
    setDataLoading(true);
    setLoadError(null);
    isPollUpdate.current = true; // block auto-save while loading
    try {
      const data = await loadAdminData();
      setDrivers(data.drivers);
      setTrucks(data.trucks);
      setAssignments(data.assignments);
      setCompleted(data.completed);
      setCancelled(data.cancelled);
      restoreNotifications(data.notifications);
      setActivityLog(data.activityLog);
      setArchivedDrivers(data.archivedDrivers);
      setArchivedTrucks(data.archivedTrucks);
    } catch (err) {
      console.error('[loadData] error:', err);
      // do NOT clear state on error — leave whatever is already in memory
      /* Without this the screen just rendered empty or stale with no explanation. */
      setLoadError('Could not load your data. Something went wrong, please try again.');
    } finally {
      setAdminLoadFinished(true);
      setDataLoading(false);
      setTimeout(() => { isPollUpdate.current = false; }, 200);
    }
  }, [restoreNotifications]);

  const applySession = useCallback(async (staff: StaffSession, fresh = false) => {
    isPollUpdate.current = true; // block auto-save until loadData finishes
    setAdminRole(staff.role);
    setAdminEmail(staff.email);
    setAdminIsOm(staff.isOm);
    adminRoleRef.current  = staff.role;
    adminEmailRef.current = staff.email;
    signedInRef.current   = true;
    setSignedIn(true);
    if (fresh) {
      /* Reset the device-local display name on every fresh login so a previous account's name never
         leaks onto the next session — it now comes from this account's profile. */
      if (staff.name) localStorage.setItem('360_display_name', staff.name);
      else localStorage.removeItem('360_display_name');
    }
    await loadData();
    setActiveNav(startAdminNavigation());
    setView('admin');
    if (fresh) {
      setLoginSuccess('Login Successful! Welcome to the Admin Portal.');
      onLogActivity({ type: 'login', adminEmail: staff.email, adminRole: staff.role });
    }
  }, [loadData, onLogActivity]);

  /* ── Already signed in? (Supabase keeps the session in the browser across refreshes) ── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await restoreSession();
        if (cancelled || !s) return;
        if (s.kind === 'staff') await applySession(s.staff);
        else { setDriverInfo(s.driver); setView('driver'); }
      } catch (err) {
        console.error('[restoreSession] error:', err);   // e.g. offline — stay on the login screen
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => { cancelled = true; };
  }, [applySession]);

  useEffect(() => {
    if (restoring || view === 'driver') return;
    const restoreLocation = () => {
      if (!signedInRef.current) {
        redirectToAdminLogin();
        return;
      }
      const url = new URL(window.location.href);
      const page = adminPageFromUrl(url);
      if (url.pathname !== ADMIN_PATHS[page]) {
        setActiveNav(startAdminNavigation());
      } else {
        setActiveNav(page);
      }
    };
    restoreLocation();
    window.addEventListener('popstate', restoreLocation);
    window.addEventListener(ADMIN_NAVIGATION_EVENT, restoreLocation);
    return () => {
      window.removeEventListener('popstate', restoreLocation);
      window.removeEventListener(ADMIN_NAVIGATION_EVENT, restoreLocation);
    };
  }, [restoring, view]);

  /* Auto-dismiss login success toast after 3 seconds */
  useEffect(() => {
    if (!loginSuccess) return;
    const t = setTimeout(() => setLoginSuccess(null), 3000);
    return () => clearTimeout(t);
  }, [loginSuccess]);

  /* ── Save to the database (writers only — admin / CSR). Only changed rows are written. ── */
  const saveToServer = useCallback(async (
    d: LocalDriver[], t: LocalTruck[],
    a: Assignment[], co: CompletedTask[],
    ca: Assignment[], n: AppNotification[],
    al: AdminActivityEntry[]
  ) => {
    savingRef.current = true;
    setSavingToDb(true);
    setSaveError(null);
    try {
      await syncAdminData({ drivers: d, trucks: t, assignments: a, completed: co, cancelled: ca, notifications: n, activityLog: al });
      try {
        const driverIds = new Set(d.map((driver) => driver.id));
        const assignmentIds = new Set([...a, ...co, ...ca].map((assignment) => assignment.id));
        const [driverTimes, assignmentTimes] = await Promise.all([
          readRecordCreationTimes('drivers', pendingLocalRecordIds('driver').filter((id) => driverIds.has(id))),
          readRecordCreationTimes('assignments', pendingLocalRecordIds('assignment').filter((id) => assignmentIds.has(id))),
        ]);
        if (signedInRef.current) {
          driverTimes.forEach((record) => confirmLocalRecordCreated('driver', record.id, record.createdAt));
          assignmentTimes.forEach((record) => confirmLocalRecordCreated('assignment', record.id, record.createdAt));
        }
      } catch (err) {
        console.warn('[creation timestamps] read failed; the existing poll will reload saved timestamps:', err);
      }
    } catch (err) {
      console.error('[saveToServer] error:', err);
      const why = err instanceof Error ? err.message : String(err);
      setSaveError(`Auto-save failed: ${why}. Changes may be lost on refresh.`);
      setTimeout(() => setSaveError(null), 6000);
    } finally {
      savingRef.current = false;
      setSavingToDb(false);
    }
  }, []);

  /* Auto-save: only fires for user-driven changes, not poll-driven merges */
  useEffect(() => {
    if (!isMounted.current) { isMounted.current = true; return; }
    if (isPollUpdate.current) return;                              // ← skip poll updates
    if (!signedInRef.current || adminRole === 'viewer' || adminRole === null) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;   // debounce finished — the poll below is allowed to run again
      saveToServer(drivers, trucks, assignments, completed, cancelled, notifications, activityLog);
    }, 1500);

    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [drivers, trucks, assignments, completed, cancelled, notifications, activityLog, adminRole]);

  /* ── Server-side change (edit / cancel an assignment via a database function) ──
     1. Flush a still-pending auto-save first, so it can't later write stale values over
        what the server is about to change.
     2. Run the change. Errors are re-thrown for the calling screen to show.
     3. Reload quietly (like the poll — no full-screen loading spinner). */
  const onServerChange = useCallback(async (action: () => Promise<void>, onActionSuccess?: () => void): Promise<void> => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      await saveToServer(drivers, trucks, assignments, completed, cancelled, notifications, activityLog);
    }
    await action();
    if (onActionSuccess) {
      // The database mutation has succeeded. Reflect it immediately while the
      // full reload catches up, and do not auto-save this server-owned change.
      isPollUpdate.current = true;
      onActionSuccess();
    }
    try {
      const data = await loadAdminData();
      isPollUpdate.current = true;
      setAssignments(data.assignments);
      restoreNotifications(data.notifications);
      setDrivers(data.drivers);
      setTrucks(data.trucks);
      setCompleted(data.completed);
      setCancelled(data.cancelled);
      setActivityLog(data.activityLog);
      setArchivedDrivers(data.archivedDrivers);
      setArchivedTrucks(data.archivedTrucks);
    } catch (err) {
      /* The change itself succeeded; keep the immediate local update until the
         next poll can replace it with the database state. */
      console.warn('[onServerChange] reload failed, the next poll will retry:', err);
    } finally {
      setTimeout(() => { isPollUpdate.current = false; }, 100);
    }
  }, [saveToServer, restoreNotifications, drivers, trucks, assignments, completed, cancelled, notifications, activityLog]);

  /* ── Admin real-time poll — refresh data every 12 s ── */
  useEffect(() => {
    if (!signedIn || adminRole === 'viewer') return;
    const id = setInterval(async () => {
      /* A local edit is mid-flight (debounced save pending, or the save itself
         still running) — local state is already more current than whatever this
         poll would fetch, so skip this cycle entirely rather than momentarily
         stomping a just-made change back to its old value. */
      if (saveTimerRef.current || savingRef.current) return;
      try {
        const data = await loadAdminData();
        if (saveTimerRef.current || savingRef.current) return;   // an edit started while we were fetching
        /* Mark as poll update so auto-save doesn't fire */
        isPollUpdate.current = true;
        setLoadError(null);        // a good poll means the connection recovered
        setAssignments(data.assignments);
        restoreNotifications(data.notifications);
        setDrivers(data.drivers);
        setTrucks(data.trucks);
        setCompleted(data.completed);
        setCancelled(data.cancelled);
        setActivityLog(data.activityLog);
        setArchivedDrivers(data.archivedDrivers);
        setArchivedTrucks(data.archivedTrucks);
        /* Reset flag after React has processed the state updates */
        setTimeout(() => { isPollUpdate.current = false; }, 100);
      } catch (err) {
        /* A failed poll is not shown to the user on purpose — the screen keeps the
           last good data and the next tick retries 12 s later. It is logged, though:
           silently swallowing it hid real outages during debugging. */
        console.warn('[poll] refresh failed, keeping last loaded data:', err);
      }
    }, 12000);
    return () => clearInterval(id);
  }, [signedIn, adminRole, restoreNotifications]);

  /* Forget who was signed in and go back to the login screen (local state only). */
  const clearSession = useCallback(() => {
    if (adminRoleRef.current) redirectToAdminLogin(false);
    localStorage.removeItem('360_driver_screen');
    localStorage.removeItem('360_active_nav');
    signedInRef.current   = false;
    adminEmailRef.current = null;
    adminRoleRef.current  = null;
    setAdminRole(null);
    setAdminEmail(null);
    setAdminIsOm(false);
    setSignedIn(false);
    setAdminLoadFinished(false);
    setDriverInfo(null);
    setView('login');
    setDrivers([]);
    setTrucks([]);
    setAssignments([]);
    setCompleted([]);
    setCancelled([]);
    setNotifications([]);
    setActivityLog([]);
    setArchivedDrivers([]);
    setArchivedTrucks([]);
    isMounted.current = false;
  }, []);

  /* Signed out from somewhere else (another tab, or the session expired) → drop back to login. */
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') clearSession();
    });
    return () => data.subscription.unsubscribe();
  }, [clearSession]);

  const handleLogout = async () => {
    try { await signOut(); } catch { /* still leave the screen even if the network call failed */ }
    clearSession();
  };

  /* ── Reset all data (drivers, trucks, assignments, etc.) — keeps accounts and the activity log ── */
  const handleResetAll = useCallback(async (): Promise<void> => {
    try {
      await resetAllData();
    } catch (err) {
      console.error('[handleResetAll] error:', err);
      const why = err instanceof Error ? err.message : String(err);
      setSaveError(`Reset failed: ${why}`);
      setTimeout(() => setSaveError(null), 6000);
      /* Re-thrown rather than swallowed: AccountsPanel awaits this call, and if it
         returns normally the dialog reports "Reset complete" on a reset that failed.
         The screen is still NOT emptied — the database wasn't actually wiped. */
      throw err;
    }
    isPollUpdate.current = true;
    setDrivers([]);
    setTrucks([]);
    setAssignments([]);
    setCompleted([]);
    setCancelled([]);
    setNotifications([]);
    setTimeout(() => { isPollUpdate.current = false; }, 200);
  }, []);

  const isViewOnly   = adminRole === 'viewer';
  const isOperationManager = adminIsOm;

  /* ── Loading screen ── */
  if ((restoring || dataLoading) && !signedIn) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-green-50 to-blue-50">
        <div className="w-10 h-10 border-4 border-[#0d9488] border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground font-medium">Loading 360 Logistics data…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background relative">

      {/* ── Login success toast ── */}
      {loginSuccess && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] bg-green-600 text-white text-sm font-medium px-5 py-3 rounded-xl shadow-xl flex items-center gap-2.5 max-w-sm animate-in fade-in slide-in-from-top-3 duration-300">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          {loginSuccess}
        </div>
      )}

      {/* ── Save-error toast ── */}
      {saveError && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[100] bg-red-600 text-white text-xs font-medium px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2 max-w-sm text-center animate-in fade-in slide-in-from-top-2 duration-200">
          <span>⚠️</span> {saveError}
        </div>
      )}

      {/* ── Load-error banner — stays until a later load or poll succeeds ── */}
      {loadError && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[100] bg-red-600 text-white text-xs font-medium px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2 max-w-sm text-center animate-in fade-in slide-in-from-top-2 duration-200">
          <span>⚠️</span> {loadError}
          <button
            onClick={() => { setLoadError(null); void loadData(); }}
            className="underline font-semibold whitespace-nowrap"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Main Content ── */}
      {view === 'login' && !signedIn && (
        <LoginScreen
          onAdminLogin={async (staff) => { await applySession(staff, true); }}
          onDriverLogin={(info) => {
            setDriverInfo(info);
            setView('driver');
            setLoginSuccess(`Login Successful! Welcome, ${info.name}.`);
          }}
        />
      )}

      {(view === 'admin' || signedIn) && (
        <AdminDashboard
          initialLoading={dataLoading && !adminLoadFinished}
          contentLoading={dataLoading}
          drivers={drivers}          setDrivers={setDrivers}
          trucks={trucks}            setTrucks={setTrucks}
          assignments={assignments}  setAssignments={setAssignments}
          completed={completed}      setCompleted={setCompleted}
          cancelled={cancelled}      setCancelled={setCancelled}
          notifications={notifications} setNotifications={persistNotificationReads}
          activityLog={activityLog}
          onLogActivity={onLogActivity}
          onServerChange={onServerChange}
          archivedDrivers={archivedDrivers} archivedTrucks={archivedTrucks}
          activeNav={activeNav}      setActiveNav={setActiveNav}
          onLogout={handleLogout}
          onResetAll={handleResetAll}
          isViewOnly={isViewOnly}
          adminRole={adminRole}
          savingToDb={savingToDb}
          isOperationManager={isOperationManager}
          adminEmail={adminEmail}
        />
      )}

      {view === 'driver' && (
        <DriverInterface
          driverId={driverInfo?.id ?? ''}
          driverName={driverInfo?.name ?? ''}
          onLogout={handleLogout}
        />
      )}

    </div>
  );
}
