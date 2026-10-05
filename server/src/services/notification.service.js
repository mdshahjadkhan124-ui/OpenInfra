/**
 * Notification service — ONE place every platform email is sent from.
 *
 * Phase 8 replaces the body of `dispatch()` with a real Nodemailer transport
 * and HTML templates. Everything above it is already final: each event gets a
 * named function with a typed-ish payload, and the rest of the codebase calls
 * only those names. That is the whole point of landing this file in Phase 3
 * rather than Phase 8 — services call `notify.reportRejected(...)` from the
 * start, so Phase 8 is a transport swap, not a hunt through five services for
 * places that should have sent mail.
 *
 * Two rules every caller relies on:
 *
 *   1. **Notifications never break the request.** A dead SMTP server must not
 *      turn a successfully-filed report into a 500. Every dispatch is wrapped
 *      so a failure is logged and swallowed.
 *   2. **Callers do not await.** These are fire-and-forget; the citizen should
 *      not wait on Gmail's latency to see their report was accepted.
 */
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Single choke point for delivery.
 *
 * PHASE 8: build the Nodemailer transport here, render `event` to an HTML
 * template, and send to `to`. Until then it logs, so the event sequence is
 * visible and testable without a mail server.
 */
const dispatch = async ({ event, to, subject, data }) => {
  if (!config.email.ready) {
    logger.debug(`[notify:pending-transport] ${event} -> ${to} :: ${subject}`);
    return { delivered: false, reason: 'transport-not-configured' };
  }

  // PHASE 8: replace with the real send.
  logger.debug(`[notify:stub] ${event} -> ${to} :: ${subject}`);
  return { delivered: false, reason: 'not-implemented-until-phase-8' };
};

/**
 * Wrap a dispatch so it can never reject into a caller's request path.
 * Returns a promise the caller is free to ignore.
 */
const safeDispatch = (payload) =>
  dispatch(payload).catch((err) => {
    logger.error(`Notification '${payload.event}' to ${payload.to} failed:`, err.message);
    return { delivered: false, reason: 'error' };
  });

const appUrl = (path) => `${config.clientUrl}${path}`;

// ---------------------------------------------------------------------------
// Phase 3 — reporting
// ---------------------------------------------------------------------------

/** A report passed the AI relevance gate and is queued for admin review. */
export const reportReceived = ({ user, report }) =>
  safeDispatch({
    event: 'report.received',
    to: user.email,
    subject: 'We received your infrastructure report',
    data: {
      name: user.name,
      reportId: report.id,
      description: report.description,
      location: report.location?.address,
      estimatedCost: report.aiCostEstimate?.amount,
      currency: report.aiCostEstimate?.currency,
      severity: report.aiCostEstimate?.severity,
      link: appUrl(`/reports/${report.id}`),
    },
  });

/**
 * The AI relevance gate rejected the image.
 * `reason` is the model's own explanation, written to be read by the citizen.
 */
export const reportRejected = ({ user, report, reason }) =>
  safeDispatch({
    event: 'report.rejected',
    to: user.email,
    subject: 'About the photo you submitted',
    data: {
      name: user.name,
      reportId: report.id,
      reason,
      link: appUrl(`/reports/${report.id}`),
    },
  });

/** A new report is waiting in the admin review queue. */
export const reportAwaitingReview = ({ admins, report }) =>
  Promise.all(
    admins.map((admin) =>
      safeDispatch({
        event: 'report.awaiting_review',
        to: admin.email,
        subject: 'New infrastructure report awaiting review',
        data: {
          name: admin.name,
          reportId: report.id,
          location: report.location?.address,
          estimatedCost: report.aiCostEstimate?.amount,
          currency: report.aiCostEstimate?.currency,
          severity: report.aiCostEstimate?.severity,
          link: appUrl(`/admin/reports/${report.id}`),
        },
      })
    )
  );

// ---------------------------------------------------------------------------
// Phase 4 — admin review & publication
// ---------------------------------------------------------------------------

