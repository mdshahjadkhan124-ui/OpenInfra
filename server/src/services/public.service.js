/**
 * Public, unauthenticated reads for the transparency dashboard.
 *
 * ===========================================================================
 * WHAT IS PUBLISHED, AND WHAT IS NOT
 * ===========================================================================
 *
 * A transparency platform that leaks personal data is a worse problem than an
 * opaque one, so every field here is an explicit decision rather than a
 * `.find()` with whatever the model happens to hold.
 *
 * PUBLISHED:
 *   • The project: title, description, photo, location, status, dates.
 *   • The AI cost assessment in full, including its assumptions. This is the
 *     benchmark bids are judged against; publishing the number while hiding
 *     the reasoning would be worse than publishing neither.
 *   • Every milestone, its share, its AI verdict and its payment transaction.
 *   • The winning contractor's name and payout address. They won public money
 *     and the address is already visible on-chain — concealing it here would
 *     be theatre.
 *   • Every bid AMOUNT and its anomaly band, so the public can see the spread
 *     and how many were flagged.
 *   • The admin wallet that signed each payment, from the verified receipt.
 *
 * NOT PUBLISHED:
 *   • Any email address, ever.
 *   • The reporting citizen's full name. They are credited by first name only:
 *     reporting a pothole should not put your full name on a public ledger
 *     page alongside your neighbourhood.
 *   • LOSING bidders' identities. Their amounts and bands are published, but
 *     the names are not. A losing contractor publicly labelled "flagged" with
 *     no process to contest it is a reputational penalty the platform has no
 *     business imposing — the figure is the accountability, the name would
 *     just be punishment. The winner is named because that is where the money
 *     went.
 *   • Internal review notes, admin user ids, rejection reasons on reports that
 *     never became projects.
 */
