/**
 * /api/bids — the contractor's side of bidding.
 *
 * The admin's side (view all bids on a project, award it) lives under
 * /api/admin/projects/:id/... so that every admin-only route sits behind the
 * single guard on the admin router.
 */
import { Router } from 'express';

import * as bidController from '../controllers/bid.controller.js';
import { authenticate, authorize } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { ROLES } from '../models/User.js';
import { submitBidRules, bidIdRules, listBidsRules } from '../validators/bid.validators.js';

const router = Router();

router.use(authenticate, authorize(ROLES.CONTRACTOR));

router.post('/', validate(submitBidRules), bidController.submitBid);
router.get('/mine', validate(listBidsRules), bidController.listMyBids);
router.patch('/:id/withdraw', validate(bidIdRules), bidController.withdrawBid);

export default router;
