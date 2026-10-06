/**
 * Route guards.
 *
 * The server enforces authorization — these only decide what to render, and
 * are a UX affordance rather than a security boundary. A citizen who forces
 * their way to /admin still gets 403s from every request the page makes.
 */
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { LoadingState } from './ui.jsx';

/** Home screen for each role, used after sign-in and on a role mismatch. */
export const homeFor = (role) =>
  ({ citizen: '/citizen', contractor: '/contractor', admin: '/admin' })[role] ?? '/';

export const RequireAuth = ({ roles }) => {
  const { isAuthenticated, loading, role } = useAuth();
  const location = useLocation();

  // Never redirect while the token is still being validated, or a refresh on
  // a protected page bounces the user to the login screen and back.
  if (loading) return <LoadingState label="Checking your session…" className="min-h-screen" />;

  if (!isAuthenticated) {
    // Remember where they were headed so sign-in can return them.
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (roles && !roles.includes(role)) {
    return <Navigate to={homeFor(role)} replace />;
  }

  return <Outlet />;
};

/** For the auth pages: a signed-in user has no business on /login. */
export const RequireGuest = () => {
  const { isAuthenticated, loading, role } = useAuth();
  if (loading) return <LoadingState label="Loading…" className="min-h-screen" />;
  if (isAuthenticated) return <Navigate to={homeFor(role)} replace />;
  return <Outlet />;
};
