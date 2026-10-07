/**
 * Milestones: definition at award, progress verification, and fund release.
 *
 * This is where the three systems meet — the admin's schedule, Gemini's
 * verdict, and the escrow contract. The ordering rules below exist because two
 * of those are irreversible.
 */
import mongoose from 'mongoose';
import { ethers } from 'ethers';

import { Milestone, MILESTONE_STATUS, RESUBMITTABLE } from '../models/Milestone.js';
import { Project, PROJECT_STATUS } from '../models/Project.js';
import { Report } from '../models/Report.js';
import { User, ROLES } from '../models/User.js';
import * as chain from './chain.service.js';
import { verifyMilestoneImage } from './gemini.service.js';
import { uploadImage, deleteImage } from './upload.service.js';
import * as notify from './notification.service.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/env.js';

/** Percentages must sum to 100. Tolerance covers float representation only. */
const PERCENTAGE_TOLERANCE = 0.01;

/**
 * Validate an admin's milestone schedule.
 *
 * The sum rule is not cosmetic: the escrow contract requires the wei amounts
 * to total exactly the deposit, so a schedule summing to 99% would leave funds
 * permanently unreleasable inside a contract with no withdrawal function.
 */
export const validateSchedule = (milestones) => {
  if (!Array.isArray(milestones) || milestones.length === 0) {
    throw new ValidationError('At least one milestone is required to award a project.', {
      details: [{ field: 'milestones', message: 'Provide between 1 and 20 milestones.' }],
    });
  }
  if (milestones.length > 20) {
    throw new ValidationError('A project can have at most 20 milestones.', {
      details: [{ field: 'milestones', message: `Received ${milestones.length}.` }],
    });
  }

  const details = [];
  milestones.forEach((m, i) => {
    if (!m?.description || String(m.description).trim().length < 5) {
      details.push({
        field: `milestones[${i}].description`,
        message: 'A description of at least 5 characters is required.',
      });
    }
    const pct = Number(m?.fundPercentage);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      details.push({
        field: `milestones[${i}].fundPercentage`,
        message: 'Must be a number greater than 0 and at most 100.',
      });
    }
  });
  if (details.length > 0) throw new ValidationError('Some milestones need attention.', { details });

  const total = milestones.reduce((sum, m) => sum + Number(m.fundPercentage), 0);
  if (Math.abs(total - 100) > PERCENTAGE_TOLERANCE) {
    throw new ValidationError(
      `Milestone percentages must sum to 100%. They currently sum to ${total.toFixed(2)}%.`,
      {
        details: [
          {
            field: 'milestones',
            message:
              'Funds that are not allocated to a milestone could never be released, because the escrow contract has no withdrawal function.',
          },
        ],
      }
    );
  }

  return milestones.map((m) => ({
    description: String(m.description).trim(),
    fundPercentage: Number(m.fundPercentage),
  }));
};

/**
 * Create the milestone documents for a newly awarded project.
 *
 * Called inside the award transaction, before any chain interaction: the
 * schedule is a database decision and must be durable even if the subsequent
 * on-chain funding fails and has to be retried.
 */
export const createMilestonesForAward = async ({ project, bid, schedule, escrowAmountEth, session }) => {
  const totalWei = ethers.parseEther(String(escrowAmountEth));
  const shares = chain.splitByPercentage(
    totalWei,
    schedule.map((m) => m.fundPercentage)
  );

  const docs = schedule.map((m, i) => ({
    project: project._id,
    contractor: bid.contractor._id ?? bid.contractor,
    number: i + 1,
    onChainIndex: i,
    description: m.description,
    fundPercentage: m.fundPercentage,
    amountWei: shares[i].toString(),
    // Display only: the fiat share of the awarded amount, so the UI can show
    // "30% — ₹2,850" next to "0.0012 ETH".
    displayAmount: Math.round((bid.bidAmount * m.fundPercentage) / 100),
    currency: bid.currency,
    status: MILESTONE_STATUS.PENDING,
  }));

  const created = await Milestone.create(docs, { session, ordered: true });

  // The contract rejects a deposit that does not equal the sum exactly, so
  // check here rather than discovering it as a failed transaction.
  const sum = shares.reduce((a, b) => a + b, 0n);
  if (sum !== totalWei) {
    throw new ValidationError(
      `Milestone amounts sum to ${sum} wei but the escrow is ${totalWei} wei.`
    );
  }

  return created;
};

/**
 * Lock the escrow for an awarded project.
 *
 * Separate from awarding on purpose. A blockchain transaction cannot be rolled
 * back into a database transaction, so the award is committed first and the
 * chain call made afterwards. If the chain call fails — RPC down, wallet out
 * of gas — the project stays `awarded` with its schedule intact and this can
 * be retried, rather than losing the admin's decision.
 */
/**
 * Shared preconditions for funding a project's escrow.
 */
