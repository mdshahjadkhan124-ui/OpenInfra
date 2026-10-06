/**
 * Admin report review: approve, reject, publish.
 *
 * The AI-rejected tab matters as much as the pending one — the relevance gate
 * is a filter, not a verdict, and a wrong auto-rejection should be easy for a
 * human to overturn. Publishing such a report needs a manual cost range,
 * because there is no machine estimate to inherit.
 */
import { useState } from 'react';
import { adminApi } from '../../services/api.js';
import { useFetch, useAction } from '../../hooks/useFetch.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  Button, Card, Badge, StatusBadge, LoadingState, EmptyState, ErrorState,
  Modal, Field, Alert, Tabs, cx,
} from '../../components/ui.jsx';
import { money, timeAgo, confidencePercent } from '../../lib/format.js';
import { CATEGORY_LABEL, SEVERITY_TONE } from '../../lib/constants.js';

const TABS = [
  { value: 'pending', label: 'Needs review' },
  { value: 'rejected', label: 'AI rejected' },
  { value: 'approved', label: 'Approved' },
  { value: 'published', label: 'Published' },
];

export const ReviewReports = () => {
  const [status, setStatus] = useState('pending');
  const toast = useToast();
  const { run, isBusy } = useAction();

  const { data, loading, error, refetch } = useFetch(
    () => adminApi.reports({ status, limit: 50 }),
    [status]
  );
  const stats = useFetch(() => adminApi.stats(), []);

  const [publishing, setPublishing] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');

  const reports = data?.data?.reports ?? [];
  const counts = stats.data?.stats?.reports;

  const refreshAll = () => {
    refetch();
    stats.refetch();
  };

  const approve = (report) =>
    run(report.id, async () => {
      try {
        await adminApi.approveReport(report.id);
        toast.success(
          'Report approved',
          report.aiCostEstimate
            ? 'You can now publish it for bidding.'
            : 'It has no AI estimate, so publishing will ask you for a cost range.'
        );
        refreshAll();
      } catch (err) {
        toast.error('Could not approve', err.userMessage);
      }
    });

  const doReject = async () => {
    const report = rejecting;
    try {
      await adminApi.rejectReport(report.id, reason);
      toast.success('Report rejected', 'The citizen has been told why.');
      setRejecting(null);
      setReason('');
      refreshAll();
    } catch (err) {
      toast.error('Could not reject', err.userMessage);
    }
  };

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Review reports
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Citizen reports that passed the AI relevance check, plus the ones it rejected.
        </p>
      </header>

      <Tabs
        tabs={TABS.map((t) => ({ ...t, count: counts?.[t.value] }))}
        active={status}
        onChange={setStatus}
        className="mb-5"
      />

      {status === 'rejected' && (
        <Alert tone="blue" title="These were rejected by the AI, not by a person" className="mb-5">
          The relevance check is a filter, not a verdict. If one of these is a genuine
          infrastructure problem, approve it — the photo was kept for exactly this reason.
        </Alert>
      )}

      {loading && <LoadingState label="Loading reports…" />}
      {error && <ErrorState message={error} onRetry={refetch} />}

      {!loading && !error && reports.length === 0 && (
        <Card>
          <EmptyState icon="📋" title="Nothing here" description="Nothing matches this filter." />
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {reports.map((report) => {
          const estimate = report.aiCostEstimate;
          const ai = report.aiRelevanceResult;

          return (
            <Card key={report.id} className="flex flex-col overflow-hidden sm:flex-row">
              <img
                src={report.imageUrl}
                alt=""
                loading="lazy"
                className="h-40 w-full shrink-0 object-cover sm:h-auto sm:w-40"
              />

              <div className="flex min-w-0 flex-1 flex-col p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={report.status} />
                  <Badge tone="teal">{CATEGORY_LABEL[ai.category] ?? ai.category}</Badge>
                  {estimate && (
                    <Badge tone={SEVERITY_TONE[estimate.severity] ?? 'slate'}>
                      {estimate.severity}
                    </Badge>
                  )}
                </div>

                <p className="mt-2 line-clamp-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                  {report.description}
                </p>
                <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                  📍 {report.location.address} · {report.reporter?.name} · {timeAgo(report.createdAt)}
                </p>

                {estimate ? (
                  <p className="mt-2 text-sm font-bold text-slate-900 dark:text-slate-100">
                    {money(estimate.minAmount, estimate.currency)} –{' '}
                    {money(estimate.maxAmount, estimate.currency)}
                    <span className="ml-1.5 text-xs font-normal text-slate-500">
                      (expected {money(estimate.amount, estimate.currency)})
                    </span>
                  </p>
                ) : (
                  <p className="mt-2 line-clamp-2 rounded bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
                    {ai.reason}
                  </p>
                )}

                <p className="mt-1 text-xs text-slate-400">
                  AI confidence {confidencePercent(ai.confidence)} · {ai.model}
                </p>

                <div className="mt-auto flex flex-wrap gap-2 pt-3">
                  {report.status === 'pending' && (
                    <>
                      <Button size="sm" loading={isBusy(report.id)} onClick={() => approve(report)}>
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outlineDanger"
                        onClick={() => {
                          setRejecting(report);
                          setReason('');
                        }}
                      >
                        Reject
                      </Button>
                    </>
                  )}

                  {report.status === 'rejected' && (
                    <Button size="sm" loading={isBusy(report.id)} onClick={() => approve(report)}>
                      Overturn &amp; approve
                    </Button>
                  )}

                  {report.status === 'approved' && (
                    <Button size="sm" onClick={() => setPublishing(report)}>
                      Publish for bidding
                    </Button>
                  )}

                  {report.status === 'published' && (
                    <Badge tone="green" dot>
                      Open for bids
                    </Badge>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* ----------------------------------------------------------- reject */}
      <Modal
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        title="Reject this report"
        description="Your reason is sent to the citizen who filed it."
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={doReject} disabled={reason.trim().length < 10}>
              Reject report
            </Button>
          </>
        }
      >
        <Field
          label="Reason"
          htmlFor="reason"
          required
          hint="10–500 characters. Written plainly — a citizen will read it."
        >
          <textarea
            id="reason"
            rows={4}
            className="input resize-y"
            placeholder="This street light sits on private land and falls outside municipal responsibility."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
          />
        </Field>
      </Modal>

      {publishing && (
        <PublishModal
          report={publishing}
          onClose={() => setPublishing(null)}
          onDone={() => {
            setPublishing(null);
            refreshAll();
          }}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------

const PublishModal = ({ report, onClose, onDone }) => {
  const toast = useToast();
  const hasAiEstimate = Boolean(report.aiCostEstimate);

  const [form, setForm] = useState({
    title: '',
    description: '',
    bidsCloseAt: '',
  });
  // Required when there is no AI estimate to inherit.
  const [estimate, setEstimate] = useState({ minAmount: '', amount: '', maxAmount: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const payload = {};
      if (form.title) payload.title = form.title;
      if (form.description) payload.description = form.description;
      if (form.bidsCloseAt) payload.bidsCloseAt = new Date(form.bidsCloseAt).toISOString();
      if (!hasAiEstimate) {
        payload.estimate = {
          minAmount: Number(estimate.minAmount),
          amount: Number(estimate.amount),
          maxAmount: Number(estimate.maxAmount),
        };
      }

      const { project } = await adminApi.publishReport(report.id, payload);
      toast.success('Project published', `${project.title} is open for bidding.`);
      onDone();
    } catch (err) {
      setError(err.userMessage ?? 'Could not publish this report.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Publish for bidding"
      description="Contractors will be able to bid on this project."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="publish-form" loading={submitting}>
            Publish project
          </Button>
        </>
      }
    >
      <form id="publish-form" onSubmit={submit} className="space-y-4" noValidate>
        {hasAiEstimate ? (
          <Alert tone="teal" title="Cost benchmark">
            {money(report.aiCostEstimate.minAmount, report.aiCostEstimate.currency)} –{' '}
            {money(report.aiCostEstimate.maxAmount, report.aiCostEstimate.currency)}, expected{' '}
            {money(report.aiCostEstimate.amount, report.aiCostEstimate.currency)}. This is frozen
            onto the project — bids are measured against the upper bound.
          </Alert>
        ) : (
          <Alert tone="amber" title="A manual cost range is required">
            This report has no AI estimate, so you need to supply one. Without a benchmark no bid
            could be scored for anomalies.
          </Alert>
        )}

        {/*
          The grid stacks on the narrowest screens. The read-only range
          triplets elsewhere stay three-across because they are short centred
          amounts and the side-by-side layout is what makes them read as a
          range; these are editable number inputs, which become unusable at
          roughly 88px each on a 320px phone.
        */}
        {!hasAiEstimate && (
          <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-3">
            {[
              ['minAmount', 'Lowest'],
              ['amount', 'Expected'],
              ['maxAmount', 'Highest'],
            ].map(([key, label]) => (
              <Field key={key} label={label} htmlFor={key} required>
                <input
                  id={key}
                  type="number"
                  min="0"
                  className="input"
                  value={estimate[key]}
                  onChange={(e) => setEstimate((s) => ({ ...s, [key]: e.target.value }))}
                  required
                />
              </Field>
            ))}
          </div>
        )}

        <Field label="Title" htmlFor="title" hint="Leave blank to generate one from the report.">
          <input
            id="title"
            className="input"
            placeholder="Road damage repair — 14 MG Road, Bengaluru"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            maxLength={140}
          />
        </Field>

        <Field label="Description" htmlFor="description" hint="Leave blank to use the citizen's.">
          <textarea
            id="description"
            rows={3}
            className="input resize-y"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            maxLength={2000}
          />
        </Field>

        <Field label="Bids close" htmlFor="bidsCloseAt" hint="Optional deadline.">
          <input
            id="bidsCloseAt"
            type="datetime-local"
            className="input"
            value={form.bidsCloseAt}
            onChange={(e) => setForm((f) => ({ ...f, bidsCloseAt: e.target.value }))}
          />
        </Field>

        {error && <Alert tone="red">{error}</Alert>}
      </form>
    </Modal>
  );
};

export default ReviewReports;
