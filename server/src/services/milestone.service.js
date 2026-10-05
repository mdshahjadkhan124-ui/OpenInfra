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
export const lockProjectFunds = async (projectId, admin) => {
  const project = await Project.findById(projectId).populate('awardedContractor', 'name email walletAddress');
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

  const amountsWei = milestones.map((m) => m.amountWei);

  const result = await chain.lockFunds({
    offChainId: project.id,
    contractorAddress,
    amountsWei,
  });

  project.smartContractAddress = result.contractAddress;
  project.onChainProjectId = result.onChainProjectId;
  project.fundingTxHash = result.transactionHash;
  project.totalLockedFunds = result.totalLockedWei;
  project.status = PROJECT_STATUS.IN_PROGRESS;
  await project.save();

  logger.success(
    `Escrow funded for project ${project.id}: ${ethers.formatEther(result.totalLockedWei)} ETH, tx ${result.transactionHash}`
  );

  // PHASE 8 transport.
  notify.escrowFunded({
    contractor: project.awardedContractor,
    project,
    transactionHash: result.transactionHash,
    explorerUrl: chain.explorerTxUrl(result.transactionHash),
  });

  return { project, milestones, chain: result };
};

/** Milestones of a project, in order. */
export const listMilestonesForProject = async (projectId) => {
  const project = await Project.findById(projectId);
  if (!project) throw new NotFoundError('Project not found.');

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
export const approveAndRelease = async (milestoneId, admin, { overrideAiRejection = false, justification } = {}) => {
  const milestone = await loadMilestone(milestoneId);
  const project = milestone.project;

  if (milestone.status === MILESTONE_STATUS.PAID) {
    throw new ConflictError('This milestone has already been paid.');
  }
  if (milestone.status === MILESTONE_STATUS.APPROVING) {
    throw new ConflictError('A payment for this milestone is already being processed.');
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
    approvedAt: new Date().toISOString(),
    // Present only when a human overruled the machine, so the on-chain hash
    // differs and the override is provable after the fact.
    ...(isOverridableAiRejection
      ? { aiRejectionOverridden: true, overrideJustification: String(justification).trim() }
      : {}),
  };
  const evidenceHash = chain.hashEvidence(evidence);

  const previousStatus = milestone.status;
  milestone.status = MILESTONE_STATUS.APPROVING;
  milestone.reviewedBy = admin.id;
  milestone.reviewedAt = new Date();
  milestone.evidenceHash = evidenceHash;
  if (isOverridableAiRejection) {
    milestone.aiRejectionOverridden = true;
    milestone.overrideJustification = String(justification).trim();
    logger.warn(
      `Admin ${admin.email} OVERRODE the AI rejection of milestone ${milestone.number} ` +
        `on project ${project.id}: ${milestone.overrideJustification}`
    );
  }
  await milestone.save();

  let receipt;
  try {
    receipt = await chain.releaseMilestone({
      onChainProjectId: project.onChainProjectId,
      onChainIndex: milestone.onChainIndex,
      evidenceHash,
    });
  } catch (err) {
    // Restore whatever it was before, so the admin can retry; the on-chain
    // state is authoritative and unchanged by a failed call.
    milestone.status = previousStatus;
    await milestone.save();
    throw err;
  }

  milestone.status = MILESTONE_STATUS.PAID;
  milestone.transactionHash = receipt.transactionHash;
  milestone.blockNumber = receipt.blockNumber;
  milestone.gasUsed = receipt.gasUsed;
  milestone.paidAt = new Date();
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
    `Milestone ${milestone.number} of project ${project.id} PAID: ${explorerUrl ?? receipt.transactionHash}`
  );

  // --- Notifications (PHASE 8 transport) --------------------------------
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
export const reconcileProject = async (projectId) => {
  const project = await Project.findById(projectId);
  if (!project) throw new NotFoundError('Project not found.');
  if (project.onChainProjectId === null || project.onChainProjectId === undefined) {
    throw new ConflictError('This project has no on-chain escrow to reconcile against.');
  }

  const onChain = await chain.getOnChainProject(project.onChainProjectId);
  if (!onChain) throw new BadRequestError('Reconciliation is unavailable in fixture mode.');

  const milestones = await Milestone.find({ project: project._id }).sort({ number: 1 });
  const corrections = [];

  for (const m of milestones) {
    const chainState = onChain.milestones[m.onChainIndex];
    if (!chainState) continue;

    if (chainState.released && m.status !== MILESTONE_STATUS.PAID) {
      m.status = MILESTONE_STATUS.PAID;
      m.paidAt = chainState.releasedAt ?? new Date();
      await m.save();
      corrections.push({ milestone: m.number, from: m.status, to: 'paid', reason: 'released on-chain' });
    }
  }

  project.totalReleasedFunds = onChain.releasedWei;
  if (onChain.completed && project.status !== PROJECT_STATUS.COMPLETED) {
    project.status = PROJECT_STATUS.COMPLETED;
    project.completedAt = new Date();
    corrections.push({ project: project.id, to: 'completed' });
  }
  await project.save();

  return { onChain, corrections };
};