const loadFundableProject = async (projectId) => {
  const project = await Project.findById(projectId).populate(
    'awardedContractor',
    'name email walletAddress'
  );
  if (!project) throw new NotFoundError('Project not found.');

  if (project.status === PROJECT_STATUS.OPEN) {
    throw new ConflictError('This project has not been awarded yet.');
  }
  if (project.fundingTxHash) {
    throw new ConflictError('The escrow for this project has already been funded.');
  }
  if (project.status === PROJECT_STATUS.COMPLETED) {
    throw new ConflictError('This project is already complete.');
  }

  const milestones = await Milestone.find({ project: project._id }).sort({ number: 1 });
  if (milestones.length === 0) {
    throw new ConflictError('This project has no milestone schedule to fund.');
  }

  const contractorAddress = project.awardedContractor?.walletAddress;
  if (!contractorAddress) {
    throw new ValidationError('The awarded contractor has no payout wallet address.');
  }

  return { project, milestones, contractorAddress };
};

/**
 * Step 1 of funding: hand the admin's browser an unsigned transaction.
 *
 * The server holds no key, so this is all it can do. Nothing is written to the
 * database here — a prepared transaction the official never signs must leave
 * no trace.
 */
export const prepareLockFunds = async (projectId) => {
  const { project, milestones, contractorAddress } = await loadFundableProject(projectId);

  /**
   * The project may already be funded on-chain even though our record says
   * otherwise. prepare -> sign -> confirm is interruptible: the browser can
   * be closed, or lose its connection, between MetaMask broadcasting the
   * deposit and the backend being told the hash. The money has moved, the
   * contract knows, and only our database is behind.
   *
   * Refusing with "already funded" was the wrong response — it left the
   * project permanently stuck, showing a "lock the funds" prompt that could
   * never succeed. Recovering is both safe and the only useful thing to do:
   * the contract is the authority, so read it and record what it says.
   */
  if (await chain.isAlreadyFundedOnChain(project.id)) {
    logger.warn(
      `Project ${project.id} is funded on-chain but was not recorded; reconciling instead of funding again.`
    );
    const synced = await syncProjectFromChain(projectId);
    return { alreadyFunded: true, reconciled: true, ...synced };
  }

  const amountsWei = milestones.map((m) => m.amountWei);
  const transaction = chain.buildLockFundsTransaction({
    offChainId: project.id,
    contractorAddress,
    amountsWei,
  });

  return {
    transaction,
    project: { id: project.id, title: project.title },
    milestones: milestones.map((m) => ({
      number: m.number,
      description: m.description,
      fundPercentage: m.fundPercentage,
      amountWei: m.amountWei,
    })),
  };
};

/**
 * Step 2 of funding: verify the hash the browser reports, then record it.
 *
 * The hash is checked against the chain — success, our contract, a FundsLocked
 * event — before anything is persisted. A client cannot mark a project funded
 * by inventing a hash.
 */
export const confirmLockFunds = async (projectId, admin, { transactionHash } = {}) => {
  // Idempotent: a repeat of a confirmation that already succeeded is a
  // retry, not an error. Returning 409 here would make a flaky connection
  // look like a failure when the money has demonstrably moved.
  const existing = await Project.findById(projectId);
  if (!existing) throw new NotFoundError('Project not found.');
  if (existing.fundingTxHash) {
    if (existing.fundingTxHash.toLowerCase() === String(transactionHash).toLowerCase()) {
      return {
        project: existing,
        milestones: await Milestone.find({ project: existing._id }).sort({ number: 1 }),
        receipt: { transactionHash: existing.fundingTxHash, alreadyRecorded: true },
      };
    }
    throw new ConflictError('The escrow for this project has already been funded.');
  }

  const { project, milestones } = await loadFundableProject(projectId);

  /**
   * Record the hash BEFORE verifying.
   *
   * Verification waits for the transaction to be mined, which can take a
   * minute or more, and the browser is the only other place this hash exists.
   * Writing it first means an interrupted confirmation leaves a recoverable
   * record instead of a project that is funded on-chain and invisible here.
   */
  project.pendingFundingTxHash = transactionHash;
  await project.save();

  const receipt = await chain.confirmTransaction({
    transactionHash,
    expectEvent: 'FundsLocked',
  });

  const onChainProjectId = await chain.resolveOnChainProjectId(project.id);
  if (onChainProjectId === null) {
    throw new ConflictError(
      'That transaction confirmed, but the escrow contract has no project for this id.'
    );
  }

  const totalWei = milestones.reduce((sum, m) => sum + BigInt(m.amountWei), 0n);

  project.smartContractAddress = config.chain.contractAddress;
  project.onChainProjectId = onChainProjectId;
  project.fundingTxHash = receipt.transactionHash;
  project.pendingFundingTxHash = null; // verified, so no longer pending
  project.totalLockedFunds = totalWei.toString();
  project.status = PROJECT_STATUS.IN_PROGRESS;
  project.fundedBy = receipt.from ?? null;
  await project.save();

  logger.success(
    `Escrow funded for project ${project.id} by ${receipt.from ?? 'admin wallet'}: ` +
      `${ethers.formatEther(totalWei)} ETH, tx ${receipt.transactionHash}`
  );

  notify.escrowFunded({
    contractor: project.awardedContractor,
    project,
    transactionHash: receipt.transactionHash,
    explorerUrl: chain.explorerTxUrl(receipt.transactionHash),
  });

  return { project, milestones, receipt };
};

