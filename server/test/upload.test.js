/**
 * Which upload failures are worth retrying.
 *
 * Found in live use: a rotated Cloudinary API key had valid credentials but was
 * permission-scoped without `create`. Every upload returned 403, and every
 * citizen was told "Could not store the image. Please try again." — a retry
 * that could never succeed, while nothing pointed at the real cause.
 *
 * The distinction is pinned here because most of these statuses cannot be
 * provoked on demand from a real account, so without tests the mapping would
 * only ever be exercised by the one case that happened to occur.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { translateUploadFailure } from '../src/services/upload.service.js';

/** The wording that tells a user to retry. */
const invitesRetry = (err) => /try again/i.test(err.message);

// ---------------------------------------------------------------------------
// Permanent — a retry cannot help
// ---------------------------------------------------------------------------

test('a permission-scoped key (403) is reported as a server misconfiguration', () => {
  // The exact shape the SDK produces: it rewrites the body on an unexpected
  // status, so the `actions=["create"]` detail is already gone by here and only
  // the status is left to key on.
  const err = translateUploadFailure({
    http_code: 403,
    name: 'UnexpectedResponse',
    message: 'Server returned unexpected status code - 403',
  });

  assert.equal(err.statusCode, 503);
  assert.equal(err.code, 'IMAGE_STORAGE_MISCONFIGURED');
  assert.ok(!invitesRetry(err), 'must not invite a retry that cannot succeed');
  assert.match(err.message, /not with your photo/, 'should absolve the user of blame');
});

test('rejected credentials (401) are not presented as a transient blip', () => {
  const err = translateUploadFailure({ http_code: 401, message: 'Invalid Signature' });
  assert.equal(err.code, 'IMAGE_STORAGE_MISCONFIGURED');
  assert.ok(!invitesRetry(err));
});

test('a wrong cloud name (404) is a misconfiguration, not an outage', () => {
  // The upload endpoint is addressed by cloud name, so a 404 means the cloud
  // does not exist. Waiting will not make it appear.
  const err = translateUploadFailure({ http_code: 404, message: 'Not Found' });
  assert.equal(err.code, 'IMAGE_STORAGE_MISCONFIGURED');
  assert.ok(!invitesRetry(err));
});

test('the misconfiguration message promises nothing the server does not do', () => {
  // An earlier draft said "the team has been alerted". Nothing in this codebase
  // alerts anyone, and telling a citizen otherwise would be a lie.
  const err = translateUploadFailure({ http_code: 403, message: 'forbidden' });
  assert.doesNotMatch(err.message, /alerted|notified|we have been told/i);
});

// ---------------------------------------------------------------------------
// The user's own file
// ---------------------------------------------------------------------------

test('a rejected file is a 400 about the photo, not a 503 about the server', () => {
  const err = translateUploadFailure({ http_code: 400, message: 'Invalid image file' });
  assert.equal(err.statusCode, 400);
  assert.equal(err.code, 'IMAGE_REJECTED');
  assert.match(err.message, /different photo/i, 'the user can act on this one');
});

test("Cloudinary's own wording is not forwarded to the user", () => {
  // Its messages can name plan limits and account internals.
  const err = translateUploadFailure({
    http_code: 400,
    message: 'File size too large. Got 31457280. Maximum is 10485760 for your plan',
  });
  assert.doesNotMatch(err.message, /31457280|plan/i);
});

// ---------------------------------------------------------------------------
// Transient — the retry message is correct and must stay
// ---------------------------------------------------------------------------

test('rate limiting tells the user to come back shortly', () => {
  for (const status of [420, 429]) {
    const err = translateUploadFailure({ http_code: status, message: 'Rate limit reached' });
    assert.equal(err.code, 'IMAGE_STORAGE_BUSY', `HTTP ${status}`);
    assert.ok(invitesRetry(err), `HTTP ${status} is temporary, so a retry is the right advice`);
  }
});

test('an upstream 5xx keeps the original retry message', () => {
  const err = translateUploadFailure({ http_code: 503, message: 'Service Unavailable' });
  assert.equal(err.code, 'IMAGE_STORAGE_UNAVAILABLE');
  assert.ok(invitesRetry(err));
});

