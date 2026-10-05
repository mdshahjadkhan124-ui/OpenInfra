/**
 * Bid — a contractor's offer to carry out a published project.
 *
 * The anomaly verdict is stored on the bid, not computed on read. Two reasons:
 *
 *  1. **It is an accusation with a timestamp.** A flag says "this bid exceeded
 *     the assessed cost by more than X%". The benchmark and the margin that
 *     produced that verdict must be preserved alongside it, or a later change
 *     to either would silently rewrite history — and a contractor disputing a
 *     flag deserves to see the exact figures used against them.
 *
 *  2. The admin bid table sorts and filters on it, which a virtual cannot do.
 */
import mongoose from 'mongoose';
import { ANOMALY_LEVEL } from '../services/anomaly.service.js';

export const BID_STATUS = Object.freeze({
  /** Submitted, awaiting the admin's decision. */
  PENDING: 'pending',
  /** This bid won the project. */
  ACCEPTED: 'accepted',
  /** Another bid won, or the admin declined this one. */
  REJECTED: 'rejected',
  /** The contractor withdrew it before a decision. */
  WITHDRAWN: 'withdrawn',
});

export const BID_STATUS_VALUES = Object.values(BID_STATUS);

export const ANOMALY_BAND_VALUES = Object.values(ANOMALY_LEVEL);

/** The bands that constitute a flag. Single source of truth for both syncs. */
const FLAGGED_BANDS = [ANOMALY_LEVEL.FLAGGED, ANOMALY_LEVEL.SEVERE];

/**
 * Frozen record of how this bid was scored.
 *
 * Everything needed to reproduce the verdict: the bound it was compared
 * against, the margin in force, and the computed threshold.
 */
const anomalySchema = new mongoose.Schema(
  {
    band: { type: String, enum: ANOMALY_BAND_VALUES, required: true },
    /** The project's frozen aiEstimatedCost.maxAmount at submission time. */
    benchmarkAmount: { type: Number, default: null },
    /** The expected value, kept for display: "X% over expected". */
    expectedAmount: { type: Number, default: null },
    /** benchmarkAmount x (1 + margin/100) — the line this bid was judged by. */
    thresholdAmount: { type: Number, default: null },
    marginPercent: { type: Number, required: true },
    /** Percentage above the upper bound. Negative when inside the range. */
    deviationPercent: { type: Number, default: null },
    deviationFromExpectedPercent: { type: Number, default: null },
    basis: { type: String, default: 'max_estimate' },
    /** Human-readable, shown to both the admin and the contractor. */
    explanation: { type: String, default: '' },
    scoredAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const bidSchema = new mongoose.Schema(
  {
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    contractor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    bidAmount: {
      type: Number,
      required: [true, 'A bid amount is required.'],
      min: [1, 'A bid must be greater than zero.'],
    },
    currency: { type: String, required: true },

    /** Optional pitch: approach, timeline, prior work. */
    proposal: { type: String, default: null, trim: true, maxlength: 2000 },
    /** Contractor's own estimate of working days. */
    estimatedDays: { type: Number, default: null, min: 1, max: 3650 },

    /**
     * Denormalised from `anomaly.band` so the admin table can index on it.
     * Kept in sync by the pre-validate hook below — never set it by hand.
     */
    isFlagged: { type: Boolean, default: false, index: true },
    anomaly: { type: anomalySchema, required: true },

    status: {
      type: String,
      enum: { values: BID_STATUS_VALUES, message: '{VALUE} is not a valid bid status.' },
      default: BID_STATUS.PENDING,
      index: true,
    },

    /** The wallet the contractor wants paying, captured at bid time. */
    walletAddress: { type: String, default: null },

    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    withdrawnAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret.__v;
        delete ret._id;
        // Defence in depth. The pre-validate hook keeps the stored field right
        // for queries and indexes, but it only runs on validation — a document
        // built in memory and serialised without saving would carry the schema
        // default. Deriving here means an API response can never show a clean
        // flag over a flagged verdict, whatever path produced the document.
        if (ret.anomaly?.band) {
          ret.isFlagged = FLAGGED_BANDS.includes(ret.anomaly.band);
        }
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

bidSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

/**
 * One live bid per contractor per project.
 *
 * Partial, so a withdrawn bid does not block a resubmission — but a contractor
 * cannot stack several pending bids to game the comparison.
 */
bidSchema.index(
  { project: 1, contractor: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: [BID_STATUS.PENDING, BID_STATUS.ACCEPTED] } },
  }
);

// The admin bid table: flagged first, then cheapest.
bidSchema.index({ project: 1, isFlagged: -1, bidAmount: 1 });

/** Keep the denormalised flag honest, whatever path wrote the document. */
bidSchema.pre('validate', function syncFlag(next) {
  if (this.anomaly?.band) {
    this.isFlagged = FLAGGED_BANDS.includes(this.anomaly.band);
  }
  next();
});

export const Bid = mongoose.model('Bid', bidSchema);
export default Bid;