/** An admin approved the report; it is eligible to become a public project. */
export const reportApproved = ({ user, report }) =>
  safeDispatch({
    event: 'report.approved',
    to: user.email,
    subject: 'Your infrastructure report has been approved',
    data: {
      name: user.name,
      reportId: report.id,
      location: report.location?.address,
      estimate: report.aiCostEstimate
        ? {
            min: report.aiCostEstimate.minAmount,
            expected: report.aiCostEstimate.amount,
            max: report.aiCostEstimate.maxAmount,
            currency: report.aiCostEstimate.currency,
          }
        : null,
      link: appUrl(`/reports/${report.id}`),
    },
  });

/**
 * An admin rejected the report.
 *
 * Distinct from `report.rejected`, which is the AI relevance gate: this one
 * was a human decision and the citizen deserves to be told which it was.
 */
export const reportRejectedByAdmin = ({ user, report, reason }) =>
  safeDispatch({
    event: 'report.rejected_by_admin',
    to: user.email,
    subject: 'An update on your infrastructure report',
    data: {
      name: user.name,
      reportId: report.id,
      reason,
      link: appUrl(`/reports/${report.id}`),
    },
  });

/** The citizen's report is now a public project open for bidding. */
export const projectPublished = ({ user, project }) =>
  safeDispatch({
    event: 'project.published',
    to: user.email,
    subject: 'Your report is now an open public project',
    data: {
      name: user.name,
      projectId: project.id,
      title: project.title,
      estimate: {
        min: project.aiEstimatedCost.minAmount,
        expected: project.aiEstimatedCost.amount,
        max: project.aiEstimatedCost.maxAmount,
        currency: project.aiEstimatedCost.currency,
      },
      link: appUrl(`/transparency/projects/${project.id}`),
    },
  });

/** Contractors are told a new project is open for bids. */
export const projectOpenForBids = ({ contractors, project }) =>
  Promise.all(
    contractors.map((contractor) =>
      safeDispatch({
        event: 'project.open_for_bids',
        to: contractor.email,
        subject: `New public project open for bidding: ${project.title}`,
        data: {
          name: contractor.name,
          projectId: project.id,
          title: project.title,
          location: project.location?.address,
          estimate: {
            min: project.aiEstimatedCost.minAmount,
            expected: project.aiEstimatedCost.amount,
            max: project.aiEstimatedCost.maxAmount,
            currency: project.aiEstimatedCost.currency,
          },
          bidsCloseAt: project.bidsCloseAt,
          link: appUrl(`/contractor/projects/${project.id}`),
        },
      })
    )
  );

// ---------------------------------------------------------------------------
// Phase 5 — bidding & award
// ---------------------------------------------------------------------------

const money = (amount, currency) => ({ amount, currency });

/** Confirmation to the contractor that their bid landed. */
export const bidSubmitted = ({ contractor, project, bid }) =>
  safeDispatch({
    event: 'bid.submitted',
    to: contractor.email,
    subject: `Bid received for ${project.title}`,
    data: {
      name: contractor.name,
      projectId: project.id,
      title: project.title,
      bid: money(bid.bidAmount, bid.currency),
      // Told plainly, so a contractor is never surprised by a flag later.
      flagged: bid.isFlagged,
      anomalyExplanation: bid.anomaly?.explanation,
      link: appUrl(`/contractor/bids/${bid.id}`),
    },
  });

/** A new bid is in; admins are told regardless of band. */
export const bidReceived = ({ admins, project, bid, contractor }) =>
  Promise.all(
    admins.map((admin) =>
      safeDispatch({
        event: 'bid.received',
        to: admin.email,
        subject: `New bid on ${project.title}`,
        data: {
          name: admin.name,
          projectId: project.id,
          title: project.title,
          contractorName: contractor.name,
          bid: money(bid.bidAmount, bid.currency),
          benchmark: money(bid.anomaly?.benchmarkAmount, bid.currency),
          band: bid.anomaly?.band,
          link: appUrl(`/admin/projects/${project.id}/bids`),
        },
      })
    )
  );

/**
 * A bid breached the anomaly threshold.
 *
 * Sent as its own event rather than a flag on bid.received, so it can be
 * routed differently later — digest the routine ones, alert on these.
 */
