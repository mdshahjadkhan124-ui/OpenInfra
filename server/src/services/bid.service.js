/**
 * Bidding and project award.
 */
import mongoose from 'mongoose';
import { Bid, BID_STATUS } from '../models/Bid.js';
import { Project, PROJECT_STATUS } from '../models/Project.js';
import { User, ROLES } from '../models/User.js';
import { scoreBid } from './anomaly.service.js';
import { validateSchedule, createMilestonesForAward } from './milestone.service.js';
import { config } from '../config/env.js';
import * as notify from './notification.service.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

const POPULATE_BID = [
  { path: 'contractor', select: 'name email walletAddress' },
  { path: 'project', select: 'title status aiEstimatedCost' },
];

/**
 * Submit a bid on an open project.
 *
 * The anomaly verdict is computed here, once, and frozen onto the bid — see
 * the Bid model header for why it is not derived on read.
 */
export const submitBid = async (
  contractor,
  projectId,
  { bidAmount, proposal, estimatedDays, walletAddress } = {}
) => {
  const project = await Project.findById(projectId);
  if (!project) throw new NotFoundError('Project not found.');

  // --- Is this project biddable at all? ---------------------------------
  if (project.status !== PROJECT_STATUS.OPEN) {
    throw new ConflictError(
      `This project is '${project.status}' and is no longer accepting bids.`
    );
  }
  if (!project.isAcceptingBids) {
    throw new ConflictError('The bidding deadline for this project has passed.');
  }

  // --- Conflict of interest ---------------------------------------------
  // Reports can only be filed by citizens, so this should be unreachable —
  // but a role can change, and someone bidding to repair the problem they
  // themselves reported would undermine the whole point of the platform.
  if (project.reporter?.toString() === contractor.id) {
    throw new ForbiddenError('You cannot bid on a project arising from your own report.');
  }

  // --- Payout address ----------------------------------------------------
  // Required now rather than at award time: milestone funds are released to
  // this address on-chain, and discovering it is missing after the escrow is
  // funded would strand the money.
  const payoutAddress = (walletAddress ?? contractor.walletAddress)?.toLowerCase() ?? null;
  if (!payoutAddress) {
    throw new BadRequestError(
      'Add a wallet address to your account before bidding — milestone payments are released to it on-chain.'
    );
  }

  // --- Already bid? ------------------------------------------------------
  const existing = await Bid.findOne({
    project: project._id,
    contractor: contractor.id,
    status: { $in: [BID_STATUS.PENDING, BID_STATUS.ACCEPTED] },
  });
  if (existing) {
    throw new ConflictError(
      'You already have a live bid on this project. Withdraw it before submitting another.'
    );
  }

  // --- Score it ----------------------------------------------------------
  const estimate = project.aiEstimatedCost;
  const verdict = scoreBid(bidAmount, estimate);

  const bid = await Bid.create({
    project: project._id,
    contractor: contractor.id,
    bidAmount,
    currency: estimate.currency,
    proposal: proposal ?? null,
    estimatedDays: estimatedDays ?? null,
    walletAddress: payoutAddress,
    anomaly: {
      band: verdict.level,
      benchmarkAmount: estimate.maxAmount,
      expectedAmount: estimate.amount,
      thresholdAmount: verdict.threshold,
      marginPercent: verdict.marginPercent,
      deviationPercent: verdict.deviationPercent,
      deviationFromExpectedPercent: verdict.deviationFromExpectedPercent,
      basis: verdict.basis,
      explanation: verdict.explanation,
      scoredAt: new Date(),
    },
  });

  logger.info(
    `Bid ${bid.id} on project ${project.id}: ${estimate.currency} ${bidAmount} ` +
      `(band ${verdict.level}${verdict.isFlagged ? ', FLAGGED' : ''})`
  );

  // --- Notifications (PHASE 8 transport) ---------------------------------
  const admins = await User.find({ role: ROLES.ADMIN, isActive: true }).select('name email');
  if (admins.length > 0) {
    notify.bidReceived({ admins, project, bid, contractor });
    if (bid.isFlagged) notify.bidFlagged({ admins, project, bid, contractor });
  }
  notify.bidSubmitted({ contractor, project, bid });

  return bid;
};