/**
 * Milestones of a project, in order, for a participant.
 *
 * This returns the FULL milestone records — the AI verdict in detail, the
 * rejection reason, the reviewing admin, and `overrideJustification`, which is
 * an official's internal reasoning for overruling the machine. The public
 * dashboard deliberately redacts those (see public.service.publicMilestone),
 * so this endpoint must not be the back door around it: being signed in as
 * any citizen or as a losing bidder is not a reason to read a competitor's
 * submission history or an admin's internal notes.
 *
 * Restricted to the contractor doing the work and to admins. Anyone else gets
 * a 404 rather than a 403, matching the rest of the codebase: a 403 would
 * confirm the project exists and let an outsider enumerate ids. The public,
 * redacted view of the same project stays available at /api/public.
 */
export const listMilestonesForProject = async (projectId, requester) => {
  const project = await Project.findById(projectId);
  if (!project) throw new NotFoundError('Project not found.');

  const isAdmin = requester?.role === ROLES.ADMIN;
  const isAssignedContractor =
    project.awardedContractor && project.awardedContractor.toString() === requester?.id;

  if (!isAdmin && !isAssignedContractor) {
    throw new NotFoundError('Project not found.');
  }

  const milestones = await Milestone.find({ project: project._id }).sort({ number: 1 });

  const paid = milestones.filter((m) => m.status === MILESTONE_STATUS.PAID);
  return {
    project: {
      id: project.id,
      title: project.title,
      status: project.status,
      smartContractAddress: project.smartContractAddress,
      onChainProjectId: project.onChainProjectId,
      totalLockedFunds: project.totalLockedFunds,
      totalReleasedFunds: project.totalReleasedFunds,
      fundingTxHash: project.fundingTxHash,
      explorerUrl: chain.explorerAddressUrl(project.smartContractAddress),
    },
    milestones: milestones.map((m) => ({
      ...m.toJSON(),
      explorerUrl: chain.explorerTxUrl(m.transactionHash),
    })),
    summary: {
      total: milestones.length,
      paid: paid.length,
      pending: milestones.filter((m) => m.status === MILESTONE_STATUS.PENDING).length,
      awaitingReview: milestones.filter((m) => m.status === MILESTONE_STATUS.SUBMITTED).length,
      percentComplete: milestones.length
        ? Math.round((paid.reduce((s, m) => s + m.fundPercentage, 0) + Number.EPSILON) * 100) / 100
        : 0,
    },
  };
};

/** The admin's review queue: everything awaiting a decision. */
export const listMilestonesForReview = async ({ status = MILESTONE_STATUS.SUBMITTED } = {}) => {
  const filter = status === 'all' ? {} : { status };
  const milestones = await Milestone.find(filter)
    .sort({ submittedAt: 1 })
    .populate('project', 'title location status onChainProjectId')
    .populate('contractor', 'name email walletAddress');

  return milestones.map((m) => ({ ...m.toJSON(), explorerUrl: chain.explorerTxUrl(m.transactionHash) }));
};

/** A contractor's own milestones. */
export const listMilestonesForContractor = async (contractorId, { status } = {}) => {
  const filter = { contractor: contractorId };
  if (status && status !== 'all') filter.status = status;

  const milestones = await Milestone.find(filter)
    .sort({ createdAt: -1 })
    .populate('project', 'title status imageUrl location');

  return milestones.map((m) => ({ ...m.toJSON(), explorerUrl: chain.explorerTxUrl(m.transactionHash) }));
};

const loadMilestone = async (milestoneId, populate = true) => {
  const query = Milestone.findById(milestoneId);
  if (populate) query.populate('project').populate('contractor', 'name email walletAddress');
  const milestone = await query;
  if (!milestone) throw new NotFoundError('Milestone not found.');
  return milestone;
};

/**
 * Contractor submits a progress photo.
 *
 * Gemini sees the ORIGINAL report photo alongside the progress photo, so it
 * can judge whether this is even the same site — without that comparison, a
 * photo of any finished road anywhere would pass.
 */
