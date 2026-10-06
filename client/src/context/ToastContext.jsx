/**
 * Toasts.
 *
 * Used for every outcome the user did not explicitly navigate to: a bid
 * submitted, an AI rejection, a transaction confirmed. Errors stay longer than
 * successes because they usually need reading.
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ToastContext = createContext(null);

let nextId = 1;

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (toast) => {
      const id = nextId++;
      const duration = toast.duration ?? (toast.tone === 'error' ? 8000 : 4500);
      setToasts((current) => [...current, { ...toast, id }]);
      if (duration !== Infinity) {
        setTimeout(() => dismiss(id), duration);
      }
      return id;
    },
    [dismiss]
  );

  const toast = useMemo(
    () => ({
      success: (title, description) => push({ tone: 'success', title, description }),
      error: (title, description) => push({ tone: 'error', title, description }),
      info: (title, description) => push({ tone: 'info', title, description }),
      warning: (title, description) => push({ tone: 'warning', title, description }),
      /** Long-lived, with an external link — used for on-chain confirmations. */
      chain: (title, description, link) =>
        push({ tone: 'success', title, description, link, duration: 15000 }),
      custom: push,
      dismiss,
    }),
    [push, dismiss]
  );

  return (
    <ToastContext.Provider value={{ toast, toasts, dismiss }}>{children}</ToastContext.Provider>
  );
};

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx.toast;
};

export const useToastList = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToastList must be used inside ToastProvider');
  return { toasts: ctx.toasts, dismiss: ctx.dismiss };
};
