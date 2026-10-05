/**
 * Admin review of citizen reports, and publication as public projects.
 *
 * Every function here assumes the caller has already been proven to be an
 * admin by the route's `authorize(ROLES.ADMIN)` guard. The service re-checks
 * state transitions rather than roles: its job is "is this a legal move?",
 * not "who are you?".
 */
import mongoose from 'mongoose';
import { Report, REPORT_STATUS, REJECTION_SOURCE } from '../models/Report.js';
import { Project, PROJECT_STATUS, ESTIMATE_SOURCE } from '../models/Project.js';
import { User, ROLES } from '../models/User.js';
import { config } from '../config/env.js';
import * as notify from './notification.service.js';
import { ConflictError, NotFoundError, ValidationError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

/**
 * The admin review queue.
 *
 * Defaults to `pending` — the reports that actually need a decision — but any
 * status is listable so an admin can audit what the AI rejected.
 */
export const listReportsForReview = async ({ status = REPORT_STATUS.PENDING, page = 1, limit = 20 } = {}) => {
  const filter = status === 'all' ? {} : { status };

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);

  const [reports, total] = await Promise.all([
    Report.find(filter)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .populate('reporter', 'name email'),
    Report.countDocuments(filter),
  ]);

  return {
    reports: reports.map((r) => r.toJSON()),
    meta: { total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) || 1 },
  };
};

