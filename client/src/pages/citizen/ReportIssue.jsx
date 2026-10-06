/**
 * Report a problem.
 *
 * The screen the whole product hangs off. Two things get particular care:
 *
 *  • **The wait.** A submission runs a Cloudinary upload and a Gemini vision
 *    call, which together take 5–15 seconds. A bare spinner for that long
 *    reads as broken, so the UI narrates what is happening in stages.
 *
 *  • **The rejection.** An AI rejection comes back as HTTP 201 with
 *    status `rejected` — the submission succeeded, the verdict was no. It is
 *    presented as a considered answer with the model's own reason and advice
 *    on retrying, not as an error the citizen did something wrong to cause.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { reportApi } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Button, Card, Field, Alert, Badge, Spinner, EtherscanLink, cx } from '../../components/ui.jsx';
import { money, confidencePercent } from '../../lib/format.js';
import { CATEGORY_LABEL, SEVERITY_TONE } from '../../lib/constants.js';

const MAX_MB = 10;
const ACCEPTED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

/** What the user is told while they wait, in the order it actually happens. */
const STAGES = [
  { at: 0, label: 'Uploading your photo…' },
  { at: 3000, label: 'Checking it shows public infrastructure…' },
  { at: 7000, label: 'Estimating a fair repair cost…' },
  { at: 13000, label: 'Almost there — finishing the assessment…' },
];