export const submitProgress = async (milestoneId, contractor, { file, note } = {}) => {
  const milestone = await loadMilestone(milestoneId);

  if (milestone.contractor._id.toString() !== contractor.id) {
    // 404, not 403: confirming the milestone exists would leak another
    // contractor's workload.
    throw new NotFoundError('Milestone not found.');
  }

  const project = milestone.project;
  if (project.status !== PROJECT_STATUS.IN_PROGRESS) {
    throw new ConflictError(
      project.status === PROJECT_STATUS.AWARDED
        ? 'The escrow for this project has not been funded yet, so work cannot be submitted.'
        : `This project is '${project.status}' and is not accepting progress submissions.`
    );
  }
  if (milestone.status === MILESTONE_STATUS.PAID) {
    throw new ConflictError('This milestone has already been paid.');
  }
  if (milestone.status === MILESTONE_STATUS.SUBMITTED) {
    throw new ConflictError('This milestone is already awaiting review.');
  }
  if (milestone.status === MILESTONE_STATUS.APPROVING) {
    throw new ConflictError('A payment for this milestone is currently being processed.');
  }
  if (!RESUBMITTABLE.includes(milestone.status)) {
    throw new ConflictError(`A milestone that is '${milestone.status}' cannot be submitted.`);
  }

  // Fetch the original report photo for the comparison.
  let originalBuffer = null;
  const report = await Report.findById(project.report);
  if (report?.imageUrl && !config.gemini.mock) {
    try {
      const res = await fetch(report.imageUrl);
      if (res.ok) originalBuffer = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      // Not fatal: verification still runs, just without the site comparison.
      logger.warn(`Could not fetch the original report image for comparison: ${err.message}`);
    }
  }

  // Upload and verify concurrently, as in Phase 3.
  const [uploadResult, verifyResult] = await Promise.allSettled([
    uploadImage(file.buffer, {
      folder: 'milestones',
      context: { project: project.id, milestone: milestone.id },
    }),
    verifyMilestoneImage(file.buffer, {
      mimeType: file.mimetype,
      originalBuffer,
      originalMimeType: 'image/jpeg',
      milestoneDescription: milestone.description,
      projectTitle: project.title,
      originalIssue: report?.aiCostEstimate?.observedIssue ?? report?.description,
      contractorNote: note,
    }),
  ]);

  if (uploadResult.status === 'rejected') throw uploadResult.reason;
  const image = uploadResult.value;

  if (verifyResult.status === 'rejected') {
    await deleteImage(image.publicId);
    throw verifyResult.reason;
  }

  const verification = verifyResult.value;

  // Replace any previous attempt's image rather than accumulating orphans.
  if (milestone.progressImagePublicId) await deleteImage(milestone.progressImagePublicId);

  milestone.progressImageUrl = image.url;
  milestone.progressImagePublicId = image.publicId;
  milestone.contractorNote = note ?? null;
  milestone.aiVerificationResult = verification;
  milestone.submittedAt = new Date();
  milestone.submissionCount += 1;
  milestone.rejectionReason = null;

  // The AI is a gate, not the decider. Work it judges incomplete never reaches
  // the admin's queue; work it passes still needs a human approval before any
  // money moves.
  const passed = verification.looksComplete && verification.matchesOriginalIssue !== false;
  milestone.status = passed ? MILESTONE_STATUS.SUBMITTED : MILESTONE_STATUS.AI_REJECTED;

  await milestone.save();

  logger.info(
    `Milestone ${milestone.number} of project ${project.id} submitted ` +
      `(attempt ${milestone.submissionCount}): AI ${passed ? 'passed' : 'rejected'}`
  );

  // --- Notifications (PHASE 8 transport) --------------------------------
  if (passed) {
    const admins = await User.find({ role: ROLES.ADMIN, isActive: true }).select('name email');
    if (admins.length > 0) notify.milestoneSubmitted({ admins, project, milestone, contractor });
  } else {
    notify.milestoneAiRejected({ contractor, project, milestone, verification });
  }

  return milestone;
};

/**
 * Admin approves a milestone and the funds are released on-chain.
 *
 * The database is marked `APPROVING` before the chain call and only `PAID`
 * after the transaction is mined. If the process dies mid-flight, the
 * milestone is visibly stuck in `APPROVING` rather than silently appearing
 * unpaid while the money has actually moved — and the contract itself refuses
 * a second payment, so a retry cannot double-pay.
 */
/**
 * Shared preconditions and evidence hashing for approving a milestone.
 *
 * Returns everything both the prepare and confirm steps need, so the two
 * cannot disagree about what is being approved.
 */
const prepareApproval = async (milestoneId, admin, { overrideAiRejection = false, justification } = {}) => {
  const milestone = await loadMilestone(milestoneId);
  const project = milestone.project;

  if (milestone.status === MILESTONE_STATUS.PAID) {
    throw new ConflictError('This milestone has already been paid.');
  }

  // An AI rejection is a gate, not a verdict. The model can be wrong about a
  // perfectly good repair — a bad camera angle, poor light, an unusual
  // surface — and without a human override the contractor would be locked out
  // of payment permanently, with no appeal. Same reasoning as the admin
  // override of an AI report rejection in Phase 4.
  //
  // The override is deliberately noisy: it needs a written justification,
  // which is stored on the milestone and hashed into the on-chain evidence,
  // so overturning the machine is a recorded act rather than a quiet click.
  const isOverridableAiRejection =
    overrideAiRejection && milestone.status === MILESTONE_STATUS.AI_REJECTED;

  if (isOverridableAiRejection) {
    if (!justification || String(justification).trim().length < 20) {
      throw new ValidationError(
        'Overriding an AI rejection requires a written justification of at least 20 characters.',
        {
          details: [
            {
              field: 'justification',
              message:
                'Explain why the work is acceptable despite the automated assessment. This is kept on the public record.',
            },
          ],
        }
      );
    }
    if (!milestone.progressImageUrl) {
      throw new ConflictError('This milestone has no progress photo to approve.');
    }
  } else if (milestone.status !== MILESTONE_STATUS.SUBMITTED) {
    throw new ConflictError(
      milestone.status === MILESTONE_STATUS.AI_REJECTED
        ? 'Our AI could not confirm this work is complete. To approve it anyway, resubmit with overrideAiRejection and a justification.'
        : `Only a submitted milestone can be approved. This one is '${milestone.status}'.`
    );
  }

  if (project.status !== PROJECT_STATUS.IN_PROGRESS) {
    throw new ConflictError(`This project is '${project.status}' and cannot release funds.`);
  }
  if (project.onChainProjectId === null || project.onChainProjectId === undefined) {
    throw new ConflictError('This project has no on-chain escrow. Lock the funds first.');
  }

  // Hash the approval record and put it on-chain, so the payment is tied to
  // the evidence that justified it and can be checked independently.
  const evidence = {
    projectId: project.id,
    milestoneId: milestone.id,
    milestoneNumber: milestone.number,
    progressImageUrl: milestone.progressImageUrl,
    aiVerdict: {
      looksComplete: milestone.aiVerificationResult?.looksComplete,
      confidence: milestone.aiVerificationResult?.confidence,
      model: milestone.aiVerificationResult?.model,
    },
    approvedBy: admin.id,
    // Deliberately NOT a timestamp: prepare and confirm must derive the same
    // hash, and the official may take a minute to approve in MetaMask.
    ...(isOverridableAiRejection
      ? { aiRejectionOverridden: true, overrideJustification: String(justification).trim() }
      : {}),
  };

  return { milestone, project, isOverridableAiRejection, evidenceHash: chain.hashEvidence(evidence) };
};

