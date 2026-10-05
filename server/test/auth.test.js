/**
 * Phase 2 — auth units that need no database.
 *
 * The flows that do need one (registration, login, account linking) are
 * exercised against a real MongoDB during phase verification; what lives here
 * is the logic worth guarding on every commit: token signing rules and the
 * role guard.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

import { signAccessToken, verifyAccessToken } from '../src/services/token.service.js';
import { authorize } from '../src/middlewares/auth.js';
import { ROLES, SELF_ASSIGNABLE_ROLES, ETH_ADDRESS_PATTERN } from '../src/models/User.js';

const fakeUser = { id: '6ac3e283fd2b6c9f44e29a7f', role: ROLES.CITIZEN };

// --- Tokens --------------------------------------------------------------

test('a signed token round-trips with the right subject and issuer', () => {
  const decoded = verifyAccessToken(signAccessToken(fakeUser));
  assert.equal(decoded.sub, fakeUser.id);
  assert.equal(decoded.role, ROLES.CITIZEN);
  assert.equal(decoded.iss, 'openinfra-api');
});

test('a token signed with a different secret is rejected', () => {
  const forged = jwt.sign({ sub: fakeUser.id, role: ROLES.ADMIN }, 'not-the-real-secret', {
    issuer: 'openinfra-api',
  });
  assert.throws(() => verifyAccessToken(forged), { name: 'JsonWebTokenError' });
});

test('a token from another issuer is rejected', () => {
  const foreign = jwt.sign({ sub: fakeUser.id }, process.env.JWT_SECRET, { issuer: 'somewhere-else' });
  assert.throws(() => verifyAccessToken(foreign), { name: 'JsonWebTokenError' });
});

test('an expired token is rejected distinctly from an invalid one', () => {
  const expired = jwt.sign({ sub: fakeUser.id }, process.env.JWT_SECRET, {
    issuer: 'openinfra-api',
    expiresIn: '-1s',
  });
  assert.throws(() => verifyAccessToken(expired), { name: 'TokenExpiredError' });
});

// --- Role guard ----------------------------------------------------------

/** Run authorize() and capture whatever it passes to next(). */
const runGuard = (user, allowed) => {
  let captured = 'called-next-with-nothing';
  authorize(...allowed)({ user }, {}, (err) => {
    captured = err ?? null;
  });
  return captured;
};

test('authorize lets a matching role through', () => {
  assert.equal(runGuard({ role: ROLES.ADMIN }, [ROLES.ADMIN]), null);
});

test('authorize accepts any one of several allowed roles', () => {
  assert.equal(runGuard({ role: ROLES.CONTRACTOR }, [ROLES.ADMIN, ROLES.CONTRACTOR]), null);
});

test('authorize rejects a non-matching role with 403', () => {
  const err = runGuard({ role: ROLES.CITIZEN }, [ROLES.ADMIN]);
  assert.equal(err.statusCode, 403);
  assert.match(err.message, /requires the admin role/);
});

test('authorize fails closed when authenticate did not run', () => {
  // req.user missing means the route was mis-wired. It must deny, not allow.
  const err = runGuard(undefined, [ROLES.ADMIN]);
  assert.equal(err.statusCode, 401);
});

// --- Role constants ------------------------------------------------------

test('admin is not self-assignable at signup', () => {
  assert.ok(!SELF_ASSIGNABLE_ROLES.includes(ROLES.ADMIN));
  assert.deepEqual([...SELF_ASSIGNABLE_ROLES].sort(), ['citizen', 'contractor']);
});

// --- Wallet address pattern ----------------------------------------------

test('the wallet pattern accepts valid addresses and rejects near-misses', () => {
  const valid = '0x742d35cc6634c0532925a3b844bc454e4438f44e';
  assert.ok(ETH_ADDRESS_PATTERN.test(valid));
  assert.ok(ETH_ADDRESS_PATTERN.test(valid.toUpperCase().replace('0X', '0x')));

  for (const bad of [
    valid.slice(0, -1), // too short
    `${valid}a`, // too long
    valid.replace('0x', ''), // no prefix
    valid.replace('e', 'g'), // non-hex character
    '',
  ]) {
    assert.ok(!ETH_ADDRESS_PATTERN.test(bad), `should reject: ${bad}`);
  }
});