/** Counts per status, for the admin dashboard header. */
export const getReviewStats = async () => {
  const [reportRows, projectRows] = await Promise.all([
    Report.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Project.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);

  const toMap = (rows) => Object.fromEntries(rows.map((r) => [r._id, r.count]));
  const reports = toMap(reportRows);
  const projects = toMap(projectRows);

  return {
    reports: {
      total: reportRows.reduce((s, r) => s + r.count, 0),
      pending: reports[REPORT_STATUS.PENDING] ?? 0,
      approved: reports[REPORT_STATUS.APPROVED] ?? 0,
      rejected: reports[REPORT_STATUS.REJECTED] ?? 0,
      published: reports[REPORT_STATUS.PUBLISHED] ?? 0,
    },
    projects: {
      total: projectRows.reduce((s, r) => s + r.count, 0),
      open: projects[PROJECT_STATUS.OPEN] ?? 0,
      awarded: projects[PROJECT_STATUS.AWARDED] ?? 0,
      inProgress: projects[PROJECT_STATUS.IN_PROGRESS] ?? 0,
      completed: projects[PROJECT_STATUS.COMPLETED] ?? 0,
    },
  };
};

/** Load a report for review, with its reporter, or 404. */
const loadReport = async (reportId) => {
  const report = await Report.findById(reportId).populate('reporter', 'name email role');
  if (!report) throw new NotFoundError('Report not found.');
  return report;
};

/**
 * Approve a report.
 *
 * Deliberately accepts an AI-rejected report as well as a pending one. The
 * relevance gate is a filter, not a verdict — Phase 3 keeps the image for
 * exactly this reason, so a wrong auto-rejection can be overturned by a human.
 * An overturned report carries no AI cost estimate, so publishing it will
 * require the admin to supply one (see publishReport).
 */
export const approveReport = async (reportId, admin) => {
  const report = await loadReport(reportId);

  if (report.status === REPORT_STATUS.APPROVED) {
    throw new ConflictError('This report has already been approved.');
  }
  if (report.status === REPORT_STATUS.PUBLISHED) {
    throw new ConflictError('This report has already been published as a project.');
  }

  const isOverturningAi =
    report.status === REPORT_STATUS.REJECTED && report.rejectionSource === REJECTION_SOURCE.AI;

  report.status = REPORT_STATUS.APPROVED;
  report.rejectionSource = null;
  report.rejectionReason = null;
  report.reviewedBy = admin.id;
  report.reviewedAt = new Date();
  await report.save();

  if (isOverturningAi) {
    logger.info(`Admin ${admin.email} overturned the AI rejection of report ${report.id}.`);
  } else {
    logger.info(`Report ${report.id} approved by ${admin.email}.`);
  }

  // PHASE 8 transport. Not awaited — mail must never fail a review action.
  if (report.reporter) notify.reportApproved({ user: report.reporter, report });

  return report;
};

/** Reject a report with a human-written reason. */
export const rejectReport = async (reportId, admin, reason) => {
  const report = await loadReport(reportId);

  if (report.status === REPORT_STATUS.PUBLISHED) {
    throw new ConflictError('A published project cannot be rejected.');
  }
  if (report.status === REPORT_STATUS.REJECTED && report.rejectionSource === REJECTION_SOURCE.ADMIN) {
    throw new ConflictError('This report has already been rejected by an administrator.');
  }

  report.status = REPORT_STATUS.REJECTED;
  report.rejectionSource = REJECTION_SOURCE.ADMIN;
  report.rejectionReason = reason;
  report.reviewedBy = admin.id;
  report.reviewedAt = new Date();
  await report.save();

  logger.info(`Report ${report.id} rejected by ${admin.email}.`);

  if (report.reporter) notify.reportRejectedByAdmin({ user: report.reporter, report, reason });

  return report;
};

/**
 * Validate an admin-supplied cost range.
 * Used when overriding the AI figure, or when there is none to begin with.
 */
const validateManualEstimate = (estimate) => {
  const min = Number(estimate.minAmount);
  const expected = Number(estimate.amount);
  const max = Number(estimate.maxAmount);

  if (![min, expected, max].every((n) => Number.isFinite(n) && n >= 0)) {
    throw new ValidationError('Cost estimate bounds must all be non-negative numbers.', {
      details: [{ field: 'estimate', message: 'minAmount, amount and maxAmount are all required.' }],
    });
  }
  if (!(min <= expected && expected <= max)) {
    throw new ValidationError('Cost estimate bounds must satisfy minAmount <= amount <= maxAmount.', {
      details: [{ field: 'estimate', message: `Received ${min} / ${expected} / ${max}.` }],
    });
  }
  if (max <= 0) {
    throw new ValidationError('The upper bound must be greater than zero — it is what bids are scored against.', {
      details: [{ field: 'estimate.maxAmount', message: 'Must be greater than zero.' }],
    });
  }

  return { min, expected, max };
};

/**
 * Publish an approved report as an open project.
 *
 * Two things worth noting:
 *
 *  1. **The estimate is copied, not referenced.** See the Project model header
 *     — freezing it at publication is what makes a later anomaly flag
 *     defensible.
 *
 *  2. **A transaction.** Creating the Project and flipping the Report to
 *     `published` must both happen or neither: a Project whose Report still
 *     reads `approved` would reappear in the review queue and could be
 *     published twice. The unique index on `report` is the backstop, but the
 *     transaction is what keeps the two documents honest.
 */
export const publishReport = async (reportId, admin, { title, description, bidsCloseAt, estimate } = {}) => {
  const report = await loadReport(reportId);

  if (report.status === REPORT_STATUS.PUBLISHED) {
    throw new ConflictError('This report has already been published as a project.');
  }
  if (report.status !== REPORT_STATUS.APPROVED) {
    throw new ConflictError(
      `Only an approved report can be published. This one is '${report.status}' — approve it first.`
    );
  }

  // Guard against a race that slipped past the status check.
  const existing = await Project.findOne({ report: report._id });
  if (existing) {
    throw new ConflictError('A project already exists for this report.');
  }

  // --- Resolve the cost benchmark ---------------------------------------
  let estimatedCost;

  if (estimate) {
    // Explicit admin override. Always allowed — an official may know the site.
    const { min, expected, max } = validateManualEstimate(estimate);
    estimatedCost = {
      amount: expected,
      minAmount: min,
      maxAmount: max,
      // A report whose AI rejection was overturned has no estimate to inherit
      // a currency from, so fall back to the platform default rather than
      // letting an undefined currency fail schema validation.
      currency: report.aiCostEstimate?.currency ?? estimate.currency ?? config.report.currency,
      severity: report.aiCostEstimate?.severity ?? 'medium',
      breakdown: report.aiCostEstimate?.breakdown ?? [],
      assumptions: report.aiCostEstimate?.assumptions ?? [],
      confidence: report.aiCostEstimate?.confidence ?? 0,
      source: ESTIMATE_SOURCE.ADMIN,
      producedBy: admin.id,
    };
  } else if (report.aiCostEstimate) {
    const ai = report.aiCostEstimate;
    estimatedCost = {
      amount: ai.amount,
      minAmount: ai.minAmount,
      maxAmount: ai.maxAmount,
      currency: ai.currency,
      severity: ai.severity,
      breakdown: ai.breakdown,
      assumptions: ai.assumptions,
      confidence: ai.confidence,
      source: ESTIMATE_SOURCE.AI,
      producedBy: ai.model,
    };
  } else {
    // Typically a report whose AI rejection an admin overturned: there is no
    // machine estimate to inherit, and publishing without one would leave
    // Phase 5 unable to score any bid.
    throw new ValidationError(
      'This report has no AI cost estimate, so a manual one is required before it can be published.',
      {
        details: [
          {
            field: 'estimate',
            message: 'Provide estimate.minAmount, estimate.amount and estimate.maxAmount.',
          },
        ],
      }
    );
  }

  // --- Create project + flip report, atomically --------------------------
  const session = await mongoose.startSession();
  let project;

  try {
    await session.withTransaction(async () => {
      const [created] = await Project.create(
        [
          {
            report: report._id,
            reporter: report.reporter?._id ?? report.reporter,
            title: title?.trim() || defaultTitle(report),
            description: description?.trim() || report.description,
            imageUrl: report.imageUrl,
            location: {
              address: report.location.address,
              city: report.location.city,
              latitude: report.location.latitude,
              longitude: report.location.longitude,
            },
            category: report.aiRelevanceResult?.category ?? 'other_infrastructure',
            aiEstimatedCost: estimatedCost,
            status: PROJECT_STATUS.OPEN,
            publishedBy: admin.id,
            publishedAt: new Date(),
            bidsCloseAt: bidsCloseAt ? new Date(bidsCloseAt) : null,
          },
        ],
        { session }
      );

      report.status = REPORT_STATUS.PUBLISHED;
      report.project = created._id;
      await report.save({ session });

      project = created;
    });
  } finally {
    await session.endSession();
  }

  logger.info(
    `Project ${project.id} published by ${admin.email} ` +
      `(benchmark ${estimatedCost.currency} ${estimatedCost.maxAmount}, source ${estimatedCost.source})`
  );

  // --- Notifications (PHASE 8 transport) ---------------------------------
  if (report.reporter) notify.projectPublished({ user: report.reporter, project });

  const contractors = await User.find({ role: ROLES.CONTRACTOR, isActive: true }).select('name email');
  if (contractors.length > 0) notify.projectOpenForBids({ contractors, project });

  return project;
};

/** A readable default title when the admin does not supply one. */
const defaultTitle = (report) => {
  const label = (report.aiRelevanceResult?.category ?? 'infrastructure')
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  const place = report.location?.city || report.location?.address || 'reported location';
  return `${label} repair — ${place}`.slice(0, 140);
};