export const bidFlagged = ({ admins, project, bid, contractor }) =>
  Promise.all(
    admins.map((admin) =>
      safeDispatch({
        event: 'bid.flagged',
        to: admin.email,
        subject: `Anomalous bid flagged on ${project.title}`,
        data: {
          name: admin.name,
          projectId: project.id,
          title: project.title,
          contractorName: contractor.name,
          bid: money(bid.bidAmount, bid.currency),
          band: bid.anomaly?.band,
          benchmark: money(bid.anomaly?.benchmarkAmount, bid.currency),
          threshold: money(bid.anomaly?.thresholdAmount, bid.currency),
          deviationPercent: bid.anomaly?.deviationPercent,
          explanation: bid.anomaly?.explanation,
          link: appUrl(`/admin/projects/${project.id}/bids`),
        },
      })
    )
  );

/** The winning contractor. */
export const projectAwarded = ({ contractor, project, bid }) =>
  safeDispatch({
    event: 'project.awarded',
    to: contractor.email,
    subject: `You have been awarded: ${project.title}`,
    data: {
      name: contractor.name,
      projectId: project.id,
      title: project.title,
      awarded: money(bid.bidAmount, bid.currency),
      walletAddress: bid.walletAddress,
      link: appUrl(`/contractor/projects/${project.id}`),
    },
  });

/** Everyone who did not win. */
export const bidNotSelected = ({ contractor, project, bid }) =>
  safeDispatch({
    event: 'bid.not_selected',
    to: contractor.email,
    subject: `Outcome of your bid for ${project.title}`,
    data: {
      name: contractor.name,
      projectId: project.id,
      title: project.title,
      bid: money(bid.bidAmount, bid.currency),
      link: appUrl(`/contractor/bids/${bid.id}`),
    },
  });

/** The citizen who reported the problem learns work has been commissioned. */
export const projectAwardedToReporter = ({ user, project, bid }) =>
  safeDispatch({
    event: 'project.awarded_reporter',
    to: user.email,
    subject: `Work has been commissioned for your report`,
    data: {
      name: user.name,
      projectId: project.id,
      title: project.title,
      awarded: money(bid.bidAmount, bid.currency),
      link: appUrl(`/transparency/projects/${project.id}`),
    },
  });

// ---------------------------------------------------------------------------
// Later phases — signatures land with the feature that fires them.
//
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Phase 7 — milestones, verification and on-chain payment
// ---------------------------------------------------------------------------

/** The escrow for an awarded project has been funded on-chain. */
export const escrowFunded = ({ contractor, project, transactionHash, explorerUrl }) =>
  safeDispatch({
    event: 'escrow.funded',
    to: contractor.email,
    subject: `Funds are now in escrow for ${project.title}`,
    data: {
      name: contractor.name,
      projectId: project.id,
      title: project.title,
      transactionHash,
      explorerUrl,
      link: appUrl(`/contractor/projects/${project.id}`),
    },
  });

/** A contractor's progress photo passed the AI gate and awaits a decision. */
export const milestoneSubmitted = ({ admins, project, milestone, contractor }) =>
  Promise.all(
    admins.map((admin) =>
      safeDispatch({
        event: 'milestone.submitted',
        to: admin.email,
        subject: `Milestone ${milestone.number} submitted for ${project.title}`,
        data: {
          name: admin.name,
          projectId: project.id,
          title: project.title,
          contractorName: contractor.name,
          milestoneNumber: milestone.number,
          milestoneDescription: milestone.description,
          fundPercentage: milestone.fundPercentage,
          progressImageUrl: milestone.progressImageUrl,
          aiAssessment: milestone.aiVerificationResult?.assessment,
          aiConfidence: milestone.aiVerificationResult?.confidence,
          workQuality: milestone.aiVerificationResult?.workQuality,
          link: appUrl(`/admin/milestones/${milestone.id}`),
        },
      })
    )
  );

/**
 * Gemini judged the work incomplete, so it never reached the admin's queue.
 * The contractor is told exactly what was found wanting, and may resubmit.
 */
