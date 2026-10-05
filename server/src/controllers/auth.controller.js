/**
 * Auth controllers — parse the request, call a service, shape the response.
 * No business logic, no Mongoose.
 */
import passport from 'passport';
import { config } from '../config/env.js';
import * as authService from '../services/auth.service.js';
import { SELF_ASSIGNABLE_ROLES } from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { BadRequestError, ServiceUnavailableError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

/** POST /api/auth/register */
export const register = asyncHandler(async (req, res) => {
  const { name, email, password, role, walletAddress } = req.body;
  const payload = await authService.registerUser({ name, email, password, role, walletAddress });

  return sendSuccess(res, {
    statusCode: 201,
    message: 'Account created successfully.',
    data: payload,
  });
});

/** POST /api/auth/login */
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const payload = await authService.loginUser({ email, password });

  return sendSuccess(res, { message: 'Signed in successfully.', data: payload });
});

/** GET /api/auth/me — the token's own user. */
export const getMe = asyncHandler(async (req, res) =>
  sendSuccess(res, { message: 'Current user.', data: { user: req.user.toJSON() } })
);

/** PATCH /api/auth/wallet — set or change the payout address. */
export const updateWallet = asyncHandler(async (req, res) => {
  const user = await authService.updateWalletAddress(req.user.id, req.body.walletAddress);
  return sendSuccess(res, { message: 'Wallet address updated.', data: { user } });
});

/** GET /api/auth/users — admin only. */
export const listUsers = asyncHandler(async (req, res) => {
  const { role, page, limit } = req.query;
  const { users, meta } = await authService.listUsers({ role, page, limit });
  return sendSuccess(res, { message: 'Users retrieved.', data: { users }, meta });
});

/**
 * POST /api/auth/logout
 *
 * JWTs are stateless, so there is nothing to revoke server-side; the client
 * discards the token. The endpoint exists so the frontend has one obvious thing
 * to call, and so a future token-blocklist has a home.
 */
export const logout = asyncHandler(async (req, res) =>
  sendSuccess(res, { message: 'Signed out. Please discard your token.' })
);

// ---------------------------------------------------------------------------
// Google OAuth
// ---------------------------------------------------------------------------

/**
 * GET /api/auth/google — start the handshake.
 *
 * The desired role travels in the OAuth `state` parameter. Google returns it
 * untouched on the callback, which is how a contractor signing up with Google
 * ends up a contractor rather than the default citizen. `state` is also the
 * standard CSRF defence for OAuth, and passport verifies it round-trips.
 */
export const googleAuth = (req, res, next) => {
  if (!config.googleOAuth.ready) {
    return next(
      new ServiceUnavailableError(
        'Google sign-in is not configured on this server. Use email and password instead.'
      )
    );
  }

  const requestedRole = SELF_ASSIGNABLE_ROLES.includes(req.query.role) ? req.query.role : 'citizen';

  return passport.authenticate('google', {
    session: false,
    scope: ['profile', 'email'],
    state: requestedRole,
  })(req, res, next);
};

/**
 * GET /api/auth/google/callback
 *
 * On success we redirect back to the SPA with the JWT in the URL **fragment**,
 * not the query string. A fragment is never sent to a server, so the token
 * stays out of server access logs, proxy logs and the Referer header of the
 * next request. The frontend reads it from location.hash and clears the hash
 * immediately via history.replaceState.
 */
export const googleCallback = (req, res, next) => {
  if (!config.googleOAuth.ready) {
    return next(new ServiceUnavailableError('Google sign-in is not configured on this server.'));
  }

  const failureRedirect = (reason) =>
    res.redirect(`${config.clientUrl}/login?error=${encodeURIComponent(reason)}`);

  // Passport's default for a callback with neither `code` nor `error` is to
  // start a fresh handshake, which sends the visitor back to Google and can
  // loop. Someone landing here with no parameters did not come from Google, so
  // treat it as a failed sign-in instead.
  if (!req.query.code && !req.query.error) {
    return failureRedirect('Google sign-in did not complete. Please try again.');
  }

  passport.authenticate('google', { session: false }, async (err, profile) => {

    if (err) {
      logger.error('Google OAuth error:', err.message);
      return failureRedirect('Google sign-in failed. Please try again.');
    }
    if (!profile) {
      return failureRedirect('Google sign-in was cancelled.');
    }

    try {
      const { token, user } = await authService.findOrCreateGoogleUser({
        ...profile,
        role: req.query.state,
      });

      const fragment = new URLSearchParams({ token, role: user.role }).toString();
      return res.redirect(`${config.clientUrl}/auth/callback#${fragment}`);
    } catch (serviceErr) {
      logger.error('Google sign-in post-processing failed:', serviceErr.message);
      return failureRedirect(serviceErr.message ?? 'Google sign-in failed.');
    }
  })(req, res, next);
};
