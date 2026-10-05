/**
 * Validation for the milestone routes.
 */
import { body, param, query } from 'express-validator';
import { MILESTONE_STATUS_VALUES } from '../models/Milestone.js';

export const milestoneIdRules = [
  param('id').isMongoId().withMessage('That is not a valid milestone id.'),
];

export const projectIdParamRules = [
  param('projectId').isMongoId().withMessage('That is not a valid project id.'),
];

export const submitProgressRules = [
  ...milestoneIdRules,
  body('note')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Note must be at most 1000 characters.'),
];

export const approveMilestoneRules = [
  ...milestoneIdRules,
  body('overrideAiRejection')
    .optional()
    .isBoolean()
    .withMessage('overrideAiRejection must be true or false.'),
  body('justification')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ min: 20, max: 1000 })
    .withMessage('Justification must be between 20 and 1000 characters.'),
];

export const rejectMilestoneRules = [
  ...milestoneIdRules,
  body('reason')
    .trim()
    .notEmpty()
    .withMessage('A reason is required — it is shown to the contractor.')
    .isLength({ min: 10, max: 500 })
    .withMessage('Reason must be between 10 and 500 characters.'),
];

export const listMilestonesRules = [
  query('status')
    .optional({ values: 'falsy' })
    .isIn([...MILESTONE_STATUS_VALUES, 'all'])
    .withMessage(`Status must be one of: ${[...MILESTONE_STATUS_VALUES, 'all'].join(', ')}.`),
];

/**
 * Award now carries the milestone schedule and the escrow amount.
 *
 * The "percentages sum to 100" rule is checked in the service rather than
 * here, so the error can name the actual total and explain *why* it matters
 * (unallocated funds would be unreleasable) in one coherent message.
 */
export const awardWithMilestonesRules = [
  param('id').isMongoId().withMessage('That is not a valid project id.'),
  body('bidId').isMongoId().withMessage('A valid bidId is required.'),

  body('milestones')
    .isArray({ min: 1, max: 20 })
    .withMessage('Provide between 1 and 20 milestones.'),
  body('milestones.*.description')
    .trim()
    .isLength({ min: 5, max: 500 })
    .withMessage('Each milestone needs a description of 5 to 500 characters.'),
  body('milestones.*.fundPercentage')
    .isFloat({ gt: 0, max: 100 })
    .withMessage('Each fundPercentage must be greater than 0 and at most 100.'),

  body('escrowAmountEth')
    .optional({ values: 'falsy' })
    .isFloat({ gt: 0, max: 100 })
    .withMessage('escrowAmountEth must be a positive number of ETH (at most 100).'),
];
