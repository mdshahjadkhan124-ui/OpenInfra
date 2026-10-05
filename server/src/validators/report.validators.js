/**
 * Validation for the report routes.
 *
 * These run on multipart/form-data bodies, so every value arrives as a string;
 * coordinates are validated as numeric strings and converted in the controller.
 */
import { body, param, query } from 'express-validator';
import { REPORT_STATUS_VALUES } from '../models/Report.js';

export const createReportRules = [
  body('description')
    .trim()
    .notEmpty()
    .withMessage('Please describe the problem.')
    .isLength({ min: 10, max: 1000 })
    .withMessage('Description must be between 10 and 1000 characters.'),

  body('address')
    .trim()
    .notEmpty()
    .withMessage('Please provide the location of the problem.')
    .isLength({ min: 3, max: 300 })
    .withMessage('Address must be between 3 and 300 characters.'),

  body('city').optional({ values: 'falsy' }).trim().isLength({ max: 100 }).withMessage('City must be at most 100 characters.'),

  body('latitude')
    .optional({ values: 'falsy' })
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude must be between -90 and 90.'),

  body('longitude')
    .optional({ values: 'falsy' })
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude must be between -180 and 180.'),
];

export const reportIdRules = [
  param('id').isMongoId().withMessage('That is not a valid report id.'),
];

export const listReportsRules = [
  query('status')
    .optional({ values: 'falsy' })
    .isIn(REPORT_STATUS_VALUES)
    .withMessage(`Status must be one of: ${REPORT_STATUS_VALUES.join(', ')}.`),
  query('page').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('Page must be 1 or greater.'),
  query('limit').optional({ values: 'falsy' }).isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100.'),
];