/**
 * All bids on a project, for the admin review table.
 *
 * Sorted flagged-first, then cheapest. The admin's job is to spot the
 * anomalies, so they lead — and within each group the cheapest offer is the
 * one most likely to be awarded.
 */
export const listBidsForProject = async (projectId, { status } = {}) => {
  const project = await Project.findById(projectId);
  if (!project) throw new NotFoundError('Project not found.');

  const filter = { project: project._id };
  if (status && status !== 'all') filter.status = status;

  const bids = await Bid.find(filter)
    .sort({ isFlagged: -1, bidAmount: 1 })
    .populate('contractor', 'name email walletAddress');

  const live = bids.filter((b) => b.status !== BID_STATUS.WITHDRAWN);
  const amounts = live.map((b) => b.bidAmount);

  return {
    project: {
      id: project.id,
      title: project.title,
      status: project.status,
      aiEstimatedCost: project.aiEstimatedCost,
      biddingBenchmark: project.biddingBenchmark,
      isAcceptingBids: project.isAcceptingBids,
      awardedBid: project.awardedBid,
    },
    bids: bids.map((b) => b.toJSON()),
    summary: {
      total: bids.length,
      live: live.length,
      flagged: live.filter((b) => b.isFlagged).length,
      lowest: amounts.length > 0 ? Math.min(...amounts) : null,
      highest: amounts.length > 0 ? Math.max(...amounts) : null,
    },
  };
};

/** A contractor's own bids across all projects. */
export const listBidsByContractor = async (contractorId, { status, page = 1, limit = 20 } = {}) => {
  const filter = { contractor: contractorId };
  if (status && status !== 'all') filter.status = status;

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);

  const [bids, total] = await Promise.all([
    Bid.find(filter)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .populate('project', 'title status aiEstimatedCost location'),
    Bid.countDocuments(filter),
  ]);

  return {
    bids: bids.map((b) => b.toJSON()),
    meta: { total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) || 1 },
  };
};

/** Withdraw a pending bid. Only the bid's own contractor may do this. */
export const withdrawBid = async (bidId, contractor) => {
  const bid = await Bid.findById(bidId);
  if (!bid) throw new NotFoundError('Bid not found.');

  if (bid.contractor.toString() !== contractor.id) {
    // 404 rather than 403: confirming the bid exists would leak a competitor's activity.
    throw new NotFoundError('Bid not found.');
  }
  if (bid.status === BID_STATUS.ACCEPTED) {
    throw new ConflictError('An awarded bid cannot be withdrawn.');
  }
  if (bid.status !== BID_STATUS.PENDING) {
    throw new ConflictError(`This bid is already '${bid.status}'.`);
  }

  bid.status = BID_STATUS.WITHDRAWN;
  bid.withdrawnAt = new Date();
  await bid.save();

  logger.info(`Bid ${bid.id} withdrawn by its contractor.`);
  return bid;
};

/**
 * Award a project to a bid.
 *
 * Transactional, because four documents have to move together: the winning
 * bid, every losing bid, and the project. A partial application would leave a
 * project awarded with no accepted bid, or two accepted bids on one project —
 * and the next step locks real funds against this decision.
 *
 * Funds are NOT locked here. Phase 6 deposits them from the admin's wallet;
 * this only records the decision and leaves the escrow fields at their
 * defaults for that step to fill.
 */
