/**
 * User model — the single identity record for all three roles.
 *
 * One collection rather than three, because the roles share almost every field
 * and a user could plausibly hold more than one over time. The role is the only
 * thing that differs, and it drives every authorization decision in the app.
 */
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import validator from 'validator';

/** The three roles. Exported so middleware and validators share one source of truth. */
export const ROLES = Object.freeze({
  CITIZEN: 'citizen',
  CONTRACTOR: 'contractor',
  ADMIN: 'admin',
});

export const ROLE_VALUES = Object.values(ROLES);

/**
 * Roles a visitor may give themselves at signup.
 *
 * `admin` is deliberately absent: it is granted only by the seed script or by an
 * existing admin. Letting a request body choose its own role is how a public
 * signup form becomes a privilege escalation.
 */
export const SELF_ASSIGNABLE_ROLES = Object.freeze([ROLES.CITIZEN, ROLES.CONTRACTOR]);

/** Ethereum address: 0x followed by 40 hex characters. */
export const ETH_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

const BCRYPT_ROUNDS = 12;

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required.'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters.'],
      maxlength: [80, 'Name must be at most 80 characters.'],
    },

    email: {
      type: String,
      required: [true, 'Email is required.'],
      unique: true,
      lowercase: true,
      trim: true,
      validate: {
        validator: (value) => validator.isEmail(value),
        message: 'Please provide a valid email address.',
      },
    },

    password: {
      type: String,
      // Google users have no password. Required only for local accounts.
      required: [
        function () {
          return !this.googleId;
        },
        'Password is required.',
      ],
      minlength: [8, 'Password must be at least 8 characters.'],
      // Never returned by a query unless explicitly re-selected. Prevents the
      // hash leaking through any endpoint that forgets to strip it.
      select: false,
    },

    googleId: {
      type: String,
      // `sparse` so the unique index ignores the many documents without one;
      // a plain unique index would reject every local account after the first.
      unique: true,
      sparse: true,
      index: true,
    },

    avatarUrl: { type: String, default: null },

    role: {
      type: String,
      enum: { values: ROLE_VALUES, message: '{VALUE} is not a valid role.' },
      default: ROLES.CITIZEN,
      index: true,
    },

    /**
     * Payout address. Contractors must have one before they can be awarded a
     * project (enforced in Phase 5, not here — a contractor may sign up first
     * and connect a wallet later).
     */
    walletAddress: {
      type: String,
      default: null,
      trim: true,
      validate: {
        validator: (value) => value === null || ETH_ADDRESS_PATTERN.test(value),
        message: 'Wallet address must be a valid Ethereum address (0x + 40 hex characters).',
      },
    },

    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      /**
       * Last line of defence: even if a controller hands a raw document to
       * res.json(), the hash and Mongo internals never reach the client.
       */
      transform(_doc, ret) {
        delete ret.password;
        delete ret.__v;
        delete ret._id;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

// `id` virtual (string form of _id) is what the frontend uses throughout.
userSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

/**
 * Hash the password whenever it is set or changed.
 *
 * Lives on the model rather than in the service so there is no code path —
 * service, script, seed, test — that can write a plaintext password.
 */
userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password') || !this.password) return next();
  this.password = await bcrypt.hash(this.password, BCRYPT_ROUNDS);
  next();
});

/** Normalise wallet addresses to lowercase so comparisons are reliable. */
userSchema.pre('save', function normaliseWallet(next) {
  if (this.isModified('walletAddress') && this.walletAddress) {
    this.walletAddress = this.walletAddress.toLowerCase();
  }
  next();
});

/**
 * Constant-time password check.
 * Returns false for Google-only accounts, which have no hash to compare against.
 */
userSchema.methods.comparePassword = async function comparePassword(candidate) {
  if (!this.password) return false;
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.hasRole = function hasRole(...roles) {
  return roles.includes(this.role);
};

export const User = mongoose.model('User', userSchema);
export default User;
