/**
 * Toast viewport.
 *
 * Bottom-centre on phones (within thumb reach, clear of the nav) and
 * top-right on desktop.
 */
import { useToastList } from '../context/ToastContext.jsx';
import { cx } from './ui.jsx';

const TONES = {
  success: {
    wrap: 'border-emerald-200 bg-white dark:border-emerald-900 dark:bg-slate-900',
    bar: 'bg-emerald-500',
    icon: '✓',
    iconClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  },
  error: {
    wrap: 'border-red-200 bg-white dark:border-red-900 dark:bg-slate-900',
    bar: 'bg-red-500',
    icon: '!',
    iconClass: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
  },
  warning: {
    wrap: 'border-amber-200 bg-white dark:border-amber-900 dark:bg-slate-900',
    bar: 'bg-amber-500',
    icon: '!',
    iconClass: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  },
  info: {
    wrap: 'border-sky-200 bg-white dark:border-sky-900 dark:bg-slate-900',
    bar: 'bg-sky-500',
    icon: 'i',
    iconClass: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-400',
  },
};

export const Toaster = () => {
  const { toasts, dismiss } = useToastList();
  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:top-0 sm:right-0 sm:bottom-auto sm:items-end"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map((t) => {
        const tone = TONES[t.tone] ?? TONES.info;
        return (
          <div
            key={t.id}
            role="status"
            aria-live="polite"
            className={cx(
              'pointer-events-auto relative w-full max-w-sm animate-slide-in-right overflow-hidden rounded-xl border shadow-float',
              tone.wrap
            )}
          >
            <div className={cx('absolute inset-y-0 left-0 w-1', tone.bar)} />
            <div className="flex gap-3 p-4 pl-5">
              <span
                className={cx(
                  'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                  tone.iconClass
                )}
                aria-hidden="true"
              >
                {tone.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.title}</p>
                {t.description && (
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                    {t.description}
                  </p>
                )}
                {t.link && (
                  <a
                    href={t.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline dark:text-brand-400"
                  >
                    View on Etherscan
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </a>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="-m-1 h-6 w-6 shrink-0 rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                aria-label="Dismiss"
              >
                <svg className="mx-auto h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default Toaster;
