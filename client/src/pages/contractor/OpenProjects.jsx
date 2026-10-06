/**
 * Open projects, and bidding.
 *
 * The bid dialog shows the assessed range and the flag threshold live as the
 * contractor types. Telling them in advance that a figure will be flagged is
 * fairer than flagging it silently afterwards — and the copy is explicit that
 * a flag is not a rejection, which is what the backend actually does.
 */
import { useMemo, useState } from 'react';
import { projectApi, bidApi } from '../../services/api.js';
import { useFetch } from '../../hooks/useFetch.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useWallet } from '../../context/WalletContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { WalletButton } from '../../components/WalletButton.jsx';
import {
  Button, Card, Badge, StatusBadge, LoadingState, EmptyState, ErrorState,
  Modal, Field, Alert, cx,
} from '../../components/ui.jsx';
import { money, timeAgo, formatDate } from '../../lib/format.js';
import { CATEGORY_LABEL, SEVERITY_TONE } from '../../lib/constants.js';

/** Mirrors anomaly.service.js on the server, for live feedback only. */
const bandFor = (amount, estimate, marginPercent = 20) => {
  const value = Number(amount);
  if (!estimate?.maxAmount || !Number.isFinite(value) || value <= 0) return null;
  const upper = estimate.maxAmount;
  const threshold = Math.round(upper * (1 + marginPercent / 100));
  if (value <= upper) return { band: 'none', threshold };
  if (value <= threshold) return { band: 'elevated', threshold };
  if (value > upper * 2) return { band: 'severe', threshold };
  return { band: 'flagged', threshold };
};

