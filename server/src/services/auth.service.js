/**
 * Authentication business logic.
 *
 * Services never touch req/res. Everything here is callable from a controller,
 * a seed script or a test.
 */
import { User, ROLES, SELF_ASSIGNABLE_ROLES } from '../models/User.js';
import { signAccessToken } from './token.service.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

/** Shape returned to the client after any successful authentication. */
const authPayload = (user) => ({
  token: signAccessToken(user),
  user: user.toJSON(),
});

/**
 * Register a local (email + password) account.
 *
 * `role` is accepted from the request but checked against SELF_ASSIGNABLE_ROLES,
 * so `{"role":"admin"}` in the body is rejected rather than silently honoured.
 */
export const registerUser = async ({ name, email, password, role = ROLES.CITIZEN, walletAddress }) => {
  if (!SELF_ASSIGNABLE_ROLES.includes(role)) {
    throw new ForbiddenError(
      `Role '${role}' cannot be self-assigned. Choose one of: ${SELF_ASSIGNABLE_ROLES.join(', ')}.`
    );
  }

  const normalisedEmail = email.toLowerCase().trim();
  const existing = await User.findOne({ email: normalisedEmail });

  if (existing) {
    // A Google user registering locally is a different situation from a plain
    // duplicate, and telling them which to use saves a support round-trip.
    if (existing.googleId) {
      throw new ConflictError(
        'This email is already registered through Google. Please sign in with Google instead.'
      );
    }
    throw new ConflictError('An account with this email already exists.');
  }

  const user = await User.create({
    name,
    email: normalisedEmail,
    password,
    role,
    walletAddress: walletAddress ?? null,
  });

  logger.info(`New ${role} registered: ${user.email}`);
  return authPayload(user);
};

/**
 * Authenticate a local account.
 *
 * Both "no such user" and "wrong password" return the same message, so the
 * endpoint cannot be used to enumerate which emails have accounts.
 */
export const loginUser = async ({ email, password }) => {
  // password is select:false on the schema, so ask for it explicitly.
  const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');

  if (!user) throw new UnauthorizedError('Incorrect email or password.');

  if (!user.password && user.googleId) {
    throw new UnauthorizedError(
      'This account was created with Google. Please sign in with Google.'
    );
  }

  const matches = await user.comparePassword(password);
  if (!matches) throw new UnauthorizedError('Incorrect email or password.');

  if (!user.isActive) {
    throw new ForbiddenError('This account has been deactivated. Contact an administrator.');
  }

  user.lastLoginAt = new Date();
  await user.save({ validateBeforeSave: false });

  return authPayload(user);
};

/**
 * Find or create a user from a verified Google profile.
 *
 * Three cases:
 *   1. Known googleId        → sign in.
 *   2. Same email, local acct → link the Google id to it, rather than creating
 *                               a second account for the same person.
 *   3. Neither               → create a new account with the requested role.
 */
export const findOrCreateGoogleUser = async ({ googleId, email, name, avatarUrl, role }) => {
  const requestedRole = SELF_ASSIGNABLE_ROLES.includes(role) ? role : ROLES.CITIZEN;
  const normalisedEmail = email?.toLowerCase().trim();

  if (!normalisedEmail) {
    throw new BadRequestError('Google did not return an email address for this account.');
  }

  let user = await User.findOne({ googleId });

  if (!user) {
    user = await User.findOne({ email: normalisedEmail });

    if (user) {
      // Account linking. Safe because Google has verified ownership of the
      // email, which is the same thing the local account is keyed on.
      user.googleId = googleId;
      if (!user.avatarUrl && avatarUrl) user.avatarUrl = avatarUrl;
      await user.save({ validateBeforeSave: false });
      logger.info(`Linked Google identity to existing account: ${user.email}`);
    } else {
      user = await User.create({
        googleId,
        email: normalisedEmail,
        name: name || normalisedEmail.split('@')[0],
        avatarUrl: avatarUrl ?? null,
        role: requestedRole,
      });
      logger.info(`New ${requestedRole} registered via Google: ${user.email}`);
    }
  }

  if (!user.isActive) {
    throw new ForbiddenError('This account has been deactivated. Contact an administrator.');
  }

  user.lastLoginAt = new Date();
  await user.save({ validateBeforeSave: false });

  return authPayload(user);
};

export const getUserById = async (id) => {
  const user = await User.findById(id);
  if (!user) throw new NotFoundError('User not found.');
  return user;
};

/**
 * Set or change the payout wallet.
 *
 * Addresses are unique across users: two contractors sharing one address would
 * make an on-chain payout ambiguous to audit.
 */
/**
 * Admin-only user directory, paginated.
 *
 * Exists in Phase 2 mainly so the role guard has a real endpoint to protect,
 * but the admin dashboard needs it regardless (Phase 9).
 */
export const listUsers = async ({ role, page = 1, limit = 20 } = {}) => {
  const filter = role ? { role } : {};
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);

  const [users, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit),
    User.countDocuments(filter),
  ]);

  return {
    users: users.map((u) => u.toJSON()),
    meta: { total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) || 1 },
  };
};

export const updateWalletAddress = async (userId, walletAddress) => {
  const normalised = walletAddress.toLowerCase();

  const owner = await User.findOne({ walletAddress: normalised, _id: { $ne: userId } });
  if (owner) {
    throw new ConflictError('That wallet address is already linked to another account.');
  }

  const user = await User.findById(userId);
  if (!user) throw new NotFoundError('User not found.');

  user.walletAddress = normalised;
  await user.save();

  return user.toJSON();
};
