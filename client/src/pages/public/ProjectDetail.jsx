/**
 * Public project detail — the full money trail for one project.
 *
 * Structured as the story actually happened, top to bottom: a citizen's photo,
 * an independent assessment, bids measured against it, funds locked, then each
 * stage verified and paid. Every figure that moved money sits next to a link
 * to the transaction that moved it.
 *
 * The "check this against the chain" panel is the point of the page. Everything
 * above it is this platform's claim about itself; that panel compares the claim
 * with a ledger the platform does not control, and says so when they disagree.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { publicApi } from '../../services/api.js';
import { useFetch } from '../../hooks/useFetch.js';
import {
  Card, Badge, StatusBadge, LoadingState, ErrorState, EmptyState,
  EtherscanLink, Progress, Button, Alert, Spinner, BackLink, cx,
} from '../../components/ui.jsx';
import {
  money, formatEth, timeAgo, formatDate, shortAddress, confidencePercent,
} from '../../lib/format.js';
import { CATEGORY_LABEL, SEVERITY_TONE } from '../../lib/constants.js';

export const ProjectDetail = () => {
  const { id } = useParams();
  const { data, loading, error, refetch } = useFetch(() => publicApi.project(id), [id]);

  if (loading) return <LoadingState label="Loading the money trail…" className="min-h-[60vh]" />;
  if (error)
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <ErrorState message={error} onRetry={refetch} />
        <div className="mt-6 text-center">
          <BackLink to="/transparency">Back to all projects</BackLink>
        </div>
      </div>
    );

  const { project, milestones, bids, origin } = data;
  const e = project.estimate;
  const locked = BigInt(project.escrow.lockedWei || '0');
  const released = BigInt(project.escrow.releasedWei || '0');
  const paidCount = milestones.filter((m) => m.status === 'paid').length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <BackLink to="/transparency">All projects</BackLink>

      {/* ----------------------------------------------------------- header */}
      <header className="mt-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={project.status} />
          <Badge tone="slate">{CATEGORY_LABEL[project.category] ?? project.category}</Badge>
          {e && <Badge tone={SEVERITY_TONE[e.severity] ?? 'slate'}>{e.severity} severity</Badge>}
          {e?.source === 'admin_override' && <Badge tone="violet">manual assessment</Badge>}
        </div>

        <h1 className="mt-3 text-2xl leading-tight font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-white">
          {project.title}
        </h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          📍 {project.location.address}
          {project.location.city ? `, ${project.location.city}` : ''} · reported by{' '}
          {project.reportedBy} · published {formatDate(project.publishedAt)}
        </p>
      </header>

      {/* ------------------------------------------------------ money header */}
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
            Assessed range
          </p>
          <p className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">
            {e ? `${money(e.min, e.currency)} – ${money(e.max, e.currency)}` : '—'}
          </p>
          {e && (
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              expected {money(e.expected, e.currency)}
            </p>
          )}
        </Card>

        <Card className="p-4">
          <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
            Awarded for
          </p>
          <p className="mt-1 text-lg font-bold text-brand-700 dark:text-brand-300">
            {project.awarded ? money(project.awarded.amount, project.awarded.currency) : 'Not yet awarded'}
          </p>
          {project.awarded && (
            <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
              {project.awarded.contractorName}
            </p>
          )}
        </Card>

        <Card className="p-4">
          <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
            Released on-chain
          </p>
          <p className="mt-1 text-lg font-bold text-emerald-700 dark:text-emerald-400">
            {formatEth(project.escrow.releasedWei, 4)}
          </p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            of {formatEth(project.escrow.lockedWei, 4)} locked
          </p>
        </Card>
      </div>

      {locked > 0n && (
        <Card className="mt-3 p-4">
          <Progress
            value={Number((released * 100n) / locked)}
            tone={project.status === 'completed' ? 'green' : 'teal'}
            label={`${paidCount} of ${milestones.length} stages verified and paid`}
          />
        </Card>
      )}

      {/* ------------------------------------------------- chain verification */}
      <ChainVerification projectId={id} />

      {/* ------------------------------------------------------- 1. the report */}
      <Section
        step="1"
        title="It started with a photograph"
        description={origin ? `A citizen reported this on ${formatDate(origin.reportedAt)}.` : undefined}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <img
            src={origin?.originalPhotoUrl ?? project.imageUrl}
            alt="The problem as originally reported"
            loading="lazy"
            className="w-full rounded-xl object-cover"
          />
          <div>
            <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              {origin?.originalDescription ?? project.description}
            </p>
            {origin?.aiReason && (
              <div className="mt-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
                  AI relevance check
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  {origin.aiReason}
                </p>
                <p className="mt-1.5 text-[11px] text-slate-400">
                  {CATEGORY_LABEL[origin.aiCategory] ?? origin.aiCategory} · confidence{' '}
                  {confidencePercent(origin.aiConfidence)}
                </p>
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* -------------------------------------------------- 2. the assessment */}
      {e && (
        <Section
          step="2"
          title="An independent cost assessment"
          description="Produced from the photograph before any contractor saw it. This is the figure bids are measured against."
        >
          <div className="grid grid-cols-3 gap-3">
            {[
              ['Lowest plausible', e.min, false],
              ['Expected', e.expected, true],
              ['Highest plausible', e.max, false],
            ].map(([label, value, highlight]) => (
              <div
                key={label}
                className={cx(
                  'rounded-xl p-4 text-center',
                  highlight
                    ? 'bg-brand-50 ring-1 ring-brand-200 dark:bg-brand-950/50 dark:ring-brand-900'
                    : 'bg-slate-50 dark:bg-slate-800/60'
                )}
              >
                <p className="text-[11px] text-slate-500 dark:text-slate-400">{label}</p>
                <p
                  className={cx(
                    'mt-1 text-sm font-bold sm:text-base',
                    highlight
                      ? 'text-brand-800 dark:text-brand-200'
                      : 'text-slate-800 dark:text-slate-200'
                  )}
                >
                  {money(value, e.currency)}
                </p>
              </div>
            ))}
          </div>

          <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <strong>Why a range and not one number.</strong> A photograph carries no measuring
            reference, so the size of the damage — and therefore the cost — genuinely cannot be
            pinned down. Publishing a single figure would hide that. Bids are flagged against the{' '}
            <strong>upper</strong> bound, so a contractor is only ever questioned for exceeding the
            most generous reading.
          </p>

          {e.breakdown?.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                How the expected figure was built
              </p>
              <ul className="mt-2 divide-y divide-slate-200 text-sm dark:divide-slate-800">
                {e.breakdown.map((line) => (
                  <li key={line.item} className="flex justify-between gap-4 py-2">
                    <span className="text-slate-600 dark:text-slate-400">{line.item}</span>
                    <span className="shrink-0 font-medium tabular-nums text-slate-900 dark:text-slate-100">
                      {money(line.cost, e.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {e.assumptions?.length > 0 && (
            <div className="mt-4 rounded-lg bg-slate-50 p-4 dark:bg-slate-800/60">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Assumptions the assessment depends on
              </p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs text-slate-500 dark:text-slate-400">
                {e.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-slate-400">
                Assessed by {e.producedBy} · confidence {confidencePercent(e.confidence)}
              </p>
            </div>
          )}
        </Section>
      )}

      {/* ------------------------------------------------------- 3. the bids */}
      {bids.length > 0 && (
        <Section
          step="3"
          title={`${bids.length} bid${bids.length === 1 ? '' : 's'} received`}
          description="Cheapest first. Losing bidders are not named — their figures are the accountability, not their reputations."
        >
          <ul className="space-y-2">
            {bids.map((bid, i) => (
              <li
                key={i}
                className={cx(
                  'flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4',
                  bid.isWinner
                    ? 'border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/25'
                    : bid.isFlagged
                      ? 'border-red-300 bg-red-50/60 dark:border-red-800 dark:bg-red-950/25'
                      : 'border-slate-200 dark:border-slate-800'
                )}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {bid.bidder}
                    </span>
                    {bid.isWinner && (
                      <Badge tone="green" dot>
                        Awarded
                      </Badge>
                    )}
                    <StatusBadge status={bid.anomaly?.band} dot={false} />
                  </div>
                  {bid.isFlagged && bid.anomaly?.explanation && (
                    <p className="mt-1.5 text-xs text-red-700 dark:text-red-300">
                      {bid.anomaly.explanation}
                    </p>
                  )}
                </div>

                <p
                  className={cx(
                    'shrink-0 text-lg font-bold tabular-nums',
                    bid.isFlagged
                      ? 'text-red-700 dark:text-red-400'
                      : 'text-slate-900 dark:text-slate-100'
                  )}
                >
                  {money(bid.amount, bid.currency)}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* ------------------------------------------------------ 4. the escrow */}
      {project.escrow.fundingTxHash && (
        <Section
          step="4"
          title="Funds locked in escrow"
          description="Deposited into a contract with no withdrawal function. From this point the money can only reach the awarded contractor, one verified stage at a time."
        >
          <dl className="grid gap-3 sm:grid-cols-2">
            {[
              ['Amount locked', formatEth(project.escrow.lockedWei)],
              ['Contractor wallet', shortAddress(project.awarded?.contractorWallet, 6)],
              ['Signed by', shortAddress(project.escrow.fundedByWallet, 6)],
              ['On-chain project id', project.escrow.onChainProjectId],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                <dt className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
                  {label}
                </dt>
                <dd className="mt-0.5 font-mono text-sm text-slate-900 dark:text-slate-100">
                  {value ?? '—'}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-3 flex flex-wrap gap-4">
            <EtherscanLink hash={project.escrow.fundingTxHash} label="The deposit transaction" />
            <EtherscanLink address={project.escrow.contractAddress} label="The escrow contract" />
          </div>
        </Section>
      )}

      {/* --------------------------------------------------- 5. the milestones */}
      {milestones.length > 0 && (
        <Section
          step="5"
          title="Paid stage by stage"
          description="Each stage needed a photograph, an automated check against the original report, and an official's signature before any money moved."
        >
          <ol className="space-y-3">
            {milestones.map((m) => (
              <MilestoneRow key={m.number} milestone={m} />
            ))}
          </ol>
        </Section>
      )}

      {milestones.length === 0 && (
        <Section step="5" title="No stages yet">
          <EmptyState
            icon="⏳"
            title="This project has not been awarded"
            description="Once a contractor wins it, the milestone schedule and every payment will appear here."
          />
        </Section>
      )}

      {/* ------------------------------------------------------------ footer */}
      <Card className="mt-8 bg-slate-900 p-6 dark:bg-slate-800">
        <h2 className="text-base font-bold text-white">Verify any of this yourself</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          Nothing on this page needs to be taken on trust. Every amount above links to a
          transaction on Etherscan, a public ledger that neither this platform nor the government
          controls. Open the contract and read its source — it is verified, so you can see exactly
          what it permits.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          {project.escrow.contractAddress && (
            <Button
              as="a"
              href={project.escrow.contractUrl}
              target="_blank"
              rel="noopener noreferrer"
              variant="secondary"
              size="sm"
            >
              Open the escrow contract
            </Button>
          )}
          <Button as={Link} to="/transparency" variant="ghost" size="sm" className="text-white hover:bg-white/10">
            All projects
          </Button>
        </div>
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------------------

const Section = ({ step, title, description, children }) => (
  <section className="mt-8">
    <div className="mb-4 flex items-start gap-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
        {step}
      </span>
      <div className="min-w-0">
        <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">{title}</h2>
        {description && (
          <p className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            {description}
          </p>
        )}
      </div>
    </div>
    <Card className="p-5">{children}</Card>
  </section>
);

// ---------------------------------------------------------------------------

const MilestoneRow = ({ milestone: m }) => {
  const ai = m.aiVerification;
  const paid = m.status === 'paid';

  return (
    <li
      className={cx(
        'rounded-xl border p-4',
        paid
          ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20'
          : 'border-slate-200 dark:border-slate-800'
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row">
        {m.progressImageUrl && (
          <img
            src={m.progressImageUrl}
            alt={`Stage ${m.number} progress`}
            loading="lazy"
            className="h-28 w-full shrink-0 rounded-lg object-cover sm:w-36"
          />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
              {m.number}
            </span>
            <StatusBadge status={m.status} />
            <Badge tone="slate">{m.fundPercentage}% of funds</Badge>
          </div>

          <p className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100">
            {m.description}
          </p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {formatEth(m.amountWei)}
            {m.displayAmount ? ` · ${money(m.displayAmount, m.currency)}` : ''}
            {m.submissionCount > 1 ? ` · ${m.submissionCount} submissions` : ''}
          </p>

          {ai && (
            <div
              className={cx(
                'mt-3 rounded-lg p-3 text-xs',
                ai.looksComplete
                  ? 'bg-emerald-100/60 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300'
                  : 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300'
              )}
            >
              <p className="font-semibold">
                Automated check: {ai.looksComplete ? 'work appears complete' : 'could not confirm completion'}
                {' · '}confidence {confidencePercent(ai.confidence)}
              </p>
              <p className="mt-1 leading-relaxed">{ai.assessment}</p>
              {ai.concerns?.length > 0 && (
                <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                  {ai.concerns.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
              <p className="mt-1.5 opacity-70">
                Same site as the original report: {ai.matchesOriginalIssue === false ? 'no' : 'yes'} ·
                assessed by {ai.model}
              </p>
            </div>
          )}

          {/* An official overruling the machine is published, not buried. */}
          {m.aiRejectionOverridden && (
            <Alert tone="amber" title="An official approved this despite the automated check" className="mt-3">
              {m.overrideJustification}
            </Alert>
          )}

          {m.payment && (
            <div className="mt-3 border-t border-emerald-200 pt-3 dark:border-emerald-900">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-slate-600 dark:text-slate-400">
                  <p>
                    Paid {formatDate(m.payment.paidAt, true)} · block {m.payment.blockNumber}
                  </p>
                  <p className="mt-0.5">
                    Signed by{' '}
                    <span className="font-mono">{shortAddress(m.payment.approvedByWallet, 6)}</span>
                  </p>
                </div>
                <EtherscanLink hash={m.payment.transactionHash} label="The payment transaction" />
              </div>

              {m.payment.evidenceHash &&
                m.payment.evidenceHash !== `0x${'0'.repeat(64)}` && (
                  <p className="mt-2 font-mono text-[10px] break-all text-slate-400">
                    evidence hash {m.payment.evidenceHash}
                  </p>
                )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
};

// ---------------------------------------------------------------------------

/**
 * Live comparison of our records against the chain.
 *
 * Fetched on demand rather than on load: it costs an RPC round trip, and
 * making it a deliberate click is also the more honest framing — the visitor
 * asks the question, the page answers it.
 */
const ChainVerification = ({ projectId }) => {
  const [open, setOpen] = useState(false);
  const { data, loading, error, refetch } = useFetch(() => publicApi.verify(projectId), [projectId], {
    immediate: false,
  });

  const check = () => {
    setOpen(true);
    refetch();
  };

  if (!open) {
    return (
      <Card className="mt-4 border-brand-200 bg-brand-50/60 p-5 dark:border-brand-900 dark:bg-brand-950/30">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-brand-900 dark:text-brand-100">
              Do not take our word for it
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-brand-800/80 dark:text-brand-300/80">
              Compare every figure on this page against the Ethereum blockchain, live. If our
              records and the chain disagree, this will say so.
            </p>
          </div>
          <Button onClick={check} size="sm" className="shrink-0">
            Check against the chain
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="mt-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
          Verification against the chain
        </h2>
        {!loading && (
          <Button variant="ghost" size="sm" onClick={refetch}>
            Re-check
          </Button>
        )}
      </div>

      {loading && (
        <div className="mt-4 flex items-center gap-3">
          <Spinner size="sm" className="text-brand-600" />
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Reading the escrow contract from the Ethereum network…
          </p>
        </div>
      )}

      {error && <Alert tone="red" className="mt-4">{error}</Alert>}

      {!loading && data && !data.available && (
        <Alert tone="blue" className="mt-4">
          {data.reason}
        </Alert>
      )}

      {!loading && data?.available && (
        <>
          <Alert tone={data.allMatch ? 'green' : 'red'} className="mt-4">
            <p className="font-semibold">
              {data.allMatch
                ? 'Every figure on this page matches the blockchain.'
                : 'Our records and the blockchain do not match.'}
            </p>
            <p className="mt-1 text-xs opacity-90">
              {data.allMatch
                ? 'Checked just now, directly against the escrow contract.'
                : 'The chain is authoritative. The discrepancy is shown below and has been surfaced rather than hidden.'}
            </p>
          </Alert>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="pb-2 pr-3 font-semibold">Field</th>
                  <th className="pb-2 pr-3 font-semibold">This page says</th>
                  <th className="pb-2 pr-3 font-semibold">The chain says</th>
                  <th className="pb-2 font-semibold">Match</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {data.comparisons.map((c) => (
                  <tr key={c.field}>
                    <td className="py-2 pr-3 text-slate-700 dark:text-slate-300">{c.field}</td>
                    <td className="py-2 pr-3 font-mono break-all text-slate-900 dark:text-slate-100">
                      {c.ours || '—'}
                    </td>
                    <td className="py-2 pr-3 font-mono break-all text-slate-900 dark:text-slate-100">
                      {c.chain || '—'}
                    </td>
                    <td className="py-2">
                      <Badge tone={c.matches ? 'green' : 'red'}>{c.matches ? 'yes' : 'NO'}</Badge>
                    </td>
                  </tr>
                ))}
                {data.milestones.map((m) => (
                  <tr key={`m${m.number}`}>
                    <td className="py-2 pr-3 text-slate-700 dark:text-slate-300">
                      Stage {m.number} paid
                    </td>
                    <td className="py-2 pr-3 text-slate-900 dark:text-slate-100">
                      {m.ours.paid ? 'yes' : 'no'}
                    </td>
                    <td className="py-2 pr-3 text-slate-900 dark:text-slate-100">
                      {m.chain ? (m.chain.paid ? 'yes' : 'no') : '—'}
                    </td>
                    <td className="py-2">
                      <Badge tone={m.matches ? 'green' : 'red'}>{m.matches ? 'yes' : 'NO'}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[11px] text-slate-400">
            Read from contract{' '}
            <span className="font-mono">{shortAddress(data.contractAddress, 6)}</span>, on-chain
            project {data.onChainProjectId}, at {formatDate(data.checkedAt, true)}.
          </p>
        </>
      )}
    </Card>
  );
};

export default ProjectDetail;