import { Project, PROJECT_STATUS } from '../models/Project.js';
import { Milestone, MILESTONE_STATUS } from '../models/Milestone.js';
import { Bid } from '../models/Bid.js';
import { Report } from '../models/Report.js';
import * as chain from './chain.service.js';
import { NotFoundError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

/** First name only. See the header. */
export const creditName = (name) => {
  if (!name) return 'A citizen';
  return String(name).trim().split(/\s+/)[0];
};

/** Shape a project for public consumption. */
export const publicProject = (project) => ({
  id: project.id,
  title: project.title,
  description: project.description,
  imageUrl: project.imageUrl,
  category: project.category,
  status: project.status,

  location: {
    address: project.location?.address ?? null,
    city: project.location?.city ?? null,
    latitude: project.location?.latitude ?? null,
    longitude: project.location?.longitude ?? null,
  },

  // The whole assessment, assumptions included.
  estimate: project.aiEstimatedCost
    ? {
        min: project.aiEstimatedCost.minAmount,
        expected: project.aiEstimatedCost.amount,
        max: project.aiEstimatedCost.maxAmount,
        currency: project.aiEstimatedCost.currency,
        severity: project.aiEstimatedCost.severity,
        confidence: project.aiEstimatedCost.confidence,
        breakdown: project.aiEstimatedCost.breakdown ?? [],
        assumptions: project.aiEstimatedCost.assumptions ?? [],
        source: project.aiEstimatedCost.source,
        producedBy: project.aiEstimatedCost.producedBy,
      }
    : null,

  awarded: project.awardedAmount
    ? {
        amount: project.awardedAmount,
        currency: project.aiEstimatedCost?.currency ?? null,
        contractorName: project.awardedContractor?.name ?? null,
        contractorWallet: project.awardedContractor?.walletAddress ?? null,
        at: project.awardedAt,
      }
    : null,

  escrow: {
    contractAddress: project.smartContractAddress,
    onChainProjectId: project.onChainProjectId,
    lockedWei: project.totalLockedFunds ?? '0',
    releasedWei: project.totalReleasedFunds ?? '0',
    fundingTxHash: project.fundingTxHash,
    fundedByWallet: project.fundedBy,
    contractUrl: chain.explorerAddressUrl(project.smartContractAddress),
    fundingTxUrl: chain.explorerTxUrl(project.fundingTxHash),
  },

  reportedBy: creditName(project.reporter?.name),
  publishedAt: project.publishedAt,
  completedAt: project.completedAt,
  bidsCloseAt: project.bidsCloseAt,
  createdAt: project.createdAt,
});

export const publicMilestone = (m) => ({
  number: m.number,
  onChainIndex: m.onChainIndex,
  description: m.description,
  fundPercentage: m.fundPercentage,
  amountWei: m.amountWei,
  displayAmount: m.displayAmount,
  currency: m.currency,
  status: m.status,

  progressImageUrl: m.progressImageUrl,
  submittedAt: m.submittedAt,
  submissionCount: m.submissionCount,

  // The AI verdict is published because it is the justification for the
  // payment. A citizen should be able to see what the machine said, not just
  // that someone approved it.
  aiVerification: m.aiVerificationResult
    ? {
        looksComplete: m.aiVerificationResult.looksComplete,
        confidence: m.aiVerificationResult.confidence,
        assessment: m.aiVerificationResult.assessment,
        concerns: m.aiVerificationResult.concerns ?? [],
        matchesOriginalIssue: m.aiVerificationResult.matchesOriginalIssue,
        workQuality: m.aiVerificationResult.workQuality,
        model: m.aiVerificationResult.model,
      }
    : null,

  // An official overruling the machine is exactly the kind of decision that
  // should be surfaced rather than buried.
  aiRejectionOverridden: m.aiRejectionOverridden ?? false,
  overrideJustification: m.overrideJustification ?? null,

  payment: m.transactionHash
    ? {
        transactionHash: m.transactionHash,
        blockNumber: m.blockNumber,
        paidAt: m.paidAt,
        approvedByWallet: m.approvedByWallet,
        evidenceHash: m.evidenceHash,
        explorerUrl: chain.explorerTxUrl(m.transactionHash),
      }
    : null,
});

/**
 * Bids, with losing bidders anonymised.
 *
 * Ordered cheapest first so the spread is readable, and labelled by position
 * rather than name. The winner is named.
 */
export const publicBids = (bids, winningBidId) => {
  const live = bids.filter((b) => b.status !== 'withdrawn');
  const sorted = [...live].sort((a, b) => a.bidAmount - b.bidAmount);

  let anonCounter = 0;
  return sorted.map((bid) => {
    const isWinner = winningBidId && bid._id.toString() === winningBidId.toString();
    if (!isWinner) anonCounter += 1;

    return {
      amount: bid.bidAmount,
      currency: bid.currency,
      status: bid.status,
      isWinner: Boolean(isWinner),
      // Named only when they won. See the header.
      bidder: isWinner ? (bid.contractor?.name ?? 'Awarded contractor') : `Bidder ${anonCounter}`,
      isFlagged: bid.isFlagged,
      anomaly: bid.anomaly
        ? {
            band: bid.anomaly.band,
            benchmarkAmount: bid.anomaly.benchmarkAmount,
            thresholdAmount: bid.anomaly.thresholdAmount,
            deviationPercent: bid.anomaly.deviationPercent,
            marginPercent: bid.anomaly.marginPercent,
            explanation: bid.anomaly.explanation,
          }
        : null,
      submittedAt: bid.createdAt,
    };
  });
};

// ---------------------------------------------------------------------------
// Platform totals
// ---------------------------------------------------------------------------

/**
 * Headline figures.
 *
 * Money is summed in wei with BigInt, never with $sum — Mongo would overflow
 * a double on 1e18 values and silently return a wrong total, which on this
 * page would be worse than showing nothing.
 */
export const getPlatformStats = async () => {
  const [projects, milestones, reportCount, bidAgg] = await Promise.all([
    Project.find().select('status totalLockedFunds totalReleasedFunds awardedAmount aiEstimatedCost'),
    Milestone.find().select('status amountWei'),
    Report.countDocuments(),
    Bid.aggregate([
      { $match: { status: { $ne: 'withdrawn' } } },
      { $group: { _id: null, total: { $sum: 1 }, flagged: { $sum: { $cond: ['$isFlagged', 1, 0] } } } },
    ]),
  ]);

  const lockedWei = projects.reduce((sum, p) => sum + BigInt(p.totalLockedFunds || '0'), 0n);
  const releasedWei = projects.reduce((sum, p) => sum + BigInt(p.totalReleasedFunds || '0'), 0n);

  const byStatus = (status) => projects.filter((p) => p.status === status).length;

  const awardedProjects = projects.filter((p) => p.awardedAmount);
  const totalAwarded = awardedProjects.reduce((sum, p) => sum + (p.awardedAmount || 0), 0);
  const totalAssessed = awardedProjects.reduce(
    (sum, p) => sum + (p.aiEstimatedCost?.amount || 0),
    0
  );

  return {
    reports: reportCount,
    projects: {
      total: projects.length,
      open: byStatus(PROJECT_STATUS.OPEN),
      awarded: byStatus(PROJECT_STATUS.AWARDED),
      inProgress: byStatus(PROJECT_STATUS.IN_PROGRESS),
      completed: byStatus(PROJECT_STATUS.COMPLETED),
    },
    bids: {
      total: bidAgg[0]?.total ?? 0,
      flagged: bidAgg[0]?.flagged ?? 0,
    },
    milestones: {
      total: milestones.length,
      paid: milestones.filter((m) => m.status === MILESTONE_STATUS.PAID).length,
      awaitingReview: milestones.filter((m) => m.status === MILESTONE_STATUS.SUBMITTED).length,
    },
    funds: {
      lockedWei: lockedWei.toString(),
      releasedWei: releasedWei.toString(),
      remainingWei: (lockedWei - releasedWei).toString(),
    },
    /**
     * What the AI assessment saved, or cost, against what was actually awarded.
     * Published with its own caveat: it compares awarded totals against the
     * expected estimate, which is an indicator rather than an audited figure.
     */
    value: {
      totalAwarded,
      totalAssessed,
      currency: awardedProjects[0]?.aiEstimatedCost?.currency ?? null,
      differencePercent:
        totalAssessed > 0
          ? Number((((totalAwarded - totalAssessed) / totalAssessed) * 100).toFixed(2))
          : null,
    },
    contract: {
      address: process.env.CONTRACT_ADDRESS || null,
      explorerUrl: chain.explorerAddressUrl(process.env.CONTRACT_ADDRESS),
    },
  };
};

// ---------------------------------------------------------------------------
// Project list
// ---------------------------------------------------------------------------

export const listPublicProjects = async ({ status, category, q, sort = 'recent', page = 1, limit = 12 } = {}) => {
  const filter = {};
  if (status && status !== 'all') filter.status = status;
  if (category && category !== 'all') filter.category = category;
  if (q) {
    // Simple text match across the fields a visitor would search by.
    const safe = String(q).slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(safe, 'i');
    filter.$or = [{ title: rx }, { description: rx }, { 'location.address': rx }, { 'location.city': rx }];
  }

  const sorts = {
    recent: { publishedAt: -1 },
    oldest: { publishedAt: 1 },
    highest: { awardedAmount: -1 },
    lowest: { awardedAmount: 1 },
  };

  const safeLimit = Math.min(Math.max(Number(limit) || 12, 1), 48);
  const safePage = Math.max(Number(page) || 1, 1);

  const [projects, total] = await Promise.all([
    Project.find(filter)
      .sort(sorts[sort] ?? sorts.recent)
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .populate('reporter', 'name')
      .populate('awardedContractor', 'name walletAddress'),
    Project.countDocuments(filter),
  ]);

  // Milestone progress for the cards, in one query rather than N.
  const ids = projects.map((p) => p._id);
  const milestones = await Milestone.find({ project: { $in: ids } }).select(
    'project status fundPercentage'
  );

  const progressFor = (projectId) => {
    const own = milestones.filter((m) => m.project.toString() === projectId.toString());
    if (own.length === 0) return null;
    const paid = own.filter((m) => m.status === MILESTONE_STATUS.PAID);
    return {
      total: own.length,
      paid: paid.length,
      percentPaid: Math.round(paid.reduce((s, m) => s + m.fundPercentage, 0)),
    };
  };

  return {
    projects: projects.map((p) => ({ ...publicProject(p), milestoneProgress: progressFor(p._id) })),
    meta: { total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) || 1 },
  };
};