/**
 * Step 1 of release: hand the admin's browser an unsigned transaction.
 *
 * Simulates the call first, so an already-paid milestone is refused here
 * rather than after the official has approved a transaction that then reverts
 * and costs them gas for nothing.
 */
export const prepareMilestoneRelease = async (milestoneId, admin, options = {}) => {
  const { milestone, project, evidenceHash } = await prepareApproval(milestoneId, admin, options);

  /**
   * Simulate as the wallet that is about to sign.
   *
   * `releaseMilestone` is owner-only, so a simulation with no caller is made
   * by the zero address and always fails the ownership check — which is
   * exactly what blocked the live release. Passing the connected wallet makes
   * the dry run match the transaction MetaMask will actually broadcast, so a
   * genuinely wrong wallet is still caught here, before it costs gas.
   */
  await chain.simulateRelease({
    onChainProjectId: project.onChainProjectId,
    onChainIndex: milestone.onChainIndex,
    evidenceHash,
    from: options.walletAddress,
  });

  const transaction = chain.buildReleaseTransaction({
    onChainProjectId: project.onChainProjectId,
    onChainIndex: milestone.onChainIndex,
    evidenceHash,
    amountWei: milestone.amountWei,
  });

  return {
    transaction,
    evidenceHash,
    milestone: {
      id: milestone.id,
      number: milestone.number,
      description: milestone.description,
      fundPercentage: milestone.fundPercentage,
      amountWei: milestone.amountWei,
      displayAmount: milestone.displayAmount,
      currency: milestone.currency,
    },
    project: { id: project.id, title: project.title },
  };
};

/**
 * Step 2 of release: verify the broadcast transaction, then record the payment.
 *
 * The receipt must carry a MilestoneReleased event for THIS project and THIS
 * milestone index. A hash from an unrelated transaction, or from a release of
 * a different milestone, is rejected.
 */
