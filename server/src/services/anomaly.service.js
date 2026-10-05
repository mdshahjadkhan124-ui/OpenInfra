/**
 * Bid anomaly detection.
 *
 * Phase 5 calls this for every bid. It lives here, as a pure function with no
 * database or network dependency, because it is the one piece of business
 * logic in the platform that directly accuses a contractor of overcharging —
 * it needs to be trivially testable and trivially auditable.
 *
 * WHY THE UPPER BOUND, NOT THE EXPECTED VALUE
 * -------------------------------------------
 * The obvious rule is "flag a bid more than 20% above the AI estimate". That
 * is what the brief asks for, and with a single point estimate it is what we
 * would implement. But measurement showed the point estimate is not stable
 * enough to carry a 20% threshold: six runs of the identical photo produced
 * ₹3,000 to ₹14,000, because the model re-guesses the damage's physical size
 * each time and cost follows area.
 *
 * Scoring against a number that noisy would mean a contractor's bid is flagged
 * or cleared depending on which roll of the dice priced the report. So the
 * estimate is now a range, and deviation is scored against `maxAmount` — the
 * generous end. A flag then means:
 *
 *   "This bid exceeds even the highest cost our assessment considered
 *    plausible, by more than X%."
 *
 * That is a claim the platform can defend to the contractor disputing it, and
 * it fails safe: a wide range (genuine uncertainty) produces fewer flags, not
 * more false accusations.
 *
 * The margin stays configurable via ANOMALY_MARGIN_PERCENT (default 20).
 */
import { config } from '../config/env.js';

/** Severity bands for how far past the threshold a bid sits. */
export const ANOMALY_LEVEL = Object.freeze({
  NONE: 'none',
  /** Over the upper bound, but within the allowed margin. Shown, not flagged. */
  ELEVATED: 'elevated',
  /** Past the threshold. Flagged. */
  FLAGGED: 'flagged',
  /** Far past it — more than double the upper bound. */
  SEVERE: 'severe',
});

/**
 * Score a bid against a report's AI cost estimate.
 *
 * @param {number} bidAmount
 * @param {object|null} costEstimate  The report's aiCostEstimate sub-document.
 * @param {object} [options]
 * @param {number} [options.marginPercent]  Defaults to ANOMALY_MARGIN_PERCENT.
 * @returns {{
 *   isFlagged: boolean,
 *   level: string,
 *   threshold: number|null,
 *   deviationPercent: number|null,
 *   deviationFromExpectedPercent: number|null,
 *   marginPercent: number,
 *   basis: string,
 *   explanation: string
 * }}
 */
export const scoreBid = (bidAmount, costEstimate, { marginPercent } = {}) => {
  const margin = Number.isFinite(marginPercent)
    ? marginPercent
    : config.bidding.anomalyMarginPercent;

  const bid = Number(bidAmount);

  // No usable benchmark — a report with no estimate cannot support an
  // accusation, so nothing is flagged. Better to under-flag than to invent one.
  if (!costEstimate || !Number.isFinite(costEstimate.maxAmount) || costEstimate.maxAmount <= 0) {
    return {
      isFlagged: false,
      level: ANOMALY_LEVEL.NONE,
      threshold: null,
      deviationPercent: null,
      deviationFromExpectedPercent: null,
      marginPercent: margin,
      basis: 'no_estimate',
      explanation: 'No AI cost estimate is available for this project, so the bid cannot be scored.',
    };
  }

  const upper = costEstimate.maxAmount;
  const expected = costEstimate.amount;
  const threshold = Math.round(upper * (1 + margin / 100));

  const deviationPercent = Number((((bid - upper) / upper) * 100).toFixed(2));
  const deviationFromExpectedPercent =
    Number.isFinite(expected) && expected > 0
      ? Number((((bid - expected) / expected) * 100).toFixed(2))
      : null;

  const currency = costEstimate.currency ?? '';
  const fmt = (n) => `${currency} ${Math.round(n).toLocaleString('en-IN')}`.trim();

  if (bid <= upper) {
    return {
      isFlagged: false,
      level: ANOMALY_LEVEL.NONE,
      threshold,
      deviationPercent,
      deviationFromExpectedPercent,
      marginPercent: margin,
      basis: 'max_estimate',
      explanation: `Bid is within the assessed cost range (up to ${fmt(upper)}).`,
    };
  }

  if (bid <= threshold) {
    return {
      isFlagged: false,
      level: ANOMALY_LEVEL.ELEVATED,
      threshold,
      deviationPercent,
      deviationFromExpectedPercent,
      marginPercent: margin,
      basis: 'max_estimate',
      explanation: `Bid is ${deviationPercent}% above the upper estimate of ${fmt(upper)}, within the ${margin}% allowance.`,
    };
  }

  const severe = bid > upper * 2;
  return {
    isFlagged: true,
    level: severe ? ANOMALY_LEVEL.SEVERE : ANOMALY_LEVEL.FLAGGED,
    threshold,
    deviationPercent,
    deviationFromExpectedPercent,
    marginPercent: margin,
    basis: 'max_estimate',
    explanation: `Bid of ${fmt(bid)} exceeds the upper assessed cost of ${fmt(upper)} by ${deviationPercent}%, beyond the ${margin}% allowance (threshold ${fmt(threshold)}).`,
  };
};

export default { scoreBid, ANOMALY_LEVEL };
