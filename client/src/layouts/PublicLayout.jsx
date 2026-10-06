/**
 * Shell for pages anyone can see: the landing page, the auth screens and the
 * public transparency dashboard.
 */
import { Link, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { homeFor } from '../components/ProtectedRoute.jsx';
import { Logo } from '../components/Logo.jsx';
import { ThemeToggle } from '../components/ThemeToggle.jsx';
import { Button } from '../components/ui.jsx';

export const PublicLayout = () => {
  const { isAuthenticated, role } = useAuth();

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 dark:bg-slate-950">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/85 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/85">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <Logo />
          <nav className="ml-6 hidden items-center gap-1 sm:flex">
            <Link
              to="/transparency"
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              Transparency dashboard
            </Link>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            {isAuthenticated ? (
              <Button as={Link} to={homeFor(role)} size="sm">
                Dashboard
              </Button>
            ) : (
              <>
                <Button as={Link} to="/login" variant="ghost" size="sm" className="hidden sm:inline-flex">
                  Sign in
                </Button>
                <Button as={Link} to="/register" size="sm">
                  Get started
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-6 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:text-slate-400">
          <p>
            OpenInfra — civic infrastructure transparency. Built by{' '}
            <span className="font-medium text-slate-700 dark:text-slate-300">MD SHAHJAD KHAN</span>.
          </p>
          <p className="text-xs">
            Every payment is recorded on the Ethereum Sepolia testnet and publicly verifiable.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default PublicLayout;
