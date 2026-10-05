/**
 * Project reads.
 *
 * Writes live where the decision that causes them lives: publication in
 * review.service.js (Phase 4), awarding in bid.service.js (Phase 5), escrow
 * and milestone payouts in the chain services (Phases 6–7). This module is the
 * read side, shared by the contractor board, the admin dashboard and the
 * public transparency page.
 */
import { Project, PROJECT_STATUS, PROJECT_STATUS_VALUES } from '../models/Project.js';
import { NotFoundError } from '../utils/ApiError.js';

/** Fields every caller needs about the people attached to a project. */
const POPULATE = [
  { path: 'reporter', select: 'name' },
  { path: 'awardedContractor', select: 'name walletAddress' },
];

/**
 * List projects.
 *
 * Defaults to `open`, which is what a contractor's board wants. Pass
 * `status: 'all'` for the admin and public views.
 */
export const listProjects = async ({ status = PROJECT_STATUS.OPEN, category, page = 1, limit = 20 } = {}) => {
  const filter = {};
  if (status && status !== 'all') filter.status = status;
  if (category) filter.category = category;

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);

  const [projects, total] = await Promise.all([
    Project.find(filter)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .populate(POPULATE),
    Project.countDocuments(filter),
  ]);

  return {
    projects: projects.map((p) => p.toJSON()),
    meta: { total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) || 1 },
  };
};

export const getProjectById = async (projectId) => {
  const project = await Project.findById(projectId).populate(POPULATE);
  if (!project) throw new NotFoundError('Project not found.');
  return project;
};

/** Projects awarded to one contractor. */
export const listProjectsForContractor = async (contractorId, { status, page = 1, limit = 20 } = {}) => {
  const filter = { awardedContractor: contractorId };
  if (status && status !== 'all') filter.status = status;

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);

  const [projects, total] = await Promise.all([
    Project.find(filter)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .populate(POPULATE),
    Project.countDocuments(filter),
  ]);

  return {
    projects: projects.map((p) => p.toJSON()),
    meta: { total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) || 1 },
  };
};

export { PROJECT_STATUS, PROJECT_STATUS_VALUES };
