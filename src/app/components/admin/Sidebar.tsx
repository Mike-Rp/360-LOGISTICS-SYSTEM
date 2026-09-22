import { useState } from 'react';
import { LayoutDashboard, Package, FileText, BarChart3, UserCog, MonitorCheck, Menu, X } from 'lucide-react';
import imgLogo from 'figma:asset/5e73e3c08e898d68c86717993c6e7442d03e9ac4.png';

type NavItem = 'Dashboard' | 'Monitor' | 'Deliveries' | 'Documents' | 'Reports' | 'Accounts';

interface SidebarProps {
  activeNav: string;
  setActiveNav: (nav: NavItem) => void;
}

const navItems: { name: NavItem; icon: React.ElementType }[] = [
  { name: 'Dashboard',  icon: LayoutDashboard },
  { name: 'Monitor',    icon: MonitorCheck    },
  { name: 'Deliveries', icon: Package         },
  { name: 'Documents',  icon: FileText        },
  { name: 'Reports',    icon: BarChart3       },
  { name: 'Accounts',   icon: UserCog         },
];

export default function Sidebar({ activeNav, setActiveNav }: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleNav = (name: NavItem) => {
    setActiveNav(name);
    setMobileOpen(false);
  };

  /* Logo row — 71px tall to line up with the header's bottom border (Header.tsx:
     py-3.5 = 28px + 42px account pill + 1px border). Hard-coded: if the header's
     padding or pill size changes, update this too. px-7 (28px) = nav p-3 + item px-4,
     so the logo's left edge lines up with the menu icons. 642×363 PNG shown 40px tall,
     so it stays sharp on high-DPI screens. Click → Dashboard. */
  const LogoButton = () => (
    <button onClick={() => handleNav('Dashboard')} aria-label="Go to Dashboard"
      className="flex items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
      <img src={imgLogo} alt="360 Logistics" className="h-10 w-auto" />
    </button>
  );

  const NavContent = () => (
    <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
      {navItems.map((item) => {
        const Icon     = item.icon;
        const isActive = activeNav === item.name;
        return (
          <button
            key={item.name}
            onClick={() => handleNav(item.name)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-left ${
              isActive
                ? 'bg-primary text-white shadow-sm'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            <Icon className="w-5 h-5 flex-shrink-0" />
            <span className="font-medium text-sm">{item.name}</span>
          </button>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* ── Mobile hamburger ── */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-3.5 left-4 z-40 w-9 h-9 flex items-center justify-center rounded-lg bg-white border border-border shadow-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* ── Mobile overlay ── */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Mobile drawer ── */}
      <aside
        className={`lg:hidden fixed top-0 left-0 h-full z-50 w-64 bg-white border-r border-border flex flex-col shadow-2xl transition-transform duration-300 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-[71px] flex items-center justify-between pl-7 pr-4 border-b border-border flex-shrink-0">
          <LogoButton />
          <button onClick={() => setMobileOpen(false)} className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <NavContent />
      </aside>

      {/* ── Desktop sidebar ── */}
      <aside className="hidden lg:flex w-64 bg-white border-r border-border flex-col flex-shrink-0">
        <div className="h-[71px] flex items-center px-7 border-b border-border flex-shrink-0">
          <LogoButton />
        </div>
        <NavContent />
      </aside>
    </>
  );
}
