/**
 * Public transparency dashboard.
 *
 * No login. The argument the page has to make is that you do not have to
 * believe it — so the design keeps pulling attention towards things a visitor
 * can check independently: every amount sits next to the transaction that
 * moved it, and the activity feed is a list of links out to Etherscan rather
 * than a list of assertions.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { publicApi } from '../../services/api.js';
import { useFetch } from '../../hooks/useFetch.js';
import {
  Card, Badge, StatusBadge, LoadingState, EmptyState, ErrorState,
  EtherscanLink, Progress, Button, SkeletonCard, cx,
} from '../../components/ui.jsx';
import { money, compactMoney, formatEth, timeAgo, formatDate } from '../../lib/format.js';
import { CATEGORY_LABEL, PROJECT_STATUS } from '../../lib/constants.js';

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: PROJECT_STATUS.OPEN, label: 'Open for bids' },
  { value: PROJECT_STATUS.AWARDED, label: 'Awarded' },
  { value: PROJECT_STATUS.IN_PROGRESS, label: 'In progress' },
  { value: PROJECT_STATUS.COMPLETED, label: 'Completed' },
];

const SORTS = [
  { value: 'recent', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'highest', label: 'Highest value' },
  { value: 'lowest', label: 'Lowest value' },
];

export const Transparency = () => {
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('recent');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');

  const stats = useFetch(() => publicApi.stats(), []);
  const activity = useFetch(() => publicApi.activity({ limit: 8 }), []);
  const list = useFetch(
    () => publicApi.projects({ status, sort, q: search || undefined, limit: 24 }),
    [status, sort, search]
  );

  const s = stats.data?.stats;
  const projects = list.data?.data?.projects ?? [];

  const submitSearch = (event) => {
    event.preventDefault();
    setSearch(q.trim());
  };

  return (
    <div>
      {/* ------------------------------------------------------------- hero */}
      <section className="relative overflow-hidden border-b border-slate-200 dark:border-slate-800">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-600 via-brand-700 to-accent-800" />
        <div
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 15% 25%, white 1px, transparent 1px), radial-gradient(circle at 75% 65%, white 1px, transparent 1px)',
            backgroundSize: '52px 52px, 68px 68px',
          }}
          aria-hidden="true"
        />

        <div className="relative mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-20">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-semibold text-white backdrop-blur">
            <span className="h-1.5 w-1.5 animate-pulse-ring rounded-full bg-brand-200" />
            Public record · no account needed
          </span>

          <h1 className="mt-5 max-w-3xl text-3xl leading-tight font-extrabold tracking-tight text-white sm:text-4xl lg:text-5xl">
            Every rupee of public money, and the transaction that moved it
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/75">
            Each project below started as a citizen&rsquo;s photograph. Follow it through an
            independent cost assessment, contractor bidding, and payments released stage by stage —
            all of it on a public ledger this platform cannot edit.
          </p>

          {/* Headline figures, on the hero so they are the first thing read. */}
          {stats.loading ? (
            <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-24 animate-pulse rounded-xl bg-white/10" />
              ))}
            </div>
          ) : s ? (
            <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <HeroStat label="Locked in escrow" value={formatEth(s.funds.lockedWei, 4)} sub="held by the contract" />
              <HeroStat label="Released to contractors" value={formatEth(s.funds.releasedWei, 4)} sub="after verified work" />
              <HeroStat label="Projects" value={s.projects.total} sub={`${s.projects.completed} completed`} />
              <HeroStat
                label="Bids flagged"
                value={s.bids.flagged}
                sub={`of ${s.bids.total} received`}
                alarm={s.bids.flagged > 0}
              />
            </div>
          ) : null}

          {s?.contract?.address && (
            <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
              <span className="text-white/60">Escrow contract</span>
              <a
                href={s.contract.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 font-mono text-xs font-semibold text-white backdrop-blur transition hover:bg-white/20"
              >
                {s.contract.address}
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            </div>
          )}
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
          {/* ------------------------------------------------------ projects */}
          <div className="min-w-0">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                  Public works
                </h2>
                <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                  {list.data?.meta?.total ?? 0} project
                  {(list.data?.meta?.total ?? 0) === 1 ? '' : 's'}
                  {search ? ` matching “${search}”` : ''}
                </p>
              </div>

              <form onSubmit={submitSearch} className="flex gap-2">
                <input
                  type="search"
                  className="input w-40 py-2 text-sm sm:w-56"
                  placeholder="Search location or title"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  maxLength={80}
                  aria-label="Search projects"
                />
                <Button type="submit" variant="secondary" size="sm">
                  Search
                </Button>
              </form>
            </div>

            {/* Filters */}
            <div className="mb-5 flex flex-wrap items-center gap-2">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setStatus(f.value)}
                  className={cx(
                    'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                    status === f.value
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-slate-300 text-slate-600 hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800'
                  )}
                >
                  {f.label}
                  {s && f.value !== 'all' && (
                    <span className="ml-1.5 opacity-70">
                      {
                        {
                          open: s.projects.open,
                          awarded: s.projects.awarded,
                          in_progress: s.projects.inProgress,
                          completed: s.projects.completed,
                        }[f.value]
                      }
                    </span>
                  )}
                </button>
              ))}

              <select
                className="input ml-auto w-auto py-1.5 text-xs"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                aria-label="Sort projects"
              >
                {SORTS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            {list.loading && (
              <div className="grid gap-4 sm:grid-cols-2">
                {[0, 1, 2, 3].map((i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            )}
            {list.error && <ErrorState message={list.error} onRetry={list.refetch} />}

            {!list.loading && !list.error && projects.length === 0 && (
              <Card>
                <EmptyState
                  icon="🔍"
                  title="No projects here yet"
                  description={
                    search || status !== 'all'
                      ? 'Try a different filter or search term.'
                      : 'Once an official publishes an approved citizen report, it appears here.'
                  }
                />
              </Card>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              {projects.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          </div>

          {/* ------------------------------------------------------ sidebar */}
          <aside className="space-y-5 lg:sticky lg:top-20 lg:self-start">
            <Card>
              <div className="border-b border-slate-200 p-4 dark:border-slate-800">
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  On-chain activity
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Every entry links to a transaction you can open yourself.
                </p>
              </div>

              {activity.loading ? (
                <LoadingState label="Loading…" className="py-8" />
              ) : (activity.data?.events ?? []).length === 0 ? (
                <EmptyState
                  icon="⛓️"
                  title="No payments yet"
                  description="On-chain movements appear here as they happen."
                  className="py-10"
                />
              ) : (
                <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                  {activity.data.events.map((event, i) => (
                    <li key={`${event.transactionHash}-${i}`} className="p-4">
                      <div className="flex items-start gap-3">
                        <span
                          className={cx(
                            'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs',
                            event.type === 'milestone_paid'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                              : 'bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-400'
                          )}
                          aria-hidden="true"
                        >
                          {event.type === 'milestone_paid' ? '↑' : '🔒'}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                            {event.label}
                          </p>
                          <Link
                            to={`/transparency/projects/${event.projectId}`}
                            className="mt-0.5 block truncate text-xs text-slate-500 hover:text-brand-700 hover:underline dark:text-slate-400 dark:hover:text-brand-400"
                          >
                            {event.projectTitle}
                          </Link>
                          <p className="mt-1 text-xs font-bold tabular-nums text-slate-700 dark:text-slate-300">
                            {formatEth(event.amountWei)}
                          </p>
                          <div className="mt-1.5 flex items-center justify-between gap-2">
                            <span className="text-[11px] text-slate-400">{timeAgo(event.at)}</span>
                            <EtherscanLink hash={event.transactionHash} label="verify" compact />
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* The claim the page exists to make, stated plainly. */}
            <Card className="bg-slate-900 p-5 dark:bg-slate-800">
              <h2 className="text-sm font-bold text-white">Why you can check this</h2>
              <ul className="mt-3 space-y-2.5 text-xs leading-relaxed text-slate-300">
                <li>
                  <strong className="text-white">Funds cannot be withdrawn.</strong> The escrow
                  contract has no withdraw function. Once locked, money can only reach the awarded
                  contractor.
                </li>
                <li>
                  <strong className="text-white">A stage cannot be paid twice.</strong> Enforced by
                  the contract, not by this website.
                </li>
                <li>
                  <strong className="text-white">A person signs each payment.</strong> The server
                  holds no key — every release is signed by an official&rsquo;s own wallet.
                </li>
                <li>
                  <strong className="text-white">Open any project</strong> and compare our figures
                  against the live chain in one click.
                </li>
              </ul>
            </Card>

            {s && (
              <Card className="p-5">
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Across the platform
                </h2>
                <dl className="mt-3 space-y-2 text-xs">
                  {[
                    ['Citizen reports filed', s.reports],
                    ['Bids received', s.bids.total],
                    ['Bids flagged as anomalous', s.bids.flagged],
                    ['Stages verified and paid', `${s.milestones.paid} of ${s.milestones.total}`],
                    ['Stages awaiting approval', s.milestones.awaitingReview],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-baseline justify-between gap-3">
                      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
                      <dd className="font-bold tabular-nums text-slate-900 dark:text-slate-100">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>

                {s.value.totalAssessed > 0 && (
                  <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-800">
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Awarded {money(s.value.totalAwarded, s.value.currency)} against an assessed{' '}
                      {money(s.value.totalAssessed, s.value.currency)} —{' '}
                      <span
                        className={cx(
                          'font-bold',
                          s.value.differencePercent > 0
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        )}
                      >
                        {s.value.differencePercent > 0 ? '+' : ''}
                        {s.value.differencePercent}%
                      </span>
                    </p>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
                      An indicator, not an audited figure: it compares awarded totals with the
                      expected estimate, which is a mid-range judgement from a photograph.
                    </p>
                  </div>
                )}
              </Card>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------

const HeroStat = ({ label, value, sub, alarm = false }) => (
  <div className="rounded-xl border border-white/15 bg-white/10 p-4 backdrop-blur">
    <p className="text-[11px] font-semibold tracking-wide text-white/60 uppercase">{label}</p>
    <p
      className={cx(
        'mt-1.5 text-xl font-bold tabular-nums sm:text-2xl',
        alarm ? 'text-amber-300' : 'text-white'
      )}
    >
      {value}
    </p>
    {sub && <p className="mt-0.5 text-[11px] text-white/50">{sub}</p>}
  </div>
);

// ---------------------------------------------------------------------------

const ProjectCard = ({ project }) => {
  const e = project.estimate;
  const progress = project.milestoneProgress;
  const released = project.escrow.releasedWei;
  const locked = project.escrow.lockedWei;

  return (
    <Card hover className="flex flex-col overflow-hidden">
      <Link to={`/transparency/projects/${project.id}`} className="relative block">
        <img
          src={project.imageUrl}
          alt={project.title}
          loading="lazy"
          className="aspect-video w-full object-cover transition-transform duration-300 hover:scale-[1.03]"
        />
        <span className="absolute top-2.5 left-2.5">
          <StatusBadge status={project.status} />
        </span>
        {project.category && (
          <span className="absolute top-2.5 right-2.5">
            <Badge tone="slate" className="bg-white/90 dark:bg-slate-900/90">
              {CATEGORY_LABEL[project.category] ?? project.category}
            </Badge>
          </span>
        )}
      </Link>

      <div className="flex flex-1 flex-col p-4">
        <Link to={`/transparency/projects/${project.id}`} className="group">
          <h3 className="line-clamp-2 text-sm font-semibold text-slate-900 group-hover:text-brand-700 dark:text-slate-100 dark:group-hover:text-brand-400">
            {project.title}
          </h3>
        </Link>
        <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
          📍 {project.location.address}
        </p>

        {/* Assessment vs award, side by side — the comparison that matters. */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800/60">
            <p className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
              Assessed
            </p>
            <p className="mt-0.5 text-xs font-bold text-slate-900 dark:text-slate-100">
              {e ? `${compactMoney(e.min, e.currency)}–${compactMoney(e.max, e.currency)}` : '—'}
            </p>
          </div>
          <div
            className={cx(
              'rounded-lg p-2.5',
              project.awarded
                ? 'bg-brand-50 dark:bg-brand-950/40'
                : 'bg-slate-50 dark:bg-slate-800/60'
            )}
          >
            <p className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
              Awarded
            </p>
            <p className="mt-0.5 text-xs font-bold text-brand-800 dark:text-brand-200">
              {project.awarded ? money(project.awarded.amount, project.awarded.currency) : 'Not yet'}
            </p>
          </div>
        </div>

        {BigInt(locked || '0') > 0n && (
          <div className="mt-3">
            <Progress
              value={
                BigInt(locked) > 0n ? Number((BigInt(released) * 100n) / BigInt(locked)) : 0
              }
              tone={project.status === 'completed' ? 'green' : 'teal'}
              label={`${formatEth(released, 4)} of ${formatEth(locked, 4)} released`}
            />
            {progress && (
              <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                {progress.paid} of {progress.total} stages verified and paid
              </p>
            )}
          </div>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 pt-3">
          <span className="text-[11px] text-slate-400">
            Reported by {project.reportedBy} · {timeAgo(project.publishedAt)}
          </span>
          {project.escrow.fundingTxHash && (
            <EtherscanLink hash={project.escrow.fundingTxHash} label="escrow" compact />
          )}
        </div>
      </div>
    </Card>
  );
};

export default Transparency;
