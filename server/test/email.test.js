/**
 * Phase 8 — email templates and the notification contract.
 *
 * NODE_ENV=test puts the transport in preview mode, so nothing is sent and no
 * credentials are needed. Live delivery is verified against real Gmail during
 * phase verification.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { TEMPLATES, TEMPLATE_EVENTS, render } from '../src/services/email/templates.js';
import { emailMode } from '../src/services/email/transport.js';
import * as notify from '../src/services/notification.service.js';
import { money, eth } from '../src/services/email/layout.js';

const ETHERSCAN = 'https://sepolia.etherscan.io/tx/0xabc123';

// =========================================================================
// Coverage
// =========================================================================

/**
 * Scraped from the notification service's source, so this test fails the
 * moment someone adds an event hook without a template — rather than the
 * recipient discovering it as a blank email.
 */
const dispatchedEvents = () => {
  const src = fs.readFileSync(
    path.join(import.meta.dirname, '../src/services/notification.service.js'),
    'utf8'
  );
  return [...new Set([...src.matchAll(/event: '([a-z_.]+)'/g)].map((m) => m[1]))].sort();
};

test('every event the notification service dispatches has a template', () => {
  const missing = dispatchedEvents().filter((e) => !TEMPLATES[e]);
  assert.deepEqual(missing, [], `events with no template: ${missing.join(', ')}`);
});

test('there are no orphan templates for events nobody sends', () => {
  const dispatched = dispatchedEvents();
  const orphans = TEMPLATE_EVENTS.filter((e) => !dispatched.includes(e));
  assert.deepEqual(orphans, [], `templates with no sender: ${orphans.join(', ')}`);
});

test('all 21 platform events are covered', () => {
  assert.equal(dispatchedEvents().length, 21);
  assert.equal(TEMPLATE_EVENTS.length, 21);
});

// =========================================================================
// Rendering
// =========================================================================

test('every template produces both an HTML and a plain-text part', () => {
  // A message with no text part is markedly more likely to be spam-filtered,
  // and it is the version screen readers and watch notifications show.
  for (const event of TEMPLATE_EVENTS) {
    const { html, text } = render(event, minimalData(event));
    assert.ok(html.startsWith('<!doctype html>'), `${event}: missing doctype`);
    assert.ok(html.length > 500, `${event}: html too short`);
    assert.ok(text.length > 50, `${event}: text part too short`);
  }
});

test('no template leaks undefined, NaN or [object Object]', () => {
  for (const event of TEMPLATE_EVENTS) {
    const { html, text } = render(event, minimalData(event));
    for (const [label, body] of [
      ['html', html],
      ['text', text],
    ]) {
      assert.ok(!/undefined/.test(body), `${event} ${label}: contains "undefined"`);
      assert.ok(!/\[object Object\]/.test(body), `${event} ${label}: contains "[object Object]"`);
      assert.ok(!/\bNaN\b/.test(body), `${event} ${label}: contains "NaN"`);
    }
  }
});

test('an unknown event throws rather than sending a blank email', () => {
  assert.throws(() => render('no.such.event', {}), /No email template registered/);
});

// =========================================================================
// The Etherscan link — the point of the whole project
// =========================================================================

test('payment emails carry the Etherscan link in BOTH parts', () => {
  for (const event of ['milestone.paid.contractor', 'milestone.paid.citizen', 'escrow.funded']) {
    const { html, text } = render(event, minimalData(event));
    assert.ok(html.includes(ETHERSCAN), `${event}: link missing from html`);
    assert.ok(text.includes(ETHERSCAN), `${event}: link missing from text`);
  }
});

test("the citizen's payment email invites independent verification", () => {
  const { html, text } = render('milestone.paid.citizen', minimalData('milestone.paid.citizen'));
  // The platform saying "we paid them" is worth little; a link to a ledger it
  // does not control is the actual claim.
  assert.match(html, /do not have to take our word for it/i);
  assert.match(html, /Etherscan/);
  assert.ok(text.includes(ETHERSCAN));
});

test('payment emails show the on-chain amount in ETH', () => {
  const { html } = render('milestone.paid.citizen', minimalData('milestone.paid.citizen'));
  assert.ok(html.includes('0.0012 ETH'), 'the wei amount should render as ETH');
});

// =========================================================================
// Escaping
// =========================================================================

test('user-supplied text cannot inject markup', () => {
  const { html } = render('report.rejected', {
    name: '<script>alert(1)</script>',
    reportId: 'r1',
    reason: 'Has <b>tags</b> & "quotes" and <img src=x onerror=alert(1)>',
    link: 'https://example.test/r',
  });

  assert.ok(!html.includes('<script>'), 'script tag survived');
  assert.ok(!/<img/i.test(html), 'img tag survived');
  // The payload is still present, as inert escaped text.
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('&amp;'));
});

// =========================================================================
// Formatting helpers
// =========================================================================

test('money formats with a currency, and degrades gracefully', () => {
  assert.equal(money(10500, 'INR'), 'INR 10,500');
  assert.equal(money(0, 'INR'), 'INR 0');
  assert.equal(money(null, 'INR'), '—');
  assert.equal(money(undefined), '—');
});

test('eth converts wei without floating-point error', () => {
  assert.equal(eth('1200000000000000'), '0.0012 ETH');
  assert.equal(eth('2000000000000000'), '0.002 ETH');
  assert.equal(eth('1000000000000000000'), '1 ETH');
  assert.equal(eth('0'), '0 ETH');
  assert.equal(eth(null), '—');
});

// =========================================================================
// The non-fatal contract
// =========================================================================

test('the transport is in preview mode under NODE_ENV=test', () => {
  assert.equal(emailMode(), 'preview');
});

