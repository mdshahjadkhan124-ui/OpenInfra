/**
 * Phase 4 — Project model units.
 *
 * Mongoose documents can be constructed and validated without a connection,
 * so the schema rules and virtuals are testable with no database. The review
 * workflow itself (approve / reject / publish, and the publish transaction) is
 * exercised against a real MongoDB during phase verification.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { Project, PROJECT_STATUS, PROJECT_STATUS_VALUES, ESTIMATE_SOURCE } from '../src/models/Project.js';

const OID = '6ac3e283fd2b6c9f44e29a7f';

const build = (overrides = {}) =>
  new Project({
    report: OID,
    reporter: OID,
    publishedBy: OID,
    title: 'Road Damage repair — 14 MG Road',
    description: 'Deep pothole in the carriageway near the bus stop.',
    imageUrl: 'https://res.cloudinary.com/x/y.jpg',
    location: { address: '14 MG Road, Bengaluru' },
    aiEstimatedCost: {
      amount: 10500,
      minAmount: 7000,
      maxAmount: 16000,
      currency: 'INR',
      source: ESTIMATE_SOURCE.AI,
    },
    ...overrides,
  });

// --- Status vocabulary ---------------------------------------------------

test('project statuses cover the full lifecycle', () => {
  assert.deepEqual([...PROJECT_STATUS_VALUES], ['open', 'awarded', 'in_progress', 'completed']);
});

test('a new project defaults to open', () => {
  assert.equal(build().status, PROJECT_STATUS.OPEN);
});

// --- The bidding benchmark -----------------------------------------------

test('biddingBenchmark is the UPPER bound, not the expected value', () => {
  // This is the whole point of storing a range — Phase 5 scores against max.
  const p = build();
  assert.equal(p.biddingBenchmark, 16000);
  assert.notEqual(p.biddingBenchmark, p.aiEstimatedCost.amount);
});

test('biddingBenchmark is null when there is no estimate', () => {
  const p = build();
  p.aiEstimatedCost = undefined;
  assert.equal(p.biddingBenchmark, null);
});

// --- Bid acceptance ------------------------------------------------------

test('an open project with no deadline accepts bids', () => {
  assert.equal(build().isAcceptingBids, true);
});

test('an open project before its deadline accepts bids', () => {
  assert.equal(build({ bidsCloseAt: new Date(Date.now() + 86_400_000) }).isAcceptingBids, true);
});

test('an open project past its deadline does not accept bids', () => {
  assert.equal(build({ bidsCloseAt: new Date(Date.now() - 1000) }).isAcceptingBids, false);
});

test('a project that is no longer open never accepts bids', () => {
  for (const status of ['awarded', 'in_progress', 'completed']) {
    assert.equal(build({ status }).isAcceptingBids, false, `${status} should not accept bids`);
  }
});

// --- Escrow defaults -----------------------------------------------------

test('escrow fields start empty, as decimal strings', () => {
  const p = build();
  // Strings, because wei exceeds Number.MAX_SAFE_INTEGER and Mongoose has no
  // native bigint; the chain layer parses these with BigInt().
  assert.equal(p.totalLockedFunds, '0');
  assert.equal(p.totalReleasedFunds, '0');
  assert.equal(typeof p.totalLockedFunds, 'string');
  assert.equal(p.smartContractAddress, null);
  assert.equal(p.awardedContractor, null);
});

// --- Schema validation ---------------------------------------------------

test('a project cannot exist without a cost benchmark', async () => {
  const p = build();
  p.aiEstimatedCost = undefined;
  await assert.rejects(() => p.validate(), /aiEstimatedCost/);
});

test('the estimate requires all three bounds', async () => {
  const p = build({ aiEstimatedCost: { amount: 10500, currency: 'INR' } });
  await assert.rejects(() => p.validate(), /minAmount|maxAmount/);
});

test('an unknown status is rejected', async () => {
  await assert.rejects(() => build({ status: 'half_done' }).validate(), /not a valid project status/);
});

test('a too-short title is rejected', async () => {
  await assert.rejects(() => build({ title: 'Fix' }).validate(), /at least 5 characters/);
});

// --- Estimate provenance -------------------------------------------------

test('estimate provenance distinguishes AI from an admin override', () => {
  assert.notEqual(ESTIMATE_SOURCE.AI, ESTIMATE_SOURCE.ADMIN);
  assert.equal(build().aiEstimatedCost.source, ESTIMATE_SOURCE.AI);

  const overridden = build({
    aiEstimatedCost: {
      amount: 5000,
      minAmount: 3000,
      maxAmount: 9000,
      currency: 'INR',
      source: ESTIMATE_SOURCE.ADMIN,
      producedBy: OID,
    },
  });
  assert.equal(overridden.aiEstimatedCost.source, ESTIMATE_SOURCE.ADMIN);
});

// --- Serialisation -------------------------------------------------------

test('toJSON exposes id and hides Mongo internals', () => {
  const json = build().toJSON();
  assert.equal(typeof json.id, 'string');
  assert.equal(json._id, undefined);
  assert.equal(json.__v, undefined);
  // The virtuals the frontend relies on must survive serialisation.
  assert.equal(json.biddingBenchmark, 16000);
  assert.equal(json.isAcceptingBids, true);
});