export const confirmMilestoneRelease = async (milestoneId, admin, { transactionHash, ...options } = {}) => {
  /**
   * A repeat confirmation of a payment already recorded is a RETRY, not an
   * error — and this check has to come before `prepareApproval`, which refuses
   * a paid milestone outright.
   *
   * The real sequence this protects: the admin signs, MetaMask broadcasts, and
   * the confirm request then times out or the connection drops. The browser
   * retries with the same hash. Answering 409 "already paid" tells the official
   * their payment failed when it demonstrably succeeded, which is the exact
   * confusion the rest of the recovery work exists to prevent.
   *
   * A *different* hash for an already-paid milestone is still refused: that is
   * either a double-payment attempt or a mix-up, and neither should be recorded.
   */
  const existing = await loadMilestone(milestoneId);
  if (existing.status === MILESTONE_STATUS.PAID) {
    const sameHash =
      transactionHash &&
      existing.transactionHash?.toLowerCase() === String(transactionHash).toLowerCase();

    if (sameHash) {
      const settled = existing.project;
      logger.info(
        `Milestone ${existing.number} of project ${settled.id} re-confirmed with the same hash; treating as a retry.`
      );
      return {
        milestone: existing,
        project: settled,
        receipt: { transactionHash: existing.transactionHash, alreadyRecorded: true },
        explorerUrl: chain.explorerTxUrl(existing.transactionHash),
        projectCompleted: settled.status === PROJECT_STATUS.COMPLETED,
      };
    }
    throw new ConflictError('This milestone has already been paid.');
  }

  const { milestone, project, isOverridableAiRejection, evidenceHash } = await prepareApproval(
    milestoneId,
    admin,
    options
  );

  // Same reasoning as confirmLockFunds: record before verifying, so an
  // interrupted confirmation cannot lose the only copy of the hash.
  milestone.pendingTxHash = transactionHash;
  await milestone.save();

  const receipt = await chain.confirmTransaction({
    transactionHash,
    expectEvent: 'MilestoneReleased',
    // Not just "a release of this milestone" but one carrying OUR approval
    // record. A transaction built elsewhere, with a different evidence hash,
    // is refused — so the hash on-chain always corresponds to a decision this
    // platform can produce the evidence for.
    matchArgs: {
      projectId: String(project.onChainProjectId),
      milestoneIndex: String(milestone.onChainIndex),
      evidenceHash,
    },
  });

  milestone.status = MILESTONE_STATUS.PAID;
  milestone.reviewedBy = admin.id;
  milestone.reviewedAt = new Date();
  // Persisted so the public record can show it and anyone can check it against
  // the hash the contract emitted. prepareApproval derives it from a record
  // with no timestamp, so this is the same value that went on-chain.
  milestone.evidenceHash = evidenceHash;
  milestone.transactionHash = receipt.transactionHash;
  milestone.pendingTxHash = null; // verified
  milestone.blockNumber = receipt.blockNumber;
  milestone.gasUsed = receipt.gasUsed;
  milestone.paidAt = new Date();
  milestone.approvedByWallet = receipt.from ?? null;
  if (isOverridableAiRejection) {
    milestone.aiRejectionOverridden = true;
    milestone.overrideJustification = String(options.justification).trim();
    logger.warn(
      `Admin ${admin.email} OVERRODE the AI rejection of milestone ${milestone.number} ` +
        `on project ${project.id}: ${milestone.overrideJustification}`
    );
  }
  await milestone.save();

  // Update the project's released total and close it out if this was the last.
  const all = await Milestone.find({ project: project._id });
  const released = all
    .filter((m) => m.status === MILESTONE_STATUS.PAID)
    .reduce((sum, m) => sum + BigInt(m.amountWei), 0n);

  project.totalReleasedFunds = released.toString();

  const allPaid = all.every((m) => m.status === MILESTONE_STATUS.PAID);
  if (allPaid) {
    project.status = PROJECT_STATUS.COMPLETED;
    project.completedAt = new Date();
  }
  await project.save();

  const explorerUrl = chain.explorerTxUrl(receipt.transactionHash);
  logger.success(
    `Milestone ${milestone.number} of project ${project.id} PAID by ${receipt.from ?? 'admin wallet'}: ${explorerUrl}`
  );

  // The citizen's email carries the Etherscan link, which is the whole point:
  // they can verify the money moved without trusting this platform.
  const reporter = await User.findById(project.reporter).select('name email');
  notify.milestoneApproved({
    contractor: milestone.contractor,
    reporter,
    project,
    milestone,
    transactionHash: receipt.transactionHash,
    explorerUrl,
  });

  if (allPaid) {
    logger.success(`Project ${project.id} COMPLETED — all milestones paid.`);
    notify.projectCompleted({
      contractor: milestone.contractor,
      reporter,
      project,
      explorerUrl: chain.explorerAddressUrl(project.smartContractAddress),
    });
  }

  return { milestone, project, receipt, explorerUrl, projectCompleted: allPaid };
};

/** Admin rejects a submitted milestone; the contractor may resubmit. */
export const rejectMilestone = async (milestoneId, admin, reason) => {
  const milestone = await loadMilestone(milestoneId);

  if (milestone.status === MILESTONE_STATUS.PAID) {
    throw new ConflictError('A paid milestone cannot be rejected.');
  }
  if (milestone.status !== MILESTONE_STATUS.SUBMITTED) {
    throw new ConflictError(
      `Only a submitted milestone can be rejected. This one is '${milestone.status}'.`
    );
  }

  milestone.status = MILESTONE_STATUS.REJECTED;
  milestone.rejectionReason = reason;
  milestone.reviewedBy = admin.id;
  milestone.reviewedAt = new Date();
  await milestone.save();

  logger.info(`Milestone ${milestone.number} of project ${milestone.project.id} rejected by admin.`);

  notify.milestoneRejected({
    contractor: milestone.contractor,
    project: milestone.project,
    milestone,
    reason,
  });

  return milestone;
};

/**
 * Reconcile the database against the chain.
 *
 * The chain is the authority. This exists because a release can be mined after
 * the backend has already given up on it (RPC timeout, process restart), which
 * would leave a milestone reading APPROVING while the contractor has in fact
 * been paid.
 */
/**
 * Make the database match the chain.
 *
 * The chain is the authority. This exists because every on-chain write is a
 * prepare -> sign -> confirm sequence with a browser in the middle, and the
 * browser can vanish between the signature and the confirmation. When it does,
 * the money has moved but our record has not — and the project would otherwise
 * be stuck forever behind a prompt that can never succeed.
 *
 * Recovers, in order:
 *   1. the on-chain project id, resolved from the off-chain id if missing;
 *   2. the funding state and its transaction hash, read from the FundsLocked
 *      event when we never recorded it;
 *   3. every released milestone and its payment hash, from MilestoneReleased;
 *   4. the project's running totals and completion state.
 *
 * Safe to run repeatedly: it only ever writes values read from the contract,
 * and reports exactly what it changed.
 */
