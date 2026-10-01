import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { Assignment, CompletedTask, LocalDriver, LocalTruck, AppNotification } from '../../../data/assignmentTypes';
import DashboardStatCards from './DashboardStatCards';
import DeliveryOverviewChart from './DeliveryOverviewChart';
import RecentActivityTable from './RecentActivityTable';
import DriversFleetCards from './DriversFleetCards';
import DashboardHeader, { WelcomeSummary } from './DashboardHeader';

/* ── Redesigned admin Dashboard ──────────────────────────────────────────────
   Switched on/off by USE_NEW_DASHBOARD in AdminDashboard.tsx; the old dashboard
   (KPICards + DeliveryStatusBoard + Charts) is untouched. Everything here reads the
   same props the old one did — no extra database calls. */

/* true = welcome banner card (truck image from 1280px, live summary, Dispatch Truck);
   false = the plain header (DashboardHeader.tsx) — kept so it can be switched back. */
const SHOW_WELCOME_BANNER = true;

type Page = 'Monitor' | 'Deliveries' | 'Documents' | 'Accounts';

interface Props {
  drivers: LocalDriver[];
  trucks: LocalTruck[];
  assignments: Assignment[];
  completed: CompletedTask[];
  cancelled: Assignment[];
  notifications: AppNotification[];
  adminName?: string;
  isViewOnly: boolean;
  onNavigate: (page: Page) => void;
  onDispatch: () => void;     // opens Monitor's existing Dispatch Truck form
}

export default function DashboardHome({
  drivers, trucks, assignments, completed, cancelled, notifications,
  adminName, isViewOnly, onNavigate, onDispatch,
}: Props) {
  return (
    <div className="space-y-4 sm:space-y-6">

      {/* ── Welcome: banner card (current) or the plain header (kept, switched off) ── */}
      {SHOW_WELCOME_BANNER
        ? <WelcomeBanner assignments={assignments} completed={completed} adminName={adminName}
            isViewOnly={isViewOnly} onNavigate={onNavigate} onDispatch={onDispatch} />
        : <DashboardHeader assignments={assignments} completed={completed} adminName={adminName}
            isViewOnly={isViewOnly} onNavigate={onNavigate} onDispatch={onDispatch} />}

      {/* ── Stat cards ── */}
      <DashboardStatCards assignments={assignments} completed={completed} onNavigate={onNavigate} />

      {/* ── One shared 50/50 grid for the two bottom rows, so edges and the middle gap
          line up exactly; each row's two cards stretch to equal height.
          Row 1: Delivery Overview + Recent Activity · Row 2: Available Drivers + Fleet ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6">
        <DeliveryOverviewChart
          assignments={assignments} completed={completed} cancelled={cancelled}
        />
        <RecentActivityTable notifications={notifications} completed={completed} />
        <DriversFleetCards drivers={drivers} trucks={trucks} assignments={assignments} onViewAll={() => onNavigate('Accounts')} />
      </div>
    </div>
  );
}

/* ── Welcome banner — shown while SHOW_WELCOME_BANNER is true.
   Image: public/dashboard/hero-banner-wide.webp (hero-banner.png is kept but unused). */
function WelcomeBanner({ assignments, completed, adminName, isViewOnly, onNavigate, onDispatch }: {
  assignments: Assignment[]; completed: CompletedTask[]; adminName?: string; isViewOnly: boolean;
  onNavigate: (page: 'Deliveries' | 'Documents') => void; onDispatch: () => void;
}) {
  /* The banner image is optional: if the file is missing, the card is text only */
  const [bannerOk, setBannerOk] = useState(true);

  /* Image only from xl (1280px): at 160px tall it is 1600px wide and the truck takes
     its rightmost ~375px, so the text needs ~400px kept free on the right — narrower
     cards can't fit the title + summary + button in 160px beside it. */
  return (
    <div className="relative bg-white rounded-2xl border border-border shadow-sm overflow-hidden xl:h-[160px]">
      {bannerOk && (
        <>
          {/* Sized to the banner's height (never stretched or cut vertically), anchored
              right; anything wider than the card is cut on the left (empty scenery).
              max-w-none: stop the base img max-width:100% from squashing it. */}
          <img src="/dashboard/hero-banner-wide.webp" alt="" aria-hidden="true"
            className="hidden xl:block absolute right-0 top-0 h-full w-auto max-w-none"
            onError={() => setBannerOk(false)} />
          {/* Soft white fade behind the text; ends before the truck */}
          <div aria-hidden="true"
            className="hidden xl:block absolute inset-0 bg-gradient-to-r from-white via-white/70 via-25% to-transparent to-50%" />
        </>
      )}
      <div className="relative h-full flex flex-col justify-center gap-3 px-6 py-6 sm:px-8 xl:py-0 xl:max-w-[calc(100%-400px)]">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-foreground leading-tight">
            Welcome back, {adminName ?? 'Admin User'}
          </h1>
          <WelcomeSummary assignments={assignments} completed={completed} onNavigate={onNavigate} />
        </div>
        {!isViewOnly && (
          <button onClick={onDispatch}
            className="w-full sm:w-fit inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors shadow-sm text-sm font-semibold">
            <Plus className="w-4 h-4" /> Dispatch Truck
          </button>
        )}
      </div>
    </div>
  );
}