export const awardProject = async (projectId, bidId, admin, { milestones, escrowAmountEth } = {}) => {
  const project = await Project.findById(projectId);
  if (!project) throw new NotFoundError('Project not found.');

  if (project.status !== PROJECT_STATUS.OPEN) {
    throw new ConflictError(
      `This project is already '${project.status}' and cannot be awarded again.`
    );
  }

  const bid = await Bid.findById(bidId).populate('contractor', 'name email walletAddress');
  if (!bid) throw new NotFoundError('Bid not found.');

  if (bid.project.toString() !== project._id.toString()) {
    throw new BadRequestError('That bid does not belong to this project.');
  }
  if (bid.status !== BID_STATUS.PENDING) {
    throw new ConflictError(`That bid is '${bid.status}' and cannot be awarded.`);
  }
  if (!bid.walletAddress) {
    throw new ValidationError(
      'That bid has no payout wallet address, so milestone funds could not be released to it.'
    );
  }
  if (!bid.contractor?.isActive && bid.contractor?.isActive !== undefined) {
    throw new ConflictError('That contractor account is deactivated.');
  }

  // Validate the milestone schedule BEFORE the award transaction. A schedule
  // whose percentages do not sum to 100 would leave funds permanently
  // unreleasable, because the escrow contract has no withdrawal function.
  const schedule = validateSchedule(milestones);
  const escrowEth = String(escrowAmountEth ?? config.chain.defaultEscrowEth);
  if (!/^\d+(\.\d+)?$/.test(escrowEth) || Number(escrowEth) <= 0) {
    throw new ValidationError('escrowAmountEth must be a positive decimal number of ETH.', {
      details: [{ field: 'escrowAmountEth', message: `Received '${escrowEth}'.` }],
    });
  }

  const session = await mongoose.startSession();
  let losingBids = [];
  let createdMilestones = [];

  try {
    await session.withTransaction(async () => {
      // Winner.
      bid.status = BID_STATUS.ACCEPTED;
      bid.decidedBy = admin.id;
      bid.decidedAt = new Date();
      await bid.save({ session });

      // Everyone else still pending.
      losingBids = await Bid.find(
        { project: project._id, _id: { $ne: bid._id }, status: BID_STATUS.PENDING },
        null,
        { session }
      ).populate('contractor', 'name email');

      await Bid.updateMany(
        { project: project._id, _id: { $ne: bid._id }, status: BID_STATUS.PENDING },
        { $set: { status: BID_STATUS.REJECTED, decidedBy: admin.id, decidedAt: new Date() } },
        { session }
      );

      // The project.
      project.status = PROJECT_STATUS.AWARDED;
      project.awardedContractor = bid.contractor._id ?? bid.contractor;
      project.awardedBid = bid._id;
      project.awardedAmount = bid.bidAmount;
      project.awardedAt = new Date();
      await project.save({ session });

      // The milestone schedule is part of the award decision, so it is
      // committed with it. Funding happens afterwards, outside this
      // transaction, because a chain call cannot be rolled back.
      createdMilestones = await createMilestonesForAward({
        project,
        bid,
        schedule,
        escrowAmountEth: escrowEth,
        session,
      });
    });
  } finally {
    await session.endSession();
  }

  logger.info(
    `Project ${project.id} awarded to ${bid.contractor?.email ?? bid.contractor} ` +
      `for ${bid.currency} ${bid.bidAmount}${bid.isFlagged ? ' (a FLAGGED bid)' : ''}; ` +
      `${losingBids.length} other bid(s) rejected.`
  );

  // --- Notifications (PHASE 8 transport) ---------------------------------
  notify.projectAwarded({ contractor: bid.contractor, project, bid });
  for (const losing of losingBids) {
    if (losing.contractor) notify.bidNotSelected({ contractor: losing.contractor, project, bid: losing });
  }

  const reporter = await User.findById(project.reporter).select('name email');
  if (reporter) notify.projectAwardedToReporter({ user: reporter, project, bid });

  // The escrow is NOT funded here any more. Funding needs a signature from the
  // admin's MetaMask, which only the browser can obtain, so awarding records
  // the decision and the UI then walks the official through
  // POST /api/admin/projects/:id/lock-funds/prepare + /confirm.
  return {
    project: await Project.findById(project._id),
    bid,
    rejectedCount: losingBids.length,
    milestones: createdMilestones,
    // Signposts the next step, which is a wallet action rather than an API call.
    nextStep: 'lock_funds',
  };
};

export { POPULATE_BID };
