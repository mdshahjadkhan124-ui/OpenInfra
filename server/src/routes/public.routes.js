/**
 * /api/public — the transparency dashboard's data. No authentication.
 *
 * Deliberately a separate router from /api/projects rather than an
 * `optionalAuth` variant of it: the two have different audiences and must be
 * able to diverge. The authenticated view shows a contractor's email to an
 * admin; this one must never show it to anyone.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import * as publicController from '../controllers/public.controller.js';
import { validate } from '../middlewares/validate.js';
import { publicListRules, publicIdRules } from '../validators/public.validators.js';
import { config } from '../config/env.js';

const router = Router();

/**
 * These endpoints have no login to throttle behind, so they get their own
 * limiter — generous enough for a page that makes three or four calls on load
 * and a visitor who clicks around, tight enough to blunt a scraper.
 */
const publicLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: config.isProduction ? 300 : 3000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please slow down and try again shortly.',
    code: 'RATE_LIMITED',
  },
});

router.use(publicLimiter);

router.get('/stats', publicController.stats);
router.get('/activity', publicController.activity);
router.get('/projects', validate(publicListRules), publicController.listProjects);
router.get('/projects/:id', validate(publicIdRules), publicController.getProject);
router.get('/projects/:id/verify', validate(publicIdRules), publicController.verifyProject);

export default router;
