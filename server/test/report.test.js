/**
 * Phase 3 — report units that need neither a database nor a network call.
 *
 * The AI gate itself is verified against real photos and the live Gemini API
 * during phase verification; what is guarded here is the surrounding contract:
 * the status vocabulary, the upload filter, and the promise that notifications
 * can never break a request.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { REPORT_STATUS, REPORT_STATUS_VALUES, REJECTION_SOURCE, SEVERITY_VALUES } from '../src/models/Report.js';
import { ALLOWED_IMAGE_TYPES } from '../src/middlewares/upload.js';
import * as notify from '../src/services/notification.service.js';

// --- Status vocabulary ---------------------------------------------------

test('report statuses cover the full lifecycle', () => {
  assert.deepEqual([...REPORT_STATUS_VALUES].sort(), ['approved', 'pending', 'published', 'rejected']);
});

test('a rejection always records whether the AI or an admin made the call', () => {
  // The UI says "our AI could not accept this" vs "an official reviewed this",
  // so the two must stay distinguishable.
  assert.notEqual(REJECTION_SOURCE.AI, REJECTION_SOURCE.ADMIN);
  assert.equal(REPORT_STATUS.REJECTED, 'rejected');
});

test('severity values match what the UI colour-codes', () => {
  assert.deepEqual([...SEVERITY_VALUES], ['low', 'medium', 'high', 'critical']);
});

// --- Upload filter -------------------------------------------------------

test('the upload filter accepts camera formats and nothing else', () => {
  for (const ok of ['image/jpeg', 'image/png', 'image/webp', 'image/heic']) {
    assert.ok(ALLOWED_IMAGE_TYPES.includes(ok), `should accept ${ok}`);
  }
  for (const bad of ['application/pdf', 'text/plain', 'image/svg+xml', 'video/mp4', 'application/octet-stream']) {
    assert.ok(!ALLOWED_IMAGE_TYPES.includes(bad), `should reject ${bad}`);
  }
});

test('SVG is excluded deliberately', () => {
  // SVG is a script-bearing document, not a photograph. It could never be a
  // genuine phone-camera report, and serving one back invites stored XSS.
  assert.ok(!ALLOWED_IMAGE_TYPES.includes('image/svg+xml'));
});

// --- Notification contract -----------------------------------------------

test('notifications never reject, even with unusable input', async () => {
  // Services call these without awaiting. A rejected promise here would become
  // an unhandled rejection and, per server.js, take the process down.
  const results = await Promise.all([
    notify.reportReceived({ user: { email: 'a@b.test', name: 'A' }, report: { id: '1' } }),
    notify.reportRejected({ user: { email: 'a@b.test', name: 'A' }, report: { id: '1' }, reason: 'x' }),
    notify.reportAwaitingReview({ admins: [{ email: 'c@d.test', name: 'C' }], report: { id: '1' } }),
  ]);
  assert.equal(results.length, 3);
});

test('a notification with a malformed payload still resolves', async () => {
  const result = await notify.reportReceived({ user: { email: 'x@y.test' }, report: {} });
  assert.equal(typeof result, 'object');
});

test('every Phase 3 event has a named function', () => {
  for (const event of ['reportReceived', 'reportRejected', 'reportAwaitingReview']) {
    assert.equal(typeof notify[event], 'function', `${event} should exist`);
  }
});
