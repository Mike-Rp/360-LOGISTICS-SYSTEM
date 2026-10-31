import { useState, useEffect, useRef, useCallback, type Dispatch, type SetStateAction } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { supabase } from './lib/supabaseClient';
import { loadAdminData, syncAdminData, markNotificationsRead, resetAllData, restoreSession, signOut, checkSessionStatus, endThisDeviceSession, readRecordCreationTimes, resolveAvatarUrl } from './lib/db';
import { rememberNotificationReads, restoreNotificationReads } from './lib/notificationReadState';
import type { StaffSession } from './lib/db';
import AdminDashboard from './components/admin/AdminDashboard';
import DriverInterface from './components/driver/DriverInterface';
import LoginScreen from './components/auth/LoginScreen';
import ResetPasswordScreen from './components/auth/ResetPasswordScreen';
import VerifyReportScreen from './components/auth/VerifyReportScreen';
import { canDispatchAssignments } from './lib/staffPermissions';
import { ADMIN_PATHS, ADMIN_NAVIGATION_EVENT, adminPageFromUrl, startAdminNavigation, redirectToAdminLogin } from './lib/adminNavigation';
import { pendingLocalRecordIds, confirmLocalRecordCreated } from './lib/recordOrdering';
import { isResetLoginIntent } from './lib/resetLoginNavigation';
import type { Assignment, CompletedTask, LocalDriver, LocalTruck, AppNotification, AdminRole, AdminActivityEntry, AdminActivityInput } from './data/assignmentTypes';

type AppView = 'login' | 'admin' | 'driver';
type NavItem = 'Dashboard' | 'Monitor' | 'Deliveries' | 'Documents' | 'Reports' | 'Accounts';
type SessionEndReason = 'replaced' | 'signed_out';

