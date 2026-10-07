/**
 * Integrity check for the fixture images.
 *
 * Fixture mode keys its canned AI responses on the SHA-256 of the image bytes,
 * and an unrecognised hash falls back to `DEFAULT_RELEVANT` — a *passing*
 * verdict. So re-saving one of these PNGs, or re-exporting it from an editor
 * that rewrites metadata, silently turns every negative test into a positive
 * one: the irrelevant image starts being judged relevant and the half-done
 * milestone photo starts being judged complete.
 *
 * The behavioural tests do catch that, but they report it as
 * `expected false, got true`, which sends the reader looking for a bug in the
 * AI gate rather than at the file they just touched. This says what actually
 * happened.
 *
 * Three things have to agree, and this checks all three rather than just the
 * digests:
 *
 *   1. the bytes on disk          (the actual SHA-256)
 *   2. `hashes.json`              (the recorded digest)
 *   3. the keys in `aiResponses.js` (AI_FIXTURES and MILESTONE_FIXTURES)
 *
 * Any pair agreeing while the third drifts is still a broken fixture, so a
 * digest is not enough on its own.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { AI_FIXTURES, MILESTONE_FIXTURES } from '../../src/services/__fixtures__/aiResponses.js';

const FIXTURE_DIR = import.meta.dirname;
const MANIFEST = path.join(FIXTURE_DIR, 'hashes.json');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/**
 * @returns {{ok: boolean, problems: string[], checked: number}}
 *   `problems` are complete sentences, each naming the file and the fix.
 */
export const verifyFixtures = () => {
  const problems = [];

  if (!fs.existsSync(MANIFEST)) {
    return { ok: false, problems: [`The fixture manifest is missing: ${MANIFEST}`], checked: 0 };
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  } catch (err) {
    return { ok: false, problems: [`hashes.json is not valid JSON: ${err.message}`], checked: 0 };
  }

  const expectedDigests = new Set();

  for (const [name, expected] of Object.entries(manifest)) {
    const file = path.join(FIXTURE_DIR, name);

    if (!fs.existsSync(file)) {
      problems.push(
        `${name} is listed in hashes.json but missing from test/fixtures/. ` +
          `Restore it from git (git checkout -- server/test/fixtures/${name}).`
      );
      continue;
    }

    const actual = sha256(fs.readFileSync(file));
    expectedDigests.add(expected);

    if (actual !== expected) {
      problems.push(
        `${name} has changed. Its bytes now hash to ${actual} but hashes.json ` +
          `records ${expected}.\n` +
          `      Fixture responses are keyed by this hash, so the canned verdict no ` +
          `longer applies and\n` +
          `      lookups fall back to a PASSING response — which quietly inverts the ` +
          `negative tests.\n` +
          `      Either restore the file (git checkout -- server/test/fixtures/${name}) or, ` +
          `if the\n` +
          `      change was deliberate, update hashes.json AND the matching keys in\n` +
          `      src/services/__fixtures__/aiResponses.js to ${actual}.`
      );
      continue;
    }

    // The digest is right; now make sure both response maps still know it.
    if (!Object.hasOwn(AI_FIXTURES, expected)) {
      problems.push(
        `${name} matches its recorded digest, but ${expected} is not a key in ` +
          `AI_FIXTURES (src/services/__fixtures__/aiResponses.js), so report analysis ` +
          `falls back to DEFAULT_RELEVANT for it.`
      );
    }
    if (!Object.hasOwn(MILESTONE_FIXTURES, expected)) {
      problems.push(
        `${name} matches its recorded digest, but ${expected} is not a key in ` +
          `MILESTONE_FIXTURES, so milestone verification falls back to a "complete" ` +
          `verdict for it.`
      );
    }
  }

  // Orphans in the other direction: a key no fixture file can produce is dead
  // config, and usually the leftover half of a half-finished rename.
  for (const [label, map] of [
    ['AI_FIXTURES', AI_FIXTURES],
    ['MILESTONE_FIXTURES', MILESTONE_FIXTURES],
  ]) {
    for (const key of Object.keys(map)) {
      if (!expectedDigests.has(key)) {
        problems.push(
          `${label} has an entry for ${key}, but no file in hashes.json hashes to it. ` +
            `Either the fixture image was removed or the key is stale.`
        );
      }
    }
  }

  // A stray PNG nobody has registered will silently behave as "relevant".
  for (const entry of fs.readdirSync(FIXTURE_DIR)) {
    if (entry.endsWith('.png') && !Object.hasOwn(manifest, entry)) {
      problems.push(
        `${entry} is in test/fixtures/ but not in hashes.json, so it has no canned ` +
          `verdict and would be treated as relevant. Register it or remove it.`
      );
    }
  }

  return { ok: problems.length === 0, problems, checked: Object.keys(manifest).length };
};

/** Throw with everything that is wrong, for callers that should not continue. */
export const assertFixturesIntact = () => {
  const { ok, problems, checked } = verifyFixtures();
  if (ok) return checked;

  throw new Error(
    `Fixture images are not in the state the tests assume ` +
      `(${problems.length} problem${problems.length === 1 ? '' : 's'}):\n\n` +
      problems.map((p) => `  • ${p}`).join('\n\n') +
      '\n'
  );
};
