import { useState, useEffect, useRef, useCallback } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { SERVER } from './lib/supabaseClient';
import { publicAnonKey } from '/utils/supabase/info';
import AdminDashboard from './components/admin/AdminDashboard';
import DriverInterface from './components/driver/DriverInterface';
import LoginScreen from './components/auth/LoginScreen';
import type { Assignment, CompletedTask, LocalDriver, LocalTruck, AppNotification, AdminRole, AdminActivityEntry, AdminActivityInput } from './data/assignmentTypes';
import { OM_EMAIL } from './data/assignmentTypes';

type AppView = 'login' | 'admin' | 'driver';
type NavItem = 'Dashboard' | 'Monitor' | 'Deliveries' | 'Documents' | 'Reports' | 'Accounts';

export default function App() {
  const [view,      setView]      = useState<AppView>('login');  // ← back to login
  const [activeNav, setActiveNav] = useState<NavItem>('Dashboard');

  /* Auth state */
  const [adminRole,    setAdminRole]    = useState<AdminRole | null>(null);
  const [adminEmail,   setAdminEmail]   = useState<string | null>(null);
  const [accessToken,  setAccessToken]  = useState<string | null>(null);
  const [dataLoading,  setDataLoading]  = useState(false);
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

  /* ── Admin activity logging — auto-injects current account info ── */
  const onLogActivity = useCallback((entry: AdminActivityInput) => {
    /* Extract email from the current token so every entry is tagged by account */
    const token = localStorage.getItem('360_admin_token');
    let inferredEmail = entry.adminEmail;
    let inferredRole  = entry.adminRole;
    if (!inferredEmail && token) {
      try {
        const decoded = atob(token);
        inferredEmail = decoded.split(':')[0];
        inferredRole  = inferredRole ?? decoded.split(':')[1];
      } catch { /* ignore */ }
    }
    const fullEntry: AdminActivityEntry = {
      ...entry,
      adminEmail: inferredEmail,
      adminRole:  inferredRole,
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
    };
    setActivityLog((prev) => [fullEntry, ...prev]);
  }, []);

  /* ── Helpers: build correct headers for each request ── */
  const adminGetHeaders = useCallback((token: string): HeadersInit => ({
    'Authorization': `Bearer ${publicAnonKey}`,
    'X-Admin-Token': token,
  }), []);

  /* ── Load data from server ── */
  const loadData = useCallback(async (token: string) => {
    setDataLoading(true);
    isPollUpdate.current = true; // block auto-save while loading
    try {
      const res = await fetch(`${SERVER}/app-data`, {
        headers: adminGetHeaders(token),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('[loadData] error:', err);
        // do NOT clear state on error — leave whatever is already in memory
        return;
      }
      const data = await res.json();
      setDrivers(data.drivers             ?? []);
      setTrucks(data.trucks               ?? []);
      setAssignments(data.assignments     ?? []);
      setCompleted(data.completed         ?? []);
      setCancelled(data.cancelled         ?? []);
      setNotifications(data.notifications ?? []);
      setActivityLog(data.activityLog     ?? []);
    } catch (err) {
      console.error('[loadData] fetch error:', err);
      // do NOT clear state on network error
    } finally {
      setDataLoading(false);
      setTimeout(() => { isPollUpdate.current = false; }, 200);
    }
  }, [adminGetHeaders]);

  const applySession = useCallback(async (token: string, role: AdminRole, fresh = false, name?: string) => {
    isPollUpdate.current = true; // block auto-save until loadData finishes
    const email = atob(token).split(':')[0];
    setAdminRole(role);
    setAdminEmail(email);
    setAccessToken(token);
    if (fresh) {
      /* Reset the device-local display name on every fresh login so a previous
         account's name (especially a real team member's) never leaks onto the
         next session — member logins repopulate it with their real name, static
         account logins fall back to Header's 'Admin User' default. */
      if (name) localStorage.setItem('360_display_name', name);
      else localStorage.removeItem('360_display_name');
    }
    await loadData(token);
    setView('admin');
    setActiveNav('Dashboard');
    if (fresh) {
      setLoginSuccess('Login Successful! Welcome to the Admin Portal.');
      onLogActivity({ type: 'login', adminEmail: email, adminRole: role });
    }
  }, [loadData, onLogActivity]);

  /* ── Check for existing session on mount (localStorage) ── */
  useEffect(() => {
    const token = localStorage.getItem('360_admin_token');
    const role  = localStorage.getItem('360_admin_role') as AdminRole | null;
    if (token && role) {
      applySession(token, role);
      return;
    }
    /* Also restore driver session */
    const dId   = localStorage.getItem('360_driver_id');
    const dName = localStorage.getItem('360_driver_name');
    if (dId && dName) {
      setDriverInfo({ id: dId, name: dName });
      setView('driver');
    }
  }, [applySession]);

  /* ── Auto-save to server (non-viewer only) ── */
  const saveTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted      = useRef(false);
  const isPollUpdate   = useRef(false);   // ← flag: skip auto-save during poll merges
  const accessTokenRef = useRef<string | null>(null);
  const [saveError,     setSaveError]     = useState<string | null>(null);
  const [loginSuccess,  setLoginSuccess]  = useState<string | null>(null);

  /* Auto-dismiss login success toast after 3 seconds */
  useEffect(() => {
    if (!loginSuccess) return;
    const t = setTimeout(() => setLoginSuccess(null), 3000);
    return () => clearTimeout(t);
  }, [loginSuccess]);

  /* Keep ref in sync so the setTimeout closure always has latest token */
  useEffect(() => { accessTokenRef.current = accessToken; }, [accessToken]);

  const saveToServer = useCallback(async (
    token: string,
    d: LocalDriver[], t: LocalTruck[],
    a: Assignment[], co: CompletedTask[],
    ca: Assignment[], n: AppNotification[],
    al: AdminActivityEntry[]
  ) => {
    setSavingToDb(true);
    setSaveError(null);
    try {
      const res = await fetch(`${SERVER}/app-data`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${publicAnonKey}`,
          'X-Admin-Token': token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ drivers: d, trucks: t, assignments: a, completed: co, cancelled: ca, notifications: n, activityLog: al }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('[saveToServer] error:', err);
        setSaveError(`Auto-save failed: ${err?.error ?? res.status}. Changes may be lost on refresh.`);
        setTimeout(() => setSaveError(null), 6000);
      }
    } catch (err) {
      console.error('[saveToServer] fetch error:', err);
      setSaveError('Auto-save failed — check your connection.');
      setTimeout(() => setSaveError(null), 6000);
    } finally {
      setSavingToDb(false);
    }
  }, []);

  /* Auto-save: only fires for user-driven changes, not poll-driven merges */
  useEffect(() => {
    if (!isMounted.current) { isMounted.current = true; return; }
    if (isPollUpdate.current) return;                              // ← skip poll updates
    const token = accessTokenRef.current;
    if (!token || adminRole === 'viewer' || adminRole === null) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const t = accessTokenRef.current;
      if (t) saveToServer(t, drivers, trucks, assignments, completed, cancelled, notifications, activityLog);
    }, 1500);

    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [drivers, trucks, assignments, completed, cancelled, notifications, activityLog, adminRole]);

  /* ── Admin real-time poll — refresh data every 12 s ── */
  useEffect(() => {
    if (!accessToken || adminRole === 'viewer') return;
    const id = setInterval(async () => {
      try {
        const res = await fetch(`${SERVER}/app-data`, {
          headers: {
            'Authorization': `Bearer ${publicAnonKey}`,
            'X-Admin-Token': accessToken,
          },
        });
        if (!res.ok) return;
        const data = await res.json();
        /* Mark as poll update so auto-save doesn't fire */
        isPollUpdate.current = true;
        setAssignments(data.assignments   ?? []);
        setNotifications(data.notifications ?? []);
        setDrivers(data.drivers           ?? []);
        setTrucks(data.trucks             ?? []);
        setCompleted(data.completed       ?? []);
        setCancelled(data.cancelled       ?? []);
        setActivityLog(data.activityLog   ?? []);
        /* Reset flag after React has processed the state updates */
        setTimeout(() => { isPollUpdate.current = false; }, 100);
      } catch { /* ignore poll errors */ }
    }, 12000);
    return () => clearInterval(id);
  }, [accessToken, adminRole]);

  const handleLogout = async () => {
    localStorage.removeItem('360_admin_token');
    localStorage.removeItem('360_admin_role');
    localStorage.removeItem('360_driver_id');
    localStorage.removeItem('360_driver_name');
    setAdminRole(null);
    setAdminEmail(null);
    setAccessToken(null);
    setDriverInfo(null);
    setView('login');
    setDrivers([]);
    setTrucks([]);
    setAssignments([]);
    setCompleted([]);
    setCancelled([]);
    setNotifications([]);
    setActivityLog([]);
    isMounted.current = false;
  };

  /* ── Reset all data (drivers, trucks, assignments, etc.) — keeps admin accounts ── */
  const handleResetAll = useCallback(async (): Promise<void> => {
    const token = accessTokenRef.current;
    if (!token) return;
    try {
      const res = await fetch(`${SERVER}/reset-data`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${publicAnonKey}`,
          'X-Admin-Token': token,
        },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? `Server error ${res.status}`);
      }
    } catch (err) {
      console.error('[handleResetAll] server error, clearing local only:', err);
    }
    /* Clear local state regardless of server outcome */
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
  const isOperationManager = adminEmail === OM_EMAIL;

  /* ── Loading screen ── */
  if (dataLoading) {
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

      {/* ── Main Content ── */}
      {view === 'login' && (
        <LoginScreen
          drivers={drivers}
          trucks={trucks}
          assignments={assignments}
          onAdminLogin={async (token, role, name) => { await applySession(token, role, true, name); }}
          onDriverLogin={(info) => {
            localStorage.setItem('360_driver_id',   info.id);
            localStorage.setItem('360_driver_name', info.name);
            setDriverInfo(info);
            setView('driver');
            setLoginSuccess(`Login Successful! Welcome, ${info.name}.`);
          }}
        />
      )}

      {view === 'admin' && (
        <AdminDashboard
          drivers={drivers}          setDrivers={setDrivers}
          trucks={trucks}            setTrucks={setTrucks}
          assignments={assignments}  setAssignments={setAssignments}
          completed={completed}      setCompleted={setCompleted}
          cancelled={cancelled}      setCancelled={setCancelled}
          notifications={notifications} setNotifications={setNotifications}
          activityLog={activityLog}
          onLogActivity={onLogActivity}
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
          onLogout={() => {
            localStorage.removeItem('360_driver_id');
            localStorage.removeItem('360_driver_name');
            setDriverInfo(null);
            setView('login');
          }}
        />
      )}

    </div>
  );
}