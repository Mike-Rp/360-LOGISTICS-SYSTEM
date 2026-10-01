import { useCallback, useEffect, useState } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import KPICards from './KPICards';
import DeliveryTable from './DeliveryTable';
import DeliveryStatusBoard from './DeliveryStatusBoard';
import Charts from './Charts';
import DocumentArchive from './DocumentArchive';
import DriversManagement from './DriversManagement';
import Reports from './Reports';
import AccountsPanel from './AccountsPanel';
import SettingsPanel from './SettingsPanel';
import HelpPanel from './HelpPanel';
import WorkspaceSettingsPanel from './WorkspaceSettingsPanel';
import DashboardHome from './dashboard/DashboardHome';
import type { Assignment, CompletedTask, LocalDriver, LocalTruck, AppNotification, AdminRole, AdminActivityEntry, AdminActivityInput } from '../../data/assignmentTypes';

type NavItem = 'Dashboard' | 'Monitor' | 'Deliveries' | 'Documents' | 'Reports' | 'Accounts';

type NotificationTarget = { page: 'Documents' | 'Monitor'; assignmentId: string; docType?: string };

function targetFromUrl(): NotificationTarget | null {
  const params = new URLSearchParams(window.location.search);
  const page = params.get('page');
  const assignmentId = params.get('assignment') ?? '';
  if ((page !== 'Documents' && page !== 'Monitor') || !params.has('assignment')) return null;
  return { page, assignmentId, docType: params.get('document') ?? undefined };
}

const SEARCH_PLACEHOLDERS: Partial<Record<NavItem, string>> = {
  Monitor: 'Search trucks, drivers, routes...',
  Deliveries: 'Search deliveries...',
  Documents: 'Search documents...',
  Accounts: 'Search accounts...',
};

/* Dashboard redesign switch — true = new dashboard (dashboard/DashboardHome.tsx),
   false = the original KPICards + DeliveryStatusBoard + Charts. Nothing else changes. */
const USE_NEW_DASHBOARD = true;

interface Props {
  drivers: LocalDriver[];
  setDrivers: React.Dispatch<React.SetStateAction<LocalDriver[]>>;
  trucks: LocalTruck[];
  setTrucks: React.Dispatch<React.SetStateAction<LocalTruck[]>>;
  assignments: Assignment[];
  setAssignments: React.Dispatch<React.SetStateAction<Assignment[]>>;
  completed: CompletedTask[];
  setCompleted: React.Dispatch<React.SetStateAction<CompletedTask[]>>;
  cancelled: Assignment[];
  setCancelled: React.Dispatch<React.SetStateAction<Assignment[]>>;
  notifications: AppNotification[];
  setNotifications: React.Dispatch<React.SetStateAction<AppNotification[]>>;
  activityLog: AdminActivityEntry[];
  onLogActivity: (entry: AdminActivityInput) => void;
  onServerChange: (action: () => Promise<void>) => Promise<void>;
  archivedDrivers: LocalDriver[];
  archivedTrucks: LocalTruck[];
  activeNav: NavItem;
  setActiveNav: React.Dispatch<React.SetStateAction<NavItem>>;
  onLogout: () => void;
  isViewOnly: boolean;
  adminRole: AdminRole | null;
  savingToDb: boolean;
  onResetAll: () => Promise<void>;   // AccountsPanel awaits this
  isOperationManager: boolean;
  adminEmail: string | null;
}