export default function App() {
  const [view,      setView]      = useState<AppView>('login');  // ← back to login
  const [activeNav, setActiveNav] = useState<NavItem>(() => adminPageFromUrl());

  useEffect(() => {
    localStorage.setItem('360_active_nav', activeNav);
  }, [activeNav]);

  /* Auth state. The session itself (who is signed in) is kept by Supabase Auth in the browser and
     restored on refresh via restoreSession() — we no longer hand-roll tokens in localStorage. */
  const [staffProfile, setStaffProfile] = useState<StaffSession | null>(null);
  /* REQ-012: the resolved avatar display URL lives here, shared by the navbar AND
     Settings, so both update together from one place. Resolved whenever the stored
     path changes (login, restore, a different account). An upload/remove that keeps
     the SAME path (avatars always upload to one fixed path, replacing in place) would
     never re-trigger this effect on its own, so handleStaffProfileUpdated also takes
     an optional fresh URL to set directly, bypassing the wait. */
  const [avatarUrl, setAvatarUrl] = useState('');
  useEffect(() => {
    let alive = true;
    if (!staffProfile?.avatarPath) { setAvatarUrl(''); return; }
    resolveAvatarUrl(staffProfile.avatarPath).then((url) => { if (alive) setAvatarUrl(url); });
    return () => { alive = false; };
  }, [staffProfile?.id, staffProfile?.avatarPath]);

  const handleStaffProfileUpdated = useCallback((update: Partial<StaffSession>, freshAvatarUrl?: string) => {
    setStaffProfile((prev) => (prev ? { ...prev, ...update } : prev));
    if (freshAvatarUrl !== undefined) setAvatarUrl(freshAvatarUrl);
  }, []);
  const adminRole = staffProfile?.role ?? null;
  const adminEmail = staffProfile?.email ?? null;
  const adminIsOm = staffProfile?.isOm ?? false;
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
  const [notificationsReady, setNotificationsReady] = useState(false);
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
  const [availabilityRefreshError, setAvailabilityRefreshError] = useState(false);
  const [loginSuccess,  setLoginSuccess]  = useState<string | null>(null);
  const [loginNotice, setLoginNotice] = useState<SessionEndReason | null>(null);
  const sessionTerminationRef = useRef(false);
  const sessionCheckRef = useRef<Promise<boolean> | null>(null);
  const sessionEpochRef = useRef(0);
  const activeSessionRef = useRef(false);
  const normalLogoutRef = useRef(false);
  const notificationsRef = useRef(notifications);
  notificationsRef.current = notifications;
  const pendingReadWrites = useRef(new Set<string>());

  /* One cleanup path for normal logout, remote sign-out, and session replacement.
     The epoch makes responses started under the old account unable to restore its data. */
  const clearSession = useCallback(() => {
    sessionEpochRef.current += 1;
    sessionCheckRef.current = null;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    if (adminRoleRef.current) redirectToAdminLogin(false);
    localStorage.removeItem('360_driver_screen');
    localStorage.removeItem('360_active_nav');
    localStorage.removeItem('360_display_name');
    localStorage.removeItem('360_avatar');
    signedInRef.current = false;
    activeSessionRef.current = false;
    adminEmailRef.current = null;
    adminRoleRef.current = null;
    setStaffProfile(null);
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
    notificationsRef.current = [];
    pendingReadWrites.current.clear();
    setNotificationsReady(false);
    setActivityLog([]);
    setArchivedDrivers([]);
    setArchivedTrucks([]);
    setSaveError(null);
    setLoadError(null);
    setAvailabilityRefreshError(false);
    setLoginSuccess(null);
    setDataLoading(false);
    setSavingToDb(false);
    isMounted.current = false;
    isPollUpdate.current = true;
  }, []);

  const handleSessionInvalidated = useCallback((reason: SessionEndReason) => {
    if (sessionTerminationRef.current) return;
    sessionTerminationRef.current = true;
    setRestoring(true);
    setLoginNotice(reason);
    clearSession();
    void endThisDeviceSession().catch((error) => {
      console.warn('[session] could not clear this device session:', error);
    }).finally(() => {
      setRestoring(false);
    });
  }, [clearSession]);

  /* A single in-flight check is shared by the poll, focus, and mutation failures. */
  const checkAppSession = useCallback((): Promise<boolean> => {
    if (sessionTerminationRef.current) return Promise.resolve(false);
    if (sessionCheckRef.current) return sessionCheckRef.current;
    const epoch = sessionEpochRef.current;
    const request = (async () => {
      try {
        const status = await checkSessionStatus();
        if (sessionEpochRef.current !== epoch || sessionTerminationRef.current) return false;
        if (status === 'replaced' || status === 'signed_out') {
          handleSessionInvalidated(status);
          return false;
        }
        return true; // 'unknown' is deliberately non-destructive.
      } catch (error) {
        console.warn('[session] status check unavailable:', error);
        return sessionEpochRef.current === epoch && !sessionTerminationRef.current;
      }
    })();
    sessionCheckRef.current = request;
    void request.finally(() => { if (sessionCheckRef.current === request) sessionCheckRef.current = null; });
    return request;
  }, [handleSessionInvalidated]);

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
      if (signedInRef.current && adminEmailRef.current === account) void checkAppSession();
      console.error('[notification read] save failed:', err);
      if (signedInRef.current && adminEmailRef.current === account) {
        setSaveError(failureMessage);
      }
    }).finally(() => {
      pending.forEach((id) => pendingReadWrites.current.delete(`${account}:${id}`));
    });
  }, [checkAppSession]);

  const restoreNotifications = useCallback((loaded: AppNotification[]) => {
    const account = adminEmailRef.current;
    const restored = account ? restoreNotificationReads(account, loaded) : null;
    const next = restored?.notifications ?? loaded;
    notificationsRef.current = next;
    setNotifications(next);
    setNotificationsReady(true);
    if (restored?.storageError) {
      setSaveError('Browser storage is unavailable. Notification read status may not survive refresh until saved to the server.');
    }
    if (account && restored) flushNotificationReads(account, restored.pendingIds);
  }, [flushNotificationReads]);

  // Header uses this same setter for individual reads and Mark all as read.
  const persistNotificationReads: Dispatch<SetStateAction<AppNotification[]>> = useCallback((update) => {
    if (!signedInRef.current || sessionTerminationRef.current) return;
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
    if (!signedInRef.current || sessionTerminationRef.current) return;
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
    const epoch = sessionEpochRef.current;
    setDataLoading(true);
    setLoadError(null);
    isPollUpdate.current = true; // block auto-save while loading
    try {
      const data = await loadAdminData();
      if (sessionEpochRef.current !== epoch) return;
      setAvailabilityRefreshError(false);
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
      if (sessionEpochRef.current !== epoch) return;
      if (!await checkAppSession()) return;
      console.error('[loadData] error:', err);
      // do NOT clear state on error — leave whatever is already in memory
      /* Without this the screen just rendered empty or stale with no explanation. */
      setLoadError('Could not load your data. Something went wrong, please try again.');
      setAvailabilityRefreshError(true);
    } finally {
      if (sessionEpochRef.current === epoch) {
        setAdminLoadFinished(true);
        setDataLoading(false);
        setTimeout(() => { if (sessionEpochRef.current === epoch) isPollUpdate.current = false; }, 200);
      }
    }
  }, [restoreNotifications, checkAppSession]);

  const applySession = useCallback(async (staff: StaffSession, fresh = false) => {
    if (fresh) {
      sessionTerminationRef.current = false;
      setLoginNotice(null);
    }
    const epoch = sessionEpochRef.current;
    isPollUpdate.current = true; // block auto-save until loadData finishes
    setStaffProfile(staff);
    adminRoleRef.current  = staff.role;
    adminEmailRef.current = staff.email;
    signedInRef.current   = true;
    activeSessionRef.current = true;
    setSignedIn(true);
    // Retire the old browser-wide profile cache; the authenticated profile is authoritative.
    localStorage.removeItem('360_display_name');
    localStorage.removeItem('360_avatar');
    await loadData();
    if (sessionEpochRef.current !== epoch || sessionTerminationRef.current) return;
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
        // The one-time reset link and the public report-verification page are
        // available without an authenticated session.
        if (window.location.pathname === '/reset-password' || window.location.pathname === '/verify-report') return;
        // This tab intentionally shows the staff login after leaving a reset link.
        // The Supabase session remains untouched, including sessions in other tabs.
        if (isResetLoginIntent(new URL(window.location.href))) return;
        const stored = (await supabase.auth.getSession()).data.session;
        if (cancelled) return;
        if (stored && !await checkAppSession()) return;
        const s = await restoreSession();
        if (cancelled || !s) return;
        if (!await checkAppSession() || cancelled) return;
        if (s.kind === 'staff') await applySession(s.staff);
        else {
          activeSessionRef.current = true;
          setDriverInfo(s.driver);
          setView('driver');
        }
      } catch (err) {
        console.error('[restoreSession] error:', err);   // e.g. offline — stay on the login screen
      } finally {
        if (!cancelled && !sessionTerminationRef.current) setRestoring(false);
      }
    })();
    return () => { cancelled = true; };
  }, [applySession, checkAppSession]);

  useEffect(() => {
    if (restoring || view === 'driver' || window.location.pathname === '/reset-password' || window.location.pathname === '/verify-report') return;
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
    const epoch = sessionEpochRef.current;
    savingRef.current = true;
    setSavingToDb(true);
    setSaveError(null);
    try {
      await syncAdminData(
        { drivers: d, trucks: t, assignments: a, completed: co, cancelled: ca, notifications: n, activityLog: al },
        { activityOnly: adminRoleRef.current === 'opm' },
      );
      if (sessionEpochRef.current !== epoch) return;
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
      if (sessionEpochRef.current !== epoch || !await checkAppSession()) return;
      console.error('[saveToServer] error:', err);
      const why = err instanceof Error ? err.message : String(err);
      setSaveError(`Auto-save failed: ${why}. Changes may be lost on refresh.`);
      setTimeout(() => setSaveError(null), 6000);
    } finally {
      savingRef.current = false;
      if (sessionEpochRef.current === epoch) setSavingToDb(false);
    }
  }, [checkAppSession]);

  /* Auto-save: only fires for user-driven changes, not poll-driven merges.
     Notification read-state is deliberately excluded from this effect's
     dependencies — it already has its own, correctly role-gated persistence
     path (persistNotificationReads → flushNotificationReads), which skips the
     server write entirely for OPM (notifs_update's RLS requires can_write(),
     which OPM never has). Re-triggering this generic sync on every read toggle
     reattempted that same forbidden write via syncTable('notifications', ...)
     and failed for OPM. notificationsRef.current is still read here (it's kept
     current by both the read-state setter and the poll), so a save triggered
     for another reason still carries the latest read state along with it. */
  useEffect(() => {
    if (!isMounted.current) { isMounted.current = true; return; }
    if (isPollUpdate.current) return;                              // ← skip poll updates
    if (!signedInRef.current || adminRole === null) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;   // debounce finished — the poll below is allowed to run again
      saveToServer(drivers, trucks, assignments, completed, cancelled, notificationsRef.current, activityLog);
    }, 1500);

    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [drivers, trucks, assignments, completed, cancelled, activityLog, adminRole]);

  /* ── Server-side change (edit / cancel an assignment via a database function) ──
     1. Flush a still-pending auto-save first, so it can't later write stale values over
        what the server is about to change.
     2. Run the change. Errors are re-thrown for the calling screen to show.
     3. Reload quietly (like the poll — no full-screen loading spinner). */
  const onServerChange = useCallback(async (action: () => Promise<void>, onActionSuccess?: () => void): Promise<void> => {
    const epoch = sessionEpochRef.current;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      await saveToServer(drivers, trucks, assignments, completed, cancelled, notifications, activityLog);
    }
    if (sessionEpochRef.current !== epoch) return;
    try { await action(); }
    catch (error) {
      if (sessionEpochRef.current === epoch) await checkAppSession();
      throw error;
    }
    if (sessionEpochRef.current !== epoch) return;
    if (onActionSuccess) {
      // The database mutation has succeeded. Reflect it immediately while the
      // full reload catches up, and do not auto-save this server-owned change.
      isPollUpdate.current = true;
      onActionSuccess();
    }
    try {
      const data = await loadAdminData();
      if (sessionEpochRef.current !== epoch) return;
      setAvailabilityRefreshError(false);
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
      if (sessionEpochRef.current === epoch && await checkAppSession()) {
        setAvailabilityRefreshError(true);
        console.warn('[onServerChange] reload failed, the next poll will retry:', err);
      }
    } finally {
      setTimeout(() => { if (sessionEpochRef.current === epoch) isPollUpdate.current = false; }, 100);
    }
  }, [saveToServer, restoreNotifications, checkAppSession, drivers, trucks, assignments, completed, cancelled, notifications, activityLog]);

  /* ── Admin real-time poll — refresh data every 12 s ── */
  useEffect(() => {
    if (!signedIn) return;
    const id = setInterval(async () => {
      const epoch = sessionEpochRef.current;
      if (!await checkAppSession()) return;
      /* A local edit is mid-flight (debounced save pending, or the save itself
         still running) — local state is already more current than whatever this
         poll would fetch, so skip this cycle entirely rather than momentarily
         stomping a just-made change back to its old value. */
      if (saveTimerRef.current || savingRef.current) return;
      try {
        const data = await loadAdminData();
        if (sessionEpochRef.current !== epoch || sessionTerminationRef.current) return;
        if (saveTimerRef.current || savingRef.current) return;   // an edit started while we were fetching
        /* Mark as poll update so auto-save doesn't fire */
        isPollUpdate.current = true;
        setAvailabilityRefreshError(false);
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
        setTimeout(() => { if (sessionEpochRef.current === epoch) isPollUpdate.current = false; }, 100);
      } catch (err) {
        /* A failed poll is not shown to the user on purpose — the screen keeps the
           last good data and the next tick retries 12 s later. It is logged, though:
           silently swallowing it hid real outages during debugging. */
        if (sessionEpochRef.current === epoch) {
          setAvailabilityRefreshError(true);
          console.warn('[poll] refresh failed, keeping last loaded data:', err);
        }
      }
    }, 12000);
    return () => clearInterval(id);
  }, [signedIn, adminRole, restoreNotifications, checkAppSession]);

  useEffect(() => {
    if (!activeSessionRef.current || restoring || view === 'login') return;
    const checkWhenActive = () => { if (document.visibilityState === 'visible') void checkAppSession(); };
    document.addEventListener('visibilitychange', checkWhenActive);
    window.addEventListener('focus', checkWhenActive);
    return () => {
      document.removeEventListener('visibilitychange', checkWhenActive);
      window.removeEventListener('focus', checkWhenActive);
    };
  }, [view, restoring, checkAppSession]);

  /* Signed out from somewhere else (another tab, or the session expired) → drop back to login. */
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_OUT') return;
      if (sessionTerminationRef.current || normalLogoutRef.current) return;
      if (activeSessionRef.current) handleSessionInvalidated('signed_out');
    });
    return () => data.subscription.unsubscribe();
  }, [handleSessionInvalidated]);

  const handleLogout = async () => {
    normalLogoutRef.current = true;
    try { await signOut(); } catch { /* still leave the screen even if the network call failed */ }
    clearSession();
    normalLogoutRef.current = false;
  };

  /* ── Reset all data (drivers, trucks, assignments, etc.) — keeps accounts and the activity log ── */
  const handleResetAll = useCallback(async (): Promise<void> => {
    const epoch = sessionEpochRef.current;
    try {
      await resetAllData();
    } catch (err) {
      if (!await checkAppSession()) throw err;
      console.error('[handleResetAll] error:', err);
      const why = err instanceof Error ? err.message : String(err);
      setSaveError(`Reset failed: ${why}`);
      setTimeout(() => setSaveError(null), 6000);
      /* Re-thrown rather than swallowed: AccountsPanel awaits this call, and if it
         returns normally the dialog reports "Reset complete" on a reset that failed.
         The screen is still NOT emptied — the database wasn't actually wiped. */
      throw err;
    }
    if (sessionEpochRef.current !== epoch) return;
    isPollUpdate.current = true;
    setDrivers([]);
    setTrucks([]);
    setAssignments([]);
    setCompleted([]);
    setCancelled([]);
    setNotifications([]);
    setTimeout(() => { if (sessionEpochRef.current === epoch) isPollUpdate.current = false; }, 200);
  }, [checkAppSession]);

  const isViewOnly   = !canDispatchAssignments(adminRole);
  const isOperationManager = adminIsOm;

  if (window.location.pathname === '/reset-password') return <ResetPasswordScreen />;
  if (window.location.pathname === '/verify-report') return <VerifyReportScreen />;

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

      {/* Authentication success stays centered above either signed-in view. */}
      {loginSuccess && (
        <div className="pointer-events-none fixed inset-x-3 top-[calc(1rem+env(safe-area-inset-top))] z-40 mx-auto max-w-sm" aria-live="polite">
          <div role="status" className="pointer-events-auto flex items-center gap-2.5 rounded-xl bg-green-600 px-5 py-3 text-sm font-medium text-white shadow-lg">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" />{loginSuccess}
          </div>
        </div>
      )}

      {/* Login errors stay together; persistent admin errors appear in page content. */}
      {view !== 'admin' && !signedIn && (saveError || loadError) && (
        <div className={`pointer-events-none fixed inset-x-3 z-40 mx-auto flex max-w-sm flex-col gap-2 ${loginSuccess ? 'top-[calc(5rem+env(safe-area-inset-top))]' : 'top-[calc(1rem+env(safe-area-inset-top))]'}`} aria-live="polite">
          {saveError && <div role="alert" className="pointer-events-auto rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg">{saveError}</div>}
          {loadError && <div role="alert" className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg">
            <span className="min-w-0 flex-1">{loadError}</span>
            <button type="button" onClick={() => { setLoadError(null); void loadData(); }} className="rounded px-1 font-semibold underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Retry</button>
          </div>}
        </div>
      )}

      {/* ── Main Content ── */}
      {view === 'login' && !signedIn && (
        <LoginScreen
          sessionNotice={loginNotice}
          onDismissSessionNotice={() => setLoginNotice(null)}
          onAdminLogin={async (staff) => { await applySession(staff, true); }}
          onDriverLogin={(info) => {
            sessionTerminationRef.current = false;
            activeSessionRef.current = true;
            setLoginNotice(null);
            setDriverInfo(info);
            setView('driver');
            setLoginSuccess(`Login Successful! Welcome, ${info.name}.`);
          }}
        />
      )}

      {(view === 'admin' || signedIn) && (
        <AdminDashboard
          key={adminEmail ?? 'admin'}
          initialLoading={dataLoading && !adminLoadFinished}
          contentLoading={dataLoading}
          availabilityError={!!loadError || availabilityRefreshError}
          drivers={drivers}          setDrivers={setDrivers}
          trucks={trucks}            setTrucks={setTrucks}
          assignments={assignments}  setAssignments={setAssignments}
          completed={completed}      setCompleted={setCompleted}
          cancelled={cancelled}      setCancelled={setCancelled}
          notifications={notifications} setNotifications={persistNotificationReads}
          notificationsReady={notificationsReady}
          saveError={saveError}
          loadError={loadError}
          onRetryLoad={() => { setLoadError(null); void loadData(); }}
          activityLog={activityLog}
          onLogActivity={onLogActivity}
          onServerChange={onServerChange}
          archivedDrivers={archivedDrivers} archivedTrucks={archivedTrucks}
          activeNav={activeNav}      setActiveNav={setActiveNav}
          onLogout={handleLogout}
          onResetAll={handleResetAll}
          isViewOnly={isViewOnly}
          adminRole={adminRole}
          staffProfile={staffProfile}
          avatarUrl={avatarUrl}
          onStaffProfileUpdated={handleStaffProfileUpdated}
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
          onCheckSession={checkAppSession}
        />
      )}

    </div>
  );
}