// ---------------------------------------------------------------------------
// Project detail
// ---------------------------------------------------------------------------

export const getPublicProject = async (projectId) => {
  const project = await Project.findById(projectId)
    .populate('reporter', 'name')
    .populate('awardedContractor', 'name walletAddress');

  if (!project) throw new NotFoundError('Project not found.');

  const [milestones, bids, report] = await Promise.all([
    Milestone.find({ project: project._id }).sort({ number: 1 }),
    Bid.find({ project: project._id }).populate('contractor', 'name'),
    Report.findById(project.report).select('imageUrl description aiRelevanceResult createdAt'),
  ]);

  return {
    project: publicProject(project),
    milestones: milestones.map(publicMilestone),
    bids: publicBids(bids, project.awardedBid),
    origin: report
      ? {
          reportedAt: report.createdAt,
          originalPhotoUrl: report.imageUrl,
          originalDescription: report.description,
          aiCategory: report.aiRelevanceResult?.category,
          aiConfidence: report.aiRelevanceResult?.confidence,
          aiReason: report.aiRelevanceResult?.reason,
        }
      : null,
  };
};

/**
 * Read the project's state straight from the chain and compare it with ours.
 *
 * This is the point of the whole dashboard. Anything else on the page is this
 * platform's own claim about itself; this endpoint lets a visitor see that the
 * database agrees with a ledger the platform does not control — and flags it
 * when they disagree, rather than quietly showing the comfortable number.
 *
 * Deliberately a separate request: it depends on a live RPC call, so the page
 * renders instantly and this resolves beside it.
 */