export default function AdminDashboard({
  drivers, setDrivers, trucks, setTrucks,
  assignments, setAssignments, completed, setCompleted,
  cancelled, setCancelled,
  notifications, setNotifications,
  activityLog, onLogActivity, onServerChange, archivedDrivers, archivedTrucks,
  activeNav, setActiveNav,
  onLogout, isViewOnly, adminRole, savingToDb,
  onResetAll, isOperationManager, adminEmail,
}: Props) {

  /* ── Floating panel state ── */
  const [settingsOpen,  setSettingsOpen]  = useState(false);
  const [helpOpen,      setHelpOpen]      = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchInput, setSearchInput] = useState({ page: activeNav, value: '' });
  const [searchQuery, setSearchQuery] = useState({ page: activeNav, value: '' });
  const [notificationTarget, setNotificationTarget] = useState<NotificationTarget | null>(targetFromUrl);
  const [locationReady, setLocationReady] = useState(false);
  const currentSearchInput = searchInput.page === activeNav ? searchInput.value : '';
  const currentSearchQuery = searchQuery.page === activeNav ? searchQuery.value : '';

  useEffect(() => {
    setSearchInput({ page: activeNav, value: '' });
    setSearchQuery({ page: activeNav, value: '' });
  }, [activeNav]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery({ page: activeNav, value: currentSearchInput }), 250);
    return () => window.clearTimeout(timer);
  }, [activeNav, currentSearchInput]);

  const changeSearch = (value: string) => {
    setSearchInput({ page: activeNav, value });
    if (!value) setSearchQuery({ page: activeNav, value: '' });
  };

  useEffect(() => {
    const restoreLocation = () => {
      const target = targetFromUrl();
      const page = new URLSearchParams(window.location.search).get('page');
      setNotificationTarget(target);
      if (page === 'Documents' || page === 'Monitor' || page === 'Dashboard' || page === 'Deliveries' || page === 'Reports' || page === 'Accounts') {
        setActiveNav(page);
      }
    };
    restoreLocation();
    setLocationReady(true);
    window.addEventListener('popstate', restoreLocation);
    return () => window.removeEventListener('popstate', restoreLocation);
  }, [setActiveNav]);

  useEffect(() => {
    if (!locationReady || notificationTarget) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('page') || url.searchParams.get('page') === activeNav) return;
    url.searchParams.set('page', activeNav);
    window.history.replaceState(window.history.state, '', url);
  }, [activeNav, locationReady, notificationTarget]);

  const navigateToNotification = (page: string, target: { assignmentId: string; docType?: string }) => {
    if (page !== 'Documents' && page !== 'Monitor') return;
    const previous = new URL(window.location.href);
    previous.searchParams.set('page', activeNav);
    previous.searchParams.delete('assignment');
    previous.searchParams.delete('document');
    window.history.replaceState(window.history.state, '', previous);
    const next = new URL(previous);
    next.searchParams.set('page', page);
    next.searchParams.set('assignment', target.assignmentId);
    if (target.docType) next.searchParams.set('document', target.docType);
    window.history.pushState(null, '', next);
    setNotificationTarget({ page, ...target });
    setActiveNav(page);
  };

  const clearNotificationTarget = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('assignment');
    url.searchParams.delete('document');
    window.history.replaceState(window.history.state, '', url);
    setNotificationTarget(null);
  }, []);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenuOpen(false);
    };
    const desktop = window.matchMedia('(min-width: 768px)');
    const closeOnDesktop = () => {
      if (desktop.matches) setMobileMenuOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    desktop.addEventListener('change', closeOnDesktop);
    closeOnDesktop();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
      desktop.removeEventListener('change', closeOnDesktop);
    };
  }, [mobileMenuOpen]);

  /* Dashboard "Dispatch Truck" → go to Monitor and open its existing Dispatch Truck form */
  const [dispatchOnOpen, setDispatchOnOpen] = useState(false);

  /* Display name is stored the same way SettingsPanel's profile section already
     persists it — read once at mount, this component remounts on login/logout. */
  const adminName = localStorage.getItem('360_display_name') ?? undefined;

  /* ── Notifications preference (persisted in localStorage) ── */
  const [notifEnabled, setNotifEnabled] = useState(
    () => localStorage.getItem('360_notif_enabled') !== 'false'
  );

  const renderContent = () => {
    switch (activeNav) {
      case 'Dashboard':
        if (USE_NEW_DASHBOARD) {
          return (
            <DashboardHome
              drivers={drivers} trucks={trucks}
              assignments={assignments} completed={completed} cancelled={cancelled}
              notifications={notifications}
              adminName={adminName}
              isViewOnly={isViewOnly}
              onNavigate={(page) => setActiveNav(page)}
              onDispatch={() => { setDispatchOnOpen(true); setActiveNav('Monitor'); }}
            />
          );
        }
        return (
          <>
            <KPICards drivers={drivers} trucks={trucks} assignments={assignments} completed={completed} />
            <DeliveryStatusBoard
              assignments={assignments}
              completed={completed}
              cancelled={cancelled}
              onNavigateToDeliveries={() => setActiveNav('Deliveries')}
            />
            <Charts
              assignments={assignments}
              completed={completed}
              cancelled={cancelled}
              notifications={notifications}
            />
          </>
        );
      case 'Monitor':
        return (
          <DriversManagement
            drivers={drivers}         setDrivers={setDrivers}
            trucks={trucks}           setTrucks={setTrucks}
            assignments={assignments} setAssignments={setAssignments}
            completed={completed}     setCompleted={setCompleted}
            setCancelled={setCancelled}
            isViewOnly={isViewOnly}
            onLogActivity={onLogActivity}
            onServerChange={onServerChange}
            adminEmail={adminEmail}
            openDispatchOnMount={dispatchOnOpen}
            onDispatchOpened={() => setDispatchOnOpen(false)}
            search={currentSearchQuery}
            onSearchChange={changeSearch}
            notificationTarget={notificationTarget?.page === 'Monitor' ? notificationTarget : null}
            onNotificationTargetHandled={clearNotificationTarget}
          />
        );
      case 'Deliveries':
        return (
          <DeliveryTable fullView assignments={assignments} completed={completed} cancelled={cancelled} trucks={trucks} search={currentSearchQuery} />
        );
      case 'Documents':
        return <DocumentArchive assignments={assignments} completed={completed} setAssignments={setAssignments} isViewOnly={isViewOnly} search={currentSearchQuery} onSearchChange={changeSearch} notificationTarget={notificationTarget?.page === 'Documents' ? notificationTarget : null} onNotificationTargetHandled={clearNotificationTarget} />;
      case 'Reports':
        return <Reports assignments={assignments} completed={completed} cancelled={cancelled} />;
      case 'Accounts':
        return (
          <AccountsPanel
            drivers={drivers}   setDrivers={setDrivers}
            trucks={trucks}     setTrucks={setTrucks}
            assignments={assignments}
            isViewOnly={isViewOnly}
            onResetAll={onResetAll}
            adminRole={adminRole}
            savingToDb={savingToDb}
            onLogActivity={onLogActivity}
            onServerChange={onServerChange}
            archivedDrivers={archivedDrivers}
            archivedTrucks={archivedTrucks}
            search={currentSearchQuery}
          />
        );
      default:
        return <KPICards drivers={drivers} trucks={trucks} assignments={assignments} completed={completed} />;
    }
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar activeNav={activeNav} setActiveNav={setActiveNav} mobileOpen={mobileMenuOpen} setMobileOpen={setMobileMenuOpen} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden pt-[calc(4rem+env(safe-area-inset-top))] md:pt-0">
        <Header
          notifications={notifications}
          setNotifications={setNotifications}
          onNavigate={navigateToNotification}
          onLogout={onLogout}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenHelp={() => setHelpOpen(true)}
          notifEnabled={notifEnabled}
          isOperationManager={isOperationManager}
          adminEmail={adminEmail}
          adminName={adminName}
          onOpenWorkspaceSettings={() => setWorkspaceOpen(true)}
          searchPlaceholder={SEARCH_PLACEHOLDERS[activeNav]}
          searchValue={currentSearchInput}
          onSearchChange={changeSearch}
        />
        <main className={`min-w-0 flex-1 p-4 sm:p-6 ${mobileMenuOpen ? 'overflow-hidden' : 'overflow-y-auto'}`}>
          <div className="max-w-[1600px] mx-auto space-y-4 sm:space-y-6">{renderContent()}</div>
        </main>
      </div>

      {/* ── Floating panels ── */}
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        notifEnabled={notifEnabled}
        setNotifEnabled={setNotifEnabled}
      />
      <HelpPanel
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
      />
      {isOperationManager && (
        <WorkspaceSettingsPanel
          open={workspaceOpen}
          onClose={() => setWorkspaceOpen(false)}
          activityLog={activityLog}
          onLogActivity={onLogActivity}
          adminEmail={adminEmail}
        />
      )}
    </div>
  );
}
