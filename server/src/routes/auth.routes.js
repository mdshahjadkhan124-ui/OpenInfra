/**
 * /api/auth
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import * as authController from '../controllers/auth.controller.js';
import { authenticate, authorize } from '../middlewares/auth.js';
import { ROLES } from '../models/User.js';
import { validate } from '../middlewares/validate.js';
import { registerRules, loginRules, walletRules } from '../validators/auth.validators.js';
import { config } from '../config/env.js';

const router = Router();

/**
 * Credential endpoints get a far tighter limit than the global one.
 * The global limiter is about fair use; this one is about brute force, so it
 * counts only failures — a legitimate user who signs in correctly a few times
 * is never locked out.
 */
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.isProduction ? 10 : 100,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many failed attempts. Please try again in 15 minutes.',
    code: 'RATE_LIMITED',
  },
});

// --- Local auth ----------------------------------------------------------
router.post('/register', credentialLimiter, validate(registerRules), authController.register);
router.post('/login', credentialLimiter, validate(loginRules), authController.login);
router.post('/logout', authController.logout);

// --- Google OAuth --------------------------------------------------------
// GET /api/auth/google?role=contractor   → redirects to Google
router.get('/google', authController.googleAuth);
router.get('/google/callback', authController.googleCallback);

// --- Current user --------------------------------------------------------
router.get('/me', authenticate, authController.getMe);
router.patch('/wallet', authenticate, validate(walletRules), authController.updateWallet);

// --- Admin only ----------------------------------------------------------
// The role guard always runs *after* authenticate, which populates req.user.
router.get('/users', authenticate, authorize(ROLES.ADMIN), authController.listUsers);

export default router;
