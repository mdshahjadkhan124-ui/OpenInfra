/**
 * Public controllers. No authentication anywhere in this file.
 */
import * as publicService from '../services/public.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';

/**
 * Short-lived caching.
 *
 * These are the only endpoints a crawler or a shared link can hammer, and the
 * data changes on the order of minutes. 60 seconds keeps the page honest while
 * absorbing a burst from a link being shared.
 */
const cacheFor = (res, seconds) => {
  res.set('Cache-Control', `public, max-age=${seconds}, stale-while-revalidate=${seconds * 2}`);
};

/** GET /api/public/stats */
export const stats = asyncHandler(async (req, res) => {
  const data = await publicService.getPlatformStats();
  cacheFor(res, 60);
  return sendSuccess(res, { message: 'Platform statistics.', data: { stats: data } });
});

/** GET /api/public/projects */
export const listProjects = asyncHandler(async (req, res) => {
  const { status, category, q, sort, page, limit } = req.query;
  const { projects, meta } = await publicService.listPublicProjects({
    status,
    category,
    q,
    sort,
    page,
    limit,
  });
  cacheFor(res, 60);
  return sendSuccess(res, { message: 'Projects retrieved.', data: { projects }, meta });
});

/** GET /api/public/projects/:id */
export const getProject = asyncHandler(async (req, res) => {
  const data = await publicService.getPublicProject(req.params.id);
  cacheFor(res, 60);
  return sendSuccess(res, { message: 'Project retrieved.', data });
});

/**
 * GET /api/public/projects/:id/verify
 *
 * Not cached: the entire value of this endpoint is that it reflects the chain
 * right now. A cached "everything matches" would defeat the purpose.
 */
export const verifyProject = asyncHandler(async (req, res) => {
  const data = await publicService.verifyAgainstChain(req.params.id);
  res.set('Cache-Control', 'no-store');
  return sendSuccess(res, { message: 'Chain verification.', data });
});

/** GET /api/public/activity */
export const activity = asyncHandler(async (req, res) => {
  const data = await publicService.getRecentActivity({ limit: req.query.limit });
  cacheFor(res, 30);
  return sendSuccess(res, { message: 'Recent on-chain activity.', data });
});
