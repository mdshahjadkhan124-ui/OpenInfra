/**
 * API router — the single place every route group is mounted.
 * Each phase adds one line here.
 */
import { Router } from 'express';
import healthRoutes from './health.routes.js';
import authRoutes from './auth.routes.js';
import reportRoutes from './report.routes.js';
import adminRoutes from './admin.routes.js';
import projectRoutes from './project.routes.js';
import bidRoutes from './bid.routes.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/reports', reportRoutes);
router.use('/admin', adminRoutes);
router.use('/projects', projectRoutes);
router.use('/bids', bidRoutes);
// Phase 7: router.use('/milestones', milestoneRoutes);
// Phase 10: router.use('/public', publicRoutes);

export default router;
