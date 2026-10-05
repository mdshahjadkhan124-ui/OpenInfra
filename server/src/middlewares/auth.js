/**
 * Authentication and authorization middleware.
 *
 *   authenticate      — proves who you are, populates req.user
 *   authorize(...)    — proves you may do this, by role
 *   optionalAuth      — populates req.user if a token is present, never rejects
 *
 * Design note on why `authenticate` hits the database on every request:
 *
 * The JWT already carries the role, so we could trust the claim and skip the
 * lookup. We deliberately don't. A token is valid for 7 days, and in that window
 * an admin may deactivate an account or change a role. Trusting the claim would
 * leave a deactivated contractor able to collect milestone payouts for a week.
 * One indexed findById per request is a cheap price for revocation that takes
 * effect immediately — and this API's requests already do far heavier work
 * (Gemini calls, chain transactions).
 */
import { User } from '../models/User.js';
import { verifyAccessToken } from '../services/token.service.js';
import { ForbiddenError, UnauthorizedError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/** Pull a bearer token out of the Authorization header. */
const extractToken = (req) => {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!/^Bearer$/i.test(scheme) || !token) return null;
  return token.trim();
};

/** Require a valid token for an active user. Populates req.user. */
export const authenticate = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) {
    throw new UnauthorizedError('Authentication required. Provide a Bearer token.');
  }

  // Throws JsonWebTokenError / TokenExpiredError, which the centralized error
  // handler already translates into 401s with distinct codes.
  const decoded = verifyAccessToken(token);

  const user = await User.findById(decoded.sub);
  if (!user) {
    throw new UnauthorizedError('The account linked to this token no longer exists.');
  }
  if (!user.isActive) {
    throw new ForbiddenError('This account has been deactivated.');
  }

  req.user = user;
  req.token = decoded;
  next();
});

/**
 * Restrict a route to specific roles. Must run after `authenticate`.
 *
 *   router.post('/publish', authenticate, authorize(ROLES.ADMIN), handler);
 */
export const authorize =
  (...allowedRoles) =>
  (req, res, next) => {
    if (!req.user) {
      // A programming error, not a client error: authorize was mounted without
      // authenticate in front of it. Fail closed and say so clearly.
      return next(new UnauthorizedError('Authentication required.'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new ForbiddenError(
          `This action requires the ${allowedRoles.join(' or ')} role. Your role is ${req.user.role}.`
        )
      );
    }

    next();
  };

/**
 * Attach req.user when a token happens to be present, but never reject.
 *
 * Used by the public transparency endpoints (Phase 10), which are open to
 * anonymous visitors but can show extra controls to a logged-in admin.
 */
export const optionalAuth = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) return next();

  try {
    const decoded = verifyAccessToken(token);
    const user = await User.findById(decoded.sub);
    if (user?.isActive) {
      req.user = user;
      req.token = decoded;
    }
  } catch {
    // A bad token on a public route is simply treated as anonymous.
  }

  next();
});
