/**
 * Authentication state.
 *
 * Holds the token and the current user, and re-validates against the server on
 * boot. A token in localStorage proves nothing — it may be expired, or the
 * account may have been deactivated — so the app always asks `/auth/me` before
 * treating anyone as signed in.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi, getToken, setToken, onUnauthorized } from '../services/api.js';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const signOut = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  /** Re-validate whatever token we have. */
  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return null;
    }
    try {
      const { user: fresh } = await authApi.me();
      setUser(fresh);
      return fresh;
    } catch {
      // The interceptor has already cleared the token on a 401.
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // A 401 from any request signs the whole app out at once, rather than
  // leaving each page to discover it separately.
  useEffect(() => onUnauthorized(() => setUser(null)), []);

  const signIn = useCallback(async (credentials) => {
    const { token, user: signedIn } = await authApi.login(credentials);
    setToken(token);
    setUser(signedIn);
    return signedIn;
  }, []);

  const signUp = useCallback(async (payload) => {
    const { token, user: created } = await authApi.register(payload);
    setToken(token);
    setUser(created);
    return created;
  }, []);

  /** Used by the OAuth callback page, which receives a token in the URL hash. */
  const adoptToken = useCallback(async (token) => {
    setToken(token);
    const { user: fresh } = await authApi.me();
    setUser(fresh);
    return fresh;
  }, []);

  const saveWallet = useCallback(async (walletAddress) => {
    const { user: updated } = await authApi.setWallet(walletAddress);
    setUser(updated);
    return updated;
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      isAuthenticated: Boolean(user),
      role: user?.role ?? null,
      signIn,
      signUp,
      signOut,
      adoptToken,
      refresh,
      saveWallet,
    }),
    [user, loading, signIn, signUp, signOut, adoptToken, refresh, saveWallet]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
