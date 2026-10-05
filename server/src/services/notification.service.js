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
// Later phases — signatures land with the feature that fires them.
//
//   Phase 5: bidReceived, bidFlagged, projectAwarded
//   Phase 7: milestoneSubmitted, milestoneApproved (with Etherscan link),
//            projectCompleted
// ---------------------------------------------------------------------------

export const notify = {
  reportReceived,
  reportRejected,
  reportAwaitingReview,
  reportApproved,
  reportRejectedByAdmin,
  projectPublished,
  projectOpenForBids,
};

export default notify;
