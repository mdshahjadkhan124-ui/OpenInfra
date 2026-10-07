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
import { readFileSync } from 'node:fs';

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

// ---------------------------------------------------------------------------
// The release simulation must declare a caller
// ---------------------------------------------------------------------------

test('simulateRelease accepts the signing wallet as `from`', () => {
  /**
   * `releaseMilestone` is owner-only. A simulation with no caller is made by
   * the zero address, so it reverted with OwnableUnauthorizedAccount(0x0) and
   * the error was reported to the real admin as "not the administrator" —
   * blocking every release. The parameter is what lets the dry run be made by
   * the account that will actually sign.
   */
  const source = readFileSync(
    new URL('../src/services/chain.service.js', import.meta.url),
    'utf8'
  );
  const signature = source.match(/export const simulateRelease = async \(\{([^}]*)\}/);
  assert.ok(signature, 'simulateRelease should take a destructured options object');
  assert.match(signature[1], /\bfrom\b/, 'it must accept a caller address');
  assert.match(
    source,
    /const caller = from \?\? \(await getContract\(\)\.owner\(\)\)/,
    'and fall back to the contract owner rather than simulating as nobody'
  );
});

test('prepareMilestoneRelease forwards the wallet to the simulation', () => {
  // The seam is only useful if the caller actually passes through it.
  const source = readFileSync(
    new URL('../src/services/milestone.service.js', import.meta.url),
    'utf8'
  );
  const call = source.match(/chain\.simulateRelease\(\{[\s\S]*?\}\)/);
  assert.ok(call, 'prepareMilestoneRelease should simulate before preparing');
  assert.match(call[0], /from: options\.walletAddress/);
});

test('the approve validator accepts a wallet address', async () => {
  const { approveMilestoneRules } = await import('../src/validators/milestone.validators.js');
  // express-validator chains expose their field via .builder.fields
  const fields = approveMilestoneRules.flatMap((rule) => rule.builder?.fields ?? []);
  assert.ok(fields.includes('walletAddress'), 'walletAddress must be validated, not silently dropped');
});

// ---------------------------------------------------------------------------
// A payment is proven by the event's emitter, not the transaction's recipient
// ---------------------------------------------------------------------------

test('confirmTransaction identifies escrow events by emitter address', () => {
  /**
   * `receipt.to` is not the escrow when a wallet batches the call through a
   * smart account (MetaMask's EIP-7702 delegation does exactly this). A real
   * milestone payment was refused on that basis while the contract had
   * emitted MilestoneReleased and the funds had moved. Filtering logs by
   * emitter is both correct for batching and strictly stronger: only our
   * contract can emit a log bearing our address.
   */
  const source = readFileSync(
    new URL('../src/services/chain.service.js', import.meta.url),
    'utf8'
  );

  assert.match(
    source,
    /\.filter\(\(log\) => \(log\.address \?\? ''\)\.toLowerCase\(\) === escrowAddress\)/,
    'logs must be filtered to those emitted by the escrow'
  );
  assert.doesNotMatch(
    source,
    /TX_WRONG_CONTRACT/,
    'the receipt.to check must be gone — it rejects legitimate batched transactions'
  );
});

// ---------------------------------------------------------------------------
// Completion follows the milestones, not the released total
// ---------------------------------------------------------------------------

test('a project is only completed when every milestone is paid', () => {
  /**
   * The contract's completion flag tracks the released TOTAL, so it flips as
   * soon as the last wei leaves escrow — even if one milestone's payment was
   * never recorded here. Honouring it alone would close the project and
   * strand that milestone, because prepareApproval refuses to release against
   * a completed project.
   */
  const source = readFileSync(
    new URL('../src/services/milestone.service.js', import.meta.url),
    'utf8'
  );

  assert.doesNotMatch(
    source,
    /if \(onChain\.completed \|\| allPaid\)/,
    'on-chain completion must not be sufficient on its own'
  );
  assert.match(
    source,
    /if \(onChain\.completed && !allPaid\)/,
    'the disagreement should be surfaced for attention'
  );
  // Both completion paths — release and sync — gate on every milestone.
  const gates = source.match(/const allPaid =[\s\S]{0,160}?every\(\(m\) => m\.status === MILESTONE_STATUS\.PAID\)/g);
  assert.ok(gates && gates.length >= 2, 'release and sync should each require all milestones paid');
});

// ---------------------------------------------------------------------------
// Confirming a payment twice is a retry, not a failure
// ---------------------------------------------------------------------------

test('confirmMilestoneRelease checks for an existing payment before prepareApproval', () => {
  /**
   * Found by the end-to-end run, and it was live: re-confirming a payment
   * already recorded answered 409 "already paid".
   *
   * The sequence that hits it — admin signs, MetaMask broadcasts, the confirm
   * request times out, the browser retries with the same hash — is exactly the
   * one the recovery work exists to survive. Telling the official their payment
   * failed when it succeeded is the confusion this whole area is meant to end.
   *
   * The guard has to come BEFORE `prepareApproval`, which refuses a paid
   * milestone outright. An idempotency check placed after it can never run —
   * which is what had happened: the branch had been written into the progress
   * submission instead, where there is no transaction hash to compare.
   */
  const source = readFileSync(
    new URL('../src/services/milestone.service.js', import.meta.url),
    'utf8'
  );

  const fn = source.slice(
    source.indexOf('export const confirmMilestoneRelease'),
    source.indexOf('export const rejectMilestone')
  );
  assert.ok(fn.length > 0, 'confirmMilestoneRelease should exist');

  const idempotentAt = fn.indexOf('alreadyRecorded');
  const prepareAt = fn.indexOf('await prepareApproval');
  assert.ok(idempotentAt > -1, 'it must short-circuit a payment already recorded');
  assert.ok(prepareAt > -1, 'it should still run prepareApproval for a new payment');
  assert.ok(
    idempotentAt < prepareAt,
    'the idempotency check must come first, or prepareApproval rejects the retry and it never runs'
  );

  // And a different hash for a paid milestone must still be refused.
  assert.match(fn, /throw new ConflictError\('This milestone has already been paid\.'\)/);
});

test('the progress submission carries no transaction-hash idempotency', () => {
  // That branch was misplaced there, where `transactionHash` is never supplied,
  // so it was dead code pretending to be a safeguard.
  const source = readFileSync(
    new URL('../src/services/milestone.service.js', import.meta.url),
    'utf8'
  );
  const fn = source.slice(
    source.indexOf('export const submitProgress'),
    source.indexOf('const prepareApproval')
  );
  if (fn.length > 0) {
    assert.doesNotMatch(
      fn,
      /options\.transactionHash/,
      'a progress submission has no transaction hash to be idempotent about'
    );
  }
});