test('no notification hook ever rejects, whatever it is handed', async () => {
  // Services call these without awaiting. A rejection here would become an
  // unhandled rejection and, per server.js, take the process down — turning a
  // mail problem into an outage.
  const results = await Promise.all([
    notify.reportReceived({ user: { email: 'a@b.test' }, report: {} }),
    notify.reportRejected({ user: { email: 'a@b.test' }, report: {}, reason: 'x' }),
    notify.reportApproved({ user: { email: 'a@b.test' }, report: {} }),
    notify.reportRejectedByAdmin({ user: { email: 'a@b.test' }, report: {}, reason: 'x' }),
    notify.projectPublished({ user: { email: 'a@b.test' }, project: { aiEstimatedCost: {} } }),
    notify.bidSubmitted({ contractor: { email: 'a@b.test' }, project: {}, bid: {} }),
    notify.escrowFunded({ contractor: { email: 'a@b.test' }, project: {} }),
    notify.milestoneApproved({
      contractor: { email: 'a@b.test' },
      reporter: null,
      project: {},
      milestone: {},
    }),
    notify.projectCompleted({ contractor: { email: 'a@b.test' }, reporter: null, project: {} }),
  ]);

  assert.equal(results.length, 9);
});

test('a notification with no recipient is skipped, not thrown', async () => {
  const result = await notify.reportReceived({ user: {}, report: {} });
  assert.equal(result.delivered, false);
  assert.equal(result.reason, 'no-recipient');
});

test('a render failure is reported, not thrown', async () => {
  // reportAwaitingReview maps over admins; an admin with no email must not
  // break the loop for the others.
  const results = await notify.reportAwaitingReview({
    admins: [{ email: 'ok@b.test', name: 'A' }, {}],
    report: {},
  });
  assert.equal(results.length, 2);
  assert.equal(results[1].reason, 'no-recipient');
});

// =========================================================================
// Sample data
// =========================================================================

/** Minimal-but-complete data for each event, matching what the hooks pass. */
function minimalData(event) {
  const estimate = { min: 7000, expected: 10500, max: 16000, currency: 'INR' };
  const common = {
    name: 'Asha Citizen',
    projectId: 'p1',
    reportId: 'r1',
    title: 'Road Damage repair',
    link: 'https://example.test/x',
  };

  const byEvent = {
    'report.received': { ...common, description: 'A pothole', location: 'MG Road', estimatedCost: 10500, currency: 'INR', severity: 'high' },
    'report.rejected': { ...common, reason: 'Not infrastructure.' },
    'report.awaiting_review': { ...common, location: 'MG Road', estimatedCost: 10500, currency: 'INR', severity: 'high' },
    'report.approved': { ...common, location: 'MG Road', estimate },
    'report.rejected_by_admin': { ...common, reason: 'Outside municipal responsibility.' },
    'project.published': { ...common, estimate },
    'project.open_for_bids': { ...common, location: 'MG Road', estimate, bidsCloseAt: new Date(Date.now() + 8.64e7).toISOString() },
    'bid.submitted': { ...common, bid: { amount: 14000, currency: 'INR' }, flagged: false },
    'bid.received': { ...common, contractorName: 'Bela', bid: { amount: 14000, currency: 'INR' }, benchmark: { amount: 16000, currency: 'INR' }, band: 'none' },
    'bid.flagged': { ...common, contractorName: 'Bela', bid: { amount: 25600, currency: 'INR' }, band: 'flagged', benchmark: { amount: 16000, currency: 'INR' }, threshold: { amount: 19200, currency: 'INR' }, deviationPercent: 60, explanation: 'Too high.' },
    'project.awarded': { ...common, awarded: { amount: 14000, currency: 'INR' }, walletAddress: '0xabc' },
    'bid.not_selected': { ...common, bid: { amount: 15000, currency: 'INR' } },
    'project.awarded_reporter': { ...common, awarded: { amount: 14000, currency: 'INR' } },
    'escrow.funded': { ...common, transactionHash: '0xabc123', explorerUrl: ETHERSCAN },
    'milestone.submitted': { ...common, contractorName: 'Bela', milestoneNumber: 1, milestoneDescription: 'Base layer', fundPercentage: 30, progressImageUrl: 'https://img.test/p.jpg', aiAssessment: 'Looks done.', aiConfidence: 0.9, workQuality: 'good' },
    'milestone.ai_rejected': { ...common, milestoneNumber: 1, assessment: 'Not level.', concerns: ['Uneven surface.'], matchesOriginalIssue: true },
    'milestone.rejected': { ...common, milestoneNumber: 1, reason: 'Edges not sealed.' },
    'milestone.paid.contractor': { ...common, milestoneNumber: 1, milestoneDescription: 'Base layer', fundPercentage: 60, amountWei: '1200000000000000', displayAmount: 8400, currency: 'INR', transactionHash: '0xabc123', explorerUrl: ETHERSCAN },
    'milestone.paid.citizen': { ...common, milestoneNumber: 1, milestoneDescription: 'Base layer', fundPercentage: 60, amountWei: '1200000000000000', displayAmount: 8400, currency: 'INR', transactionHash: '0xabc123', explorerUrl: ETHERSCAN, verifyYourself: ETHERSCAN },
    'project.completed.contractor': { ...common, totalReleasedFunds: '2000000000000000', contractExplorerUrl: 'https://sepolia.etherscan.io/address/0xe' },
    'project.completed.citizen': { ...common, totalReleasedFunds: '2000000000000000', contractExplorerUrl: 'https://sepolia.etherscan.io/address/0xe' },
  };

  return byEvent[event] ?? common;
}
