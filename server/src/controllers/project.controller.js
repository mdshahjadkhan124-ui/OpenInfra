/**
 * Project read controllers.
 */
import * as projectService from '../services/project.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';

/** GET /api/projects — defaults to open projects (the contractor's board). */
export const listProjects = asyncHandler(async (req, res) => {
  const { status, category, page, limit } = req.query;
  const { projects, meta } = await projectService.listProjects({ status, category, page, limit });

  return sendSuccess(res, { message: 'Projects retrieved.', data: { projects }, meta });
});

/** GET /api/projects/mine — projects awarded to the calling contractor. */
export const listMyProjects = asyncHandler(async (req, res) => {
  const { status, page, limit } = req.query;
  const { projects, meta } = await projectService.listProjectsForContractor(req.user.id, {
    status,
    page,
    limit,
  });

  return sendSuccess(res, { message: 'Projects retrieved.', data: { projects }, meta });
});

/** GET /api/projects/:id */
export const getProject = asyncHandler(async (req, res) => {
  const project = await projectService.getProjectById(req.params.id);
  return sendSuccess(res, { message: 'Project retrieved.', data: { project: project.toJSON() } });
});
