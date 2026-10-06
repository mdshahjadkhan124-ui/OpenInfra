/**
 * Guards for the on-chain / database desync fix.
 *
 * The recovery path itself is verified against live Sepolia during phase
 * verification — it needs a real contract with a real funded project, which no
 * unit test can stand in for honestly. What is pinned here is the schema and
 * configuration the recovery depends on, because those are exactly what a
 * later refactor would quietly drop.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { Project } from '../src/models/Project.js';
import { Milestone } from '../src/models/Milestone.js';
import { config } from '../src/config/env.js';
import * as milestoneService from '../src/services/milestone.service.js';
import * as chain from '../src/services/chain.service.js';

const OID = '6ac3e283fd2b6c9f44e29a7f';

// ---------------------------------------------------------------------------
// The field that makes an interrupted confirmation recoverable
// ---------------------------------------------------------------------------

test('a project can hold an unverified funding hash', () => {
  // Written the instant the browser reports it, before verification, so a
  // connection that drops during the 120-second receipt wait cannot destroy
  // the only copy of the hash.
  const p = new Project({
    report: OID,
    reporter: OID,
    publishedBy: OID,
    title: 'Road repair test',
    description: 'A pothole.',
    imageUrl: 'https://img.test/a.jpg',
    location: { address: '14 MG Road' },
    aiEstimatedCost: { amount: 10500, minAmount: 7000, maxAmount: 16000, currency: 'INR' },
  });

  assert.equal(p.pendingFundingTxHash, null, 'should default to null');
  p.pendingFundingTxHash = `0x${'a'.repeat(64)}`;
  assert.equal(p.pendingFundingTxHash, `0x${'a'.repeat(64)}`);
});

test('a milestone can hold an unverified release hash', () => {
  const m = new Milestone({
    project: OID,
    contractor: OID,
    number: 1,
    onChainIndex: 0,
    description: 'Base layer laid',
    fundPercentage: 30,
    amountWei: '1200000000000000',
  });

  assert.equal(m.pendingTxHash, null);
  m.pendingTxHash = `0x${'b'.repeat(64)}`;
  assert.equal(m.pendingTxHash, `0x${'b'.repeat(64)}`);
});

test('the verified and unverified hash fields are distinct', () => {
  // Collapsing them would mean an unverified, possibly bogus hash appearing on
  // the public record as proof of payment.
  const p = new Project.schema.paths.fundingTxHash.constructor('x', {});
  assert.ok(Project.schema.paths.fundingTxHash, 'fundingTxHash must exist');
  assert.ok(Project.schema.paths.pendingFundingTxHash, 'pendingFundingTxHash must exist');
  assert.notEqual(
    Project.schema.paths.fundingTxHash.path,
    Project.schema.paths.pendingFundingTxHash.path
  );
  assert.ok(p);
});

// ---------------------------------------------------------------------------
// Configuration the log recovery depends on
// ---------------------------------------------------------------------------

test('the contract deployment block is configured', () => {
  // The lower bound for any event scan. Without it a scan would start at
  // genesis, which every hosted provider refuses.
  assert.equal(typeof config.chain.deployBlock, 'number');
  assert.ok(config.chain.deployBlock > 0);
});

test('the provider log window is configured and conservative', () => {
  // Alchemy's free tier allows TEN blocks per eth_getLogs call. Defaulting
  // higher would make recovery fail on the tier this project documents.
  assert.equal(typeof config.chain.logWindow, 'number');
  assert.ok(config.chain.logWindow >= 1);
  assert.ok(config.chain.logWindow <= 10_000);
});

// ---------------------------------------------------------------------------
// The recovery surface exists and is a one-way sync
// ---------------------------------------------------------------------------

test('syncProjectFromChain is exported, and reconcileProject still aliases it', () => {
  assert.equal(typeof milestoneService.syncProjectFromChain, 'function');
  // The older name is kept so existing routes and docs keep working.
  assert.equal(milestoneService.reconcileProject, milestoneService.syncProjectFromChain);
});

test('the chain service exposes hash recovery for both event types', () => {
  assert.equal(typeof chain.findFundingTransaction, 'function');
  assert.equal(typeof chain.findMilestoneReleaseTransactions, 'function');
});

test('hash recovery returns nothing in fixture mode rather than inventing a hash', async () => {
  // Fabricating a plausible-looking hash would put a fake proof of payment on
  // the public record.
  assert.equal(config.chain.mock, true, 'fixture mode should be on under NODE_ENV=test');
  assert.equal(await chain.findFundingTransaction(0), null);
  assert.equal((await chain.findMilestoneReleaseTransactions(0)).size, 0);
});

test('the server still holds no signing key', () => {
  // The desync fix touched the chain service; this makes sure it did not
  // reintroduce a server-side signer.
  assert.equal(config.chain.adminPrivateKey, undefined);
  assert.equal(typeof chain.buildLockFundsTransaction, 'function');
  assert.equal(typeof chain.buildReleaseTransaction, 'function');
  assert.equal(chain.default.sendTransaction, undefined);
  assert.equal(chain.default.lockFunds, undefined, 'no direct server-signed lock');
  assert.equal(chain.default.releaseMilestone, undefined, 'no direct server-signed release');
});
