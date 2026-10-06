/** Admin overview: what needs a decision, and the state of the escrow. */
import { Link } from 'react-router-dom';
import { adminApi } from '../../services/api.js';
import { useFetch } from '../../hooks/useFetch.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { WalletButton } from '../../components/WalletButton.jsx';
import { Button, Card, Stat, LoadingState, Alert, EtherscanLink } from '../../components/ui.jsx';
import { shortAddress } from '../../lib/format.js';
import { useWallet } from '../../context/WalletContext.jsx';

export const AdminHome = () => {
  const { user } = useAuth();
  const { address, onSepolia } = useWallet();
  const stats = useFetch(() => adminApi.stats(), []);
  const pendingMilestones = useFetch(() => adminApi.milestones({ status: 'submitted' }), []);
  const contract = useFetch(() => adminApi.escrowContract(), []);

  const s = stats.data?.stats;
  const awaiting = pendingMilestones.data?.milestones?.length ?? 0;
  const c = contract.data;
  const walletMismatch = c && !c.mock && address && address.toLowerCase() !== c.admin?.toLowerCase();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Hello, {user?.name?.split(' ')[0]}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Review reports, award work, and release funds you sign for yourself.
          </p>
        </div>
        <WalletButton />
      </header>

      {walletMismatch && (
        <Alert tone="red" title="This wallet cannot release funds">
          The escrow contract only accepts transactions from{' '}
          <span className="font-mono font-semibold">{shortAddress(c.admin, 6)}</span>. Switch
          accounts in MetaMask before approving anything.
        </Alert>
      )}
      {address && onSepolia && !walletMismatch && c && !c.mock && (
        <Alert tone="teal">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Signing as the escrow administrator. The server holds no key — every payment is
              signed by your wallet.
            </span>
            <EtherscanLink address={c.contractAddress} label="escrow contract" compact />
          </div>
        </Alert>
      )}

      {stats.loading ? (
        <LoadingState label="Loading dashboard…" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <Stat label="Reports to review" value={s?.reports.pending ?? 0} tone={s?.reports.pending ? 'amber' : 'slate'} icon="📋" />
            <Stat label="Milestones to approve" value={awaiting} tone={awaiting ? 'amber' : 'slate'} icon="✓" />
            <Stat label="Open for bids" value={s?.projects.open ?? 0} tone="blue" icon="🏗️" />
            <Stat label="Completed" value={s?.projects.completed ?? 0} tone="green" icon="🎉" />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {[
              { to: '/admin/reports', title: 'Review reports', body: 'Approve or reject citizen reports, and publish them for bidding.', count: s?.reports.pending, icon: '📋' },
              { to: '/admin/projects', title: 'Projects & bids', body: 'Compare bids against the assessment and award the work.', count: s?.projects.open, icon: '⚖️' },
              { to: '/admin/milestones', title: 'Approve milestones', body: 'Verify completed work and release its payment on-chain.', count: awaiting, icon: '💸' },
            ].map((card) => (
              <Card key={card.to} hover className="flex flex-col p-5">
                <div className="flex items-start justify-between">
                  <span className="text-2xl">{card.icon}</span>
                  {card.count > 0 && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      {card.count} waiting
                    </span>
                  )}
                </div>
                <h2 className="mt-3 text-base font-semibold text-slate-900 dark:text-slate-100">{card.title}</h2>
                <p className="mt-1 flex-1 text-sm text-slate-500 dark:text-slate-400">{card.body}</p>
                <Button as={Link} to={card.to} variant="secondary" size="sm" className="mt-4 self-start">
                  Open
                </Button>
              </Card>
            ))}
          </div>

          <Card className="p-5">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Project pipeline</h2>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Open', s?.projects.open, 'blue'],
                ['Awarded', s?.projects.awarded, 'violet'],
                ['In progress', s?.projects.inProgress, 'amber'],
                ['Completed', s?.projects.completed, 'green'],
              ].map(([label, value, tone]) => (
                <Stat key={label} label={label} value={value ?? 0} tone={tone} />
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
};

export default AdminHome;
