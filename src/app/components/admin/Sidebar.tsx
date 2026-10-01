import { useState } from 'react';
import { LayoutDashboard, Package, FileText, BarChart3, UserCog, Route, Menu, X } from 'lucide-react';
import imgLogo from 'figma:asset/5e73e3c08e898d68c86717993c6e7442d03e9ac4.png';

type NavItem = 'Dashboard' | 'Monitor' | 'Deliveries' | 'Documents' | 'Reports' | 'Accounts';

interface SidebarProps {
  activeNav: string;
  setActiveNav: (nav: NavItem) => void;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
}

const navItems: { name: NavItem; label?: string; icon: React.ElementType }[] = [
  { name: 'Dashboard',  icon: LayoutDashboard },
  { name: 'Monitor',    label: 'Dispatch', icon: Route },
  { name: 'Deliveries', icon: Package         },
  { name: 'Documents',  icon: FileText        },
  { name: 'Reports',    icon: BarChart3       },
  { name: 'Accounts',   icon: UserCog         },
];

export default function Sidebar({ activeNav, setActiveNav, mobileOpen, setMobileOpen }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('360_admin_sidebar_collapsed') === 'true'; }
    catch { return false; }
  });

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      try { localStorage.setItem('360_admin_sidebar_collapsed', String(next)); }
      catch { /* Keep the choice for this session if storage is unavailable. */ }
      return next;
    });
  };

  const handleNav = (name: NavItem) => {
    setActiveNav(name);
    setMobileOpen(false);
  };

  /* Logo row — 71px tall to line up with the header's bottom border (Header.tsx:
     py-3.5 = 28px + 42px account pill + 1px border). Hard-coded: if the header's
     padding or pill size changes, update this too. px-7 (28px) = nav p-3 + item px-4,
     so the logo's left edge lines up with the menu icons. 642×363 PNG shown 40px tall,
     so it stays sharp on high-DPI screens. Click → Dashboard. */
  const LogoButton = ({ compact = false }: { compact?: boolean }) => (
    <button onClick={() => handleNav('Dashboard')} aria-label="Go to Dashboard"
      className="flex items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
      <img src={imgLogo} alt="360 Logistics" className={compact ? 'h-5 w-auto' : 'h-10 w-auto'} />
    </button>
  );

  const NavContent = ({ iconOnly = false }: { iconOnly?: boolean }) => (
    <nav className={`flex-1 space-y-0.5 ${iconOnly ? 'overflow-visible p-2' : 'overflow-y-auto p-3'}`}>
      {navItems.map((item) => {
        const Icon     = item.icon;
        const isActive = activeNav === item.name;
        const label = item.label ?? item.name;
        return (
          <button
            key={item.name}
            onClick={() => handleNav(item.name)}
            aria-label={iconOnly ? label : undefined}
            aria-current={isActive ? 'page' : undefined}
            className={`${iconOnly ? 'group relative flex h-11 w-full items-center justify-center rounded-lg' : 'w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left'} transition-all ${
              isActive
                ? 'bg-primary text-white shadow-sm'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            <Icon className="w-5 h-5 flex-shrink-0" />
            {iconOnly ? (
              <>
                <span className="sr-only">{label}</span>
                <span role="tooltip" className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs text-background opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus:opacity-100">{label}</span>
              </>
            ) : <span className="font-medium text-sm">{label}</span>}
          </button>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* ── Mobile top bar ── */}
      <div className="fixed inset-x-0 top-0 z-30 flex h-[calc(4rem+env(safe-area-inset-top))] items-center gap-3 border-b border-border bg-white px-4 pt-[env(safe-area-inset-top)] md:hidden">
        <button type="button" onClick={() => setMobileOpen(true)} aria-label="Open menu" aria-expanded={mobileOpen}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground">
          <Menu className="h-5 w-5" />
        </button>
        <LogoButton compact />
      </div>

      {/* ── Mobile overlay ── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Mobile drawer ── */}
      <aside
        role="dialog" aria-label="Navigation menu" aria-modal={mobileOpen} aria-hidden={!mobileOpen}
        className={`fixed inset-y-0 left-0 z-[90] flex w-[min(16rem,calc(100vw-1rem))] flex-col border-r border-border bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl transition-[transform,visibility] duration-150 md:hidden ${
          mobileOpen ? 'visible translate-x-0' : 'invisible pointer-events-none -translate-x-full'
        }`}
      >
        <div className="flex h-[calc(71px+env(safe-area-inset-top))] flex-shrink-0 items-center justify-between border-b border-border pl-7 pr-4 pt-[env(safe-area-inset-top)]">
          <LogoButton />
          <button onClick={() => setMobileOpen(false)} aria-label="Close menu" className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <NavContent />
      </aside>

      {/* ── Desktop sidebar ── */}
      <aside onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && event.propertyName === 'width') window.dispatchEvent(new Event('resize'));
      }} className={`hidden flex-shrink-0 flex-col border-r border-border bg-white transition-[width] duration-150 md:flex ${collapsed ? 'w-[68px]' : 'w-64'}`}>
        <div className={`flex h-[71px] flex-shrink-0 items-center border-b border-border ${collapsed ? 'flex-col justify-center gap-1 px-2' : 'justify-between px-7'}`}>
          {!collapsed && <LogoButton />}
          <button type="button" onClick={toggleCollapsed} aria-label={collapsed ? 'Expand menu' : 'Collapse menu'} aria-expanded={!collapsed}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <Menu className="h-5 w-5" />
          </button>
        </div>
        <NavContent iconOnly={collapsed} />
      </aside>
    </>
  );
}