export const ReportIssue = () => {
  const toast = useToast();

  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [form, setForm] = useState({ description: '', address: '', city: '' });
  const [coords, setCoords] = useState({ latitude: '', longitude: '' });
  const [locating, setLocating] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [stage, setStage] = useState(STAGES[0].label);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  // Revoke the object URL when the preview changes, or the tab leaks blobs.
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  // Walk the stage labels while the request is in flight.
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

  const chooseFile = (chosen) => {
    setError(null);
    if (!chosen) return;

    if (!ACCEPTED.includes(chosen.type.toLowerCase())) {
      setError('That file type is not supported. Use a JPEG, PNG, WebP or HEIC photo.');
      return;
    }
    if (chosen.size > MAX_MB * 1024 * 1024) {
      setError(`That photo is ${(chosen.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_MB} MB.`);
      return;
    }

    if (preview) URL.revokeObjectURL(preview);
    setFile(chosen);
    setPreview(URL.createObjectURL(chosen));
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      toast.warning('Location unavailable', 'This browser does not support geolocation.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          latitude: pos.coords.latitude.toFixed(6),
          longitude: pos.coords.longitude.toFixed(6),
        });
        setLocating(false);
        toast.success('Location captured');
      },
      () => {
        setLocating(false);
        toast.warning('Could not get your location', 'Type the address instead.');
      },
      { timeout: 10_000 }
    );
  };

  const submit = async (event) => {
    event.preventDefault();
    setError(null);

    if (!file) {
      setError('A photo is required.');
      return;
    }

    const payload = new FormData();
    payload.append('image', file);
    payload.append('description', form.description);
    payload.append('address', form.address);
    if (form.city) payload.append('city', form.city);
    if (coords.latitude) payload.append('latitude', coords.latitude);
    if (coords.longitude) payload.append('longitude', coords.longitude);

    setSubmitting(true);
    setStage(STAGES[0].label);

    try {
      const { report } = await reportApi.create(payload);
      setResult(report);

      if (report.status === 'rejected') {
        toast.warning('Photo not accepted', 'Our AI could not confirm it shows public infrastructure.');
      } else {
        toast.success('Report submitted', 'An official will review it shortly.');
      }
    } catch (err) {
      setError(err.userMessage ?? 'Could not submit your report.');
      toast.error('Submission failed', err.userMessage);
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview(null);
    setForm({ description: '', address: '', city: '' });
    setCoords({ latitude: '', longitude: '' });
    setResult(null);
    setError(null);
  };

  // ---------------------------------------------------------------- result
  if (result) {
    const rejected = result.status === 'rejected';
    const estimate = result.aiCostEstimate;

    return (
      <div className="mx-auto max-w-2xl animate-slide-up">
        <Card className="overflow-hidden">
          <div
            className={cx(
              'flex items-start gap-4 p-6',
              rejected
                ? 'bg-red-50 dark:bg-red-950/30'
                : 'bg-emerald-50 dark:bg-emerald-950/30'
            )}
          >
            <span
              className={cx(
                'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl',
                rejected ? 'bg-red-100 dark:bg-red-900/50' : 'bg-emerald-100 dark:bg-emerald-900/50'
              )}
            >
              {rejected ? '✕' : '✓'}
            </span>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-slate-900 dark:text-white">
                {rejected ? 'We could not accept this photo' : 'Report submitted'}
              </h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                {rejected
                  ? 'Our automated review did not find public infrastructure in this image.'
                  : 'Our AI assessed the repair cost. An official will review it shortly.'}
              </p>
            </div>
          </div>

          <div className="space-y-5 p-6">
            {rejected ? (
              <>
                <Alert tone="red" title="What our AI saw">
                  {result.rejectionReason}
                </Alert>
                <div className="text-sm text-slate-600 dark:text-slate-400">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">
                    If this is a genuine problem, try again with:
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    <li>daylight, or as much light as you can manage</li>
                    <li>a few steps back, so the damage and its surroundings are both visible</li>
                    <li>the damage filling a good part of the frame, in focus</li>
                  </ul>
                  <p className="mt-3">
                    An official can also review this decision — your photo has been kept.
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="rounded-xl border border-brand-200 bg-brand-50 p-5 dark:border-brand-900 dark:bg-brand-950/40">
                  <p className="text-xs font-bold tracking-wide text-brand-800 uppercase dark:text-brand-300">
                    Independent cost assessment
                  </p>
                  <p className="mt-2 text-3xl font-bold text-brand-900 dark:text-brand-100">
                    {money(estimate.amount, estimate.currency)}
                  </p>
                  <p className="mt-1 text-sm text-brand-700 dark:text-brand-300">
                    Plausible range {money(estimate.minAmount, estimate.currency)} –{' '}
                    {money(estimate.maxAmount, estimate.currency)}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge tone="teal">{CATEGORY_LABEL[result.aiRelevanceResult.category]}</Badge>
                    <Badge tone={SEVERITY_TONE[estimate.severity] ?? 'slate'}>
                      {estimate.severity} severity
                    </Badge>
                    <Badge tone="slate">
                      confidence {confidencePercent(estimate.confidence)}
                    </Badge>
                  </div>
                  <p className="mt-4 text-xs leading-relaxed text-brand-800/80 dark:text-brand-300/80">
                    Contractor bids are measured against the upper end of this range. Anything
                    more than 20% above it is flagged automatically.
                  </p>
                </div>

                {estimate.breakdown?.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      How that was estimated
                    </p>
                    <ul className="mt-2 divide-y divide-slate-200 text-sm dark:divide-slate-800">
                      {estimate.breakdown.map((line) => (
                        <li key={line.item} className="flex justify-between gap-4 py-2">
                          <span className="text-slate-600 dark:text-slate-400">{line.item}</span>
                          <span className="shrink-0 font-medium tabular-nums text-slate-900 dark:text-slate-100">
                            {money(line.cost, estimate.currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {estimate.assumptions?.length > 0 && (
                  <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-800/50">
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Assumptions made
                    </p>
                    <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs text-slate-500 dark:text-slate-400">
                      {estimate.assumptions.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button as={Link} to="/citizen/reports" variant="secondary">
                View my reports
              </Button>
              <Button onClick={reset}>Report another problem</Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  // ------------------------------------------------------------------ form
  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Report a problem
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Upload a photo and we will assess it, estimate a fair repair cost, and put it in front
          of an official.
        </p>
      </header>

      <form onSubmit={submit} className="space-y-5" noValidate>
        <Card className="p-5">
          <Field label="Photo of the problem" required>
            {preview ? (
              <div className="relative overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                <img src={preview} alt="The problem you are reporting" className="max-h-80 w-full object-cover" />
                {!submitting && (
                  <button
                    type="button"
                    onClick={() => {
                      URL.revokeObjectURL(preview);
                      setFile(null);
                      setPreview(null);
                    }}
                    className="absolute top-3 right-3 rounded-lg bg-slate-900/70 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur transition hover:bg-slate-900"
                  >
                    Change photo
                  </button>
                )}
                <p className="bg-white px-3 py-2 text-xs text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                  {file?.name} · {(file?.size / 1024 / 1024).toFixed(1)} MB
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  chooseFile(e.dataTransfer.files?.[0]);
                }}
                className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center transition hover:border-brand-400 hover:bg-brand-50/50 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:border-brand-600 dark:hover:bg-brand-950/20"
              >
                <span className="text-3xl">📷</span>
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Tap to choose a photo, or drag one here
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  JPEG, PNG, WebP or HEIC · up to {MAX_MB} MB
                </span>
              </button>
            )}
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED.join(',')}
              capture="environment"
              className="hidden"
              onChange={(e) => chooseFile(e.target.files?.[0])}
            />
          </Field>
        </Card>

        <Card className="space-y-4 p-5">
          <Field
            label="What is wrong?"
            htmlFor="description"
            required
            hint={`${form.description.length}/1000 — at least 10 characters`}
          >
            <textarea
              id="description"
              rows={4}
              className="input resize-y"
              placeholder="Deep pothole in the middle of the road near the bus stop. Two-wheelers are swerving into oncoming traffic."
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              required
              minLength={10}
              maxLength={1000}
            />
          </Field>

          <Field label="Where is it?" htmlFor="address" required>
            <input
              id="address"
              className="input"
              placeholder="14 MG Road, near the bus stop"
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              required
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="City" htmlFor="city">
              <input
                id="city"
                className="input"
                placeholder="Bengaluru"
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
              />
            </Field>

            <Field label="Coordinates" hint="Optional, but it helps crews find the spot.">
              {coords.latitude ? (
                <div className="flex items-center gap-2">
                  <span className="flex-1 rounded-lg bg-emerald-50 px-3 py-2.5 font-mono text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                    {coords.latitude}, {coords.longitude}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setCoords({ latitude: '', longitude: '' })}
                  >
                    Clear
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={useMyLocation}
                  loading={locating}
                  className="w-full"
                >
                  📍 Use my location
                </Button>
              )}
            </Field>
          </div>
        </Card>

        {error && (
          <Alert tone="red" title="Please fix this">
            {error}
          </Alert>
        )}

        {submitting ? (
          <Card className="flex items-center gap-4 p-5">
            <Spinner size="lg" className="text-brand-600" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{stage}</p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                This usually takes five to fifteen seconds. Please keep this page open.
              </p>
            </div>
          </Card>
        ) : (
          <Button type="submit" size="lg" className="w-full" disabled={!file}>
            Submit report
          </Button>
        )}
      </form>
    </div>
  );
};

export default ReportIssue;
