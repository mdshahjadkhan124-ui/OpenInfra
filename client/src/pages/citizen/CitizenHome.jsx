/** Citizen overview: their counts, plus a prompt to report. */
import { Link } from 'react-router-dom';
import { reportApi } from '../../services/api.js';
import { useFetch } from '../../hooks/useFetch.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Button, Card, Stat, StatusBadge, LoadingState, EmptyState } from '../../components/ui.jsx';
import { money, timeAgo } from '../../lib/format.js';

export const CitizenHome = () => {
  const { user } = useAuth();
  const stats = useFetch(() => reportApi.stats(), []);
  const recent = useFetch(() => reportApi.mine({ limit: 4 }), []);

  const s = stats.data?.stats;
  const reports = recent.data?.data?.reports ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Hello, {user?.name?.split(' ')[0]}
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Report an infrastructure problem and follow the public money that fixes it.
        </p>
      </header>

      {stats.loading ? (
        <LoadingState label="Loading your activity…" />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Stat label="Reported" value={s?.total ?? 0} icon="📍" />
          <Stat label="Under review" value={s?.pending ?? 0} tone="amber" icon="⏳" />
          <Stat label="Became projects" value={s?.published ?? 0} tone="green" icon="🏗️" />
          <Stat label="Not accepted" value={s?.rejected ?? 0} tone="red" icon="✕" />
        </div>
      )}

      <Card className="overflow-hidden bg-gradient-to-br from-brand-600 to-accent-700 p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div className="max-w-md">
            <h2 className="text-lg font-bold text-white">Seen something broken?</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-white/80">
              Take a photo. Our AI checks it is genuinely public infrastructure and estimates a
              fair repair cost — the figure every contractor bid is then measured against.
            </p>
          </div>
          <Button
            as={Link}
            to="/citizen/report"
            size="lg"
            className="border-0 bg-white text-brand-800 hover:bg-white/90"
          >
            Report a problem
          </Button>
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between p-5 pb-3">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Recent reports
          </h2>
          {reports.length > 0 && (
            <Link
              to="/citizen/reports"
              className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-400"
            >
              View all
            </Link>
          )}
        </div>

        {recent.loading ? (
          <LoadingState label="Loading…" className="py-10" />
        ) : reports.length === 0 ? (
          <EmptyState
            icon="📭"
            title="Nothing reported yet"
            description="Your reports will appear here once you submit one."
          />
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {reports.map((report) => (
              <li key={report.id} className="flex items-center gap-4 p-4">
                <img
                  src={report.imageUrl}
                  alt=""
                  loading="lazy"
                  className="h-14 w-14 shrink-0 rounded-lg object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                    {report.description}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                    {report.location.address} · {timeAgo(report.createdAt)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <StatusBadge status={report.status} />
                  {report.aiCostEstimate && (
                    <p className="mt-1.5 text-xs font-semibold tabular-nums text-slate-600 dark:text-slate-400">
                      {money(report.aiCostEstimate.amount, report.aiCostEstimate.currency)}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
};

export default CitizenHome;
