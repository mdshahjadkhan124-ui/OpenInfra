/**
 * Validation for the admin review and project routes.
 */
import { body, param, query } from 'express-validator';
import { REPORT_STATUS_VALUES } from '../models/Report.js';
import { PROJECT_STATUS_VALUES } from '../models/Project.js';

export const mongoIdRules = [param('id').isMongoId().withMessage('That is not a valid id.')];

export const reviewQueueRules = [
  query('status')
    .optional({ values: 'falsy' })
    .isIn([...REPORT_STATUS_VALUES, 'all'])
    .withMessage(`Status must be one of: ${[...REPORT_STATUS_VALUES, 'all'].join(', ')}.`),
  query('page').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('Page must be 1 or greater.'),
  query('limit').optional({ values: 'falsy' }).isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100.'),
];

export const rejectReportRules = [
  ...mongoIdRules,
  body('reason')
    .trim()
    .notEmpty()
    .withMessage('A reason is required — it is shown to the citizen who filed the report.')
    .isLength({ min: 10, max: 500 })
    .withMessage('Reason must be between 10 and 500 characters.'),
];

export const publishReportRules = [
  ...mongoIdRules,

  body('title')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ min: 5, max: 140 })
    .withMessage('Title must be between 5 and 140 characters.'),

  body('description')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ min: 10, max: 2000 })
    .withMessage('Description must be between 10 and 2000 characters.'),

  body('bidsCloseAt')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('bidsCloseAt must be an ISO 8601 date.')
    .custom((value) => {
      if (new Date(value) <= new Date()) throw new Error('bidsCloseAt must be in the future.');
      return true;
    }),

  // Override estimate. Ordering (min <= amount <= max) is checked in the
  // service, where it can produce one coherent message about the whole range.
  body('estimate').optional().isObject().withMessage('estimate must be an object.'),
  body('estimate.minAmount')
    .if(body('estimate').exists())
    .isFloat({ min: 0 })
    .withMessage('estimate.minAmount must be a non-negative number.'),
  body('estimate.amount')
    .if(body('estimate').exists())
    .isFloat({ min: 0 })
    .withMessage('estimate.amount must be a non-negative number.'),
  body('estimate.maxAmount')
    .if(body('estimate').exists())
    .isFloat({ min: 0 })
    .withMessage('estimate.maxAmount must be a non-negative number.'),
];

export const listProjectsRules = [
  query('status')
    .optional({ values: 'falsy' })
    .isIn([...PROJECT_STATUS_VALUES, 'all'])
    .withMessage(`Status must be one of: ${[...PROJECT_STATUS_VALUES, 'all'].join(', ')}.`),
  query('page').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('Page must be 1 or greater.'),
  query('limit').optional({ values: 'falsy' }).isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100.'),
];