export const OpenProjects = () => {
  const { user } = useAuth();
  const { address } = useWallet();
  const toast = useToast();

  const { data, loading, error, refetch } = useFetch(
    () => projectApi.list({ status: 'open', limit: 50 }),
    []
  );
  const myBids = useFetch(() => bidApi.mine({ limit: 100 }), []);

  const [bidding, setBidding] = useState(null);
  const [form, setForm] = useState({ bidAmount: '', proposal: '', estimatedDays: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  const projects = data?.data?.projects ?? [];

  // Which projects already have a live bid from this contractor.
  const bidProjectIds = useMemo(() => {
    const live = (myBids.data?.data?.bids ?? []).filter((b) =>
      ['pending', 'accepted'].includes(b.status)
    );
    return new Set(live.map((b) => b.project?.id ?? b.project));
  }, [myBids.data]);

  const hasWallet = Boolean(user?.walletAddress || address);
  const preview = bidding ? bandFor(form.bidAmount, bidding.aiEstimatedCost) : null;

  const openBid = (project) => {
    setBidding(project);
    setForm({ bidAmount: '', proposal: '', estimatedDays: '' });
    setFormError(null);
  };

  const submitBid = async (event) => {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);

    try {
      const { bid } = await bidApi.submit({
        projectId: bidding.id,
        bidAmount: Number(form.bidAmount),
        proposal: form.proposal || undefined,
        estimatedDays: form.estimatedDays ? Number(form.estimatedDays) : undefined,
        walletAddress: address || undefined,
      });

      if (bid.isFlagged) {
        toast.warning(
          'Bid submitted — and flagged',
          'It exceeds the assessed range, so an official will scrutinise it.'
        );
      } else {
        toast.success('Bid submitted', money(bid.bidAmount, bid.currency));
      }

      setBidding(null);
      myBids.refetch();
    } catch (err) {
      setFormError(err.userMessage ?? 'Could not submit your bid.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Open projects
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Public works out to tender. Every bid is compared against an independent cost
          assessment.
        </p>
      </header>

      {!hasWallet && (
        <Alert tone="amber" title="Connect a wallet before bidding" className="mb-5">
          <p className="mb-3">
            Milestone payments are released to your wallet on-chain, so we need the address
            before you can bid.
          </p>
          <WalletButton />
        </Alert>
      )}

      {loading && <LoadingState label="Loading open projects…" />}
      {error && <ErrorState message={error} onRetry={refetch} />}

      {!loading && !error && projects.length === 0 && (
        <Card>
          <EmptyState
            icon="🏗️"
            title="No open projects right now"
            description="Projects appear here once an official publishes an approved citizen report."
          />
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {projects.map((project) => {
          const estimate = project.aiEstimatedCost;
          const alreadyBid = bidProjectIds.has(project.id);

          return (
            <Card key={project.id} hover className="flex flex-col overflow-hidden sm:flex-row">
              <img
                src={project.imageUrl}
                alt=""
                loading="lazy"
                className="h-40 w-full shrink-0 object-cover sm:h-auto sm:w-40"
              />

              <div className="flex min-w-0 flex-1 flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="line-clamp-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {project.title}
                  </h3>
                  <Badge tone={SEVERITY_TONE[estimate.severity] ?? 'slate'} className="shrink-0">
                    {estimate.severity}
                  </Badge>
                </div>

                <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                  📍 {project.location.address}
                </p>

                <div className="mt-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                  <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
                    Assessed cost
                  </p>
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {money(estimate.minAmount, estimate.currency)} –{' '}
                    {money(estimate.maxAmount, estimate.currency)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    Bids above {money(Math.round(estimate.maxAmount * 1.2), estimate.currency)} are
                    flagged
                  </p>
                </div>

                <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                  <span className="text-xs text-slate-400">
                    {project.bidsCloseAt
                      ? `Closes ${formatDate(project.bidsCloseAt)}`
                      : `Posted ${timeAgo(project.createdAt)}`}
                  </span>
                  {alreadyBid ? (
                    <Badge tone="teal" dot>
                      Bid submitted
                    </Badge>
                  ) : (
                    <Button size="sm" onClick={() => openBid(project)} disabled={!hasWallet}>
                      Place bid
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* --------------------------------------------------------- bid dialog */}
      <Modal
        open={Boolean(bidding)}
        onClose={() => setBidding(null)}
        title="Place a bid"
        description={bidding?.title}
        footer={
          <>
            <Button variant="secondary" onClick={() => setBidding(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="bid-form"
              loading={submitting}
              disabled={!form.bidAmount || Number(form.bidAmount) <= 0}
            >
              Submit bid
            </Button>
          </>
        }
      >
        {bidding && (
          <form id="bid-form" onSubmit={submitBid} className="space-y-4" noValidate>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                ['Lowest', bidding.aiEstimatedCost.minAmount],
                ['Expected', bidding.aiEstimatedCost.amount],
                ['Highest', bidding.aiEstimatedCost.maxAmount],
              ].map(([label, value], i) => (
                <div
                  key={label}
                  className={cx(
                    'rounded-lg p-2.5',
                    i === 1 ? 'bg-brand-50 dark:bg-brand-950/50' : 'bg-slate-50 dark:bg-slate-800/60'
                  )}
                >
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{label}</p>
                  <p className="mt-0.5 text-xs font-bold text-slate-900 dark:text-slate-100">
                    {money(value, bidding.aiEstimatedCost.currency)}
                  </p>
                </div>
              ))}
            </div>

            <Field label={`Your bid (${bidding.aiEstimatedCost.currency})`} htmlFor="bidAmount" required>
              <input
                id="bidAmount"
                type="number"
                min="1"
                step="1"
                className="input text-lg font-semibold"
                placeholder={String(bidding.aiEstimatedCost.amount)}
                value={form.bidAmount}
                onChange={(e) => setForm((f) => ({ ...f, bidAmount: e.target.value }))}
                required
                autoFocus
              />
            </Field>

            {/* Live band feedback, so a flag is never a surprise. */}
            {preview && (
              <Alert
                tone={preview.band === 'none' ? 'green' : preview.band === 'elevated' ? 'amber' : 'red'}
                title={
                  preview.band === 'none'
                    ? 'Within the assessed range'
                    : preview.band === 'elevated'
                      ? 'Above the range, but within the allowance'
                      : 'This bid will be flagged'
                }
              >
                {preview.band === 'none' &&
                  'This bid sits inside the independent assessment and will not be flagged.'}
                {preview.band === 'elevated' &&
                  `Above the upper estimate but under the ${money(preview.threshold, bidding.aiEstimatedCost.currency)} threshold, so it will not be flagged.`}
                {(preview.band === 'flagged' || preview.band === 'severe') && (
                  <>
                    It exceeds {money(preview.threshold, bidding.aiEstimatedCost.currency)} and will
                    be marked for scrutiny. <strong>A flag is not a rejection</strong> — if site
                    conditions justify the cost, explain them below and an official can still award
                    it.
                  </>
                )}
              </Alert>
            )}

            <Field
              label="Proposal"
              htmlFor="proposal"
              hint="Your approach, and anything the assessment could not see from a photograph."
            >
              <textarea
                id="proposal"
                rows={3}
                className="input resize-y"
                placeholder="Full-depth patch with hot mix, two-day lane closure, traffic management included."
                value={form.proposal}
                onChange={(e) => setForm((f) => ({ ...f, proposal: e.target.value }))}
                maxLength={2000}
              />
            </Field>

            <Field label="Working days" htmlFor="estimatedDays">
              <input
                id="estimatedDays"
                type="number"
                min="1"
                max="3650"
                className="input"
                placeholder="3"
                value={form.estimatedDays}
                onChange={(e) => setForm((f) => ({ ...f, estimatedDays: e.target.value }))}
              />
            </Field>

            <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
              Payments go to{' '}
              <span className="font-mono text-slate-700 dark:text-slate-300">
                {address || user?.walletAddress}
              </span>
            </p>

            {formError && <Alert tone="red">{formError}</Alert>}
          </form>
        )}
      </Modal>
    </div>
  );
};

export default OpenProjects;
