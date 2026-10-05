/**
 * Input validation for the auth routes.
 *
 * Validation lives here rather than in controllers so the rules are readable in
 * one place and the controller stays a thin orchestrator.
 */
import { body } from 'express-validator';
import { SELF_ASSIGNABLE_ROLES, ETH_ADDRESS_PATTERN } from '../models/User.js';

export const registerRules = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Name is required.')
    .isLength({ min: 2, max: 80 })
    .withMessage('Name must be between 2 and 80 characters.'),

  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required.')
    .isEmail()
    .withMessage('Enter a valid email address.')
    .normalizeEmail({ gmail_remove_dots: false }),

  body('password')
    .notEmpty()
    .withMessage('Password is required.')
    .isLength({ min: 8, max: 128 })
    .withMessage('Password must be between 8 and 128 characters.')
    // Deliberately a low bar beyond length: length dominates entropy, and
    // aggressive composition rules push people toward "Password1!".
    .matches(/[a-zA-Z]/)
    .withMessage('Password must contain at least one letter.')
    .matches(/\d/)
    .withMessage('Password must contain at least one number.'),

  body('role')
    .optional()
    .isIn(SELF_ASSIGNABLE_ROLES)
    .withMessage(`Role must be one of: ${SELF_ASSIGNABLE_ROLES.join(', ')}.`),

  body('walletAddress')
    .optional({ values: 'falsy' })
    .matches(ETH_ADDRESS_PATTERN)
    .withMessage('Wallet address must be a valid Ethereum address (0x + 40 hex characters).'),
];

export const loginRules = [
  body('email').trim().notEmpty().withMessage('Email is required.').isEmail().withMessage('Enter a valid email address.'),
  body('password').notEmpty().withMessage('Password is required.'),
];

export const walletRules = [
  body('walletAddress')
    .trim()
    .notEmpty()
    .withMessage('Wallet address is required.')
    .matches(ETH_ADDRESS_PATTERN)
    .withMessage('Wallet address must be a valid Ethereum address (0x + 40 hex characters).'),
];
