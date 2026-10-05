/**
 * Milestone controllers.
 */
import * as milestoneService from '../services/milestone.service.js';
import * as chain from '../services/chain.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';

// ---------------------------------------------------------------------------
// Contractor
// ---------------------------------------------------------------------------

/**
 * POST /api/milestones/:id/progress — upload a progress photo. Contractor only.
 *
 * Returns 200 whether or not the AI accepts it: the submission was recorded
 * either way, and the outcome is in `status`. An AI rejection is feedback, not
 * a client error — the contractor can read the concerns and resubmit.
 */
export const submitProgress = asyncHandler(async (req, res) => {
  const milestone = await milestoneService.submitProgress(req.params.id, req.user, {
    file: req.file,
    note: req.body.note,
  });

  const aiPassed = milestone.status === 'submitted';

  return sendSuccess(res, {
    message: aiPassed
      ? 'Progress submitted. Our AI verified the work and an official will review it shortly.'
      : 'Progress received, but our AI could not confirm the work is complete. Review the notes and submit a clearer photo.',
    data: { milestone: milestone.toJSON() },
  });
});

/** GET /api/milestones/mine — the caller's own milestones. Contractor only. */
export const listMyMilestones = asyncHandler(async (req, res) => {
  const milestones = await milestoneService.listMilestonesForContractor(req.user.id, {
    status: req.query.status,
  });
  return sendSuccess(res, { message: 'Milestones retrieved.', data: { milestones } });
});

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/** GET /api/milestones/project/:projectId — the schedule and its progress. */
export const listForProject = asyncHandler(async (req, res) => {
  const result = await milestoneService.listMilestonesForProject(req.params.projectId);
  return sendSuccess(res, { message: 'Milestones retrieved.', data: result });
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

/** GET /api/admin/milestones — the review queue. Defaults to submitted. */
export const listForReview = asyncHandler(async (req, res) => {
  const milestones = await milestoneService.listMilestonesForReview({ status: req.query.status });
  return sendSuccess(res, { message: 'Milestones retrieved.', data: { milestones } });
});

/**
 * POST /api/admin/milestones/:id/approve — approve and release the funds.
 *
 * This is the endpoint that moves real money. It is synchronous: it waits for
 * the transaction to be mined so the response can carry the hash, which is
 * what the citizen's email and the public dashboard are built around.
 */
export const approveMilestone = asyncHandler(async (req, res) => {
  const { milestone, project, explorerUrl, projectCompleted } = await milestoneService.approveAndRelease(
    req.params.id,
    req.user,
    { overrideAiRejection: req.body?.overrideAiRejection === true, justification: req.body?.justification }
  );

  const overrideNote = milestone.aiRejectionOverridden
    ? ' This approval overrode the automated assessment and is recorded as such.'
    : '';

  return sendSuccess(res, {
    message:
      (projectCompleted
        ? 'Milestone paid. All milestones are now complete and the project is closed.'
        : 'Milestone approved and funds released to the contractor.') + overrideNote,
    data: {
      milestone: milestone.toJSON(),
      transactionHash: milestone.transactionHash,
      explorerUrl,
      projectCompleted,
      project: {
        id: project.id,
        status: project.status,
        totalLockedFunds: project.totalLockedFunds,
        totalReleasedFunds: project.totalReleasedFunds,
      },
    },
  });
});

/** PATCH /api/admin/milestones/:id/reject — decline a submitted milestone. */
export const rejectMilestone = asyncHandler(async (req, res) => {
  const milestone = await milestoneService.rejectMilestone(req.params.id, req.user, req.body.reason);
  return sendSuccess(res, {
    message: 'Milestone rejected. The contractor can submit again.',
    data: { milestone: milestone.toJSON() },
  });
});

/** POST /api/admin/projects/:id/lock-funds — retry escrow funding. */
export const lockFunds = asyncHandler(async (req, res) => {
  const { project, chain: receipt } = await milestoneService.lockProjectFunds(req.params.id, req.user);

  return sendSuccess(res, {
    message: 'Escrow funded. The contractor can now submit progress.',
    data: {
      project: project.toJSON(),
      transactionHash: receipt.transactionHash,
      explorerUrl: chain.explorerTxUrl(receipt.transactionHash),
    },
  });
});

/**
 * POST /api/admin/projects/:id/reconcile — re-sync against the chain.
 *
 * The chain is the authority. A release can be mined after the backend has
 * given up on it, leaving a milestone stuck reading 'approving' while the
 * contractor has actually been paid.
 */
export const reconcile = asyncHandler(async (req, res) => {
  const result = await milestoneService.reconcileProject(req.params.id);
  return sendSuccess(res, {
    message: result.corrections.length > 0 ? 'Reconciled with the chain.' : 'Already in sync with the chain.',
    data: result,
  });
});

/** GET /api/admin/escrow-wallet — balance of the wallet that pays gas. */
export const escrowWalletStatus = asyncHandler(async (req, res) => {
  const status = await chain.getEscrowWalletStatus();
  return sendSuccess(res, {
    message: 'Escrow wallet status.',
    data: { ...status, explorerUrl: chain.explorerAddressUrl(status.address) },
  });
});