export const syncProjectFromChain = async (projectId) => {
  const project = await Project.findById(projectId).populate(
    'awardedContractor',
    'name email walletAddress'
  );
  if (!project) throw new NotFoundError('Project not found.');

  if (project.status === PROJECT_STATUS.OPEN) {
    throw new ConflictError('This project has not been awarded, so there is nothing on-chain yet.');
  }

  // --- 1. Resolve the on-chain id -----------------------------------------
  // The usual reason for a desync is that this was never written, so it
  // cannot be a precondition for recovery.
  let onChainProjectId = project.onChainProjectId;
  if (onChainProjectId === null || onChainProjectId === undefined) {
    onChainProjectId = await chain.resolveOnChainProjectId(project.id);
    if (onChainProjectId === null) {
      return {
        synced: false,
        reason:
          'This project has not been funded on-chain yet, so there is nothing to reconcile. Lock the escrow funds to begin.',
        corrections: [],
      };
    }
  }

  const onChain = await chain.getOnChainProject(onChainProjectId);
  if (!onChain) {
    throw new BadRequestError('Reconciliation is unavailable in fixture mode.');
  }

  // Refuse to adopt a project that is not ours. Writing another project's
  // figures onto this one would corrupt the public record.
  if (onChain.offChainId && onChain.offChainId !== project.id) {
    throw new ConflictError(
      `On-chain project ${onChainProjectId} belongs to "${onChain.offChainId}", not this project. Refusing to reconcile.`
    );
  }

  const corrections = [];
  const milestones = await Milestone.find({ project: project._id }).sort({ number: 1 });

  // --- 2. Funding ---------------------------------------------------------
  if (project.onChainProjectId !== onChainProjectId) {
    corrections.push({
      field: 'onChainProjectId',
      from: project.onChainProjectId,
      to: onChainProjectId,
      reason: 'resolved from the off-chain id',
    });
    project.onChainProjectId = onChainProjectId;
  }

  if (onChain.funded && !project.fundingTxHash) {
    // Recover the hash from the contract's own event log.
    const funding = await chain.findFundingTransaction(onChainProjectId);
    if (funding) {
      project.fundingTxHash = funding.transactionHash;
      project.fundedBy = funding.depositor ?? project.fundedBy;
      corrections.push({
        field: 'fundingTxHash',
        from: null,
        to: funding.transactionHash,
        reason: 'recovered from the FundsLocked event',
      });
    } else if (project.pendingFundingTxHash) {
      // The log scan failed, but the browser did tell us the hash before it
      // went away. The contract confirms the project IS funded, so adopting
      // the recorded hash is sound.
      project.fundingTxHash = project.pendingFundingTxHash;
      corrections.push({
        field: 'fundingTxHash',
        from: null,
        to: project.pendingFundingTxHash,
        reason: 'adopted the hash recorded before verification',
      });
    } else {
      corrections.push({
        field: 'fundingTxHash',
        from: null,
        to: null,
        reason:
          'funded on-chain, but the transaction hash could not be recovered from logs and none was recorded',
      });
    }
  }

  if (project.smartContractAddress !== config.chain.contractAddress) {
    project.smartContractAddress = config.chain.contractAddress;
    corrections.push({ field: 'smartContractAddress', to: config.chain.contractAddress });
  }

  if (onChain.funded && project.totalLockedFunds !== onChain.totalWei) {
    corrections.push({
      field: 'totalLockedFunds',
      from: project.totalLockedFunds,
      to: onChain.totalWei,
      reason: 'read from the contract',
    });
    project.totalLockedFunds = onChain.totalWei;
  }

  // --- 3. Milestones ------------------------------------------------------
  const releaseTxs = await chain.findMilestoneReleaseTransactions(onChainProjectId);

  for (const m of milestones) {
    const chainState = onChain.milestones[m.onChainIndex];
    if (!chainState) continue;

    if (chainState.released && m.status !== MILESTONE_STATUS.PAID) {
      const from = m.status;
      m.status = MILESTONE_STATUS.PAID;
      m.paidAt = chainState.releasedAt ?? new Date();

      const tx = releaseTxs.get(m.onChainIndex);
      if (tx) {
        m.transactionHash = tx.transactionHash;
        m.blockNumber = tx.blockNumber;
        if (tx.evidenceHash) m.evidenceHash = tx.evidenceHash;
        // The wallet that signed the release, so a recovered milestone carries
        // the same proof of who approved it as one confirmed normally. Only set
        // when recovered — never blanked, since an existing value came from the
        // receipt at confirm time and is no less trustworthy.
        if (tx.approvedByWallet) m.approvedByWallet = tx.approvedByWallet;
      } else if (m.pendingTxHash) {
        m.transactionHash = m.pendingTxHash;
      }

      await m.save();
      corrections.push({
        milestone: m.number,
        from,
        to: 'paid',
        reason: tx
          ? `released on-chain in ${tx.transactionHash}`
          : 'released on-chain (transaction hash unavailable)',
      });
    } else if (chainState.released && m.status === MILESTONE_STATUS.PAID) {
      /**
       * Already paid here and on-chain, but the record may still be missing
       * pieces — and the branch above only runs for a milestone whose status is
       * changing, so it would never fill them in.
       *
       * This is what repairs a milestone reconciled before the chain scan knew
       * how to read the signer: it is paid, so nothing above touches it, yet
       * `approvedByWallet` stays null and the public record names nobody as
       * having approved the payment. Backfilled here, and only ever when the
       * field is empty — a value already recorded came from the receipt at
       * confirm time and is never overwritten.
       */
      const tx = releaseTxs.get(m.onChainIndex);
      const backfilled = [];

      if (tx?.approvedByWallet && !m.approvedByWallet) {
        m.approvedByWallet = tx.approvedByWallet;
        backfilled.push('approvedByWallet');
      }
      if (tx?.evidenceHash && !m.evidenceHash) {
        m.evidenceHash = tx.evidenceHash;
        backfilled.push('evidenceHash');
      }
      if (tx?.transactionHash && !m.transactionHash) {
        m.transactionHash = tx.transactionHash;
        backfilled.push('transactionHash');
      }
      if (tx?.blockNumber && !m.blockNumber) {
        m.blockNumber = tx.blockNumber;
        backfilled.push('blockNumber');
      }

      if (backfilled.length > 0) {
        await m.save();
        corrections.push({
          milestone: m.number,
          field: backfilled.join(', '),
          from: null,
          to: 'recovered from the release transaction',
          reason: 'already paid, but the payment record was incomplete',
        });
      }
    }

    // A milestone our database thinks is paid but the chain says is not is the
    // dangerous direction, so it is surfaced loudly rather than silently
    // "corrected" — it should not be possible and warrants a human look.
    if (!chainState.released && m.status === MILESTONE_STATUS.PAID) {
      logger.error(
        `DESYNC: milestone ${m.number} of project ${project.id} is marked paid in the database but is NOT released on-chain.`
      );
      corrections.push({
        milestone: m.number,
        from: 'paid',
        to: 'paid',
        reason: 'WARNING: marked paid locally but not released on-chain — needs investigation',
        requiresAttention: true,
      });
    }
  }

  // --- 4. Totals and status ----------------------------------------------
  if (project.totalReleasedFunds !== onChain.releasedWei) {
    corrections.push({
      field: 'totalReleasedFunds',
      from: project.totalReleasedFunds,
      to: onChain.releasedWei,
      reason: 'read from the contract',
    });
    project.totalReleasedFunds = onChain.releasedWei;
  }

  /**
   * Completed means EVERY milestone is paid — never "the contract says the
   * total is released".
   *
   * These can disagree. The contract's own completion flag tracks the
   * released total, so it flips as soon as the last wei leaves escrow even if
   * one milestone's payment was never recorded here. Accepting that flag on
   * its own would close a project while a milestone still read unpaid,
   * stranding it: `prepareApproval` refuses to release against a completed
   * project, so the milestone could never be recorded and the public ledger
   * would permanently understate what was paid.
   *
   * Requiring every milestone to be paid locally — after step 3 above has
   * already reconciled each one against the chain — means completion follows
   * the milestones rather than racing ahead of them.
   */
  const allPaid =
    milestones.length > 0 && milestones.every((m) => m.status === MILESTONE_STATUS.PAID);

  if (onChain.completed && !allPaid) {
    const unpaid = milestones.filter((m) => m.status !== MILESTONE_STATUS.PAID);
    corrections.push({
      field: 'status',
      from: project.status,
      to: project.status,
      reason:
        `the contract reports all funds released, but ${unpaid.length} milestone(s) ` +
        `(#${unpaid.map((m) => m.number).join(', #')}) are not recorded as paid — ` +
        'left open deliberately so they can still be reconciled',
      requiresAttention: true,
    });
  }

  if (allPaid) {
    if (project.status !== PROJECT_STATUS.COMPLETED) {
      corrections.push({ field: 'status', from: project.status, to: PROJECT_STATUS.COMPLETED });
      project.status = PROJECT_STATUS.COMPLETED;
      project.completedAt = project.completedAt ?? new Date();
    }
  } else if (onChain.funded && project.status === PROJECT_STATUS.AWARDED) {
    // The state the desync left stranded: funded on-chain, still "awarded"
    // locally, so the contractor could not submit work.
    corrections.push({
      field: 'status',
      from: PROJECT_STATUS.AWARDED,
      to: PROJECT_STATUS.IN_PROGRESS,
      reason: 'escrow is funded on-chain',
    });
    project.status = PROJECT_STATUS.IN_PROGRESS;
  }

  await project.save();

  if (corrections.length > 0) {
    logger.success(
      `Reconciled project ${project.id} from chain: ${corrections.length} correction(s).`
    );
  }

  return {
    synced: true,
    corrections,
    onChain: {
      onChainProjectId,
      offChainId: onChain.offChainId,
      contractor: onChain.contractor,
      funded: onChain.funded,
      completed: onChain.completed,
      totalWei: onChain.totalWei,
      releasedWei: onChain.releasedWei,
      remainingWei: onChain.remainingWei,
      milestones: onChain.milestones,
    },
    project: await Project.findById(project._id),
  };
};

/** Kept as the previous name so existing callers and routes keep working. */
export const reconcileProject = syncProjectFromChain;
