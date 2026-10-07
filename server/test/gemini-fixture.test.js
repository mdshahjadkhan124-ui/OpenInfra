/**
 * Fixture mode for the external integrations.
 *
 * NODE_ENV=test forces mocking on (see config/env.js), so the whole suite runs
 * without credentials and without spending the Gemini daily quota. These tests
 * verify the fixture path produces the same shape the real one does.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { config } from '../src/config/env.js';
import { analyseReportImage } from '../src/services/gemini.service.js';
import { uploadImage, deleteImage } from '../src/services/upload.service.js';
import { FIXTURE_RESPONSES } from '../src/services/__fixtures__/aiResponses.js';
import { verifyFixtures } from './fixtures/verify.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const img = (name) => fs.readFileSync(path.join(FIXTURES, name));

/**
 * First, because every other fixture assertion in the suite depends on it.
 *
 * Responses are keyed by the SHA-256 of the image bytes, and an unknown hash
 * falls back to a PASSING verdict — so a re-saved PNG turns the negative tests
 * into positive ones. The behavioural tests below would fail, but they would
 * report it as `expected false, got true` and send the reader hunting for a bug
 * in the AI gate instead of looking at the file they just touched.
 */
test('the fixture images still match their recorded digests', () => {
  const { ok, problems, checked } = verifyFixtures();
  assert.ok(checked > 0, 'hashes.json should list at least one fixture');
  // The problems are already written as complete sentences naming the file and
  // the fix, so they are the whole assertion message.
  assert.ok(ok, ['', ...problems.map((p) => `  • ${p}`), ''].join('\n\n'));
});

test('fixture mode is on under NODE_ENV=test', () => {
  assert.equal(config.gemini.mock, true);
  assert.equal(config.cloudinary.mock, true);
  // A mocked integration must report ready, or callers would throw a 503.
  assert.equal(config.gemini.ready, true);
  assert.equal(config.cloudinary.ready, true);
});

test('the road-damage fixture passes the gate and carries a full range', async () => {
  const { relevance, costEstimate } = await analyseReportImage(img('relevant-road-damage.png'), {
    mimeType: 'image/png',
  });

  assert.equal(relevance.isRelevant, true);
  assert.equal(relevance.category, 'road_damage');
  assert.equal(relevance.model, 'fixture');

  const expected = FIXTURE_RESPONSES.relevantRoadDamage.cost;
  assert.equal(costEstimate.amount, expected.expectedCost);
  assert.equal(costEstimate.minAmount, expected.minCost);
  assert.equal(costEstimate.maxAmount, expected.maxCost);
  assert.equal(costEstimate.currency, config.report.currency);
  assert.ok(costEstimate.assumptions.length > 0, 'assumptions should be recorded');
});

test('the bounds are ordered min <= expected <= max', async () => {
  for (const name of ['relevant-road-damage.png', 'relevant-street-lighting.png']) {
    const { costEstimate } = await analyseReportImage(img(name), { mimeType: 'image/png' });
    assert.ok(costEstimate.minAmount <= costEstimate.amount, `${name}: min <= expected`);
    assert.ok(costEstimate.amount <= costEstimate.maxAmount, `${name}: expected <= max`);
  }
});

test('the irrelevant fixture is rejected with no cost at all', async () => {
  const { relevance, costEstimate } = await analyseReportImage(
    img('irrelevant-not-infrastructure.png'),
    { mimeType: 'image/png' }
  );

  assert.equal(relevance.isRelevant, false);
  assert.equal(relevance.category, 'not_infrastructure');
  // Null, not a zero-valued range: a fake benchmark must never reach Phase 5.
  assert.equal(costEstimate, null);
  assert.match(relevance.reason, /infrastructure/i);
});

test('fixture mode is deterministic — same bytes, same verdict', async () => {
  const buf = img('relevant-road-damage.png');
  const a = await analyseReportImage(buf, { mimeType: 'image/png' });
  const b = await analyseReportImage(buf, { mimeType: 'image/png' });
  assert.equal(a.costEstimate.amount, b.costEstimate.amount);
  assert.equal(a.costEstimate.maxAmount, b.costEstimate.maxAmount);
  assert.equal(a.relevance.category, b.relevance.category);
});

test('an unknown image falls back to a usable relevant response', async () => {
  const { relevance, costEstimate } = await analyseReportImage(Buffer.from('an unknown image'), {
    mimeType: 'image/png',
  });
  assert.equal(relevance.isRelevant, true);
  assert.ok(costEstimate.maxAmount > 0);
});

test('fixture mode makes no network round trip', async () => {
  const started = Date.now();
  const { relevance } = await analyseReportImage(img('relevant-road-damage.png'), {
    mimeType: 'image/png',
  });
  assert.equal(relevance.model, 'fixture');
  assert.ok(Date.now() - started < 200, 'should not make a network round trip');
});

test('mocked uploads return a stable fake asset', async () => {
  const buf = img('relevant-road-damage.png');
  const a = await uploadImage(buf, { folder: 'reports' });
  const b = await uploadImage(buf, { folder: 'reports' });

  assert.equal(a.publicId, b.publicId, 'same bytes should map to the same asset id');
  assert.match(a.url, /^https:\/\/res\.cloudinary\.com\/fixture\//);
  assert.equal(a.mock, true);
  assert.equal(await deleteImage(a.publicId), true);
});

test('different images get different mocked asset ids', async () => {
  const a = await uploadImage(img('relevant-road-damage.png'), { folder: 'reports' });
  const b = await uploadImage(img('irrelevant-not-infrastructure.png'), { folder: 'reports' });
  assert.notEqual(a.publicId, b.publicId);
});
