/**
 * Phase 11 — the security controls, exercised rather than asserted about.
 *
 * Two things are guarded here that a refactor could quietly undo without
 * breaking anything visible:
 *
 *   1. Who may read a project's full milestone records. The public dashboard
 *      redacts them carefully; an authenticated endpoint that returns
 *      everything to anyone signed in would be the back door around that.
 *   2. That the server refuses to start on a guessable JWT secret. This one is
 *      run in a real child process, because the control is `process.exit(1)` at
 *      import time and nothing short of a separate process can observe it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import { Project } from '../src/models/Project.js';
import { Milestone } from '../src/models/Milestone.js';
import { ROLES } from '../src/models/User.js';
import { listMilestonesForProject } from '../src/services/milestone.service.js';

// ---------------------------------------------------------------------------
// Who may read the full milestone records
// ---------------------------------------------------------------------------

const PROJECT_ID = '6ac48fed7f7ea1f37629bc1c';
const CONTRACTOR_ID = '6ac3e283fd2b6c9f44e29a7f';
const OUTSIDER_ID = '6ac3e283fd2b6c9f44e29a80';

/**
 * Stand in for the two model reads the function makes.
 *
 * Mongoose models are plain objects, so replacing a method swaps it for every
 * importer — which is the seam that lets this run with no database. Restored
 * after each test so nothing leaks into the rest of the suite.
 */
const withStubbedModels = async (run) => {
  const realFindById = Project.findById;
  const realFind = Milestone.find;

  Project.findById = async () => ({
    _id: PROJECT_ID,
    id: PROJECT_ID,
    title: 'Road repair',
    status: 'in_progress',
    awardedContractor: { toString: () => CONTRACTOR_ID },
    smartContractAddress: null,
    onChainProjectId: 3,
    totalLockedFunds: '4000000000000000',
    totalReleasedFunds: '0',
    fundingTxHash: null,
  });

  // `.sort()` is chained onto the result, so the stub returns a thenable-ish
  // object exposing it.
  Milestone.find = () => ({
    sort: async () => [
      {
        number: 1,
        status: 'submitted',
        fundPercentage: 100,
        transactionHash: null,
        toJSON: () => ({
          number: 1,
          status: 'submitted',
          overrideJustification: 'Site inspection confirmed the work.',
          rejectionReason: null,
          reviewedBy: 'an-admin-id',
        }),
      },
    ],
  });

  try {
    return await run();
  } finally {
    Project.findById = realFindById;
    Milestone.find = realFind;
  }
};

const asUser = (role, id) => ({ id, role });

test('the assigned contractor gets the full milestone records', async () => {
  await withStubbedModels(async () => {
    const result = await listMilestonesForProject(
      PROJECT_ID,
      asUser(ROLES.CONTRACTOR, CONTRACTOR_ID)
    );
    assert.equal(result.milestones.length, 1);
    assert.ok(
      'overrideJustification' in result.milestones[0],
      'the contractor doing the work sees the full record'
    );
  });
});

test('an admin gets the full milestone records', async () => {
  await withStubbedModels(async () => {
    const result = await listMilestonesForProject(PROJECT_ID, asUser(ROLES.ADMIN, OUTSIDER_ID));
    assert.equal(result.milestones.length, 1);
  });
});

test('an unrelated citizen is refused, and told 404 rather than 403', async () => {
  // 403 would confirm the project exists and let an outsider enumerate ids.
  await withStubbedModels(async () => {
    await assert.rejects(
      () => listMilestonesForProject(PROJECT_ID, asUser(ROLES.CITIZEN, OUTSIDER_ID)),
      (err) => err.statusCode === 404
    );
  });
});

test('a contractor who was not awarded this project is refused', async () => {
  // The case that matters commercially: a losing bidder reading the winner's
  // submission history.
  await withStubbedModels(async () => {
    await assert.rejects(
      () => listMilestonesForProject(PROJECT_ID, asUser(ROLES.CONTRACTOR, OUTSIDER_ID)),
      (err) => err.statusCode === 404
    );
  });
});

test('a missing requester is refused rather than treated as permitted', async () => {
  // A future caller that forgets to pass req.user must fail closed.
  await withStubbedModels(async () => {
    await assert.rejects(
      () => listMilestonesForProject(PROJECT_ID, undefined),
      (err) => err.statusCode === 404
    );
  });
});

// ---------------------------------------------------------------------------
// The server refuses to start on a guessable JWT secret
// ---------------------------------------------------------------------------

// A file:// URL rather than a filesystem path: on Windows an absolute path is
// not a valid ESM specifier, and the child would then fail for the wrong
// reason and make this test look like it was passing on a technicality.
const ENV_MODULE = new URL('../src/config/env.js', import.meta.url).href;

/** Import env.js in a fresh process, and report how it exited. */
const bootWith = (JWT_SECRET) => {
  try {
    execFileSync(process.execPath, ['--input-type=module', '-e', `import ${JSON.stringify(ENV_MODULE)}`], {
      env: {
        ...process.env,
        NODE_ENV: 'development', // the guard is skipped under NODE_ENV=test
        MONGO_URI: 'mongodb://127.0.0.1:27017',
        JWT_SECRET,
      },
      stdio: 'pipe',
    });
    return { exitCode: 0, output: '' };
  } catch (err) {
    return {
      exitCode: err.status,
      output: `${err.stdout ?? ''}${err.stderr ?? ''}`,
    };
  }
};

test('a short JWT secret stops the server at boot', () => {
  const { exitCode, output } = bootWith('tooshort');
  assert.equal(exitCode, 1, 'it must refuse to start');
  assert.match(output, /JWT_SECRET is not strong enough/);
  assert.match(output, /at least 32 are required/);
});

test('a well-known placeholder is named as such, not merely called short', () => {
  // The placeholder list is checked before the length floor. Every entry is
  // under 32 characters, so testing length first made the list unreachable and
  // reported the copy-paste default as a length problem.
  const { exitCode, output } = bootWith('changeme');
  assert.equal(exitCode, 1);
  assert.match(output, /well-known placeholder/);
});

test('a long secret made of padding or repetition is refused', () => {
  // Length is not strength. Both of these clear 32 characters and are trivial.
  for (const weak of ['changeme'.padEnd(40, 'x'), 'a'.repeat(40), 'abcabcabc'.repeat(5)]) {
    const { exitCode, output } = bootWith(weak);
    assert.equal(exitCode, 1, `should refuse ${weak.slice(0, 12)}…`);
    assert.match(output, /distinct characters/);
  }
});

test('a properly generated secret boots', () => {
  // 48 random bytes, base64 — what the README tells you to generate.
  const { exitCode } = bootWith('Zq7kP2vN8mR4tY6uI0oA3sD5fG9hJ1kL7zX4cV6bN8mQ2wE5rT7y');
  assert.equal(exitCode, 0);
});
