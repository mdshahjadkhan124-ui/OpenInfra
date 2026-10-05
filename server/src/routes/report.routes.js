/**
 * /api/reports
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import * as reportController from '../controllers/report.controller.js';
import { authenticate, authorize } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { uploadSingleImage, requireImage } from '../middlewares/upload.js';
import {
  createReportRules,
  reportIdRules,
  listReportsRules,
} from '../validators/report.validators.js';
import { ROLES } from '../models/User.js';
import { config } from '../config/env.js';

const router = Router();

/**
 * Report creation is the most expensive endpoint in the API: every call costs
 * a Gemini inference and a Cloudinary upload. This limit is about protecting
 * the quota, not about abuse in the security sense.
 */
const reportingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: config.isProduction ? 20 : 200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Per user rather than per IP: a shared office NAT shouldn't exhaust one
  // household's allowance. Falls back to IP for unauthenticated callers.
  keyGenerator: (req) => req.user?.id ?? req.ip,
  message: {
    success: false,
    message: 'You have filed a lot of reports recently. Please try again later.',
    code: 'RATE_LIMITED',
  },
});

// Everything here requires a logged-in user.
router.use(authenticate);

/**
 * POST /api/reports
 *
 * Middleware order matters: Multer must parse the multipart body before
 * express-validator can see the text fields, and `requireImage` runs before
 * validation so a missing photo is reported before field-level complaints.
 */
router.post(
  '/',
  authorize(ROLES.CITIZEN),
  reportingLimiter,
  uploadSingleImage,
  requireImage,
  validate(createReportRules),
  reportController.createReport
);

router.get('/mine', validate(listReportsRules), reportController.listMyReports);
router.get('/mine/stats', reportController.getMyStats);

router.get('/:id', validate(reportIdRules), reportController.getReport);
router.delete('/:id', validate(reportIdRules), reportController.deleteReport);

export default router;
