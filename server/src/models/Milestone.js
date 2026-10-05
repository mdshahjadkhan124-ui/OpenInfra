/**
 * Milestone — one verified stage of work, and one on-chain payment.
 *
 * A milestone is the join between three systems that must agree: the admin's
 * funding schedule, Gemini's verdict on the progress photo, and the escrow
 * contract's payment record. Each of those is stored here in full, because the
 * whole point of the platform is that a citizen can check them against each
 * other.
 *
 * WHY BOTH A PERCENTAGE AND A WEI AMOUNT
 * --------------------------------------
 * The admin thinks in percentages ("30% on completion of stage 1") and the
 * contract thinks in wei. Dividing a percentage on-chain would leave dust and
 * break the contract's "milestones sum to the deposit" invariant, so the split
 * is resolved to exact wei off-chain at award time, with any rounding
 * remainder pushed into the final milestone. Both figures are stored: the
 * percentage is what the UI shows and what the admin agreed to, and
 * `amountWei` is what actually gets paid.
 */
import mongoose from 'mongoose';

export const MILESTONE_STATUS = Object.freeze({
  /** Defined at award, no work submitted yet. */
  PENDING: 'pending',
  /** Contractor has uploaded a progress photo; awaiting admin approval. */
  SUBMITTED: 'submitted',
  /** Gemini judged the work incomplete. The contractor may resubmit. */
  AI_REJECTED: 'ai_rejected',
  /** Admin declined it. The contractor may resubmit. */
  REJECTED: 'rejected',
  /** Admin approved; the on-chain release is in flight. */
  APPROVING: 'approving',
  /** Funds released on-chain. Terminal. */
  PAID: 'paid',
});

export const MILESTONE_STATUS_VALUES = Object.values(MILESTONE_STATUS);

/** Statuses from which a contractor may (re)submit a progress photo. */
export const RESUBMITTABLE = Object.freeze([
  MILESTONE_STATUS.PENDING,
  MILESTONE_STATUS.AI_REJECTED,
  MILESTONE_STATUS.REJECTED,
]);

/** Gemini integration #2 — does the photo show the promised work completed? */
const aiVerificationSchema = new mongoose.Schema(
  {
    looksComplete: { type: Boolean, required: true },
    confidence: { type: Number, min: 0, max: 1, default: 0 },
    /** Shown to the contractor, and to the admin deciding whether to approve. */
    assessment: { type: String, default: '' },
    /** Specific things the model found still outstanding. */
    concerns: { type: [String], default: [] },
    /** Whether the photo plausibly shows the same site as the original report. */
    matchesOriginalIssue: { type: Boolean, default: null },
    workQuality: {
      type: String,
      enum: ['poor', 'acceptable', 'good', 'excellent', 'unknown'],
      default: 'unknown',
    },
    model: { type: String, default: null },
    verifiedAt: { type: Date, default: null },
    latencyMs: { type: Number, default: null },
  },
  { _id: false }
);

const milestoneSchema = new mongoose.Schema(
  {
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    contractor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    /**
     * 1-based for humans, and `onChainIndex` is the 0-based index the contract
     * uses. Keeping both explicit avoids an off-by-one between a UI that says
     * "Milestone 1" and a `releaseMilestone(0)` call.
     */
    number: { type: Number, required: true, min: 1 },
    onChainIndex: { type: Number, required: true, min: 0 },

    description: {
      type: String,
      required: [true, 'Each milestone needs a description of the work it covers.'],
      trim: true,
      minlength: [5, 'Milestone description must be at least 5 characters.'],
      maxlength: [500, 'Milestone description must be at most 500 characters.'],
    },

    /** The share of the total this milestone pays, 0 < p <= 100. */
    fundPercentage: {
      type: Number,
      required: true,
      min: [0.01, 'A milestone must be worth more than zero.'],
      max: [100, 'A milestone cannot exceed 100% of the funds.'],
    },

    /** Exact wei this milestone pays. Decimal string; parsed with BigInt(). */
    amountWei: { type: String, required: true },

    /** The fiat-equivalent share of the awarded amount, for display only. */
    displayAmount: { type: Number, default: null },
    currency: { type: String, default: null },

    // --- Contractor submission --------------------------------------------
    progressImageUrl: { type: String, default: null },
    progressImagePublicId: { type: String, default: null },
    contractorNote: { type: String, default: null, trim: true, maxlength: 1000 },
    submittedAt: { type: Date, default: null },
    /** How many times the contractor has submitted for this milestone. */
    submissionCount: { type: Number, default: 0 },

    aiVerificationResult: { type: aiVerificationSchema, default: null },

    // --- Admin decision ---------------------------------------------------
    status: {
      type: String,
      enum: { values: MILESTONE_STATUS_VALUES, message: '{VALUE} is not a valid milestone status.' },
      default: MILESTONE_STATUS.PENDING,
      index: true,
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
    /**
     * Set when an admin approved work the AI had rejected. Kept on the public
     * record, because overruling the automated check is exactly the kind of
     * decision a transparency platform should surface rather than bury.
     */
    aiRejectionOverridden: { type: Boolean, default: false },
    overrideJustification: { type: String, default: null },

    // --- On-chain payment -------------------------------------------------
    /** Set once the release transaction is mined. The public proof of payment. */
    transactionHash: { type: String, default: null },
    blockNumber: { type: Number, default: null },
    gasUsed: { type: String, default: null },
    paidAt: { type: Date, default: null },
    /**
     * keccak256 of the approval record, passed to the contract so the payment
     * is tied on-chain to the evidence that justified it.
     */
    evidenceHash: { type: String, default: null },
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

milestoneSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

/** One milestone per number per project. */
milestoneSchema.index({ project: 1, number: 1 }, { unique: true });
milestoneSchema.index({ project: 1, status: 1 });

/** Convenience for the UI: is this awaiting an admin decision? */
milestoneSchema.virtual('awaitingReview').get(function () {
  return this.status === MILESTONE_STATUS.SUBMITTED;
});

/** Terminal: paid on-chain and provable. */
milestoneSchema.virtual('isPaid').get(function () {
  return this.status === MILESTONE_STATUS.PAID && Boolean(this.transactionHash);
});

export const Milestone = mongoose.model('Milestone', milestoneSchema);
export default Milestone;
