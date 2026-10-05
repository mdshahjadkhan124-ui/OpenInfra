/**
 * API router — the single place every route group is mounted.
 * Each phase adds one line here.
 */
import { Router } from 'express';
import healthRoutes from './health.routes.js';

const router = Router();

router.use('/health', healthRoutes);

// Phase 2: router.use('/auth', authRoutes);
// Phase 3: router.use('/reports', reportRoutes);
// Phase 4: router.use('/projects', projectRoutes);
// Phase 5: router.use('/bids', bidRoutes);
// Phase 7: router.use('/milestones', milestoneRoutes);
// Phase 10: router.use('/public', publicRoutes);

export default router;
