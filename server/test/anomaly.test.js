/**
 * Bid anomaly scoring (Phase 5 logic, landed with the range it depends on).
 *
 * Pure function, no I/O — this is the code that accuses a contractor of
 * overcharging, so every band is pinned down explicitly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreBid, ANOMALY_LEVEL } from '../src/services/anomaly.service.js';

/** min 7,000 / expected 10,500 / max 16,000 -> threshold at +20% = 19,200 */
const estimate = { amount: 10500, minAmount: 7000, maxAmount: 16000, currency: 'INR' };

test('a bid inside the range is not flagged', () => {
  const r = scoreBid(12000, estimate);
  assert.equal(r.isFlagged, false);
  assert.equal(r.level, ANOMALY_LEVEL.NONE);
});

test('a bid at exactly the upper bound is not flagged', () => {
  assert.equal(scoreBid(16000, estimate).level, ANOMALY_LEVEL.NONE);
});

test('a bid above the upper bound but inside the margin is elevated, not flagged', () => {
  const r = scoreBid(18000, estimate);
  assert.equal(r.isFlagged, false);
  assert.equal(r.level, ANOMALY_LEVEL.ELEVATED);
  assert.equal(r.deviationPercent, 12.5);
});

test('a bid exactly at the threshold is not flagged', () => {
  // 16,000 x 1.20 = 19,200. The rule is "more than 20% above", so equality passes.
  const r = scoreBid(19200, estimate);
  assert.equal(r.isFlagged, false);
  assert.equal(r.threshold, 19200);
});

test('one rupee past the threshold is flagged', () => {
  const r = scoreBid(19201, estimate);
  assert.equal(r.isFlagged, true);
  assert.equal(r.level, ANOMALY_LEVEL.FLAGGED);
});

test('more than double the upper bound is severe', () => {
  const r = scoreBid(40000, estimate);
  assert.equal(r.isFlagged, true);
  assert.equal(r.level, ANOMALY_LEVEL.SEVERE);
});

test('scoring uses the upper bound, not the expected value', () => {
  // 13,000 is +23.8% over the expected 10,500 — a naive point-estimate rule
  // would flag it — but it sits inside the assessed range, so it is clean.
  const r = scoreBid(13000, estimate);
  assert.equal(r.isFlagged, false);
  assert.equal(r.basis, 'max_estimate');
  assert.ok(r.deviationFromExpectedPercent > 20, 'should be >20% over expected');
});

test('the margin is configurable per call', () => {
  assert.equal(scoreBid(19201, estimate, { marginPercent: 50 }).isFlagged, false);
  assert.equal(scoreBid(19201, estimate, { marginPercent: 0 }).isFlagged, true);
});

test('a missing estimate never flags', () => {
  for (const bad of [null, undefined, {}, { maxAmount: 0 }, { maxAmount: NaN }]) {
    const r = scoreBid(999999, bad);
    assert.equal(r.isFlagged, false, `should not flag with estimate ${JSON.stringify(bad)}`);
    assert.equal(r.basis, 'no_estimate');
  }
});

test('explanations name the figures a contractor would dispute', () => {
  const r = scoreBid(25000, estimate);
  assert.match(r.explanation, /25,000/);
  assert.match(r.explanation, /16,000/);
  assert.match(r.explanation, /20%/);
});