test('a network failure with no status at all is treated as transient', () => {
  // The conservative default: an unrecognised failure gets the retry message
  // rather than being declared permanent on a guess.
  for (const message of [
    'socket hang up',
    'getaddrinfo ENOTFOUND api.cloudinary.com',
    'connect ETIMEDOUT',
  ]) {
    const err = translateUploadFailure({ message });
    assert.equal(err.code, 'IMAGE_STORAGE_UNAVAILABLE', message);
    assert.ok(invitesRetry(err), message);
  }
  // Including a completely empty error.
  assert.ok(invitesRetry(translateUploadFailure({})));
});

// ---------------------------------------------------------------------------
// Shared properties
// ---------------------------------------------------------------------------

test('every translated failure is operational and keeps its cause', () => {
  // isOperational keeps these out of the crash path; the cause is logged but
  // never sent to the client.
  for (const raw of [{ http_code: 403 }, { http_code: 400 }, { http_code: 429 }, {}]) {
    const err = translateUploadFailure(raw);
    assert.equal(err.isOperational, true);
    assert.equal(err.cause, raw);
    assert.ok(err.code, 'a machine-readable code lets the frontend branch on it');
  }
});

test('the four outcomes have distinct codes', () => {
  const codes = new Set(
    [{ http_code: 403 }, { http_code: 400 }, { http_code: 429 }, { http_code: 500 }].map(
      (e) => translateUploadFailure(e).code
    )
  );
  assert.equal(codes.size, 4, 'a client cannot distinguish outcomes that share a code');
});

// ---------------------------------------------------------------------------
// Deletion must purge the CDN, not just the stored asset
// ---------------------------------------------------------------------------

/**
 * Run `deleteImage` for real, with Cloudinary's `destroy` intercepted.
 *
 * In a child process because fixture mode is forced on under NODE_ENV=test, so
 * `deleteImage` would short-circuit and never reach the SDK — the assertion
 * would pass without testing anything. The child runs as `development` with
 * uploads un-mocked, and patches the `cloudinary` singleton before the service
 * is imported, so nothing touches the network.
 */
const deleteImageProbe = () => {
  const serviceUrl = new URL('../src/services/upload.service.js', import.meta.url).href;
  const script = `
    import { v2 as cloudinary } from 'cloudinary';
    const calls = [];
    cloudinary.uploader.destroy = async (publicId, options) => {
      calls.push({ publicId, options: options ?? null });
      return { result: 'ok' };
    };
    const { deleteImage } = await import(${JSON.stringify(serviceUrl)});
    const { config } = await import(${JSON.stringify(new URL('../src/config/env.js', import.meta.url).href)});
    const returned = await deleteImage('openinfra/reports/withdrawn-photo');
    process.stdout.write(JSON.stringify({ returned, calls, mock: config.cloudinary.mock }));
  `;

  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: {
      ...process.env,
      NODE_ENV: 'development', // `test` forces fixture mode, which skips the SDK
      MOCK_EXTERNAL: 'false',
      MOCK_UPLOADS: 'false',
      LOG_LEVEL: 'silent',
    },
    encoding: 'utf8',
  });
  return JSON.parse(out.slice(out.indexOf('{')));
};

test('deleting an image invalidates the CDN copy, not just the stored asset', () => {
  /**
   * `report.service.deleteReport` calls this when a citizen deletes their own
   * report. Without `invalidate: true`, Cloudinary drops the stored asset but
   * keeps serving the delivery URL — sent as `immutable, max-age=2592000` — so
   * a withdrawn photo stays publicly fetchable for up to thirty days by anyone
   * holding the link, with no authentication on it.
   */
  const { returned, calls, mock } = deleteImageProbe();

  assert.equal(mock, false, 'the probe must exercise the real path, not fixture mode');
  assert.equal(calls.length, 1, 'destroy should have been called exactly once');
  assert.equal(calls[0].publicId, 'openinfra/reports/withdrawn-photo');
  assert.ok(calls[0].options, 'destroy must be called with options, not bare');
  assert.equal(calls[0].options.invalidate, true, 'the CDN copy must be purged too');
  assert.equal(returned, true);
});

test('a citizen deleting their report is what triggers that invalidation', () => {
  // The privacy promise lives in report.service, so the link between the two is
  // worth pinning: a refactor that stopped deleting the image would leave the
  // photo served indefinitely with nothing failing.
  const source = readFileSync(new URL('../src/services/report.service.js', import.meta.url), 'utf8');
  const fn = source.slice(source.indexOf('export const deleteReport'));
  assert.match(
    fn,
    /await deleteImage\(report\.imagePublicId\)/,
    'deleteReport must remove the stored photograph, not only the record'
  );
});