export const milestoneAiRejected = ({ contractor, project, milestone, verification }) =>
  safeDispatch({
    event: 'milestone.ai_rejected',
    to: contractor.email,
    subject: `Milestone ${milestone.number} needs another look`,
    data: {
      name: contractor.name,
      projectId: project.id,
      title: project.title,
      milestoneNumber: milestone.number,
      assessment: verification.assessment,
      concerns: verification.concerns,
      matchesOriginalIssue: verification.matchesOriginalIssue,
      canResubmit: true,
      link: appUrl(`/contractor/milestones/${milestone.id}`),
    },
  });

/** An admin declined a submitted milestone. */
export const milestoneRejected = ({ contractor, project, milestone, reason }) =>
  safeDispatch({
    event: 'milestone.rejected',
    to: contractor.email,
    subject: `Milestone ${milestone.number} was not approved`,
    data: {
      name: contractor.name,
      projectId: project.id,
      title: project.title,
      milestoneNumber: milestone.number,
      reason,
      canResubmit: true,
      link: appUrl(`/contractor/milestones/${milestone.id}`),
    },
  });

/**
 * A milestone was approved and paid on-chain.
 *
 * This is the email that makes the platform's claim checkable: the citizen who
 * reported the problem gets the Etherscan link and can confirm the money moved
 * without trusting anything this platform says.
 */
export const milestoneApproved = ({
  contractor,
  reporter,
  project,
  milestone,
  transactionHash,
  explorerUrl,
}) => {
  const payload = {
    projectId: project.id,
    title: project.title,
    milestoneNumber: milestone.number,
    milestoneDescription: milestone.description,
    fundPercentage: milestone.fundPercentage,
    amountWei: milestone.amountWei,
    displayAmount: milestone.displayAmount,
    currency: milestone.currency,
    transactionHash,
    explorerUrl,
  };

  const sends = [
    safeDispatch({
      event: 'milestone.paid.contractor',
      to: contractor.email,
      subject: `Payment released for milestone ${milestone.number}`,
      data: {
        ...payload,
        name: contractor.name,
        link: appUrl(`/contractor/projects/${project.id}`),
      },
    }),
  ];

  if (reporter?.email) {
    sends.push(
      safeDispatch({
        event: 'milestone.paid.citizen',
        to: reporter.email,
        subject: `Progress on your report: milestone ${milestone.number} verified and paid`,
        data: {
          ...payload,
          name: reporter.name,
          // Spelled out in the template: this link is independent proof.
          verifyYourself: explorerUrl,
          link: appUrl(`/transparency/projects/${project.id}`),
        },
      })
    );
  }

  return Promise.all(sends);
};

/** Every milestone paid; the project is finished. */
export const projectCompleted = ({ contractor, reporter, project, explorerUrl }) => {
  const payload = {
    projectId: project.id,
    title: project.title,
    totalReleasedFunds: project.totalReleasedFunds,
    contractExplorerUrl: explorerUrl,
  };

  const sends = [
    safeDispatch({
      event: 'project.completed.contractor',
      to: contractor.email,
      subject: `${project.title} is complete`,
      data: {
        ...payload,
        name: contractor.name,
        link: appUrl(`/contractor/projects/${project.id}`),
      },
    }),
  ];

  if (reporter?.email) {
    sends.push(
      safeDispatch({
        event: 'project.completed.citizen',
        to: reporter.email,
        subject: 'The problem you reported has been fixed',
        data: {
          ...payload,
          name: reporter.name,
          link: appUrl(`/transparency/projects/${project.id}`),
        },
      })
    );
  }

  return Promise.all(sends);
};

// ---------------------------------------------------------------------------
// Aggregate export — kept last so every event above is defined.
// ---------------------------------------------------------------------------

export const notify = {
  reportReceived,
  reportRejected,
  reportAwaitingReview,
  reportApproved,
  reportRejectedByAdmin,
  projectPublished,
  projectOpenForBids,
  bidSubmitted,
  bidReceived,
  bidFlagged,
  projectAwarded,
  bidNotSelected,
  projectAwardedToReporter,
  escrowFunded,
  milestoneSubmitted,
  milestoneAiRejected,
  milestoneRejected,
  milestoneApproved,
  projectCompleted,
};

export default notify;
