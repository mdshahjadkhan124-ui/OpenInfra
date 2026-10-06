/**
 * Split-screen shell for sign-in and registration.
 *
 * The left panel states what the product does, because someone landing on a
 * login form from a link deserves to know what they are signing in to.
 */
import { Outlet } from 'react-router-dom';
import { Logo } from '../components/Logo.jsx';
import { ThemeToggle } from '../components/ThemeToggle.jsx';

const POINTS = [
  { title: 'Report with a photo', body: 'AI checks it is genuinely public infrastructure and estimates a fair repair cost.' },
  { title: 'Bids measured against it', body: 'Any bid more than 20% above the assessed range is flagged automatically.' },
  { title: 'Paid stage by stage', body: 'Funds sit in an escrow contract and are released only after work is verified.' },
  { title: 'Verify it yourself', body: 'Every payment is an Ethereum transaction anyone can inspect on Etherscan.' },
];

export const AuthLayout = () => (
  <div className="flex min-h-screen bg-white dark:bg-slate-950">
    {/* --- Story panel, desktop only --- */}
    <div className="relative hidden w-1/2 overflow-hidden bg-gradient-to-br from-brand-700 via-brand-800 to-accent-900 lg:flex lg:flex-col lg:justify-between lg:p-12">
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 30%, white 1px, transparent 1px), radial-gradient(circle at 70% 70%, white 1px, transparent 1px)',
          backgroundSize: '48px 48px, 64px 64px',
        }}
        aria-hidden="true"
      />

      <div className="relative">
        <Logo className="[&_span]:text-white [&_span>span]:text-white/60" />
      </div>

      <div className="relative max-w-md">
        <h1 className="text-3xl leading-tight font-bold text-white">
          Public money, publicly accounted for.
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-white/70">
          OpenInfra connects a citizen&apos;s photo of a pothole to the exact Ethereum transaction
          that paid to fix it.
        </p>

        <ul className="mt-8 space-y-4">
          {POINTS.map((point, i) => (
            <li key={point.title} className="flex gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/15 text-xs font-bold text-white">
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-semibold text-white">{point.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-white/60">{point.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <p className="relative text-xs text-white/40">
        Running on the Ethereum Sepolia test network.
      </p>
    </div>

    {/* --- Form panel --- */}
    <div className="flex w-full flex-col lg:w-1/2">
      <div className="flex items-center justify-between p-5 lg:justify-end">
        <Logo className="lg:hidden" />
        <ThemeToggle />
      </div>
      <div className="flex flex-1 items-center justify-center px-5 pb-12">
        <div className="w-full max-w-sm">
          <Outlet />
        </div>
      </div>
    </div>
  </div>
);

export default AuthLayout;
