/**
 * /api/admin — report review and project publication.
 *
 * The admin guard is applied once at the top rather than per route, so a route
 * added later cannot accidentally be left unprotected.
 */
import { Router } from 'express';

import * as adminController from '../controllers/admin.controller.js';
import * as bidController from '../controllers/bid.controller.js';
import * as milestoneController from '../controllers/milestone.controller.js';
import { authenticate, authorize } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { ROLES } from '../models/User.js';
import {
  mongoIdRules,
  reviewQueueRules,
  rejectReportRules,
  publishReportRules,
} from '../validators/admin.validators.js';
import { awardRules, listBidsRules } from '../validators/bid.validators.js';
import {
  milestoneIdRules,
  approveMilestoneRules,
  rejectMilestoneRules,
  listMilestonesRules,
  awardWithMilestonesRules,
  confirmTxRules,
} from '../validators/milestone.validators.js';

const router = Router();

// Everything below is admin-only. Order matters: authenticate populates
// req.user, which authorize then reads.
router.use(authenticate, authorize(ROLES.ADMIN));

router.get('/stats', adminController.getStats);

router.get('/reports', validate(reviewQueueRules), adminController.listReportsForReview);
router.patch('/reports/:id/approve', validate(mongoIdRules), adminController.approveReport);
router.patch('/reports/:id/reject', validate(rejectReportRules), adminController.rejectReport);
router.post('/reports/:id/publish', validate(publishReportRules), adminController.publishReport);

// --- Bid review & award (Phase 5) ---------------------------------------
router.get('/projects/:id/bids', validate([...mongoIdRules, ...listBidsRules]), bidController.listBidsForProject);
router.post('/projects/:id/award', validate(awardWithMilestonesRules), bidController.awardProject);

// --- Escrow & milestones (Phase 7) --------------------------------------
// Every on-chain write is prepare -> (admin's MetaMask signs) -> confirm.
// The server holds no key; see services/chain.service.js.
router.post('/projects/:id/lock-funds/prepare', validate(mongoIdRules), milestoneController.prepareLockFunds);
router.post('/projects/:id/lock-funds/confirm', validate(confirmTxRules), milestoneController.confirmLockFunds);
router.post('/projects/:id/reconcile', validate(mongoIdRules), milestoneController.reconcile);

router.get('/milestones', validate(listMilestonesRules), milestoneController.listForReview);
router.post(
  '/milestones/:id/approve/prepare',
  validate(approveMilestoneRules),
  milestoneController.prepareMilestoneRelease
);
router.post(
  '/milestones/:id/approve/confirm',
  validate([...approveMilestoneRules, ...confirmTxRules]),
  milestoneController.confirmMilestoneRelease
);
router.patch('/milestones/:id/reject', validate(rejectMilestoneRules), milestoneController.rejectMilestone);

router.get('/escrow-contract', milestoneController.escrowContractStatus);

export default router;
