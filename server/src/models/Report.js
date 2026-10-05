/**
 * Report — a citizen's submission about a public infrastructure problem.
 *
 * This is the root of the whole money trail: a Report becomes a Project
 * (Phase 4), which attracts Bids (Phase 5), which is awarded and funded
 * on-chain (Phase 6) and paid out per Milestone (Phase 7). The AI verdict
 * stored here is the benchmark every later bid is judged against, so it is
 * recorded in full — verdict, confidence, model and timestamp — rather than
 * reduced to a single number.
 */
import mongoose from 'mongoose';

export const REPORT_STATUS = Object.freeze({
  /** Passed the AI relevance gate, waiting for an admin to review. */
  PENDING: 'pending',
  /** Admin approved it; eligible to be published as a project. */
  APPROVED: 'approved',
  /** Rejected — either by the AI relevance gate or by an admin. */
  REJECTED: 'rejected',
  /** Published as an open project for bidding (Phase 4). */
  PUBLISHED: 'published',
});

export const REPORT_STATUS_VALUES = Object.values(REPORT_STATUS);

/** Who or what rejected a report. Kept distinct so the UI can say which. */
export const REJECTION_SOURCE = Object.freeze({
  AI: 'ai_relevance_gate',
  ADMIN: 'admin_review',
});

export const SEVERITY_VALUES = Object.freeze(['low', 'medium', 'high', 'critical']);

/** Sub-document: what the AI concluded about whether this is civic infrastructure. */
const relevanceSchema = new mongoose.Schema(
  {
    isRelevant: { type: Boolean, required: true },
    category: { type: String, default: 'not_infrastructure' },
    confidence: { type: Number, min: 0, max: 1, default: 0 },
    /** Shown verbatim to the citizen when a report is auto-rejected. */
    reason: { type: String, default: '' },
    model: { type: String, default: null },
    analysedAt: { type: Date, default: null },
    latencyMs: { type: Number, default: null },
  },
  { _id: false }
);

/**
 * Sub-document: the AI's fair-cost benchmark. Absent on rejected reports.
 *
 * Stored as a RANGE rather than a point value. A photograph carries no
 * measuring reference, so the model cannot pin the damage's physical size —
 * measured over six identical runs, a single point estimate varied by ~60%
 * (CV), entirely because the assumed dimensions moved. Recording min/expected/
 * max keeps that uncertainty visible instead of hiding it behind one number,
 * and gives Phase 5 an upper bound it can defensibly score bids against.
 *
 * `amount` remains the EXPECTED value, so every existing reader keeps working.
 */
const costEstimateSchema = new mongoose.Schema(
  {
    /** Expected (most likely) cost. The headline figure shown in the UI. */
    amount: { type: Number, required: true, min: 0 },
    /** Smallest plausible cost consistent with the photo. */
    minAmount: { type: Number, required: true, min: 0 },
    /**
     * Largest plausible cost consistent with the photo.
     * Phase 5 flags a bid that exceeds this by more than ANOMALY_MARGIN_PERCENT.
     */
    maxAmount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true },
    severity: { type: String, enum: SEVERITY_VALUES, default: 'medium' },
    observedIssue: { type: String, default: '' },
    breakdown: {
      type: [
        {
          _id: false,
          item: { type: String, required: true },
          cost: { type: Number, required: true, min: 0 },
        },
      ],
      default: [],
    },
    assumptions: { type: [String], default: [] },
    confidence: { type: Number, min: 0, max: 1, default: 0 },
    model: { type: String, default: null },
    estimatedAt: { type: Date, default: null },
  },
  { _id: false }
);

const locationSchema = new mongoose.Schema(
  {
    address: { type: String, required: [true, 'Location address is required.'], trim: true, maxlength: 300 },
    city: { type: String, trim: true, maxlength: 100, default: null },
    /**
     * Optional GPS. Stored as separate numbers rather than GeoJSON because
     * nothing in this project does radius queries; a 2dsphere index would be
     * cost without benefit. Easy to migrate later if map clustering is added.
     */
    latitude: { type: Number, min: -90, max: 90, default: null },
    longitude: { type: Number, min: -180, max: 180, default: null },
  },
  { _id: false }
);

const reportSchema = new mongoose.Schema(
  {
    reporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    imageUrl: { type: String, required: true },
    /** Cloudinary public_id — needed to delete the asset if the report is purged. */
    imagePublicId: { type: String, required: true },

    location: { type: locationSchema, required: true },

    description: {
      type: String,
      required: [true, 'Description is required.'],
      trim: true,
      minlength: [10, 'Description must be at least 10 characters.'],
      maxlength: [1000, 'Description must be at most 1000 characters.'],
    },

    aiRelevanceResult: { type: relevanceSchema, required: true },

    /** Null whenever the relevance gate rejected the image — never a fake zero. */
    aiCostEstimate: { type: costEstimateSchema, default: null },

    status: {
      type: String,
      enum: { values: REPORT_STATUS_VALUES, message: '{VALUE} is not a valid report status.' },
      default: REPORT_STATUS.PENDING,
      index: true,
    },

    rejectionSource: {
      type: String,
      enum: [...Object.values(REJECTION_SOURCE), null],
      default: null,
    },
    /** Human-readable rejection text, from the AI or the reviewing admin. */
    rejectionReason: { type: String, default: null },

    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },

    /** Set in Phase 4 when an approved report is published for bidding. */
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
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

reportSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

// The two queries this collection actually serves: a citizen's own reports,
// newest first, and the admin review queue filtered by status.
reportSchema.index({ reporter: 1, createdAt: -1 });
reportSchema.index({ status: 1, createdAt: -1 });

/** Convenience for the UI: was this killed by the AI rather than a person? */
reportSchema.virtual('wasAutoRejected').get(function () {
  return this.status === REPORT_STATUS.REJECTED && this.rejectionSource === REJECTION_SOURCE.AI;
});

export const Report = mongoose.model('Report', reportSchema);
export default Report;
