/**
 * Report business logic — the citizen reporting pipeline.
 */
import { Report, REPORT_STATUS, REJECTION_SOURCE } from '../models/Report.js';
import { User, ROLES } from '../models/User.js';
import { analyseReportImage } from './gemini.service.js';
import { uploadImage, deleteImage } from './upload.service.js';
import * as notify from './notification.service.js';
import { ForbiddenError, NotFoundError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

/**
 * Create a report from an uploaded photo.
 *
 * Order of operations, and why:
 *
 *   1. **Gemini and Cloudinary run in parallel.** They are independent — Gemini
 *      reads the in-memory buffer, Cloudinary stores it — and each takes a
 *      second or more. Running them concurrently roughly halves the time the
 *      citizen spends watching a spinner.
 *
 *   2. **The image is stored even when the AI rejects it.** Tempting to skip
 *      the upload and save the quota, but the AI can be wrong, and a citizen
 *      whose genuine report was auto-rejected needs the photo to still exist
 *      for an admin to overturn the call. Discarding the evidence would make
 *      an appeal impossible.
 *
 *   3. **If Gemini fails, the orphaned upload is deleted.** Otherwise a flaky
 *      AI call would litter Cloudinary with assets no document references.
 */
export const createReport = async ({ reporter, file, description, location }) => {
  const [uploadResult, analysisResult] = await Promise.allSettled([
    uploadImage(file.buffer, {
      folder: 'reports',
      context: { reporter: reporter.id },
    }),
    analyseReportImage(file.buffer, {
      mimeType: file.mimetype,
      description,
      location,
    }),
  ]);

  // Upload failed: nothing to clean up, and we cannot file a report without
  // an image, so surface the storage error.
  if (uploadResult.status === 'rejected') {
    throw uploadResult.reason;
  }

  const image = uploadResult.value;

  // AI failed: the upload succeeded, so remove it before giving up.
  if (analysisResult.status === 'rejected') {
    await deleteImage(image.publicId);
    throw analysisResult.reason;
  }

  const { relevance, costEstimate } = analysisResult.value;
  const isRejected = !relevance.isRelevant;

  const report = await Report.create({
    reporter: reporter.id,
    imageUrl: image.url,
    imagePublicId: image.publicId,
    location,
    description,
    aiRelevanceResult: relevance,
    aiCostEstimate: costEstimate,
    status: isRejected ? REPORT_STATUS.REJECTED : REPORT_STATUS.PENDING,
    rejectionSource: isRejected ? REJECTION_SOURCE.AI : null,
    rejectionReason: isRejected ? relevance.reason : null,
  });

  // --- Notifications (Phase 8 supplies the transport) ---------------------
  // Not awaited: the citizen should not wait on an SMTP round trip, and a mail
  // failure must never turn a filed report into an error.
  if (isRejected) {
    logger.info(`Report ${report.id} auto-rejected by AI: ${relevance.category}`);
    notify.reportRejected({ user: reporter, report, reason: relevance.reason });
  } else {
    logger.info(
      `Report ${report.id} accepted (${relevance.category}, ${costEstimate.currency} ${costEstimate.amount})`
    );
    notify.reportReceived({ user: reporter, report });

    // Admins are told there is something in the queue.
    const admins = await User.find({ role: ROLES.ADMIN, isActive: true }).select('name email');
    if (admins.length > 0) notify.reportAwaitingReview({ admins, report });
  }

  return report;
};

/** Reports filed by one citizen, newest first. */
export const listReportsByReporter = async (reporterId, { status, page = 1, limit = 20 } = {}) => {
  const filter = { reporter: reporterId };
  if (status) filter.status = status;

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);

  const [reports, total] = await Promise.all([
    Report.find(filter)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit),
    Report.countDocuments(filter),
  ]);

  return {
    reports: reports.map((r) => r.toJSON()),
    meta: { total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) || 1 },
  };
};

/**
 * Fetch one report.
 *
 * A citizen may only read their own; an admin may read any. Enforced here
 * rather than in the controller so the rule holds for every caller.
 */
export const getReportById = async (reportId, requester) => {
  const report = await Report.findById(reportId).populate('reporter', 'name email role');
  if (!report) throw new NotFoundError('Report not found.');

  const isOwner = report.reporter?._id?.toString() === requester.id;
  const isAdmin = requester.role === ROLES.ADMIN;

  if (!isOwner && !isAdmin) {
    // 404 rather than 403: confirming a report exists would leak that someone
    // else filed one at this id.
    throw new NotFoundError('Report not found.');
  }

  return report;
};

/** Aggregate counts for the citizen's dashboard. */
export const getReporterStats = async (reporterId) => {
  const rows = await Report.aggregate([
    { $match: { reporter: reporterId } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  const byStatus = Object.fromEntries(rows.map((r) => [r._id, r.count]));

  return {
    total: rows.reduce((sum, r) => sum + r.count, 0),
    pending: byStatus[REPORT_STATUS.PENDING] ?? 0,
    approved: byStatus[REPORT_STATUS.APPROVED] ?? 0,
    rejected: byStatus[REPORT_STATUS.REJECTED] ?? 0,
    published: byStatus[REPORT_STATUS.PUBLISHED] ?? 0,
  };
};

/**
 * Permanently delete a report and its stored image.
 *
 * Only the reporter, and only while it is still rejected or pending — once a
 * report is approved or published it is part of a public record that a bid or
 * a funded project may reference.
 */
export const deleteReport = async (reportId, requester) => {
  const report = await Report.findById(reportId);
  if (!report) throw new NotFoundError('Report not found.');

  if (report.reporter.toString() !== requester.id) {
    throw new NotFoundError('Report not found.');
  }

  const deletable = [REPORT_STATUS.PENDING, REPORT_STATUS.REJECTED];
  if (!deletable.includes(report.status)) {
    throw new ForbiddenError(
      `A ${report.status} report cannot be deleted; it is part of the public record.`
    );
  }

  await deleteImage(report.imagePublicId);
  await report.deleteOne();

  logger.info(`Report ${reportId} deleted by its reporter.`);
  return { id: reportId };
};
