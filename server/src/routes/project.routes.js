/**
 * /api/projects — read side.
 *
 * Authenticated for now: contractors browse open projects here. Phase 10 adds
 * the unauthenticated public transparency endpoints under /api/public, which
 * is kept separate so the two can diverge — the public view exposes the money
 * trail but not, say, a contractor's contact details.
 */
import { Router } from 'express';

import * as projectController from '../controllers/project.controller.js';
import { authenticate } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { mongoIdRules, listProjectsRules } from '../validators/admin.validators.js';

const router = Router();

router.use(authenticate);

// `/mine` must be declared before `/:id`, or Express would treat "mine" as an id.
router.get('/mine', validate(listProjectsRules), projectController.listMyProjects);
router.get('/', validate(listProjectsRules), projectController.listProjects);
router.get('/:id', validate(mongoIdRules), projectController.getProject);

export default router;
