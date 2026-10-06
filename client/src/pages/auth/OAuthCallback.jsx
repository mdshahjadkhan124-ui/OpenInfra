/**
 * Google OAuth landing page.
 *
 * The server redirects here with the JWT in the URL **fragment**, not the
 * query string — a fragment is never sent to a server, so the token stays out
 * of access logs, proxy logs and the Referer header of whatever the user
 * clicks next (see the Phase 2 note in the API docs).
 *
 * This page therefore has to read `location.hash`, adopt the token, and then
 * scrub the hash from history so it is not left sitting in the address bar or
 * recoverable with the back button.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { homeFor } from '../../components/ProtectedRoute.jsx';
import { LoadingState, ErrorState } from '../../components/ui.jsx';

export const OAuthCallback = () => {
  const { adoptToken } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [error, setError] = useState(null);

  // Under React 18+ StrictMode effects run twice in development; adopting the
  // same token twice is harmless but the duplicate toast is not.
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = params.get('token');

    // Remove the token from the URL immediately, before any await.
    window.history.replaceState(null, '', `${window.location.pathname}`);

    if (!token) {
      setError('Google did not return a sign-in token. Please try again.');
      return;
    }

    adoptToken(token)
      .then((user) => {
        toast.success(`Signed in as ${user.name}`);
        navigate(homeFor(user.role), { replace: true });
      })
      .catch((err) => {
        setError(err.userMessage ?? 'That sign-in link is no longer valid.');
      });
  }, [adoptToken, navigate, toast]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <ErrorState message={error} onRetry={() => navigate('/login', { replace: true })} />
      </div>
    );
  }

  return <LoadingState label="Completing sign-in…" className="min-h-screen" />;
};

export default OAuthCallback;
