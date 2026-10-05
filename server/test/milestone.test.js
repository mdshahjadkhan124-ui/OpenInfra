/**
 * Phase 7 — milestone units that need no database, network or chain.
 *
 * The full flow (submit → verify → approve → release) is exercised against a
 * real MongoDB, real Cloudinary and real Sepolia during phase verification.
 * What is guarded here is the arithmetic and the rules that protect money:
 * the percentage→wei split, the sum invariant the escrow contract depends on,
 * and the milestone status vocabulary.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';

import { splitByPercentage, hashEvidence, explorerTxUrl } from '../src/services/chain.service.js';
import { validateSchedule } from '../src/services/milestone.service.js';
import {
  Milestone,
  MILESTONE_STATUS,
  MILESTONE_STATUS_VALUES,
  RESUBMITTABLE,
} from '../src/models/Milestone.js';
import { verifyMilestoneImage } from '../src/services/gemini.service.js';
import { MILESTONE_RESPONSES } from '../src/services/__fixtures__/aiResponses.js';
import fs from 'node:fs';
import path from 'node:path';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const img = (name) => fs.readFileSync(path.join(FIXTURES, name));

// =========================================================================
// The percentage -> wei split
// =========================================================================

test('a clean split allocates exactly the total', () => {
  const total = ethers.parseEther('1');
  const shares = splitByPercentage(total, [30, 45, 25]);

  assert.equal(shares.reduce((a, b) => a + b, 0n), total);
  assert.equal(shares[0], ethers.parseEther('0.3'));
  assert.equal(shares[1], ethers.parseEther('0.45'));
  assert.equal(shares[2], ethers.parseEther('0.25'));
});

test('a repeating split still sums to EXACTLY the total', () => {
  // 3 x 33.33% cannot divide 1 ETH evenly. The escrow contract requires the
  // shares to equal the deposit exactly, so the remainder must land somewhere
  // rather than being lost to rounding.
  const total = ethers.parseEther('1');
  const shares = splitByPercentage(total, [33.33, 33.33, 33.34]);

  assert.equal(shares.reduce((a, b) => a + b, 0n), total, 'must sum to the deposit');
  assert.ok(shares.every((s) => s > 0n));
});

test('the rounding remainder goes to the final milestone', () => {
  const total = 100n; // deliberately tiny, to force a remainder
  const shares = splitByPercentage(total, [33.33, 33.33, 33.34]);
  assert.equal(shares.reduce((a, b) => a + b, 0n), total);
  // The last share absorbs whatever integer division dropped.
  assert.ok(shares[2] >= shares[0]);
});

test('awkward percentages across many milestones still balance', () => {
  for (const [total, pcts] of [
    [ethers.parseEther('0.004'), [60, 40]],
    [ethers.parseEther('2.5'), [20, 30, 30, 20]],
    [ethers.parseEther('0.0001'), [16.66, 16.66, 16.66, 16.67, 16.67, 16.68]],
    [1n, [50, 50]],
    [7n, [14.28, 14.28, 14.28, 14.29, 14.29, 14.29, 14.29]],
  ]) {
    const shares = splitByPercentage(total, pcts);
    assert.equal(
      shares.reduce((a, b) => a + b, 0n),
      BigInt(total),
      `${pcts.join('/')} of ${total} must sum exactly`
    );
  }
});

test('a single 100% milestone takes the whole amount', () => {
  const total = ethers.parseEther('0.5');
  assert.deepEqual(splitByPercentage(total, [100]), [total]);
});

// =========================================================================
// Schedule validation
// =========================================================================

const stage = (pct, description = 'A clearly described stage of the works') => ({
  description,
  fundPercentage: pct,
});

test('a schedule summing to 100 is accepted', () => {
  const ok = validateSchedule([stage(30), stage(45), stage(25)]);
  assert.equal(ok.length, 3);
  assert.equal(ok[0].fundPercentage, 30);
});

test('a schedule that does not sum to 100 is rejected, naming the total', () => {
  // Unallocated funds would be unreleasable forever: the escrow contract has
  // no withdrawal function, so this is a money-loss bug, not a nitpick.
  assert.throws(
    () => validateSchedule([stage(30), stage(30)]),
    (err) => err.statusCode === 422 && /60\.00%/.test(err.message)
  );
  assert.throws(
    () => validateSchedule([stage(60), stage(60)]),
    (err) => err.statusCode === 422 && /120\.00%/.test(err.message)
  );
});

test('float representation does not break the sum check', () => {
  // 33.33 + 33.33 + 33.34 is 100.00000000000001 in IEEE 754.
  assert.doesNotThrow(() => validateSchedule([stage(33.33), stage(33.33), stage(33.34)]));
  assert.doesNotThrow(() => validateSchedule([stage(16.66), stage(16.67), stage(16.67), stage(50)]));
});

test('an empty or oversized schedule is rejected', () => {
  assert.throws(() => validateSchedule([]), { statusCode: 422 });
  assert.throws(() => validateSchedule(null), { statusCode: 422 });
  const tooMany = Array.from({ length: 21 }, () => stage(100 / 21));
  assert.throws(() => validateSchedule(tooMany), { statusCode: 422 });
});

test('a zero, negative or over-100 percentage is rejected', () => {
  for (const bad of [0, -10, 101]) {
    assert.throws(() => validateSchedule([stage(bad), stage(100 - bad)]), { statusCode: 422 });
  }
});

test('a missing or too-short description is rejected', () => {
  assert.throws(() => validateSchedule([{ fundPercentage: 100 }]), { statusCode: 422 });
  assert.throws(() => validateSchedule([stage(100, 'x')]), { statusCode: 422 });
});

// =========================================================================
// Status vocabulary
// =========================================================================

test('milestone statuses cover the full lifecycle', () => {
  assert.deepEqual(
    [...MILESTONE_STATUS_VALUES],
    ['pending', 'submitted', 'ai_rejected', 'rejected', 'approving', 'paid']
  );
});

test('a contractor can resubmit from pending or either rejection, but not once paid', () => {
  assert.ok(RESUBMITTABLE.includes(MILESTONE_STATUS.PENDING));
  assert.ok(RESUBMITTABLE.includes(MILESTONE_STATUS.AI_REJECTED));
  assert.ok(RESUBMITTABLE.includes(MILESTONE_STATUS.REJECTED));
  assert.ok(!RESUBMITTABLE.includes(MILESTONE_STATUS.PAID));
  assert.ok(!RESUBMITTABLE.includes(MILESTONE_STATUS.SUBMITTED));
  assert.ok(!RESUBMITTABLE.includes(MILESTONE_STATUS.APPROVING));
});

test('AI rejection is distinct from admin rejection', () => {
  // The UI tells the contractor which it was, and only an AI rejection is
  // overridable by an admin.
  assert.notEqual(MILESTONE_STATUS.AI_REJECTED, MILESTONE_STATUS.REJECTED);
});

// =========================================================================
// Model
// =========================================================================

const OID = '6ac3e283fd2b6c9f44e29a7f';
const buildMilestone = (overrides = {}) =>
  new Milestone({
    project: OID,
    contractor: OID,
    number: 1,
    onChainIndex: 0,
    description: 'Excavation, debris removal and base preparation',
    fundPercentage: 60,
    amountWei: '1200000000000000',
    ...overrides,
  });

test('a new milestone starts pending and unpaid', () => {
  const m = buildMilestone();
  assert.equal(m.status, MILESTONE_STATUS.PENDING);
  assert.equal(m.isPaid, false);
  assert.equal(m.awaitingReview, false);
  assert.equal(m.transactionHash, null);
  assert.equal(m.submissionCount, 0);
  assert.equal(m.aiRejectionOverridden, false);
});

test('isPaid requires a transaction hash, not just the status', () => {
  // A milestone claiming to be paid with no on-chain proof is exactly the
  // inconsistency the public dashboard must never display as settled.
  const noProof = buildMilestone({ status: MILESTONE_STATUS.PAID });
  assert.equal(noProof.isPaid, false);

  const proven = buildMilestone({ status: MILESTONE_STATUS.PAID, transactionHash: `0x${'a'.repeat(64)}` });
  assert.equal(proven.isPaid, true);
});

test('awaitingReview is true only while submitted', () => {
  assert.equal(buildMilestone({ status: MILESTONE_STATUS.SUBMITTED }).awaitingReview, true);
  for (const s of ['pending', 'ai_rejected', 'rejected', 'approving', 'paid']) {
    assert.equal(buildMilestone({ status: s }).awaitingReview, false);
  }
});

test('the on-chain index is 0-based while the human number is 1-based', async () => {
  const m = buildMilestone({ number: 3, onChainIndex: 2 });
  await m.validate();
  // Keeping both explicit is what prevents a UI saying "Milestone 3" from
  // calling releaseMilestone(3) on a 3-milestone project.
  assert.equal(m.number - 1, m.onChainIndex);
});

test('a milestone cannot exist without an amount or a description', async () => {
  await assert.rejects(() => buildMilestone({ amountWei: undefined }).validate(), /amountWei/);
  await assert.rejects(() => buildMilestone({ description: undefined }).validate(), /description/);
});

test('an out-of-range percentage is rejected by the schema', async () => {
  await assert.rejects(() => buildMilestone({ fundPercentage: 0 }).validate(), /more than zero/);
  await assert.rejects(() => buildMilestone({ fundPercentage: 101 }).validate(), /cannot exceed 100/);
});

// =========================================================================
// Evidence hash
// =========================================================================

test('the evidence hash is deterministic and sensitive to every field', () => {
  const base = { projectId: 'p1', milestoneId: 'm1', approvedBy: 'a1' };
  assert.equal(hashEvidence(base), hashEvidence({ ...base }));
  assert.notEqual(hashEvidence(base), hashEvidence({ ...base, approvedBy: 'a2' }));
  assert.match(hashEvidence(base), /^0x[0-9a-f]{64}$/);
});

test('an AI override changes the evidence hash', () => {
  // The override must be provable on-chain, so it has to alter the hash.
  const base = { projectId: 'p1', milestoneId: 'm1', approvedBy: 'a1' };
  const overridden = { ...base, aiRejectionOverridden: true, overrideJustification: 'site inspected' };
  assert.notEqual(hashEvidence(base), hashEvidence(overridden));
});

test('explorer URLs are built only for a real hash', () => {
  assert.match(explorerTxUrl(`0x${'b'.repeat(64)}`), /sepolia\.etherscan\.io\/tx\/0xbbb/);
  assert.equal(explorerTxUrl(null), null);
});

// =========================================================================
// Gemini integration #2, in fixture mode
// =========================================================================

test('the fixture gate passes completed work', async () => {
  const v = await verifyMilestoneImage(img('relevant-road-damage.png'), {
    mimeType: 'image/png',
    milestoneDescription: 'Surface course laid and compacted',
  });
  assert.equal(v.looksComplete, true);
  assert.equal(v.matchesOriginalIssue, true);
  assert.equal(v.model, 'fixture');
  assert.equal(v.concerns.length, 0);
});

test('the fixture gate rejects incomplete work with specific concerns', async () => {
  const v = await verifyMilestoneImage(img('relevant-street-lighting.png'), {
    mimeType: 'image/png',
    milestoneDescription: 'Surface course laid and compacted',
  });
  assert.equal(v.looksComplete, false);
  assert.ok(v.concerns.length > 0, 'a rejection must say what is outstanding');
  assert.deepEqual(v.concerns, MILESTONE_RESPONSES.milestoneIncomplete.concerns);
});

test('the fixture gate rejects a photo of a different site', async () => {
  const v = await verifyMilestoneImage(img('irrelevant-not-infrastructure.png'), {
    mimeType: 'image/png',
    milestoneDescription: 'Surface course laid and compacted',
  });
  assert.equal(v.looksComplete, false);
  assert.equal(v.matchesOriginalIssue, false);
});

test('verification is deterministic in fixture mode', async () => {
  const buf = img('relevant-road-damage.png');
  const a = await verifyMilestoneImage(buf, { mimeType: 'image/png', milestoneDescription: 'x' });
  const b = await verifyMilestoneImage(buf, { mimeType: 'image/png', milestoneDescription: 'x' });
  assert.equal(a.looksComplete, b.looksComplete);
  assert.equal(a.confidence, b.confidence);
});
