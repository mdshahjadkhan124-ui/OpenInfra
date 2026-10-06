/**
 * Milestone approval — where public money actually moves.
 *
 * This is the screen the Phase 9 signing migration exists for. The flow is:
 *
 *   1. ask the server to PREPARE an unsigned transaction;
 *   2. the official's MetaMask signs and broadcasts it;
 *   3. hand the resulting hash back to the server to CONFIRM, which verifies
 *      it against the chain before recording the payment.
 *
 * The server holds no private key, so step 2 is the only way funds can move —
 * every payout is a deliberate act by a named official with their own wallet.
 *
 * The UI is deliberately heavy on confirmation: it shows the amount, the
 * recipient, the AI verdict and the photograph before the wallet opens, and
 * says plainly that the action is irreversible.
 */
import { useState } from 'react';
import { adminApi } from '../../services/api.js';
import { useFetch } from '../../hooks/useFetch.js';
import { useWallet } from '../../context/WalletContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { WalletButton } from '../../components/WalletButton.jsx';
import {
  Button, Card, Badge, StatusBadge, LoadingState, EmptyState, ErrorState,
  Modal, Field, Alert, Tabs, EtherscanLink, Spinner, cx,
} from '../../components/ui.jsx';
import { money, formatEth, timeAgo, confidencePercent, shortAddress } from '../../lib/format.js';

const TABS = [
  { value: 'submitted', label: 'Awaiting approval' },
  { value: 'ai_rejected', label: 'AI could not verify' },
  { value: 'paid', label: 'Paid' },
  { value: 'all', label: 'All' },
];

/** Steps shown while the three-part release runs. */
const RELEASE_STEPS = {
  preparing: 'Preparing the transaction…',
  signing: 'Waiting for you to approve in MetaMask…',
  confirming: 'Verifying the transaction on-chain…',
};

