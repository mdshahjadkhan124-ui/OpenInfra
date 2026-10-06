/**
 * Shared UI primitives.
 *
 * Kept in one file because they are small and almost always imported
 * together. Anything that grows past ~40 lines moves to its own module.
 */
import { Link } from 'react-router-dom';
import { STATUS_LABEL, STATUS_TONE, ETHERSCAN_BASE } from '../lib/constants.js';
import { shortHash } from '../lib/format.js';

export const cx = (...parts) => parts.filter(Boolean).join(' ');

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

export const Spinner = ({ size = 'md', className = '' }) => {
  const dimensions = { xs: 'h-3 w-3', sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-8 w-8', xl: 'h-12 w-12' };
  return (
    <svg
      className={cx('animate-spin', dimensions[size], className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path
        className="opacity-90"
        d="M22 12a10 10 0 0 0-10-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
};

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

const BUTTON_VARIANTS = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-600/50 shadow-sm',
  secondary:
    'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 hover:border-slate-400 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800',
  ghost:
    'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
  danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 disabled:bg-red-600/50 shadow-sm',
  success:
    'bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 disabled:bg-emerald-600/50 shadow-sm',
  outlineDanger:
    'border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40',
};

const BUTTON_SIZES = {
  sm: 'px-3 py-1.5 text-xs gap-1.5',
  md: 'px-4 py-2.5 text-sm gap-2',
  lg: 'px-5 py-3 text-base gap-2',
};

export const Button = ({
  as: Component = 'button',
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  className = '',
  children,
  ...props
}) => (
  <Component
    className={cx(
      'inline-flex items-center justify-center rounded-lg font-semibold transition-all duration-150',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
      'disabled:cursor-not-allowed disabled:opacity-60',
      BUTTON_VARIANTS[variant],
      BUTTON_SIZES[size],
      className
    )}
    disabled={Component === 'button' ? disabled || loading : undefined}
    aria-busy={loading || undefined}
    {...props}
  >
    {loading && <Spinner size="sm" />}
    {children}
  </Component>
);

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

const TONES = {
  green:
    'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-900',
  red: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-400 dark:border-red-900',
  amber:
    'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-900',
  blue: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-400 dark:border-sky-900',
  violet:
    'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/50 dark:text-violet-400 dark:border-violet-900',
  teal: 'bg-brand-50 text-brand-700 border-brand-200 dark:bg-brand-950/50 dark:text-brand-400 dark:border-brand-900',
  slate:
    'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',
};

export const Badge = ({ tone = 'slate', children, className = '', dot = false }) => (
  <span
    className={cx(
      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
      TONES[tone] ?? TONES.slate,
      className
    )}
  >
    {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
    {children}
  </span>
);

/** Badge driven by a status string, so the colour is never chosen by hand. */
export const StatusBadge = ({ status, className = '', dot = true }) => {
  if (!status) return null;
  return (
    <Badge tone={STATUS_TONE[status] ?? 'slate'} className={className} dot={dot}>
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
};

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export const Card = ({ className = '', hover = false, children, ...props }) => (
  <div className={cx('card', hover && 'card-hover', className)} {...props}>
    {children}
  </div>
);

export const CardHeader = ({ title, description, actions, className = '' }) => (
  <div className={cx('flex flex-wrap items-start justify-between gap-3 p-5 pb-0', className)}>
    <div className="min-w-0">
      <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
      {description && (
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
      )}
    </div>
    {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
  </div>
);

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export const LoadingState = ({ label = 'Loading…', className = '' }) => (
  <div className={cx('flex flex-col items-center justify-center gap-3 py-16', className)}>
    <Spinner size="lg" className="text-brand-600" />
    <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
  </div>
);

export const EmptyState = ({ icon, title, description, action, className = '' }) => (
  <div className={cx('flex flex-col items-center justify-center px-6 py-16 text-center', className)}>
    {icon && (
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl dark:bg-slate-800">
        {icon}
      </div>
    )}
    <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
    {description && (
      <p className="mt-1.5 max-w-sm text-sm text-slate-500 dark:text-slate-400">{description}</p>
    )}
    {action && <div className="mt-5">{action}</div>}
  </div>
);

export const ErrorState = ({ message, onRetry, className = '' }) => (
  <div className={cx('flex flex-col items-center justify-center px-6 py-16 text-center', className)}>
    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-2xl dark:bg-red-950/50">
      ⚠️
    </div>
    <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
      Something went wrong
    </h3>
    <p className="mt-1.5 max-w-md text-sm text-slate-500 dark:text-slate-400">{message}</p>
    {onRetry && (
      <Button variant="secondary" onClick={onRetry} className="mt-5">
        Try again
      </Button>
    )}
  </div>
);

export const SkeletonCard = () => (
  <div className="card p-5">
    <div className="skeleton h-4 w-2/3" />
    <div className="skeleton mt-3 h-3 w-full" />
    <div className="skeleton mt-2 h-3 w-4/5" />
    <div className="mt-5 flex gap-2">
      <div className="skeleton h-6 w-20 rounded-full" />
      <div className="skeleton h-6 w-24 rounded-full" />
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Form field
// ---------------------------------------------------------------------------

export const Field = ({ label, htmlFor, error, hint, required, children, className = '' }) => (
  <div className={className}>
    {label && (
      <label className="label" htmlFor={htmlFor}>
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
    )}
    {children}
    {error ? (
      <p className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400">{error}</p>
    ) : (
      hint && <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
    )}
  </div>
);

// ---------------------------------------------------------------------------
// On-chain link
// ---------------------------------------------------------------------------

/**
 * A link to Etherscan.
 *
 * The whole platform rests on these being easy to find and obviously external,
 * so it always carries the outbound icon and opens in a new tab.
 */
export const EtherscanLink = ({ hash, address, label, className = '', compact = false }) => {
  const target = hash ? `${ETHERSCAN_BASE}/tx/${hash}` : address ? `${ETHERSCAN_BASE}/address/${address}` : null;
  if (!target) return <span className="text-slate-400">—</span>;

  return (
    <a
      href={target}
      target="_blank"
      rel="noopener noreferrer"
      className={cx(
        'inline-flex items-center gap-1.5 font-medium text-brand-700 hover:text-brand-800 hover:underline dark:text-brand-400 dark:hover:text-brand-300',
        compact ? 'text-xs' : 'text-sm',
        className
      )}
      title={hash ?? address}
    >
      <span className="font-mono">{label ?? shortHash(hash ?? address)}</span>
      <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
};

// ---------------------------------------------------------------------------
// Stat tile
// ---------------------------------------------------------------------------

export const Stat = ({ label, value, sub, tone = 'slate', icon }) => {
  const accents = {
    slate: 'text-slate-900 dark:text-slate-100',
    green: 'text-emerald-600 dark:text-emerald-400',
    red: 'text-red-600 dark:text-red-400',
    amber: 'text-amber-600 dark:text-amber-400',
    blue: 'text-sky-600 dark:text-sky-400',
    teal: 'text-brand-600 dark:text-brand-400',
  };
  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
          {label}
        </p>
        {icon && <span className="text-base opacity-70">{icon}</span>}
      </div>
      <p className={cx('mt-2 text-2xl font-bold tabular-nums', accents[tone])}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sub}</p>}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

export const Progress = ({ value, tone = 'teal', label, className = '' }) => {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const fills = {
    teal: 'bg-brand-500',
    green: 'bg-emerald-500',
    amber: 'bg-amber-500',
    blue: 'bg-sky-500',
  };
  return (
    <div className={className}>
      {label && (
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="text-slate-500 dark:text-slate-400">{label}</span>
          <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-300">
            {pct.toFixed(0)}%
          </span>
        </div>
      )}
      <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div
          className={cx('h-full rounded-full transition-all duration-500', fills[tone])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export const Modal = ({ open, onClose, title, description, children, footer, size = 'md' }) => {
  if (!open) return null;
  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 animate-fade-in bg-slate-900/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cx(
          'relative z-10 max-h-[92vh] w-full animate-slide-up overflow-y-auto rounded-t-2xl bg-white shadow-float sm:rounded-2xl dark:bg-slate-900',
          widths[size]
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5 dark:border-slate-800">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
            {description && (
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-m-1 rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
            aria-label="Close dialog"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="p-5">{children}</div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 p-5 dark:border-slate-800">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export const Tabs = ({ tabs, active, onChange, className = '' }) => (
  <div className={cx('flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800', className)}>
    {tabs.map((tab) => (
      <button
        key={tab.value}
        type="button"
        onClick={() => onChange(tab.value)}
        className={cx(
          '-mb-px shrink-0 border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors',
          active === tab.value
            ? 'border-brand-600 text-brand-700 dark:text-brand-400'
            : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
        )}
      >
        {tab.label}
        {tab.count !== undefined && (
          <span
            className={cx(
              'ml-1.5 rounded-full px-1.5 py-0.5 text-xs tabular-nums',
              active === tab.value
                ? 'bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-300'
                : 'bg-slate-100 text-slate-500 dark:bg-slate-800'
            )}
          >
            {tab.count}
          </span>
        )}
      </button>
    ))}
  </div>
);

export const Alert = ({ tone = 'blue', title, children, className = '' }) => {
  const tones = {
    blue: 'bg-sky-50 border-sky-200 text-sky-900 dark:bg-sky-950/40 dark:border-sky-900 dark:text-sky-200',
    amber:
      'bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-200',
    red: 'bg-red-50 border-red-200 text-red-900 dark:bg-red-950/40 dark:border-red-900 dark:text-red-200',
    green:
      'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-200',
    teal: 'bg-brand-50 border-brand-200 text-brand-900 dark:bg-brand-950/40 dark:border-brand-900 dark:text-brand-200',
  };
  return (
    <div className={cx('rounded-xl border p-4 text-sm', tones[tone], className)}>
      {title && <p className="mb-1 font-semibold">{title}</p>}
      <div className="leading-relaxed opacity-95">{children}</div>
    </div>
  );
};

export const BackLink = ({ to, children = 'Back' }) => (
  <Link
    to={to}
    className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
  >
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    {children}
  </Link>
);
