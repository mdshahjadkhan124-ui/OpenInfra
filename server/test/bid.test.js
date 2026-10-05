/**
 * Phase 5 — Bid model units.
 *
 * The scoring maths lives in anomaly.test.js; this covers the model's own
 * contract, chiefly that the denormalised `isFlagged` can never drift from
 * the band that justifies it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { Bid, BID_STATUS, BID_STATUS_VALUES } from '../src/models/Bid.js';
import { ANOMALY_LEVEL, scoreBid } from '../src/services/anomaly.service.js';

const OID = '6ac3e283fd2b6c9f44e29a7f';
const estimate = { amount: 10500, minAmount: 7000, maxAmount: 16000, currency: 'INR' };

const build = (bidAmount, overrides = {}) => {
  const verdict = scoreBid(bidAmount, estimate);
  return new Bid({
    project: OID,
    contractor: OID,
    bidAmount,
    currency: 'INR',
    walletAddress: '0x742d35cc6634c0532925a3b844bc454e4438f44e',
    anomaly: {
      band: verdict.level,
      benchmarkAmount: estimate.maxAmount,
      expectedAmount: estimate.amount,
      thresholdAmount: verdict.threshold,
      marginPercent: verdict.marginPercent,
      deviationPercent: verdict.deviationPercent,
      deviationFromExpectedPercent: verdict.deviationFromExpectedPercent,
      basis: verdict.basis,
      explanation: verdict.explanation,
    },
    ...overrides,
  });
};

// --- Status vocabulary ---------------------------------------------------

test('bid statuses cover the full lifecycle', () => {
  assert.deepEqual([...BID_STATUS_VALUES], ['pending', 'accepted', 'rejected', 'withdrawn']);
});

test('a new bid starts pending', () => {
  assert.equal(build(12000).status, BID_STATUS.PENDING);
});

// --- isFlagged stays in sync with the band -------------------------------

test('isFlagged is derived from the band on validate', async () => {
  const cases = [
    [12000, ANOMALY_LEVEL.NONE, false],
    [17600, ANOMALY_LEVEL.ELEVATED, false],
    [25600, ANOMALY_LEVEL.FLAGGED, true],
    [40000, ANOMALY_LEVEL.SEVERE, true],
  ];

  for (const [amount, band, flagged] of cases) {
    const bid = build(amount);
    await bid.validate();
    assert.equal(bid.anomaly.band, band, `${amount} should band as ${band}`);
    assert.equal(bid.isFlagged, flagged, `${amount} should set isFlagged=${flagged}`);
  }
});

test('a hand-set isFlagged is corrected to match the band', async () => {
  // The field exists only so the admin table can index on it. If any code path
  // writes it directly, the band must win — otherwise a bid could display as
  // clean while carrying a flagged verdict.
  const bid = build(40000, { isFlagged: false });
  await bid.validate();
  assert.equal(bid.isFlagged, true);

  const clean = build(12000, { isFlagged: true });
  await clean.validate();
  assert.equal(clean.isFlagged, false);
});

// --- The frozen verdict --------------------------------------------------

test('the verdict records everything needed to reproduce it', async () => {
  const bid = build(25600);
  await bid.validate();

  // A contractor disputing a flag must be able to see the exact figures used.
  assert.equal(bid.anomaly.benchmarkAmount, 16000);
  assert.equal(bid.anomaly.expectedAmount, 10500);
  assert.equal(bid.anomaly.thresholdAmount, 19200);
  assert.equal(bid.anomaly.marginPercent, 20);
  assert.equal(bid.anomaly.basis, 'max_estimate');
  assert.ok(bid.anomaly.explanation.length > 0);
  assert.ok(bid.anomaly.scoredAt instanceof Date);
});

test('deviation is reported against both bounds', async () => {
  // 13,125 is >20% over expected but inside the range: the admin UI shows both
  // numbers so the "not flagged" decision is legible.
  const bid = build(13125);
  await bid.validate();
  assert.ok(bid.anomaly.deviationFromExpectedPercent > 20);
  assert.ok(bid.anomaly.deviationPercent < 0);
  assert.equal(bid.isFlagged, false);
});

// --- Schema validation ---------------------------------------------------

test('a bid cannot be zero or negative', async () => {
  for (const amount of [0, -1]) {
    await assert.rejects(() => build(amount).validate(), /greater than zero/);
  }
});

test('a bid cannot exist without a verdict', async () => {
  const bid = build(12000);
  bid.anomaly = undefined;
  await assert.rejects(() => bid.validate(), /anomaly/);
});

test('an unknown status is rejected', async () => {
  await assert.rejects(() => build(12000, { status: 'maybe' }).validate(), /not a valid bid status/);
});

test('a proposal longer than 2000 characters is rejected', async () => {
  await assert.rejects(() => build(12000, { proposal: 'x'.repeat(2001) }).validate(), /proposal/i);
});

// --- Serialisation -------------------------------------------------------

test('toJSON exposes id, hides Mongo internals, keeps the verdict', () => {
  const json = build(25600).toJSON();
  assert.equal(typeof json.id, 'string');
  assert.equal(json._id, undefined);
  assert.equal(json.__v, undefined);
  assert.equal(json.isFlagged, true);
  assert.equal(json.anomaly.band, ANOMALY_LEVEL.FLAGGED);
});
