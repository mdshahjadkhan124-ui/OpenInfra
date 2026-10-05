/**
 * Test preload, run via `node --import ./test/setup.js`.
 *
 * This cannot live inside the test files themselves: ES `import` statements are
 * hoisted and evaluated before any top-level assignment, so setting NODE_ENV in
 * a test file happens *after* src/config/env.js has already read it. Preloading
 * is the only way to guarantee the flag is set before the config module loads.
 *
 * Setting NODE_ENV=test does two things that matter here:
 *   • relaxes the config loader's required-variable check, so the suite runs on
 *     a fresh clone that has no .env yet
 *   • silences the logger and morgan, keeping test output readable
 */
process.env.NODE_ENV = 'test';

// Deterministic values so tests never depend on a developer's local .env.
process.env.JWT_SECRET ??= 'test-secret-not-used-for-real-tokens';
process.env.CLIENT_URL ??= 'http://localhost:5173';
