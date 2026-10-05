/**
 * Phase 1 smoke tests.
 *
 * These exercise the HTTP layer only — no database. NODE_ENV=test relaxes the
 * config loader's core-variable check, and createApp() is deliberately separate
 * from server.js so the app can be driven without connecting to Mongo.
 *
 * Uses node:test + global fetch; no supertest dependency.
 *
 * NODE_ENV=test is set by test/setup.js, preloaded via --import.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

/** Boot the app on an ephemeral port and hand the test a bound fetch. */
const withServer = async (run) => {
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run((path, init) => fetch(base + path, init));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

test('GET / returns the API banner', async () => {
  await withServer(async (get) => {
    const res = await get('/');
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.message, 'OpenInfra API');
  });
});

test('unknown route returns a 404 in the standard error envelope', async () => {
  await withServer(async (get) => {
    const res = await get('/api/definitely-not-a-route');
    const body = await res.json();
    assert.equal(res.status, 404);
    assert.equal(body.success, false);
    assert.equal(body.code, 'ROUTE_NOT_FOUND');
  });
});

test('malformed JSON is translated to a 400, not a 500', async () => {
  await withServer(async (get) => {
    const res = await get('/api/health', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.code, 'MALFORMED_JSON');
  });
});

test('a disallowed CORS origin is rejected as 403, not 500', async () => {
  await withServer(async (get) => {
    const res = await get('/api/health', { headers: { Origin: 'http://evil.example.com' } });
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.code, 'FORBIDDEN');
  });
});

test('the configured client origin is allowed', async () => {
  await withServer(async (get) => {
    const res = await get('/api/health', { headers: { Origin: 'http://localhost:5173' } });
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  });
});

test('health reports degraded (503) when the database is not connected', async () => {
  await withServer(async (get) => {
    const res = await get('/api/health');
    const body = await res.json();
    // No DB connection is made in these tests, so health must say so rather
    // than optimistically reporting ok.
    assert.equal(res.status, 503);
    assert.equal(body.data.status, 'degraded');
    assert.equal(body.data.database.status, 'disconnected');
  });
});
