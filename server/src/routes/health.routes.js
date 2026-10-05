import { Router } from 'express';
import { getHealth } from '../controllers/health.controller.js';

const router = Router();

/** GET /api/health — liveness + dependency check. Public. */
router.get('/', getHealth);

export default router;
