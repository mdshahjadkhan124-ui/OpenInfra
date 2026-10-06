/**
 * Awarded work, and milestone progress submission.
 *
 * The upload dialog narrates the AI wait the same way the citizen report form
 * does, and an AI rejection is shown as feedback with the model's specific
 * concerns — the contractor can resubmit immediately, so this is a correction
 * loop rather than a dead end.
 */
import { useEffect, useRef, useState } from 'react';
import { projectApi, milestoneApi } from '../../services/api.js';
import { useFetch } from '../../hooks/useFetch.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  Button, Card, Badge, StatusBadge, LoadingState, EmptyState, ErrorState,
  Modal, Field, Alert, Progress, EtherscanLink, Spinner, cx,
} from '../../components/ui.jsx';
import { money, formatEth, timeAgo, confidencePercent } from '../../lib/format.js';
import { MILESTONE_STATUS } from '../../lib/constants.js';

const RESUBMITTABLE = [
  MILESTONE_STATUS.PENDING,
  MILESTONE_STATUS.AI_REJECTED,
  MILESTONE_STATUS.REJECTED,
];

const STAGES = [
  { at: 0, label: 'Uploading your photo…' },
  { at: 3000, label: 'Comparing it with the original report…' },
  { at: 8000, label: 'Checking the work looks complete…' },
  { at: 14000, label: 'Almost there…' },
];

