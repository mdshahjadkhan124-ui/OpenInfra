/**
 * Project — an approved report published for contractor bidding.
 *
 * This is the public face of the money trail. A Report belongs to the citizen
 * who filed it; a Project is a public works item that contractors bid on,
 * funds are escrowed against, and anyone can audit on the transparency
 * dashboard without logging in.
 *
 * WHY THE AI ESTIMATE IS COPIED, NOT REFERENCED
 * ---------------------------------------------
 * `aiEstimatedCost` is a snapshot taken at publish time, not a live lookup
 * through `report`. The estimate is the benchmark every bid is judged against
 * and the basis on which a contractor may be publicly flagged for overcharging.
 * If it were read live, re-analysing or editing the underlying report would
 * retroactively change what bidders were measured against — and could flag a
 * bid that was perfectly reasonable when it was submitted. Freezing it at
 * publication makes the record defensible after the fact.
 */
import mongoose from 'mongoose';

export const PROJECT_STATUS = Object.freeze({
  /** Published and accepting bids. */
  OPEN: 'open',
  /** A contractor has been chosen; funds are being locked on-chain (Phase 6). */
  AWARDED: 'awarded',
  /** Funds locked, milestones underway (Phase 7). */
  IN_PROGRESS: 'in_progress',
  /** Every milestone approved and paid. */
  COMPLETED: 'completed',
});

export const PROJECT_STATUS_VALUES = Object.values(PROJECT_STATUS);

/** Where the cost benchmark came from. Surfaced publicly for transparency. */
export const ESTIMATE_SOURCE = Object.freeze({
  AI: 'ai_vision_estimate',
  /** An admin overrode or supplied the figure — e.g. after overturning an AI rejection. */
  ADMIN: 'admin_override',
});

/**
 * Frozen copy of the cost benchmark.
 *
 * A range, not a point value: see services/gemini.service.js for the
 * measurement that motivated it. `maxAmount` is what Phase 5 scores bids
 * against.
 */
const estimatedCostSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    minAmount: { type: Number, required: true, min: 0 },
    maxAmount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true },
    severity: { type: String, default: 'medium' },
    breakdown: {
      type: [{ _id: false, item: String, cost: Number }],
      default: [],
    },
    assumptions: { type: [String], default: [] },
    confidence: { type: Number, min: 0, max: 1, default: 0 },
    source: {
      type: String,
      enum: Object.values(ESTIMATE_SOURCE),
      default: ESTIMATE_SOURCE.AI,
    },
    /** Model name, or the admin's id when source is an override. */
    producedBy: { type: String, default: null },
  },
  { _id: false }
);

const locationSchema = new mongoose.Schema(
  {
    address: { type: String, required: true, trim: true },
    city: { type: String, default: null },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
  },
  { _id: false }
);

const projectSchema = new mongoose.Schema(
  {
    /** One project per report — enforced by the unique index below. */
    report: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Report',
      required: true,
      unique: true,
    },

    /** The citizen whose report became this project. Credited publicly. */
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    title: {
      type: String,
      required: [true, 'Title is required.'],
      trim: true,
      minlength: [5, 'Title must be at least 5 characters.'],
      maxlength: [140, 'Title must be at most 140 characters.'],
    },

    description: { type: String, required: true, trim: true, maxlength: 2000 },

    /** Copied from the report so the public dashboard needs no join. */
    imageUrl: { type: String, required: true },
    location: { type: locationSchema, required: true },
    category: { type: String, default: 'other_infrastructure', index: true },

    aiEstimatedCost: { type: estimatedCostSchema, required: true },

    status: {
      type: String,
      enum: { values: PROJECT_STATUS_VALUES, message: '{VALUE} is not a valid project status.' },
      default: PROJECT_STATUS.OPEN,
      index: true,
    },

    // --- Award (Phase 5) ---------------------------------------------------
    awardedContractor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    awardedBid: { type: mongoose.Schema.Types.ObjectId, ref: 'Bid', default: null },
    /** The winning bid amount, in the same currency as the estimate. */
    awardedAmount: { type: Number, default: null, min: 0 },
    awardedAt: { type: Date, default: null },

    // --- Escrow (Phase 6) --------------------------------------------------
    /**
     * Total locked in the escrow contract, denominated in wei as a decimal
     * string. A string because Number cannot hold 1e18 safely, and Mongoose
     * has no native bigint — the chain layer parses it with BigInt().
     */
    totalLockedFunds: { type: String, default: '0' },
    totalReleasedFunds: { type: String, default: '0' },
    smartContractAddress: { type: String, default: null },
    /** On-chain project id inside the escrow contract. */
    onChainProjectId: { type: Number, default: null },
    fundingTxHash: { type: String, default: null },
    /**
     * The wallet that actually signed the deposit. Recorded because the point
     * of moving signing to MetaMask is that a payment is attributable to a
     * named official's own key, not to the platform's server.
     */
    fundedBy: { type: String, default: null },

    // --- Publication -------------------------------------------------------
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    publishedAt: { type: Date, default: Date.now },
    /** Optional cut-off after which bids are no longer accepted. */
    bidsCloseAt: { type: Date, default: null },

    completedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret.__v;
        delete ret._id;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

projectSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

// The queries this collection serves: the contractor's open-projects board,
// the public dashboard, and "what has this contractor been awarded".
projectSchema.index({ status: 1, createdAt: -1 });
projectSchema.index({ awardedContractor: 1, status: 1 });

/** Bids are only accepted while the project is open and before any deadline. */
projectSchema.virtual('isAcceptingBids').get(function () {
  if (this.status !== PROJECT_STATUS.OPEN) return false;
  return !this.bidsCloseAt || this.bidsCloseAt > new Date();
});

/**
 * The figure Phase 5 scores bids against — the generous end of the range.
 * Exposed as a virtual so no caller has to remember which bound is the basis.
 */
projectSchema.virtual('biddingBenchmark').get(function () {
  return this.aiEstimatedCost?.maxAmount ?? null;
});

export const Project = mongoose.model('Project', projectSchema);
export default Project;
