/**
 * Report controllers.
 */
import * as reportService from '../services/report.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';

/**
 * POST /api/reports — file a new report. Citizen only.
 *
 * multipart/form-data: `image` plus the text fields.
 *
 * Note the 201 on an AI rejection too. The request succeeded — a report
 * document was created — and the outcome is carried in `status`. Returning an
 * error status for "your photo is not infrastructure" would conflate a client
 * mistake with a judgement the system made and recorded.
 */
export const createReport = asyncHandler(async (req, res) => {
  const { description, address, city, latitude, longitude } = req.body;

  const location = {
    address,
    city: city || null,
    latitude: latitude !== undefined && latitude !== '' ? Number(latitude) : null,
    longitude: longitude !== undefined && longitude !== '' ? Number(longitude) : null,
  };

  const report = await reportService.createReport({
    reporter: req.user,
    file: req.file,
    description,
    location,
  });

  const rejected = report.status === 'rejected';

  return sendSuccess(res, {
    statusCode: 201,
    message: rejected
      ? 'We reviewed your photo but could not accept it as an infrastructure report.'
      : 'Report submitted. Our AI has estimated the repair cost and an official will review it shortly.',
    data: { report: report.toJSON() },
  });
});

/** GET /api/reports/mine — the caller's own reports. */
export const listMyReports = asyncHandler(async (req, res) => {
  const { status, page, limit } = req.query;
  const { reports, meta } = await reportService.listReportsByReporter(req.user.id, {
    status,
    page,
    limit,
  });

  return sendSuccess(res, { message: 'Reports retrieved.', data: { reports }, meta });
});

/** GET /api/reports/mine/stats — counts by status, for the citizen dashboard. */
export const getMyStats = asyncHandler(async (req, res) => {
  const stats = await reportService.getReporterStats(req.user._id);
  return sendSuccess(res, { message: 'Report statistics.', data: { stats } });
});

/** GET /api/reports/:id — owner or admin only. */
export const getReport = asyncHandler(async (req, res) => {
  const report = await reportService.getReportById(req.params.id, req.user);
  return sendSuccess(res, { message: 'Report retrieved.', data: { report: report.toJSON() } });
});

/** DELETE /api/reports/:id — owner only, and only while pending or rejected. */
export const deleteReport = asyncHandler(async (req, res) => {
  const result = await reportService.deleteReport(req.params.id, req.user);
  return sendSuccess(res, { message: 'Report deleted.', data: result });
});