export const Milestones = () => {
  const [status, setStatus] = useState('submitted');
  const { data, loading, error, refetch } = useFetch(
    () => adminApi.milestones({ status }),
    [status]
  );
  const contract = useFetch(() => adminApi.escrowContract(), []);
  const [reviewing, setReviewing] = useState(null);

  const milestones = data?.milestones ?? [];

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Approve milestones
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Approving releases funds from the escrow contract. You sign each payment with your
            own wallet.
          </p>
        </div>
        <WalletButton />
      </header>

      <AdminWalletCheck contract={contract.data} />

      <Tabs tabs={TABS} active={status} onChange={setStatus} className="mb-5" />

      {loading && <LoadingState label="Loading milestones…" />}
      {error && <ErrorState message={error} onRetry={refetch} />}

      {!loading && !error && milestones.length === 0 && (
        <Card>
          <EmptyState
            icon="✓"
            title="Nothing waiting"
            description={
              status === 'submitted'
                ? 'Contractors’ progress photos appear here once our AI has verified them.'
                : 'Nothing matches this filter.'
            }
          />
        </Card>
      )}

      <div className="space-y-4">
        {milestones.map((m) => (
          <MilestoneCard key={m.id} milestone={m} onReview={() => setReviewing(m)} />
        ))}
      </div>

      {reviewing && (
        <ReviewModal
          milestone={reviewing}
          contract={contract.data}
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

/**
 * Warn when the connected wallet is not the contract's admin.
 *
 * Without this the official signs, pays gas, and the transaction reverts with
 * OwnableUnauthorizedAccount — an expensive way to discover you are on the
 * wrong account.
 */
const AdminWalletCheck = ({ contract }) => {
  const { address, onSepolia, available } = useWallet();
  if (!contract || contract.mock) return null;

  if (!available) {
    return (
      <Alert tone="amber" title="MetaMask required" className="mb-5">
        Releasing funds needs a wallet signature. Install MetaMask to approve milestones.
      </Alert>
    );
  }
  if (!address) {
    return (
      <Alert tone="amber" title="Connect your wallet" className="mb-5">
        You can review milestones, but releasing funds needs your wallet connected.
      </Alert>
    );
  }
  if (!onSepolia) {
    return (
      <Alert tone="red" title="Wrong network" className="mb-5">
        The escrow contract is on Sepolia. Switch networks before approving anything.
      </Alert>
    );
  }
  if (address.toLowerCase() !== contract.admin?.toLowerCase()) {
    return (
      <Alert tone="red" title="This wallet cannot release funds" className="mb-5">
        The escrow contract only accepts transactions from{' '}
        <span className="font-mono font-semibold">{shortAddress(contract.admin, 6)}</span>, but you
        are connected as{' '}
        <span className="font-mono font-semibold">{shortAddress(address, 6)}</span>. Switch
        accounts in MetaMask.
      </Alert>
    );
  }
  return (
    <Alert tone="teal" className="mb-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          Connected as the escrow administrator. Payments you approve will be signed by{' '}
          <span className="font-mono font-semibold">{shortAddress(address, 6)}</span>.
        </span>
        <EtherscanLink address={contract.contractAddress} label="escrow contract" compact />
      </div>
    </Alert>
  );
};

// ---------------------------------------------------------------------------

const MilestoneCard = ({ milestone: m, onReview }) => {
  const ai = m.aiVerificationResult;
  const needsDecision = m.status === 'submitted' || m.status === 'ai_rejected';

  return (
    <Card
      className={cx(
        'overflow-hidden',
        m.status === 'submitted' && 'border-l-4 border-l-amber-500',
        m.status === 'ai_rejected' && 'border-l-4 border-l-red-500',
        m.status === 'paid' && 'border-l-4 border-l-emerald-500'
      )}
    >
      <div className="flex flex-col gap-4 p-5 sm:flex-row">
        {m.progressImageUrl && (
          <img
            src={m.progressImageUrl}
            alt="Progress"
            loading="lazy"
            className="h-32 w-full shrink-0 rounded-lg object-cover sm:w-40"
          />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {m.project?.title ?? 'Project'}
            </h3>
            <StatusBadge status={m.status} />
            <Badge tone="slate">
              Stage {m.number} · {m.fundPercentage}%
            </Badge>
          </div>

          <p className="mt-1.5 text-sm text-slate-700 dark:text-slate-300">{m.description}</p>

          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
            <div>
              <dt className="inline text-slate-500 dark:text-slate-400">Contractor: </dt>
              <dd className="inline font-medium text-slate-900 dark:text-slate-100">
                {m.contractor?.name}
              </dd>
            </div>
            <div>
              <dt className="inline text-slate-500 dark:text-slate-400">Pays: </dt>
              <dd className="inline font-medium text-slate-900 dark:text-slate-100">
                {formatEth(m.amountWei)}
                {m.displayAmount ? ` (${money(m.displayAmount, m.currency)})` : ''}
              </dd>
            </div>
            <div>
              <dt className="inline text-slate-500 dark:text-slate-400">Submitted: </dt>
              <dd className="inline font-medium text-slate-900 dark:text-slate-100">
                {timeAgo(m.submittedAt)}
                {m.submissionCount > 1 ? ` · attempt ${m.submissionCount}` : ''}
              </dd>
            </div>
          </dl>

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
                AI: {ai.looksComplete ? 'looks complete' : 'could not confirm'} · confidence{' '}
                {confidencePercent(ai.confidence)} · quality {ai.workQuality}
              </p>
              <p className="mt-1 leading-relaxed">{ai.assessment}</p>
              {ai.concerns?.length > 0 && (
                <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                  {ai.concerns.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {m.transactionHash && (
            <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3 dark:border-slate-800">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Paid {timeAgo(m.paidAt)}
                {m.approvedByWallet ? ` by ${shortAddress(m.approvedByWallet)}` : ''}
              </span>
              <EtherscanLink hash={m.transactionHash} label="payment transaction" compact />
            </div>
          )}

          {m.aiRejectionOverridden && (
            <Alert tone="amber" title="Approved despite the AI assessment" className="mt-3">
              {m.overrideJustification}
            </Alert>
          )}
        </div>

        {needsDecision && (
          <div className="shrink-0">
            <Button onClick={onReview}>Review</Button>
          </div>
        )}
      </div>
    </Card>
  );
};

// ---------------------------------------------------------------------------

const ReviewModal = ({ milestone: m, contract, onClose, onDone }) => {
  const { address, onSepolia, sendPrepared } = useWallet();
  const toast = useToast();

  const [step, setStep] = useState(null);
  const [error, setError] = useState(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [justification, setJustification] = useState('');

  const ai = m.aiVerificationResult;
  const needsOverride = m.status === 'ai_rejected';
  const isAdminWallet =
    contract?.mock || address?.toLowerCase() === contract?.admin?.toLowerCase();
  const canSign = Boolean(address) && onSepolia && isAdminWallet;

  /**
   * The three-step release.
   *
   * Each failure mode is distinguished, because they need different responses
   * from the official: a cancelled signature is not an error, a prepare failure
   * means the milestone changed underneath them, and a confirm failure after a
   * successful broadcast means the money HAS moved and only our record is
   * behind — which must not be reported as a failure.
   */
  const release = async () => {
    setError(null);
    /**
     * The connected wallet goes with the request so the server simulates the
     * release as the account that will actually sign it. Without it the dry
     * run was made by no one, and an owner-only contract naturally refused.
     */
    const overridePayload = needsOverride
      ? { overrideAiRejection: true, justification, walletAddress: address }
      : { walletAddress: address };

    let prepared;
    try {
      setStep('preparing');
      prepared = await adminApi.prepareRelease(m.id, overridePayload);
    } catch (err) {
      setStep(null);
      setError(err.userMessage ?? 'Could not prepare the transaction.');
      return;
    }

    let hash;
    try {
      setStep('signing');
      hash = await sendPrepared(prepared.transaction);
    } catch (err) {
      setStep(null);
      if (err.cancelled) {
        toast.info('Cancelled', 'Nothing was released.');
      } else {
        setError(err.message);
      }
      return;
    }

    try {
      setStep('confirming');
      const result = await adminApi.confirmRelease(m.id, { transactionHash: hash, ...overridePayload });

      toast.chain(
        result.data.projectCompleted ? 'Project complete' : 'Funds released',
        `${formatEth(m.amountWei)} sent to ${m.contractor?.name}.`,
        result.data.explorerUrl
      );
      onDone();
    } catch (err) {
      setStep(null);
      // The transaction may well have succeeded — never imply the money did
      // not move when we only failed to verify it.
      setError(
        `${err.userMessage ?? 'Could not confirm the transaction.'} The transaction ${hash.slice(0, 12)}… may still have succeeded — use Reconcile on the project to re-sync from the chain.`
      );
    }
  };

  const reject = async () => {
    setError(null);
    setStep('rejecting');
    try {
      await adminApi.rejectMilestone(m.id, reason);
      toast.success('Milestone rejected', 'The contractor can submit again.');
      onDone();
    } catch (err) {
      setStep(null);
      setError(err.userMessage ?? 'Could not reject this milestone.');
    }
  };

  const busy = Boolean(step);

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={`Stage ${m.number} — ${m.project?.title ?? 'project'}`}
      description={m.description}
      size="lg"
      footer={
        !busy && (
          <>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            {!rejecting ? (
              <>
                <Button variant="outlineDanger" onClick={() => setRejecting(true)}>
                  Reject
                </Button>
                <Button
                  variant="success"
                  onClick={release}
                  disabled={!canSign || (needsOverride && justification.trim().length < 20)}
                  title={!canSign ? 'Connect the admin wallet on Sepolia first' : undefined}
                >
                  Approve &amp; release {formatEth(m.amountWei)}
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" onClick={() => setRejecting(false)}>
                  Back
                </Button>
                <Button variant="danger" onClick={reject} disabled={reason.trim().length < 10}>
                  Confirm rejection
                </Button>
              </>
            )}
          </>
        )
      }
    >
      <div className="space-y-4">
        {m.progressImageUrl && (
          <img
            src={m.progressImageUrl}
            alt="Submitted progress"
            className="max-h-80 w-full rounded-xl object-cover"
          />
        )}

        {ai && (
          <Alert
            tone={ai.looksComplete ? 'green' : 'red'}
            title={`AI verdict — ${ai.looksComplete ? 'looks complete' : 'could not confirm completion'}`}
          >
            <p>{ai.assessment}</p>
            {ai.concerns?.length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-5">
                {ai.concerns.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs opacity-80">
              Confidence {confidencePercent(ai.confidence)} · same site as the original report:{' '}
              {ai.matchesOriginalIssue === false ? 'no' : 'yes'} · model {ai.model}
            </p>
          </Alert>
        )}

        {m.contractorNote && (
          <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Contractor&apos;s note
            </p>
            <p className="mt-1 text-slate-700 dark:text-slate-300">{m.contractorNote}</p>
          </div>
        )}

        {/* ---------------------------------------------------- the payment */}
        {!rejecting && (
          <div className="rounded-xl border border-brand-200 bg-brand-50 p-4 dark:border-brand-900 dark:bg-brand-950/40">
            <p className="text-xs font-bold tracking-wide text-brand-800 uppercase dark:text-brand-300">
              You are about to release
            </p>
            <p className="mt-1 text-2xl font-bold text-brand-900 dark:text-brand-100">
              {formatEth(m.amountWei)}
            </p>
            <dl className="mt-3 space-y-1 text-xs text-brand-900/80 dark:text-brand-200/80">
              <div className="flex justify-between gap-3">
                <dt>To contractor</dt>
                <dd className="font-medium">{m.contractor?.name}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Wallet</dt>
                <dd className="font-mono">{shortAddress(m.contractor?.walletAddress, 6)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Share of project</dt>
                <dd className="font-medium">{m.fundPercentage}%</dd>
              </div>
              {m.displayAmount && (
                <div className="flex justify-between gap-3">
                  <dt>Equivalent value</dt>
                  <dd className="font-medium">{money(m.displayAmount, m.currency)}</dd>
                </div>
              )}
            </dl>
            <p className="mt-3 text-xs font-medium text-brand-900 dark:text-brand-200">
              You will sign this in MetaMask. Once mined it is irreversible, and the contract
              will refuse to pay this stage a second time.
            </p>
          </div>
        )}

        {/* ------------------------------------------------- AI override box */}
        {needsOverride && !rejecting && (
          <Field
            label="Justification for overriding the AI"
            htmlFor="justification"
            required
            hint="At least 20 characters. Stored on the public record and hashed into the on-chain evidence."
          >
            <textarea
              id="justification"
              rows={3}
              className="input resize-y"
              placeholder="Site inspection on 6 October confirms the carriageway has been properly reinstated; the automated check could not match the camera angle to the original photo."
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              maxLength={1000}
            />
          </Field>
        )}

        {/* ---------------------------------------------------- rejection box */}
        {rejecting && (
          <Field
            label="Why are you rejecting this?"
            htmlFor="reason"
            required
            hint="10–500 characters. Sent to the contractor, who can then resubmit."
          >
            <textarea
              id="reason"
              rows={3}
              className="input resize-y"
              placeholder="The edges have not been sealed and loose material remains. Please complete and submit a new photo."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
            />
          </Field>
        )}

        {!canSign && !rejecting && (
          <Alert tone="amber" title="Cannot sign yet">
            {!address
              ? 'Connect your wallet to release funds.'
              : !onSepolia
                ? 'Switch your wallet to the Sepolia network.'
                : `This wallet is not the escrow administrator (${shortAddress(contract?.admin, 6)}).`}
          </Alert>
        )}

        {busy && (
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
            <Spinner size="md" className="text-brand-600" />
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {RELEASE_STEPS[step] ?? 'Working…'}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {step === 'signing'
                  ? 'Open MetaMask if it did not come to the front.'
                  : step === 'confirming'
                    ? 'Waiting for the transaction to be mined and verified. Do not close this.'
                    : 'One moment.'}
              </p>
            </div>
          </div>
        )}

        {error && <Alert tone="red" title="That did not work">{error}</Alert>}
      </div>
    </Modal>
  );
};

export default Milestones;
