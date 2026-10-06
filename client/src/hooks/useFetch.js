/**
 * Minimal data fetching.
 *
 * Deliberately not react-query: the app has a handful of screens, each loading
 * one or two resources, and a cache layer would be more machinery than the
 * problem needs. What it does provide is the three states every screen has to
 * render — loading, error, data — plus a refetch, so no page reimplements them.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export const useFetch = (fetcher, deps = [], { immediate = true } = {}) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(immediate);
  const [error, setError] = useState(null);

  // Guards against setting state after unmount, and against a slow earlier
  // request overwriting a faster later one when deps change quickly.
  const requestId = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      if (mounted.current && id === requestId.current) setData(result);
      return result;
    } catch (err) {
      if (mounted.current && id === requestId.current) {
        setError(err.userMessage ?? err.message ?? 'Could not load this.');
      }
      return null;
    } finally {
      if (mounted.current && id === requestId.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (immediate) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, immediate]);

  return { data, loading, error, refetch: run, setData };
};

/** Tracks whether an action (not a load) is in flight, keyed by id. */
export const useAction = () => {
  const [busy, setBusy] = useState(null);

  const run = useCallback(async (key, action) => {
    setBusy(key);
    try {
      return await action();
    } finally {
      setBusy(null);
    }
  }, []);

  return { busy, isBusy: (key) => busy === key, anyBusy: busy !== null, run };
};
