/**
 * Validation for the public endpoints.
 *
 * Stricter than the authenticated equivalents: these take input from anyone,
 * so the search term is length-capped and the sort is an allowlist rather than
 * a passthrough to a Mongo sort object.
 */
import { param, query } from 'express-validator';
import { PROJECT_STATUS_VALUES } from '../models/Project.js';

export const publicIdRules = [
  param('id').isMongoId().withMessage('That is not a valid project id.'),
];

export const publicListRules = [
  query('status')
    .optional({ values: 'falsy' })
    .isIn([...PROJECT_STATUS_VALUES, 'all'])
    .withMessage(`Status must be one of: ${[...PROJECT_STATUS_VALUES, 'all'].join(', ')}.`),

  query('category')
    .optional({ values: 'falsy' })
    .isLength({ max: 40 })
    .withMessage('Category is too long.'),

  query('q')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 80 })
    .withMessage('Search term must be at most 80 characters.'),

  query('sort')
    .optional({ values: 'falsy' })
    .isIn(['recent', 'oldest', 'highest', 'lowest'])
    .withMessage('Sort must be one of: recent, oldest, highest, lowest.'),

  query('page').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('Page must be 1 or greater.'),
  query('limit')
    .optional({ values: 'falsy' })
    .isInt({ min: 1, max: 48 })
    .withMessage('Limit must be between 1 and 48.'),
];