export const AwardedWork = () => {
  const toast = useToast();
  const { data, loading, error, refetch } = useFetch(
    () => projectApi.mine({ status: 'all', limit: 50 }),
    []
  );

  const [active, setActive] = useState(null); // project whose milestones are open
  const [uploading, setUploading] = useState(null); // milestone being submitted

  const projects = data?.data?.projects ?? [];

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          My work
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Projects awarded to you. Submit a photo for each stage to release its payment.
        </p>
      </header>

      {loading && <LoadingState label="Loading your projects…" />}
      {error && <ErrorState message={error} onRetry={refetch} />}

      {!loading && !error && projects.length === 0 && (
        <Card>
          <EmptyState
            icon="🔧"
            title="No awarded projects yet"
            description="Projects you win appear here, with their milestone schedule."
          />
        </Card>
      )}

      <div className="space-y-4">
        {projects.map((project) => (
          <ProjectRow
            key={project.id}
            project={project}
            onOpen={() => setActive(project)}
          />
        ))}
      </div>

      {active && (
        <MilestoneDrawer
          project={active}
          onClose={() => setActive(null)}
          onUpload={setUploading}
        />
      )}

      {uploading && (
        <ProgressUploadModal
          milestone={uploading}
          onClose={() => setUploading(null)}
          onDone={() => {
            setUploading(null);
            // Re-read the drawer's milestones and the project list.
            setActive((p) => (p ? { ...p } : p));
            refetch();
          }}
          toast={toast}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------

const ProjectRow = ({ project, onOpen }) => {
  const locked = project.totalLockedFunds ?? '0';
  const released = project.totalReleasedFunds ?? '0';
  const pct =
    BigInt(locked) > 0n ? Number((BigInt(released) * 100n) / BigInt(locked)) : 0;

  const notFunded = project.status === 'awarded' && !project.fundingTxHash;

  return (
    <Card hover className="overflow-hidden">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <img
          src={project.imageUrl}
          alt=""
          loading="lazy"
          className="h-20 w-full shrink-0 rounded-lg object-cover sm:w-24"
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {project.title}
            </h3>
            <StatusBadge status={project.status} />
          </div>
          <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
            📍 {project.location.address}
          </p>

          <div className="mt-3 max-w-xs">
            <Progress
              value={pct}
              tone={project.status === 'completed' ? 'green' : 'teal'}
              label={`${formatEth(released)} of ${formatEth(locked)} released`}
            />
          </div>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
            {money(project.awardedAmount, project.aiEstimatedCost?.currency)}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">agreed</p>
          <Button size="sm" variant="secondary" onClick={onOpen} className="mt-2">
            View stages
          </Button>
        </div>
      </div>

      {notFunded && (
        <div className="border-t border-amber-200 bg-amber-50 px-5 py-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          Waiting for the government to lock the escrow funds. You can submit progress once that
          is done.
        </div>
      )}
    </Card>
  );
};

// ---------------------------------------------------------------------------

const MilestoneDrawer = ({ project, onClose, onUpload }) => {
  const { data, loading, error, refetch } = useFetch(
    () => milestoneApi.forProject(project.id),
    [project.id, project]
  );

  const milestones = data?.milestones ?? [];
  const summary = data?.summary;

  return (
    <Modal
      open
      onClose={onClose}
      title={project.title}
      description={
        summary ? `${summary.paid} of ${summary.total} stages paid` : 'Milestone schedule'
      }
      size="lg"
    >
      {loading && <LoadingState label="Loading stages…" className="py-10" />}
      {error && <ErrorState message={error} onRetry={refetch} />}

      {data?.project?.fundingTxHash && (
        <Alert tone="teal" className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Escrow funded and locked on-chain.</span>
            <EtherscanLink hash={data.project.fundingTxHash} label="deposit transaction" compact />
          </div>
        </Alert>
      )}

      <ol className="space-y-3">
        {milestones.map((m) => {
          const canSubmit = RESUBMITTABLE.includes(m.status) && project.status === 'in_progress';
          const ai = m.aiVerificationResult;

          return (
            <li
              key={m.id}
              className={cx(
                'rounded-xl border p-4',
                m.status === 'paid'
                  ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20'
                  : 'border-slate-200 dark:border-slate-800'
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                      {m.number}
                    </span>
                    <StatusBadge status={m.status} />
                    <Badge tone="slate">{m.fundPercentage}%</Badge>
                  </div>
                  <p className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                    {m.description}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {formatEth(m.amountWei)}
                    {m.displayAmount ? ` · ${money(m.displayAmount, m.currency)}` : ''}
                  </p>
                </div>

                {canSubmit && (
                  <Button size="sm" onClick={() => onUpload(m)} className="shrink-0">
                    {m.submissionCount > 0 ? 'Resubmit' : 'Submit progress'}
                  </Button>
                )}
              </div>

              {ai && (
                <div
                  className={cx(
                    'mt-3 rounded-lg p-3 text-xs',
                    ai.looksComplete
                      ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                      : 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300'
                  )}
                >
                  <p className="font-semibold">
                    AI assessment · confidence {confidencePercent(ai.confidence)}
                  </p>
                  <p className="mt-1 leading-relaxed">{ai.assessment}</p>
                  {ai.concerns?.length > 0 && (
                    <ul className="mt-2 list-disc space-y-0.5 pl-4">
                      {ai.concerns.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  )}
                  {ai.matchesOriginalIssue === false && (
                    <p className="mt-2 font-semibold">
                      This did not look like the same site as the original report.
                    </p>
                  )}
                </div>
              )}

              {m.rejectionReason && (
                <Alert tone="amber" title="An official asked for more work" className="mt-3">
                  {m.rejectionReason}
                </Alert>
              )}

              {m.aiRejectionOverridden && (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  An official approved this despite the automated assessment.
                </p>
              )}

              {m.transactionHash && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-emerald-200 pt-3 dark:border-emerald-900">
                  <span className="text-xs text-slate-600 dark:text-slate-400">
                    Paid {timeAgo(m.paidAt)}
                  </span>
                  <EtherscanLink hash={m.transactionHash} label="payment transaction" compact />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </Modal>
  );
};

// ---------------------------------------------------------------------------

const ProgressUploadModal = ({ milestone, onClose, onDone, toast }) => {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [stage, setStage] = useState(STAGES[0].label);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  useEffect(() => {
    if (!submitting) return undefined;
    const started = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - started;
      const current = [...STAGES].reverse().find((s) => elapsed >= s.at);
      if (current) setStage(current.label);
    }, 500);
    return () => clearInterval(timer);
  }, [submitting]);

  const choose = (chosen) => {
    if (!chosen) return;
    if (chosen.size > 10 * 1024 * 1024) {
      setError('That photo is larger than 10 MB.');
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setError(null);
    setFile(chosen);
    setPreview(URL.createObjectURL(chosen));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!file) {
      setError('A photo of the completed work is required.');
      return;
    }

    const payload = new FormData();
    payload.append('image', file);
    if (note) payload.append('note', note);

    setSubmitting(true);
    setError(null);

    try {
      const { milestone: updated } = await milestoneApi.submitProgress(milestone.id, payload);
      setResult(updated);

      if (updated.status === 'submitted') {
        toast.success('Progress accepted', 'An official will review it and release the payment.');
      } else {
        toast.warning('Needs another photo', 'Our AI could not confirm the work is complete.');
      }
    } catch (err) {
      setError(err.userMessage ?? 'Could not submit your progress.');
    } finally {
      setSubmitting(false);
    }
  };

  // --- outcome ---
  if (result) {
    const passed = result.status === 'submitted';
    const ai = result.aiVerificationResult;

    return (
      <Modal
        open
        onClose={onDone}
        title={passed ? 'Progress accepted' : 'Needs another photograph'}
        footer={
          <>
            {!passed && (
              <Button variant="secondary" onClick={() => setResult(null)}>
                Try another photo
              </Button>
            )}
            <Button onClick={onDone}>Done</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Alert tone={passed ? 'green' : 'red'} title="What our AI found">
            {ai.assessment}
          </Alert>

          {ai.concerns?.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Still outstanding
              </p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-400">
                {ai.concerns.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          {passed ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              An official will review this and release{' '}
              <strong>{formatEth(result.amountWei)}</strong> to your wallet on-chain. You will be
              emailed the transaction link.
            </p>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              You can submit again straight away. If you believe the work is complete, an official
              can review it directly and approve it despite the automated assessment.
            </p>
          )}
        </div>
      </Modal>
    );
  }

  // --- form ---
  return (
    <Modal
      open
      onClose={onClose}
      title={`Stage ${milestone.number} — submit progress`}
      description={milestone.description}
      footer={
        !submitting && (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="progress-form" disabled={!file}>
              Submit for verification
            </Button>
          </>
        )
      }
    >
      <form id="progress-form" onSubmit={submit} className="space-y-4" noValidate>
        <Alert tone="blue">
          Your photo is compared with the original report, so photograph the same location.
          A clear daylight shot from a few steps back, showing the finished work and its
          surroundings, verifies most reliably.
        </Alert>

        {preview ? (
          <div className="relative overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
            <img src={preview} alt="Completed work" className="max-h-64 w-full object-cover" />
            {!submitting && (
              <button
                type="button"
                onClick={() => {
                  URL.revokeObjectURL(preview);
                  setFile(null);
                  setPreview(null);
                }}
                className="absolute top-3 right-3 rounded-lg bg-slate-900/70 px-3 py-1.5 text-xs font-semibold text-white"
              >
                Change
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center transition hover:border-brand-400 dark:border-slate-700 dark:bg-slate-800/40"
          >
            <span className="text-3xl">📷</span>
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Photo of the completed work
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">up to 10 MB</span>
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => choose(e.target.files?.[0])}
        />

        <Field label="Note" htmlFor="note" hint="Optional. Treated as a claim, not as evidence.">
          <textarea
            id="note"
            rows={3}
            className="input resize-y"
            placeholder="Excavated, filled with hot mix and compacted level with the surrounding road."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
          />
        </Field>

        {error && <Alert tone="red">{error}</Alert>}

        {submitting && (
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
            <Spinner size="md" className="text-brand-600" />
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{stage}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Keep this open — it takes a few seconds.
              </p>
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
};

export default AwardedWork;
