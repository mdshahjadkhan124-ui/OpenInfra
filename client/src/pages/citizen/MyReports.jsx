/** A citizen's own reports, with the AI verdict and current status. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { reportApi } from '../../services/api.js';
import { useFetch, useAction } from '../../hooks/useFetch.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  Button, Card, StatusBadge, Badge, LoadingState, EmptyState, ErrorState,
  Tabs, Alert, Modal, cx,
} from '../../components/ui.jsx';
import { money, timeAgo, confidencePercent } from '../../lib/format.js';
import { CATEGORY_LABEL } from '../../lib/constants.js';

const TABS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Under review' },
  { value: 'published', label: 'Published' },
  { value: 'rejected', label: 'Not accepted' },
];

export const MyReports = () => {
  const [status, setStatus] = useState('');
  const toast = useToast();
  const { run, isBusy } = useAction();

  const { data, loading, error, refetch } = useFetch(
    () => reportApi.mine({ status: status || undefined, limit: 50 }),
    [status]
  );
  const stats = useFetch(() => reportApi.stats(), []);
  const [expanded, setExpanded] = useState(null);

  const reports = data?.data?.reports ?? [];

  const remove = (report) =>
    run(report.id, async () => {
      try {
        await reportApi.remove(report.id);
        toast.success('Report deleted');
        setExpanded(null);
        refetch();
        stats.refetch();
      } catch (err) {
        toast.error('Could not delete', err.userMessage);
      }
    });

  const counts = stats.data?.stats;

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            My reports
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {counts
              ? `${counts.total} submitted · ${counts.published} became public projects`
              : 'Everything you have reported.'}
          </p>
        </div>
        <Button as={Link} to="/citizen/report">
          Report a problem
        </Button>
      </header>

      <Tabs
        tabs={TABS.map((t) => ({
          ...t,
          count: t.value === '' ? counts?.total : counts?.[t.value],
        }))}
        active={status}
        onChange={setStatus}
        className="mb-5"
      />

      {loading && <LoadingState label="Loading your reports…" />}
      {error && <ErrorState message={error} onRetry={refetch} />}

      {!loading && !error && reports.length === 0 && (
        <Card>
          <EmptyState
            icon="📍"
            title={status ? 'Nothing here' : 'No reports yet'}
            description={
              status
                ? 'Try a different filter.'
                : 'Spotted a pothole, a broken street light, a blocked drain? Report it and follow what happens to the money.'
            }
            action={
              !status && (
                <Button as={Link} to="/citizen/report">
                  Report your first problem
                </Button>
              )
            }
          />
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {reports.map((report) => {
          const estimate = report.aiCostEstimate;
          const wasAiRejected = report.rejectionSource === 'ai_relevance_gate';

          return (
            <Card key={report.id} hover className="flex flex-col overflow-hidden">
              <button
                type="button"
                onClick={() => setExpanded(report)}
                className="relative aspect-video w-full overflow-hidden bg-slate-100 text-left dark:bg-slate-800"
              >
                <img
                  src={report.imageUrl}
                  alt={report.description.slice(0, 60)}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-300 hover:scale-[1.03]"
                />
                <span className="absolute top-2.5 left-2.5">
                  <StatusBadge status={report.status} />
                </span>
              </button>

              <div className="flex flex-1 flex-col p-4">
                <p className="line-clamp-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                  {report.description}
                </p>
                <p className="mt-1.5 truncate text-xs text-slate-500 dark:text-slate-400">
                  📍 {report.location.address}
                </p>

                {estimate ? (
                  <div className="mt-3 rounded-lg bg-brand-50 px-3 py-2 dark:bg-brand-950/40">
                    <p className="text-[11px] font-semibold tracking-wide text-brand-700 uppercase dark:text-brand-400">
                      Assessed cost
                    </p>
                    <p className="text-sm font-bold text-brand-900 dark:text-brand-100">
                      {money(estimate.amount, estimate.currency)}
                    </p>
                    <p className="text-[11px] text-brand-700/80 dark:text-brand-400/80">
                      range {money(estimate.minAmount, estimate.currency)} –{' '}
                      {money(estimate.maxAmount, estimate.currency)}
                    </p>
                  </div>
                ) : (
                  <p className="mt-3 line-clamp-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
                    {report.rejectionReason}
                  </p>
                )}

                <div className="mt-auto flex items-center justify-between pt-3">
                  <span className="text-xs text-slate-400">{timeAgo(report.createdAt)}</span>
                  {wasAiRejected && (
                    <Badge tone="slate" className="text-[10px]">
                      AI decision
                    </Badge>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* ------------------------------------------------------------ detail */}
      <Modal
        open={Boolean(expanded)}
        onClose={() => setExpanded(null)}
        title="Report detail"
        description={expanded?.location.address}
        size="lg"
        footer={
          expanded &&
          ['pending', 'rejected'].includes(expanded.status) && (
            <Button
              variant="outlineDanger"
              loading={isBusy(expanded.id)}
              onClick={() => remove(expanded)}
            >
              Delete this report
            </Button>
          )
        }
      >
        {expanded && (
          <div className="space-y-4">
            <img
              src={expanded.imageUrl}
              alt={expanded.description}
              className="max-h-72 w-full rounded-xl object-cover"
            />

            <div className="flex flex-wrap gap-2">
              <StatusBadge status={expanded.status} />
              <Badge tone="teal">
                {CATEGORY_LABEL[expanded.aiRelevanceResult.category] ?? 'Unclassified'}
              </Badge>
              <Badge tone="slate">
                AI confidence {confidencePercent(expanded.aiRelevanceResult.confidence)}
              </Badge>
            </div>

            <p className="text-sm text-slate-700 dark:text-slate-300">{expanded.description}</p>

            {expanded.aiRelevanceResult.reason && (
              <Alert tone={expanded.aiCostEstimate ? 'teal' : 'red'} title="What our AI concluded">
                {expanded.aiRelevanceResult.reason}
              </Alert>
            )}

            {expanded.rejectionReason && expanded.rejectionSource === 'admin_review' && (
              <Alert tone="amber" title="An official reviewed this">
                {expanded.rejectionReason}
              </Alert>
            )}

            {expanded.aiCostEstimate && (
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Cost assessment
                </p>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                  {[
                    ['Lowest', expanded.aiCostEstimate.minAmount, 'slate'],
                    ['Expected', expanded.aiCostEstimate.amount, 'teal'],
                    ['Highest', expanded.aiCostEstimate.maxAmount, 'slate'],
                  ].map(([label, value, tone]) => (
                    <div
                      key={label}
                      className={cx(
                        'rounded-lg p-3',
                        tone === 'teal'
                          ? 'bg-brand-50 dark:bg-brand-950/50'
                          : 'bg-slate-50 dark:bg-slate-800/60'
                      )}
                    >
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">{label}</p>
                      <p
                        className={cx(
                          'mt-0.5 text-sm font-bold',
                          tone === 'teal'
                            ? 'text-brand-800 dark:text-brand-200'
                            : 'text-slate-800 dark:text-slate-200'
                        )}
                      >
                        {money(value, expanded.aiCostEstimate.currency)}
                      </p>
                    </div>
                  ))}
                </div>

                {expanded.aiCostEstimate.assumptions?.length > 0 && (
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-slate-500 dark:text-slate-400">
                    {expanded.aiCostEstimate.assumptions.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {expanded.project && (
              <Alert tone="green" title="This became a public project">
                You can follow the bidding and every payment on the{' '}
                <Link to="/transparency" className="font-semibold underline">
                  transparency dashboard
                </Link>
                .
              </Alert>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default MyReports;
