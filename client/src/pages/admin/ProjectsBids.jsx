/**
 * Projects, bid review and award.
 *
 * Flagged bids are rendered in red, sorted first, with the exact figures that
 * produced the flag. Awarding also defines the milestone schedule, whose
 * percentages must sum to 100 — enforced live here and again on the server,
 * because unallocated funds would be unreleasable from a contract with no
 * withdrawal function.
 *
 * Locking the escrow is a wallet action: prepare, sign in MetaMask, confirm.
 */
import { useMemo, useState } from 'react';
import { projectApi, adminApi } from '../../services/api.js';
import { useFetch } from '../../hooks/useFetch.js';
import { useWallet } from '../../context/WalletContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { WalletButton } from '../../components/WalletButton.jsx';
import {
  Button, Card, Badge, StatusBadge, LoadingState, EmptyState, ErrorState,
  Modal, Field, Alert, Tabs, EtherscanLink, Spinner, Progress, cx,
} from '../../components/ui.jsx';
import { money, formatEth, timeAgo, shortAddress } from '../../lib/format.js';

const TABS = [
  { value: 'open', label: 'Open for bids' },
  { value: 'awarded', label: 'Awarded' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'all', label: 'All' },
];

export const ProjectsBids = () => {
  const [status, setStatus] = useState('open');
  const { data, loading, error, refetch } = useFetch(
    () => projectApi.list({ status, limit: 50 }),
    [status]
  );
  const contract = useFetch(() => adminApi.escrowContract(), []);
  const [reviewing, setReviewing] = useState(null);

  const projects = data?.data?.projects ?? [];

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Projects &amp; bids
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Review bids against the independent cost assessment, award work, and lock the escrow.
          </p>
        </div>
        <WalletButton />
      </header>

      <Tabs tabs={TABS} active={status} onChange={setStatus} className="mb-5" />

      {loading && <LoadingState label="Loading projects…" />}
      {error && <ErrorState message={error} onRetry={refetch} />}

      {!loading && !error && projects.length === 0 && (
        <Card>
          <EmptyState
            icon="🏗️"
            title="Nothing here"
            description="Publish an approved citizen report to create a project."
          />
        </Card>
      )}

      <div className="space-y-4">
        {projects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            contract={contract.data}
            onReview={() => setReviewing(project)}
            onChanged={refetch}
          />
        ))}
      </div>

      {reviewing && (
        <BidReviewModal
          project={reviewing}
          onClose={() => setReviewing(null)}
          onDone={() => {
            setReviewing(null);
            refetch();
          }}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------

const ProjectCard = ({ project, contract, onReview, onChanged }) => {
  const { address, onSepolia, sendPrepared } = useWallet();
  const toast = useToast();
  const [step, setStep] = useState(null);
  const [error, setError] = useState(null);

  const estimate = project.aiEstimatedCost;
  const needsFunding = project.status === 'awarded' && !project.fundingTxHash;
  const locked = project.totalLockedFunds ?? '0';
  const released = project.totalReleasedFunds ?? '0';
  const pct = BigInt(locked) > 0n ? Number((BigInt(released) * 100n) / BigInt(locked)) : 0;

  const isAdminWallet = contract?.mock || address?.toLowerCase() === contract?.admin?.toLowerCase();
  const canSign = Boolean(address) && onSepolia && isAdminWallet;

  /** prepare -> MetaMask -> confirm, same shape as the milestone release. */
  const lockFunds = async () => {
    setError(null);

    let prepared;
    try {
      setStep('preparing');
      prepared = await adminApi.prepareLockFunds(project.id);
    } catch (err) {
      setStep(null);
      setError(err.userMessage ?? 'Could not prepare the deposit.');
      return;
    }

    let hash;
    try {
      setStep('signing');
      hash = await sendPrepared(prepared.transaction);
    } catch (err) {
      setStep(null);
      if (err.cancelled) toast.info('Cancelled', 'No funds were locked.');
      else setError(err.message);
      return;
    }

    try {
      setStep('confirming');
      const result = await adminApi.confirmLockFunds(project.id, hash);
      toast.chain(
        'Escrow funded',
        `${prepared.transaction.summary.totalEth} ETH locked for this project.`,
        result.explorerUrl
      );
      onChanged();
    } catch (err) {
      setStep(null);
      setError(
        `${err.userMessage ?? 'Could not confirm the deposit.'} Transaction ${hash.slice(0, 12)}… may still have succeeded — use Reconcile to re-sync from the chain.`
      );
    } finally {
      setStep(null);
    }
  };

  const busy = Boolean(step);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-4 p-5 sm:flex-row">
        <img
          src={project.imageUrl}
          alt=""
          loading="lazy"
          className="h-24 w-full shrink-0 rounded-lg object-cover sm:w-32"
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {project.title}
            </h3>
            <StatusBadge status={project.status} />
            {estimate.source === 'admin_override' && <Badge tone="violet">manual estimate</Badge>}
          </div>

          <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
            📍 {project.location.address} · published {timeAgo(project.publishedAt)}
          </p>

          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
            <div>
              <dt className="inline text-slate-500 dark:text-slate-400">Assessed: </dt>
              <dd className="inline font-medium text-slate-900 dark:text-slate-100">
                {money(estimate.minAmount, estimate.currency)}–{money(estimate.maxAmount, estimate.currency)}
              </dd>
            </div>
            {project.awardedAmount && (
              <div>
                <dt className="inline text-slate-500 dark:text-slate-400">Awarded: </dt>
                <dd className="inline font-medium text-slate-900 dark:text-slate-100">
                  {money(project.awardedAmount, estimate.currency)} to{' '}
                  {project.awardedContractor?.name}
                </dd>
              </div>
            )}
          </dl>

          {BigInt(locked) > 0n && (
            <div className="mt-3 max-w-xs">
              <Progress
                value={pct}
                tone={project.status === 'completed' ? 'green' : 'teal'}
                label={`${formatEth(released)} of ${formatEth(locked)} released`}
              />
            </div>
          )}

          {project.fundingTxHash && (
            <div className="mt-2">
              <EtherscanLink hash={project.fundingTxHash} label="escrow deposit" compact />
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-2">
          {project.status === 'open' && (
            <Button size="sm" onClick={onReview}>
              Review bids
            </Button>
          )}
          {needsFunding && (
            <Button size="sm" variant="success" onClick={lockFunds} loading={busy} disabled={!canSign}>
              Lock escrow funds
            </Button>
          )}
          {project.onChainProjectId !== null && project.onChainProjectId !== undefined && (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                try {
                  const result = await adminApi.reconcile(project.id);
                  toast.success(
                    result.corrections.length ? 'Re-synced from the chain' : 'Already in sync',
                    `${result.corrections.length} correction(s).`
                  );
                  onChanged();
                } catch (err) {
                  toast.error('Could not reconcile', err.userMessage);
                }
              }}
            >
              Reconcile
            </Button>
          )}
        </div>
      </div>

      {needsFunding && (
        <div className="border-t border-amber-200 bg-amber-50 px-5 py-3 dark:border-amber-900 dark:bg-amber-950/30">
          {busy ? (
            <p className="flex items-center gap-2 text-xs font-medium text-amber-800 dark:text-amber-300">
              <Spinner size="xs" />
              {step === 'preparing'
                ? 'Preparing the deposit transaction…'
                : step === 'signing'
                  ? 'Approve the deposit in MetaMask…'
                  : 'Verifying the deposit on-chain…'}
            </p>
          ) : (
            <p className="text-xs text-amber-800 dark:text-amber-300">
              {canSign
                ? 'Awarded, but the escrow is not funded. The contractor cannot submit work until you lock the funds from your wallet.'
                : !address
                  ? 'Connect the admin wallet to lock the escrow funds.'
                  : !onSepolia
                    ? 'Switch your wallet to Sepolia to lock the escrow funds.'
                    : `Only the escrow administrator (${shortAddress(contract?.admin, 6)}) can lock funds.`}
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="border-t border-red-200 bg-red-50 px-5 py-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}
    </Card>
  );
};

// ---------------------------------------------------------------------------

const BidReviewModal = ({ project, onClose, onDone }) => {
  const toast = useToast();
  const { data, loading, error } = useFetch(() => adminApi.bidsForProject(project.id), [project.id]);
  const [awarding, setAwarding] = useState(null);

  const bids = data?.bids?.filter((b) => b.status !== 'withdrawn') ?? [];
  const summary = data?.summary;

  return (
    <>
      <Modal
        open={!awarding}
        onClose={onClose}
        title="Bids"
        description={project.title}
        size="xl"
      >
        {loading && <LoadingState label="Loading bids…" className="py-10" />}
        {error && <ErrorState message={error} />}

        {summary && (
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Bids', summary.live, 'slate'],
              ['Flagged', summary.flagged, summary.flagged ? 'red' : 'slate'],
              ['Lowest', money(summary.lowest, project.aiEstimatedCost.currency), 'green'],
              ['Assessed upper', money(project.biddingBenchmark, project.aiEstimatedCost.currency), 'teal'],
            ].map(([label, value, tone]) => (
              <div key={label} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">{label}</p>
                <p
                  className={cx(
                    'mt-0.5 text-sm font-bold',
                    tone === 'red'
                      ? 'text-red-600 dark:text-red-400'
                      : tone === 'green'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : tone === 'teal'
                          ? 'text-brand-700 dark:text-brand-400'
                          : 'text-slate-900 dark:text-slate-100'
                  )}
                >
                  {value}
                </p>
              </div>
            ))}
          </div>
        )}

        {!loading && bids.length === 0 && (
          <EmptyState icon="📭" title="No bids yet" description="Contractors have not bid on this project." />
        )}

        {/* Flagged first, then cheapest — the server already sorts this way. */}
        <ul className="space-y-3">
          {bids.map((bid) => {
            const a = bid.anomaly ?? {};
            return (
              <li
                key={bid.id}
                className={cx(
                  'rounded-xl border p-4',
                  bid.isFlagged
                    ? 'border-red-300 bg-red-50/60 dark:border-red-800 dark:bg-red-950/25'
                    : 'border-slate-200 dark:border-slate-800'
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {bid.contractor?.name}
                      </span>
                      <StatusBadge status={bid.status} />
                      <StatusBadge status={a.band} />
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {bid.contractor?.email} ·{' '}
                      <span className="font-mono">{shortAddress(bid.walletAddress, 5)}</span>
                      {bid.estimatedDays ? ` · ${bid.estimatedDays} days` : ''}
                    </p>
                    {bid.proposal && (
                      <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">{bid.proposal}</p>
                    )}
                  </div>

                  <div className="shrink-0 text-right">
                    <p
                      className={cx(
                        'text-lg font-bold tabular-nums',
                        bid.isFlagged
                          ? 'text-red-700 dark:text-red-400'
                          : 'text-slate-900 dark:text-slate-100'
                      )}
                    >
                      {money(bid.bidAmount, bid.currency)}
                    </p>
                    {bid.status === 'pending' && project.status === 'open' && (
                      <Button size="sm" className="mt-1.5" onClick={() => setAwarding(bid)}>
                        Award
                      </Button>
                    )}
                  </div>
                </div>

                {bid.isFlagged && a.explanation && (
                  <div className="mt-3 rounded-lg bg-white/70 p-3 text-xs text-red-800 dark:bg-slate-900/60 dark:text-red-300">
                    <p className="font-semibold">{a.explanation}</p>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                      {[
                        ['Assessed upper', money(a.benchmarkAmount, bid.currency)],
                        ['Flag threshold', money(a.thresholdAmount, bid.currency)],
                        ['Above upper by', `${a.deviationPercent}%`],
                        ['Above expected by', `${a.deviationFromExpectedPercent}%`],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <dt className="opacity-70">{label}</dt>
                          <dd className="font-semibold tabular-nums">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Modal>

      {awarding && (
        <AwardModal
          project={project}
          bid={awarding}
          onClose={() => setAwarding(null)}
          onDone={() => {
            setAwarding(null);
            toast.info('Next step', 'Lock the escrow funds from your wallet to start the work.');
            onDone();
          }}
        />
      )}
    </>
  );
};

// ---------------------------------------------------------------------------

const DEFAULT_SCHEDULE = [
  { description: 'Site preparation, excavation and debris removal', fundPercentage: 30 },
  { description: 'Base layer laid and compacted', fundPercentage: 45 },
  { description: 'Surface course, sealing and site reinstatement', fundPercentage: 25 },
];

const AwardModal = ({ project, bid, onClose, onDone }) => {
  const toast = useToast();
  const [milestones, setMilestones] = useState(DEFAULT_SCHEDULE);
  const [escrowEth, setEscrowEth] = useState('0.004');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const total = useMemo(
    () => milestones.reduce((sum, m) => sum + (Number(m.fundPercentage) || 0), 0),
    [milestones]
  );
  const valid = Math.abs(total - 100) < 0.01 && milestones.every((m) => m.description.trim().length >= 5);

  const update = (index, key, value) =>
    setMilestones((list) => list.map((m, i) => (i === index ? { ...m, [key]: value } : m)));

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const result = await adminApi.award(project.id, {
        bidId: bid.id,
        escrowAmountEth: escrowEth,
        milestones: milestones.map((m) => ({
          description: m.description.trim(),
          fundPercentage: Number(m.fundPercentage),
        })),
      });
      toast.success('Project awarded', result.message);
      onDone();
    } catch (err) {
      setError(err.userMessage ?? 'Could not award this project.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Award and define milestones"
      description={`${bid.contractor?.name} — ${money(bid.bidAmount, bid.currency)}`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="award-form" loading={submitting} disabled={!valid}>
            Award project
          </Button>
        </>
      }
    >
      <form id="award-form" onSubmit={submit} className="space-y-4" noValidate>
        {bid.isFlagged && (
          <Alert tone="red" title="This bid was flagged">
            {bid.anomaly?.explanation} You can still award it — the flag and your decision are both
            part of the public record.
          </Alert>
        )}

        <Field
          label="Escrow amount (test ETH)"
          htmlFor="escrowEth"
          required
          hint="Locked in the contract and split across the milestones below. Sepolia ETH has no real value."
        >
          <input
            id="escrowEth"
            type="number"
            step="0.0001"
            min="0.0001"
            className="input"
            value={escrowEth}
            onChange={(e) => setEscrowEth(e.target.value)}
            required
          />
        </Field>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Milestone schedule
            </p>
            <span
              className={cx(
                'text-xs font-bold tabular-nums',
                Math.abs(total - 100) < 0.01
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              )}
            >
              {total.toFixed(2)}% / 100%
            </span>
          </div>

          <div className="space-y-2">
            {milestones.map((m, i) => (
              <div key={i} className="flex gap-2">
                <span className="mt-2.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold dark:bg-slate-700">
                  {i + 1}
                </span>
                <input
                  className="input flex-1"
                  placeholder="What this stage covers"
                  value={m.description}
                  onChange={(e) => update(i, 'description', e.target.value)}
                  maxLength={500}
                  required
                />
                <input
                  type="number"
                  className="input w-20 shrink-0"
                  min="0.01"
                  max="100"
                  step="0.01"
                  value={m.fundPercentage}
                  onChange={(e) => update(i, 'fundPercentage', e.target.value)}
                  required
                />
                {milestones.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setMilestones((list) => list.filter((_, j) => j !== i))}
                    className="shrink-0 px-1 text-slate-400 hover:text-red-600"
                    aria-label={`Remove milestone ${i + 1}`}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>

          {milestones.length < 20 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() =>
                setMilestones((list) => [...list, { description: '', fundPercentage: 0 }])
              }
            >
              + Add a stage
            </Button>
          )}

          {Math.abs(total - 100) >= 0.01 && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">
              Percentages must sum to exactly 100%. Anything unallocated could never be released —
              the escrow contract has no withdrawal function.
            </p>
          )}
        </div>

        <Alert tone="blue">
          Awarding records the decision. You will then lock the escrow funds in a separate step,
          signed with your own wallet.
        </Alert>

        {error && <Alert tone="red">{error}</Alert>}
      </form>
    </Modal>
  );
};

export default ProjectsBids;
