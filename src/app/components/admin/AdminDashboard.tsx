import { useState } from 'react';
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
          />
        );
      case 'Deliveries':
        return (
          <DeliveryTable fullView assignments={assignments} completed={completed} cancelled={cancelled} />
        );
      case 'Documents':
        return <DocumentArchive assignments={assignments} completed={completed} setAssignments={setAssignments} isViewOnly={isViewOnly} />;
      case 'Reports':
        return <Reports assignments={assignments} completed={completed} />;
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
          />
        );
      default:
        return <KPICards drivers={drivers} trucks={trucks} assignments={assignments} completed={completed} />;
    }
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar activeNav={activeNav} setActiveNav={setActiveNav} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header
          notifications={notifications}
          setNotifications={setNotifications}
          onNavigate={(page) => setActiveNav(page as NavItem)}
          onLogout={onLogout}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenHelp={() => setHelpOpen(true)}
          notifEnabled={notifEnabled}
          isOperationManager={isOperationManager}
          adminEmail={adminEmail}
          adminName={adminName}
          onOpenWorkspaceSettings={() => setWorkspaceOpen(true)}
        />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
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
