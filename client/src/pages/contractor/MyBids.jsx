/**
 * A contractor's own bids, including the anomaly verdict against each.
 *
 * The frozen verdict is shown in full — benchmark, threshold, deviation —
 * because a contractor accused of overcharging should be able to see the exact
 * figures used, not just a red badge.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { bidApi } from '../../services/api.js';
import { useFetch, useAction } from '../../hooks/useFetch.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  Button, Card, Badge, StatusBadge, LoadingState, EmptyState, ErrorState, Tabs, Alert, cx,
} from '../../components/ui.jsx';
import { money, timeAgo } from '../../lib/format.js';

const TABS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Awaiting decision' },
  { value: 'accepted', label: 'Won' },
  { value: 'rejected', label: 'Not selected' },
];

export const MyBids = () => {
  const [status, setStatus] = useState('');
  const toast = useToast();
  const { run, isBusy } = useAction();

  const { data, loading, error, refetch } = useFetch(
    () => bidApi.mine({ status: status || undefined, limit: 50 }),
    [status]
  );
  const bids = data?.data?.bids ?? [];

  const withdraw = (bid) =>
    run(bid.id, async () => {
      try {
        await bidApi.withdraw(bid.id);
        toast.success('Bid withdrawn', 'You can bid again on this project.');
        refetch();
      } catch (err) {
        toast.error('Could not withdraw', err.userMessage);
      }
    });

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          My bids
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Every bid you have placed, and how it compared with the independent assessment.
        </p>
      </header>

      <Tabs tabs={TABS} active={status} onChange={setStatus} className="mb-5" />

      {loading && <LoadingState label="Loading your bids…" />}
      {error && <ErrorState message={error} onRetry={refetch} />}

      {!loading && !error && bids.length === 0 && (
        <Card>
          <EmptyState
            icon="📋"
            title={status ? 'Nothing here' : 'No bids yet'}
            description={
              status ? 'Try a different filter.' : 'Browse open projects and place your first bid.'
            }
            action={
              !status && (
                <Button as={Link} to="/contractor/projects">
                  Browse open projects
                </Button>
              )
            }
          />
        </Card>
      )}

      <div className="space-y-3">
        {bids.map((bid) => {
          const a = bid.anomaly ?? {};
          const flagged = bid.isFlagged;

          return (
            <Card
              key={bid.id}
              className={cx(
                'p-5',
                // Flagged bids are visibly marked here too, not just in the
                // admin view — no contractor should be surprised by a flag.
                flagged && 'border-l-4 border-l-red-500'
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {bid.project?.title ?? 'Project'}
                    </h3>
                    <StatusBadge status={bid.status} />
                    {flagged && <StatusBadge status={a.band} />}
                  </div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Placed {timeAgo(bid.createdAt)}
                    {bid.estimatedDays ? ` · ${bid.estimatedDays} working days` : ''}
                  </p>
                  {bid.proposal && (
                    <p className="mt-2 line-clamp-2 text-xs text-slate-600 dark:text-slate-400">
                      {bid.proposal}
                    </p>
                  )}
                </div>

                <div className="shrink-0 text-right">
                  <p className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">
                    {money(bid.bidAmount, bid.currency)}
                  </p>
                  {a.benchmarkAmount && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      assessed up to {money(a.benchmarkAmount, bid.currency)}
                    </p>
                  )}
                  {bid.status === 'pending' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={isBusy(bid.id)}
                      onClick={() => withdraw(bid)}
                      className="mt-1"
                    >
                      Withdraw
                    </Button>
                  )}
                </div>
              </div>

              {flagged && a.explanation && (
                <Alert tone="red" title="Why this was flagged" className="mt-4">
                  <p>{a.explanation}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                    {[
                      ['Your bid', money(bid.bidAmount, bid.currency)],
                      ['Assessed upper', money(a.benchmarkAmount, bid.currency)],
                      ['Flag threshold', money(a.thresholdAmount, bid.currency)],
                      ['Above upper by', `${a.deviationPercent}%`],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="opacity-70">{label}</dt>
                        <dd className="font-semibold tabular-nums">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-3 text-xs opacity-80">
                    A flag is not a rejection — an official can still award this bid.
                  </p>
                </Alert>
              )}

              {bid.status === 'accepted' && (
                <Alert tone="green" className="mt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>You won this project.</span>
                    <Link
                      to="/contractor/awarded"
                      className="font-semibold underline hover:no-underline"
                    >
                      Submit progress
                    </Link>
                  </div>
                </Alert>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default MyBids;
