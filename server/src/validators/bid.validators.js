/**
 * Validation for the bidding routes.
 */
import { body, param, query } from 'express-validator';
import { BID_STATUS_VALUES } from '../models/Bid.js';
import { ETH_ADDRESS_PATTERN } from '../models/User.js';

export const submitBidRules = [
  body('projectId').isMongoId().withMessage('A valid projectId is required.'),

  body('bidAmount')
    .notEmpty()
    .withMessage('A bid amount is required.')
    .isFloat({ min: 1 })
    .withMessage('Bid amount must be greater than zero.')
    // A bid is a monetary offer, not a budget line — reject absurd values
    // outright rather than letting them into the anomaly table.
    .isFloat({ max: 1e12 })
    .withMessage('Bid amount is implausibly large.'),

  body('proposal')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Proposal must be at most 2000 characters.'),

  body('estimatedDays')
    .optional({ values: 'falsy' })
    .isInt({ min: 1, max: 3650 })
    .withMessage('Estimated days must be between 1 and 3650.'),

  body('walletAddress')
    .optional({ values: 'falsy' })
    .matches(ETH_ADDRESS_PATTERN)
    .withMessage('Wallet address must be a valid Ethereum address (0x + 40 hex characters).'),
];

export const bidIdRules = [param('id').isMongoId().withMessage('That is not a valid bid id.')];

export const awardRules = [
  param('id').isMongoId().withMessage('That is not a valid project id.'),
  body('bidId').isMongoId().withMessage('A valid bidId is required.'),
];

export const listBidsRules = [
  query('status')
    .optional({ values: 'falsy' })
    .isIn([...BID_STATUS_VALUES, 'all'])
    .withMessage(`Status must be one of: ${[...BID_STATUS_VALUES, 'all'].join(', ')}.`),
  query('page').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('Page must be 1 or greater.'),
  query('limit').optional({ values: 'falsy' }).isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100.'),
];
