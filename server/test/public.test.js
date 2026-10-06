/**
 * Phase 10 — what the public dashboard is allowed to publish.
 *
 * These are the highest-stakes tests in the suite. Everything else here can
 * fail and produce a bug; these failing would mean the platform leaked a
 * citizen's details or publicly accused a named contractor without process.
 *
 * So they assert the redaction rules directly against the shaping functions,
 * rather than relying on the integration run to notice.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  creditName,
  publicProject,
  publicMilestone,
  publicBids,
} from '../src/services/public.service.js';

// ---------------------------------------------------------------------------
// Fixtures shaped like the real Mongoose documents
// ---------------------------------------------------------------------------

const fullProject = () => ({
  id: 'p1',
  title: 'Road damage repair',
  description: 'A deep pothole.',
  imageUrl: 'https://img.test/a.jpg',
  category: 'road_damage',
  status: 'completed',
  location: { address: '14 MG Road', city: 'Bengaluru', latitude: 12.97, longitude: 77.59 },
  aiEstimatedCost: {
    minAmount: 7000,
    amount: 10500,
    maxAmount: 16000,
    currency: 'INR',
    severity: 'high',
    confidence: 0.8,
    breakdown: [{ item: 'Asphalt', cost: 7000 }],
    assumptions: ['Assumed 1.5m x 1m.'],
    source: 'ai_vision_estimate',
    producedBy: 'gemini-2.5-flash',
  },
  awardedAmount: 14000,
  awardedAt: new Date('2026-10-01'),
  awardedContractor: {
    name: 'Bela Builders Pvt Ltd',
    email: 'bela@contractor.test',
    walletAddress: '0xaaaa',
  },
  // The citizen. Their full name and email must not survive shaping.
  reporter: { name: 'Priya Ramesh', email: 'priya@citizen.test' },
  smartContractAddress: '0xcontract',
  onChainProjectId: 2,
  totalLockedFunds: '6000000000000000',
  totalReleasedFunds: '6000000000000000',
  fundingTxHash: '0xfund',
  fundedBy: '0xadmin',
  publishedAt: new Date('2026-09-30'),
  completedAt: new Date('2026-10-05'),
  bidsCloseAt: null,
  createdAt: new Date('2026-09-29'),
  // Internal fields that must never appear.
  publishedBy: 'adminUserId123',
  report: 'reportId456',
  awardedBid: 'bidId789',
});

// ---------------------------------------------------------------------------
// Citizen privacy
// ---------------------------------------------------------------------------

test('a citizen is credited by first name only', () => {
  // Reporting a pothole should not put your full name on a public ledger page
  // next to your neighbourhood.
  assert.equal(creditName('Priya Ramesh'), 'Priya');
  assert.equal(creditName('Asha Devi Sharma'), 'Asha');
  assert.equal(creditName('  Mohammed   Ali  '), 'Mohammed');
});

test('a missing reporter name degrades to a neutral credit', () => {
  assert.equal(creditName(null), 'A citizen');
  assert.equal(creditName(undefined), 'A citizen');
  assert.equal(creditName(''), 'A citizen');
});

test("the shaped project never carries the citizen's full name or email", () => {
  const shaped = JSON.stringify(publicProject(fullProject()));

  assert.ok(!shaped.includes('Priya Ramesh'), 'full name leaked');
  assert.ok(!shaped.includes('priya@citizen.test'), 'citizen email leaked');
  assert.ok(shaped.includes('Priya'), 'the first-name credit should survive');
});

test('no email address of any kind survives shaping', () => {
  const shaped = JSON.stringify(publicProject(fullProject()));
  assert.ok(!/@[a-z]+\.test/.test(shaped), 'an email address leaked');
  assert.ok(!shaped.includes('bela@contractor.test'), 'contractor email leaked');
});

test('internal review fields are not published', () => {
  const shaped = publicProject(fullProject());
  for (const field of ['publishedBy', 'report', 'awardedBid', 'reviewedBy']) {
    assert.equal(shaped[field], undefined, `${field} should not be published`);
  }
});

// ---------------------------------------------------------------------------
// What IS published
// ---------------------------------------------------------------------------

test('the winning contractor is named, with their payout address', () => {
  // They won public money, and the address is already visible on-chain.
  const shaped = publicProject(fullProject());
  assert.equal(shaped.awarded.contractorName, 'Bela Builders Pvt Ltd');
  assert.equal(shaped.awarded.contractorWallet, '0xaaaa');
});

test('the cost assessment is published in full, assumptions included', () => {
  const shaped = publicProject(fullProject());
  assert.equal(shaped.estimate.min, 7000);
  assert.equal(shaped.estimate.expected, 10500);
  assert.equal(shaped.estimate.max, 16000);
  // Publishing the number while hiding the reasoning would be worse than
  // publishing neither.
  assert.deepEqual(shaped.estimate.assumptions, ['Assumed 1.5m x 1m.']);
  assert.equal(shaped.estimate.breakdown.length, 1);
  assert.equal(shaped.estimate.producedBy, 'gemini-2.5-flash');
});

test('the escrow figures and their explorer links are published', () => {
  const shaped = publicProject(fullProject());
  assert.equal(shaped.escrow.lockedWei, '6000000000000000');
  assert.equal(shaped.escrow.releasedWei, '6000000000000000');
  assert.equal(shaped.escrow.fundingTxHash, '0xfund');
  assert.equal(shaped.escrow.fundedByWallet, '0xadmin');
  assert.match(shaped.escrow.fundingTxUrl, /\/tx\/0xfund$/);
  assert.match(shaped.escrow.contractUrl, /\/address\/0xcontract$/);
});

test('a project with no estimate or award shapes without throwing', () => {
  const bare = {
    id: 'p2',
    title: 'Unpublished',
    description: 'x',
    imageUrl: 'https://img.test/b.jpg',
    status: 'open',
    location: {},
    aiEstimatedCost: null,
    awardedAmount: null,
    reporter: null,
    totalLockedFunds: '0',
    totalReleasedFunds: '0',
  };
  const shaped = publicProject(bare);
  assert.equal(shaped.estimate, null);
  assert.equal(shaped.awarded, null);
  assert.equal(shaped.reportedBy, 'A citizen');
  assert.equal(shaped.escrow.fundingTxUrl, null);
});

// ---------------------------------------------------------------------------
// Bids: figures published, losers anonymised
// ---------------------------------------------------------------------------

const bidDocs = () => [
  {
    _id: { toString: () => 'b1' },
    bidAmount: 25600,
    currency: 'INR',
    status: 'accepted',
    isFlagged: true,
    contractor: { name: 'Bela Builders Pvt Ltd', email: 'bela@contractor.test' },
    anomaly: {
      band: 'flagged',
      benchmarkAmount: 16000,
      thresholdAmount: 19200,
      deviationPercent: 60,
      marginPercent: 20,
      explanation: 'Exceeds the upper assessed cost by 60%.',
    },
    createdAt: new Date('2026-10-01'),
  },
  {
    _id: { toString: () => 'b2' },
    bidAmount: 15200,
    currency: 'INR',
    status: 'rejected',
    isFlagged: false,
    contractor: { name: 'Chetan Constructions', email: 'chetan@contractor.test' },
    anomaly: { band: 'none', benchmarkAmount: 16000, deviationPercent: -5 },
    createdAt: new Date('2026-10-01'),
  },
  {
    _id: { toString: () => 'b3' },
    bidAmount: 30400,
    currency: 'INR',
    status: 'rejected',
    isFlagged: true,
    contractor: { name: 'Dilip Infraworks', email: 'dilip@contractor.test' },
    anomaly: {
      band: 'severe',
      benchmarkAmount: 16000,
      thresholdAmount: 19200,
      deviationPercent: 90,
      explanation: 'Exceeds the upper assessed cost by 90%.',
    },
    createdAt: new Date('2026-10-01'),
  },
  {
    _id: { toString: () => 'b4' },
    bidAmount: 9000,
    currency: 'INR',
    status: 'withdrawn',
    isFlagged: false,
    contractor: { name: 'Withdrawn Co', email: 'w@contractor.test' },
    anomaly: { band: 'none' },
    createdAt: new Date('2026-10-01'),
  },
];

test('losing bidders are not named', () => {
  // Their figures are the accountability. A losing contractor publicly
  // labelled "flagged", with no process to contest it, is a reputational
  // penalty the platform has no business imposing.
  const shaped = publicBids(bidDocs(), 'b1');
  const json = JSON.stringify(shaped);

  assert.ok(!json.includes('Chetan Constructions'), 'losing bidder named');
  assert.ok(!json.includes('Dilip Infraworks'), 'losing bidder named');
  assert.ok(json.includes('Bela Builders'), 'the winner should be named');
});

test('losing bidders are labelled by position', () => {
  const shaped = publicBids(bidDocs(), 'b1');
  const losers = shaped.filter((b) => !b.isWinner);
  assert.ok(losers.every((b) => /^Bidder \d+$/.test(b.bidder)), 'losers should be numbered');
  assert.equal(new Set(losers.map((b) => b.bidder)).size, losers.length, 'labels should be unique');
});

test('every live bid amount and band IS published', () => {
  const shaped = publicBids(bidDocs(), 'b1');
  assert.equal(shaped.length, 3);
  assert.deepEqual(
    shaped.map((b) => b.amount),
    [15200, 25600, 30400],
    'cheapest first'
  );
  assert.deepEqual(
    shaped.map((b) => b.anomaly.band),
    ['none', 'flagged', 'severe']
  );
});

test('a flagged bid publishes the figures behind the flag', () => {
  const shaped = publicBids(bidDocs(), 'b1');
  const flagged = shaped.find((b) => b.isFlagged);
  assert.equal(flagged.anomaly.benchmarkAmount, 16000);
  assert.equal(flagged.anomaly.thresholdAmount, 19200);
  assert.ok(flagged.anomaly.explanation.length > 0);
});

test('withdrawn bids are excluded entirely', () => {
  const shaped = publicBids(bidDocs(), 'b1');
  assert.ok(!shaped.some((b) => b.amount === 9000), 'withdrawn bid published');
  assert.ok(!JSON.stringify(shaped).includes('Withdrawn Co'));
});

test('exactly one bid is marked the winner', () => {
  const shaped = publicBids(bidDocs(), 'b1');
  assert.equal(shaped.filter((b) => b.isWinner).length, 1);
});

test('with no winner yet, nobody is named', () => {
  const shaped = publicBids(bidDocs(), null);
  assert.equal(shaped.filter((b) => b.isWinner).length, 0);
  assert.ok(shaped.every((b) => /^Bidder \d+$/.test(b.bidder)));
  assert.ok(!JSON.stringify(shaped).includes('Bela Builders'));
});

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

const milestoneDoc = () => ({
  number: 1,
  onChainIndex: 0,
  description: 'Excavation and base preparation',
  fundPercentage: 30,
  amountWei: '1800000000000000',
  displayAmount: 4200,
  currency: 'INR',
  status: 'paid',
  progressImageUrl: 'https://img.test/p.jpg',
  submittedAt: new Date('2026-10-02'),
  submissionCount: 2,
  aiVerificationResult: {
    looksComplete: true,
    confidence: 0.89,
    assessment: 'Surface patched and compacted.',
    concerns: [],
    matchesOriginalIssue: true,
    workQuality: 'good',
    model: 'gemini-2.5-flash',
  },
  aiRejectionOverridden: true,
  overrideJustification: 'Site inspected on 6 October.',
  transactionHash: '0xpay',
  blockNumber: 123,
  paidAt: new Date('2026-10-03'),
  approvedByWallet: '0xadmin',
  evidenceHash: '0xevidence',
  // Internal: must not be published.
  reviewedBy: 'adminUserId123',
  progressImagePublicId: 'cloudinary/internal/id',
  contractorNote: 'Please release payment.',
});

test('a milestone publishes its AI verdict, because that justifies the payment', () => {
  const shaped = publicMilestone(milestoneDoc());
  assert.equal(shaped.aiVerification.looksComplete, true);
  assert.equal(shaped.aiVerification.assessment, 'Surface patched and compacted.');
  assert.equal(shaped.aiVerification.model, 'gemini-2.5-flash');
});

test('an official overruling the AI is surfaced, not buried', () => {
  const shaped = publicMilestone(milestoneDoc());
  assert.equal(shaped.aiRejectionOverridden, true);
  assert.equal(shaped.overrideJustification, 'Site inspected on 6 October.');
});

test('a milestone publishes its payment proof', () => {
  const shaped = publicMilestone(milestoneDoc());
  assert.equal(shaped.payment.transactionHash, '0xpay');
  assert.equal(shaped.payment.approvedByWallet, '0xadmin');
  assert.equal(shaped.payment.evidenceHash, '0xevidence');
  assert.match(shaped.payment.explorerUrl, /\/tx\/0xpay$/);
});

test('an unpaid milestone has no payment block rather than an empty one', () => {
  const shaped = publicMilestone({ ...milestoneDoc(), transactionHash: null, status: 'pending' });
  assert.equal(shaped.payment, null);
});

test('milestone internals are not published', () => {
  const shaped = publicMilestone(milestoneDoc());
  for (const field of ['reviewedBy', 'progressImagePublicId', 'contractorNote']) {
    assert.equal(shaped[field], undefined, `${field} should not be published`);
  }
});

test('wei amounts stay strings, so no precision is lost in transit', () => {
  const shaped = publicMilestone(milestoneDoc());
  assert.equal(typeof shaped.amountWei, 'string');
  assert.equal(shaped.amountWei, '1800000000000000');

  const project = publicProject(fullProject());
  assert.equal(typeof project.escrow.lockedWei, 'string');
  // Number() would lose the low digits on values this size.
  assert.equal(project.escrow.lockedWei, '6000000000000000');
});
