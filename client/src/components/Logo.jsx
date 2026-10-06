import { Link } from 'react-router-dom';
import { cx } from './ui.jsx';

/**
 * Wordmark.
 *
 * The glyph is three stacked bars of increasing length — a funding schedule
 * filling up, which is what the product is about.
 */
export const Logo = ({ to = '/', className = '', compact = false }) => (
  <Link to={to} className={cx('group inline-flex items-center gap-2.5', className)}>
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-accent-600 shadow-sm transition-transform group-hover:scale-105">
      <svg className="h-[18px] w-[18px] text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <path d="M5 17h5M5 12h9M5 7h14" />
      </svg>
    </span>
    {!compact && (
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-bold tracking-tight text-slate-900 dark:text-white">
          OpenInfra
        </span>
        <span className="mt-0.5 text-[10px] font-medium tracking-wide text-slate-400 uppercase dark:text-slate-500">
          Transparency
        </span>
      </span>
    )}
  </Link>
);

export default Logo;
