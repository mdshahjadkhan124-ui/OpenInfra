/**
 * Connect Wallet.
 *
 * Does double duty:
 *   • for a contractor, connecting sets their payout address on the account;
 *   • for an admin, it is the key that signs escrow transactions.
 *
 * Deliberately shows the network, because signing on the wrong chain is the
 * single most common way this flow fails and the error after the fact is
 * confusing.
 */
import { useState } from 'react';
import { useWallet } from '../context/WalletContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Badge, Spinner, cx } from './ui.jsx';
import { shortAddress } from '../lib/format.js';
import { ROLES } from '../lib/constants.js';

export const WalletButton = ({ className = '', compact = false }) => {
  const { available, address, onSepolia, connecting, connect, disconnect, switchToSepolia } = useWallet();
  const { user, saveWallet } = useAuth();
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  const handleConnect = async () => {
    try {
      const connected = await connect();

      // A contractor's payout address has to reach the server, or they cannot
      // bid. Saving it here means they never have to type it.
      if (user?.role === ROLES.CONTRACTOR && connected && connected !== user.walletAddress) {
        setSaving(true);
        try {
          await saveWallet(connected);
          toast.success('Wallet connected', `Payments will be sent to ${shortAddress(connected)}.`);
        } catch (err) {
          toast.error('Could not save your wallet', err.userMessage ?? err.message);
        } finally {
          setSaving(false);
        }
      } else {
        toast.success('Wallet connected', shortAddress(connected));
      }
    } catch (err) {
      if (!/cancelled/i.test(err.message)) toast.error('Wallet not connected', err.message);
    }
  };

  const handleSwitch = async () => {
    try {
      await switchToSepolia();
      toast.success('Switched to Sepolia');
    } catch (err) {
      toast.error('Could not switch network', err.message);
    }
  };

  if (!available) {
    return (
      <a
        href="https://metamask.io/download/"
        target="_blank"
        rel="noopener noreferrer"
        className={cx(
          'inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800',
          className
        )}
      >
        <WalletIcon />
        Install MetaMask
      </a>
    );
  }

  if (!address) {
    return (
      <Button
        variant="secondary"
        size={compact ? 'sm' : 'md'}
        onClick={handleConnect}
        loading={connecting || saving}
        className={className}
      >
        {!connecting && !saving && <WalletIcon />}
        Connect wallet
      </Button>
    );
  }

  return (
    <div className={cx('flex items-center gap-2', className)}>
      {!onSepolia && (
        <Button variant="danger" size="sm" onClick={handleSwitch} title="The contract only exists on Sepolia">
          Switch to Sepolia
        </Button>
      )}
      <div
        className={cx(
          'flex items-center gap-2 rounded-lg border px-3 py-2',
          onSepolia
            ? 'border-brand-200 bg-brand-50 dark:border-brand-900 dark:bg-brand-950/40'
            : 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40'
        )}
      >
        <span
          className={cx(
            'h-2 w-2 rounded-full',
            onSepolia ? 'animate-pulse-ring bg-emerald-500' : 'bg-red-500'
          )}
        />
        <span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">
          {shortAddress(address)}
        </span>
        {saving && <Spinner size="xs" className="text-brand-600" />}
        <button
          type="button"
          onClick={disconnect}
          className="-mr-1 rounded p-0.5 text-slate-400 transition hover:text-slate-700 dark:hover:text-slate-200"
          title="Disconnect"
          aria-label="Disconnect wallet"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {!compact && !onSepolia && (
        <Badge tone="red" dot>
          Wrong network
        </Badge>
      )}
    </div>
  );
};

const WalletIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4M3 5v14a2 2 0 0 0 2 2h16v-5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M18 12a2 2 0 0 0 0 4h4v-4h-4Z" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default WalletButton;
