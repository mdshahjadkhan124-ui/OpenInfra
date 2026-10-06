/** Contractor overview. */
import { Link } from 'react-router-dom';
import { projectApi, bidApi } from '../../services/api.js';
import { useFetch } from '../../hooks/useFetch.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { WalletButton } from '../../components/WalletButton.jsx';
import { Button, Card, Stat, LoadingState, Alert, EmptyState, StatusBadge } from '../../components/ui.jsx';
import { money, shortAddress, timeAgo } from '../../lib/format.js';

export const ContractorHome = () => {
  const { user } = useAuth();
  const open = useFetch(() => projectApi.list({ status: 'open', limit: 1 }), []);
  const bids = useFetch(() => bidApi.mine({ limit: 100 }), []);
  const awarded = useFetch(() => projectApi.mine({ status: 'all', limit: 100 }), []);

  const allBids = bids.data?.data?.bids ?? [];
  const myProjects = awarded.data?.data?.projects ?? [];
  const loading = open.loading || bids.loading || awarded.loading;

  const counts = {
    open: open.data?.meta?.total ?? 0,
    pending: allBids.filter((b) => b.status === 'pending').length,
    won: allBids.filter((b) => b.status === 'accepted').length,
    flagged: allBids.filter((b) => b.isFlagged).length,
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Hello, {user?.name?.split(' ')[0]}
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Bid for public works and get paid per verified stage.
        </p>
      </header>

      {!user?.walletAddress ? (
        <Alert tone="amber" title="Connect a wallet to start bidding">
          <p className="mb-3">
            Milestone payments are released to your wallet on-chain, so we need the address
            before you can bid.
          </p>
          <WalletButton />
        </Alert>
      ) : (
        <Alert tone="teal">
          Payments go to{' '}
          <span className="font-mono font-semibold">{shortAddress(user.walletAddress, 6)}</span>
        </Alert>
      )}

      {loading ? (
        <LoadingState label="Loading your activity…" />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Stat label="Open to bid" value={counts.open} tone="blue" icon="🏗️" />
          <Stat label="Awaiting decision" value={counts.pending} tone="amber" icon="⏳" />
          <Stat label="Projects won" value={counts.won} tone="green" icon="✓" />
          <Stat label="Flagged bids" value={counts.flagged} tone={counts.flagged ? 'red' : 'slate'} icon="⚠️" />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between p-5 pb-3">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">My work</h2>
            <Link to="/contractor/awarded" className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-400">
              View all
            </Link>
          </div>
          {myProjects.length === 0 ? (
            <EmptyState icon="🔧" title="No awarded projects" description="Win a bid and it appears here." />
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {myProjects.slice(0, 4).map((p) => (
                <li key={p.id} className="flex items-center gap-3 p-4">
                  <img src={p.imageUrl} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{p.title}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{money(p.awardedAmount, p.aiEstimatedCost?.currency)}</p>
                  </div>
                  <StatusBadge status={p.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="flex flex-col justify-between bg-gradient-to-br from-brand-600 to-accent-700 p-6">
          <div>
            <h2 className="text-lg font-bold text-white">How bidding works here</h2>
            <ul className="mt-3 space-y-2 text-sm text-white/80">
              <li>Every project carries an independent AI cost assessment.</li>
              <li>Bids more than 20% above its upper bound are flagged — but a flag is not a rejection.</li>
              <li>Funds are escrowed on-chain and released to you stage by stage.</li>
            </ul>
          </div>
          <Button as={Link} to="/contractor/projects" size="lg" className="mt-5 border-0 bg-white text-brand-800 hover:bg-white/90">
            Browse open projects
          </Button>
        </Card>
      </div>
    </div>
  );
};

export default ContractorHome;
