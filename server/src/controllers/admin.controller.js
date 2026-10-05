/**
 * Admin review controllers.
 *
 * Every route reaching these is already behind authenticate + authorize(ADMIN).
 */
import * as reviewService from '../services/review.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';

/** GET /api/admin/reports — the review queue. Defaults to pending. */
export const listReportsForReview = asyncHandler(async (req, res) => {
  const { status, page, limit } = req.query;
  const { reports, meta } = await reviewService.listReportsForReview({ status, page, limit });

  return sendSuccess(res, { message: 'Reports retrieved.', data: { reports }, meta });
});

/** GET /api/admin/stats — counts for the dashboard header. */
export const getStats = asyncHandler(async (req, res) => {
  const stats = await reviewService.getReviewStats();
  return sendSuccess(res, { message: 'Review statistics.', data: { stats } });
});

/** PATCH /api/admin/reports/:id/approve */
export const approveReport = asyncHandler(async (req, res) => {
  const report = await reviewService.approveReport(req.params.id, req.user);
  return sendSuccess(res, {
    message: 'Report approved. It can now be published as a public project.',
    data: { report: report.toJSON() },
  });
});

/** PATCH /api/admin/reports/:id/reject */
export const rejectReport = asyncHandler(async (req, res) => {
  const report = await reviewService.rejectReport(req.params.id, req.user, req.body.reason);
  return sendSuccess(res, { message: 'Report rejected.', data: { report: report.toJSON() } });
});

/**
 * POST /api/admin/reports/:id/publish
 *
 * Body is optional. `title` and `description` default to the report's own;
 * `estimate` overrides the AI cost range, and is *required* when the report
 * has none — typically a report whose AI rejection an admin overturned.
 */
export const publishReport = asyncHandler(async (req, res) => {
  const { title, description, bidsCloseAt, estimate } = req.body;

  const project = await reviewService.publishReport(req.params.id, req.user, {
    title,
    description,
    bidsCloseAt,
    estimate,
  });

  return sendSuccess(res, {
    statusCode: 201,
    message: 'Project published and open for bidding.',
    data: { project: project.toJSON() },
  });
});
