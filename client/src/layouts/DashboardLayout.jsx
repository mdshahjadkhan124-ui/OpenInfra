/**
 * Dashboard shell.
 *
 * Sidebar on desktop, slide-over drawer on mobile. Navigation is derived from
 * the signed-in role, so one layout serves all three dashboards and a citizen
 * is never shown a link they would be 403'd from.
 */
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { ROLES } from '../lib/constants.js';
import { Logo } from '../components/Logo.jsx';
import { ThemeToggle } from '../components/ThemeToggle.jsx';
import { WalletButton } from '../components/WalletButton.jsx';
import { cx } from '../components/ui.jsx';

const icons = {
  home: 'M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5',
  plus: 'M12 5v14M5 12h14',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
  gavel: 'M14 3 21 10M17.5 6.5 6 18H3v-3L14.5 3.5M12 15l6 6',
  check: 'M20 6 9 17l-5-5',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18',
};

const NAV = {
  [ROLES.CITIZEN]: [
    { to: '/citizen', label: 'Overview', icon: 'home', end: true },
    { to: '/citizen/report', label: 'Report a problem', icon: 'plus' },
    { to: '/citizen/reports', label: 'My reports', icon: 'list' },
    { to: '/transparency', label: 'Transparency', icon: 'globe' },
  ],
  [ROLES.CONTRACTOR]: [
    { to: '/contractor', label: 'Overview', icon: 'home', end: true },
    { to: '/contractor/projects', label: 'Open projects', icon: 'folder' },
    { to: '/contractor/bids', label: 'My bids', icon: 'gavel' },
    { to: '/contractor/awarded', label: 'My work', icon: 'check' },
    { to: '/transparency', label: 'Transparency', icon: 'globe' },
  ],
  [ROLES.ADMIN]: [
    { to: '/admin', label: 'Overview', icon: 'home', end: true },
    { to: '/admin/reports', label: 'Review reports', icon: 'list' },
    { to: '/admin/projects', label: 'Projects & bids', icon: 'gavel' },
    { to: '/admin/milestones', label: 'Approve milestones', icon: 'check' },
    { to: '/transparency', label: 'Transparency', icon: 'globe' },
  ],
};

const ROLE_LABEL = {
  citizen: 'Citizen',
  contractor: 'Contractor',
  admin: 'Government admin',
};

const Icon = ({ path }) => (
  <svg className="h-[18px] w-[18px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={path} />
  </svg>
);

export const DashboardLayout = () => {
  const { user, role, signOut } = useAuth();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the mobile drawer on navigation, or it covers the page just opened.
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  const items = NAV[role] ?? [];

  const navList = (
    <nav className="flex flex-1 flex-col gap-0.5 p-3">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            cx(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              isActive
                ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
            )
          }
        >
          <Icon path={icons[item.icon]} />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );

  const userPanel = (
    <div className="border-t border-slate-200 p-3 dark:border-slate-800">
      <div className="flex items-center gap-3 rounded-lg px-2 py-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-accent-600 text-sm font-bold text-white">
          {(user?.name ?? '?').charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
            {user?.name}
          </p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{ROLE_LABEL[role]}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={signOut}
        className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-red-50 hover:text-red-700 dark:text-slate-400 dark:hover:bg-red-950/40 dark:hover:text-red-400"
      >
        <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
        </svg>
        Sign out
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* --- Desktop sidebar --- */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex dark:border-slate-800 dark:bg-slate-900">
        <div className="flex h-16 items-center border-b border-slate-200 px-5 dark:border-slate-800">
          <Logo to={`/${role}`} />
        </div>
        {navList}
        {userPanel}
      </aside>

      {/* --- Mobile drawer --- */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 animate-fade-in bg-slate-900/50 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="relative flex h-full w-72 max-w-[85%] animate-slide-in-right flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="flex h-16 items-center justify-between border-b border-slate-200 px-5 dark:border-slate-800">
              <Logo to={`/${role}`} />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Close navigation"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            {navList}
            {userPanel}
          </aside>
        </div>
      )}

      {/* --- Main --- */}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/85 px-4 backdrop-blur-md sm:px-6 dark:border-slate-800 dark:bg-slate-900/85">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="-ml-1 rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden dark:text-slate-400 dark:hover:bg-slate-800"
            aria-label="Open navigation"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <div className="flex-1 lg:hidden">
            <Logo to={`/${role}`} compact />
          </div>

          <div className="ml-auto flex items-center gap-2">
            {(role === ROLES.CONTRACTOR || role === ROLES.ADMIN) && <WalletButton compact />}
            <ThemeToggle />
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default DashboardLayout;
