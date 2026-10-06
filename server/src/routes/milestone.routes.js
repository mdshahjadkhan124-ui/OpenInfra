/**
 * /api/milestones — the contractor's side, plus shared reads.
 *
 * Admin approval and release live under /api/admin/milestones, behind the
 * single admin guard on that router.
 */
import { Router } from 'express';

import * as milestoneController from '../controllers/milestone.controller.js';
import { authenticate, authorize } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { uploadSingleImage, requireImage } from '../middlewares/upload.js';
import { ROLES } from '../models/User.js';
import {
  milestoneIdRules,
  projectIdParamRules,
  submitProgressRules,
  listMilestonesRules,
} from '../validators/milestone.validators.js';

const router = Router();

router.use(authenticate);

// --- Contractor ----------------------------------------------------------
router.get(
  '/mine',
  authorize(ROLES.CONTRACTOR),
  validate(listMilestonesRules),
  milestoneController.listMyMilestones
);

/**
 * Multer must parse the multipart body before express-validator can read the
 * text fields, and requireImage runs first so a missing photo is reported
 * before field-level complaints.
 */
router.post(
  '/:id/progress',
  authorize(ROLES.CONTRACTOR),
  uploadSingleImage,
  requireImage,
  validate(submitProgressRules),
  milestoneController.submitProgress
);

// --- Participants only ---------------------------------------------------
// The assigned contractor and admins. These are the FULL records, including
// an admin's internal override justification, so the service enforces
// participation rather than merely requiring a signed-in user. The public,
// redacted view lives at /api/public.
router.get(
  '/project/:projectId',
  validate(projectIdParamRules),
  milestoneController.listForProject
);

export default router;
