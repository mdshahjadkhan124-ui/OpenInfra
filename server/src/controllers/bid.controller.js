/**
 * Bid controllers.
 */
import * as bidService from '../services/bid.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';

/**
 * POST /api/bids — submit a bid. Contractor only.
 *
 * A flagged bid is still accepted (201). Flagging is a signal to the admin,
 * not a rejection: the contractor may have seen something the photo did not
 * show, and refusing the submission outright would hide that from the record.
 */
export const submitBid = asyncHandler(async (req, res) => {
  const { projectId, bidAmount, proposal, estimatedDays, walletAddress } = req.body;

  const bid = await bidService.submitBid(req.user, projectId, {
    bidAmount: Number(bidAmount),
    proposal,
    estimatedDays: estimatedDays !== undefined ? Number(estimatedDays) : null,
    walletAddress,
  });

  return sendSuccess(res, {
    statusCode: 201,
    message: bid.isFlagged
      ? 'Bid submitted. It exceeds the assessed cost range and has been flagged for review.'
      : 'Bid submitted successfully.',
    data: { bid: bid.toJSON() },
  });
});

/** GET /api/bids/mine — the caller's own bids. Contractor only. */
export const listMyBids = asyncHandler(async (req, res) => {
  const { status, page, limit } = req.query;
  const { bids, meta } = await bidService.listBidsByContractor(req.user.id, { status, page, limit });

  return sendSuccess(res, { message: 'Bids retrieved.', data: { bids }, meta });
});

/** PATCH /api/bids/:id/withdraw — contractor withdraws their own pending bid. */
export const withdrawBid = asyncHandler(async (req, res) => {
  const bid = await bidService.withdrawBid(req.params.id, req.user);
  return sendSuccess(res, { message: 'Bid withdrawn.', data: { bid: bid.toJSON() } });
});

/**
 * GET /api/admin/projects/:id/bids — every bid on a project. Admin only.
 *
 * Returned flagged-first, then cheapest, with a summary so the UI can show
 * "3 bids, 1 flagged" without recomputing.
 */
export const listBidsForProject = asyncHandler(async (req, res) => {
  const result = await bidService.listBidsForProject(req.params.id, { status: req.query.status });
  return sendSuccess(res, { message: 'Bids retrieved.', data: result });
});

/** POST /api/admin/projects/:id/award — award the project to a bid. Admin only. */
export const awardProject = asyncHandler(async (req, res) => {
  const { project, bid, rejectedCount, milestones, nextStep } = await bidService.awardProject(
    req.params.id,
    req.body.bidId,
    req.user,
    { milestones: req.body.milestones, escrowAmountEth: req.body.escrowAmountEth }
  );

  const flaggedNote = bid.isFlagged ? ' Note that the winning bid was flagged as anomalous.' : '';

  return sendSuccess(res, {
    message: `Project awarded. Lock the escrow funds from your wallet to begin work.${flaggedNote}`,
    data: {
      project: project.toJSON(),
      bid: bid.toJSON(),
      rejectedBids: rejectedCount,
      milestones: milestones.map((m) => m.toJSON()),
      nextStep,
    },
  });
});