export const verifyAgainstChain = async (projectId) => {
  // Populated: the contractor's wallet is one of the fields compared, and
  // without it the comparison reads empty and reports a false mismatch.
  const project = await Project.findById(projectId).populate('awardedContractor', 'walletAddress');
  if (!project) throw new NotFoundError('Project not found.');

  if (project.onChainProjectId === null || project.onChainProjectId === undefined) {
    return {
      available: false,
      reason: 'This project has no escrow on-chain yet, so there is nothing to compare.',
    };
  }

  let onChain;
  try {
    onChain = await chain.getOnChainProject(project.onChainProjectId);
  } catch (err) {
    logger.warn(`Public chain verification failed for ${projectId}: ${err.message}`);
    return {
      available: false,
      reason: 'The Ethereum network could not be reached just now. Try again shortly.',
    };
  }

  if (!onChain) {
    return {
      available: false,
      reason: 'Chain verification is unavailable in this environment.',
    };
  }

  const milestones = await Milestone.find({ project: project._id }).sort({ number: 1 });

  // Compare each figure the database claims against what the chain says.
  const comparisons = [
    {
      field: 'Total locked',
      ours: project.totalLockedFunds ?? '0',
      chain: onChain.totalWei,
    },
    {
      field: 'Total released',
      ours: project.totalReleasedFunds ?? '0',
      chain: onChain.releasedWei,
    },
    {
      field: 'Contractor address',
      ours: (project.awardedContractor?.walletAddress ?? '').toLowerCase(),
      chain: (onChain.contractor ?? '').toLowerCase(),
    },
  ].map((c) => ({ ...c, matches: String(c.ours) === String(c.chain) }));

  const milestoneComparisons = milestones.map((m) => {
    const onChainMilestone = onChain.milestones[m.onChainIndex];
    const oursPaid = m.status === MILESTONE_STATUS.PAID;
    return {
      number: m.number,
      ours: { paid: oursPaid, amountWei: m.amountWei },
      chain: onChainMilestone
        ? { paid: onChainMilestone.released, amountWei: onChainMilestone.amountWei }
        : null,
      matches: Boolean(
        onChainMilestone &&
          onChainMilestone.released === oursPaid &&
          onChainMilestone.amountWei === m.amountWei
      ),
    };
  });

  const allMatch =
    comparisons.every((c) => c.matches) && milestoneComparisons.every((m) => m.matches);

  return {
    available: true,
    allMatch,
    checkedAt: new Date(),
    contractAddress: project.smartContractAddress,
    onChainProjectId: project.onChainProjectId,
    contractUrl: chain.explorerAddressUrl(project.smartContractAddress),
    comparisons,
    milestones: milestoneComparisons,
    onChain: {
      funded: onChain.funded,
      completed: onChain.completed,
      totalWei: onChain.totalWei,
      releasedWei: onChain.releasedWei,
      remainingWei: onChain.remainingWei,
    },
  };
};

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------

/**
 * Recent on-chain money movements across every project.
 *
 * The front page of the dashboard: concrete, dated, each with a link to a
 * transaction a visitor can open.
 */
export const getRecentActivity = async ({ limit = 15 } = {}) => {
  const safeLimit = Math.min(Math.max(Number(limit) || 15, 1), 50);

  const [payments, fundings] = await Promise.all([
    Milestone.find({ status: MILESTONE_STATUS.PAID, transactionHash: { $ne: null } })
      .sort({ paidAt: -1 })
      .limit(safeLimit)
      .populate('project', 'title')
      .populate('contractor', 'name'),
    Project.find({ fundingTxHash: { $ne: null } })
      .sort({ awardedAt: -1 })
      .limit(safeLimit)
      .select('title fundingTxHash totalLockedFunds awardedAt'),
  ]);

  const events = [
    ...payments.map((m) => ({
      type: 'milestone_paid',
      at: m.paidAt,
      projectId: m.project?._id?.toString(),
      projectTitle: m.project?.title,
      label: `Stage ${m.number} paid to ${m.contractor?.name ?? 'the contractor'}`,
      detail: m.description,
      amountWei: m.amountWei,
      transactionHash: m.transactionHash,
      explorerUrl: chain.explorerTxUrl(m.transactionHash),
    })),
    ...fundings.map((p) => ({
      type: 'escrow_funded',
      at: p.awardedAt,
      projectId: p._id.toString(),
      projectTitle: p.title,
      label: 'Funds locked in escrow',
      detail: null,
      amountWei: p.totalLockedFunds,
      transactionHash: p.fundingTxHash,
      explorerUrl: chain.explorerTxUrl(p.fundingTxHash),
    })),
  ]
    .filter((e) => e.at)
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, safeLimit);

  return { events };
};
