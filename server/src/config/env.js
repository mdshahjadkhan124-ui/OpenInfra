/**
 * Environment loader & validator.
 *
 * Two kinds of variables, deliberately treated differently:
 *
 *  1. CORE      — the server cannot meaningfully run without these, so a missing
 *                 one is a hard crash at boot with a readable message.
 *  2. FEATURE   — each external integration (Gemini, Cloudinary, OAuth, email,
 *                 chain) is a *group*. A group with missing keys does not stop
 *                 the server; it is marked `ready: false` and the service that
 *                 depends on it throws a specific "not configured" error only if
 *                 something actually calls it.
 *
 * Why: this project is built in phases, and a half-configured .env is the normal
 * state for most of that time. Crashing on a Cloudinary key that Phase 1 never
 * touches would make the server impossible to develop against. Failing loudly at
 * the point of use, instead of at boot, keeps the feedback precise.
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load /server/.env regardless of the directory the process was started from.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/** Read a variable, falling back to a default. Empty strings count as unset. */
const read = (key, fallback = undefined) => {
  const value = process.env[key];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
};

/** A feature group is `ready` only when every one of its keys has a value. */
const group = (keys) => {
  const missing = keys.filter((key) => read(key) === undefined);
  return { ready: missing.length === 0, missing };
};

// ---------------------------------------------------------------------------
// Core — required to boot
// ---------------------------------------------------------------------------
const NODE_ENV = read('NODE_ENV', 'development');
const isTest = NODE_ENV === 'test';

const CORE_KEYS = ['MONGO_URI', 'JWT_SECRET'];
const missingCore = isTest ? [] : CORE_KEYS.filter((key) => read(key) === undefined);

if (missingCore.length > 0) {
  console.error(
    [
      '',
      '  ✗ Cannot start: required environment variables are missing.',
      '',
      ...missingCore.map((key) => `      • ${key}`),
      '',
      '    Copy server/.env.example to server/.env and fill these in.',
      '',
    ].join('\n')
  );
  process.exit(1);
}

/**
 * A present-but-weak JWT secret is worse than a missing one.
 *
 * A missing secret stops the server with a clear message. A secret of
 * "secret" or "changeme" starts it happily and signs every session token with
 * something guessable — and because `authenticate` trusts the signature to
 * identify the user, forging one means becoming any user, admin included. A
 * fresh clone filling in the .env is exactly where that happens, so it is
 * refused at boot rather than left to be discovered.
 *
 * 32 characters is the floor for the HMAC-SHA256 used to sign these tokens.
 * `openssl rand -base64 48` produces a suitable value.
 */
const JWT_SECRET_MIN_LENGTH = 32;
const WEAK_SECRETS = new Set([
  'secret',
  'changeme',
  'password',
  'jwtsecret',
  'your-secret-key',
  'supersecret',
]);

/**
 * Enough distinct characters to rule out padding and repetition.
 *
 * Length alone is not strength. "changeme" padded to forty x's, or forty
 * repetitions of "a", clears a length check while remaining trivial to guess.
 * Base64 of 48 random bytes yields roughly 40 distinct characters, so a floor
 * of 10 rejects junk without troubling anything genuinely random.
 */
const JWT_SECRET_MIN_DISTINCT = 10;

if (!isTest) {
  const secret = read('JWT_SECRET').trim();
  const normalised = secret.toLowerCase();
  const distinct = new Set(secret).size;

  // Order matters: the placeholder check runs FIRST. Every value in the list is
  // shorter than the length floor, so testing length first would make the list
  // unreachable and its clearer message never appear.
  const problem = WEAK_SECRETS.has(normalised)
    ? 'it is a well-known placeholder value'
    : secret.length < JWT_SECRET_MIN_LENGTH
      ? `it is ${secret.length} characters; at least ${JWT_SECRET_MIN_LENGTH} are required`
      : distinct < JWT_SECRET_MIN_DISTINCT
        ? `it uses only ${distinct} distinct characters, so it is padding or repetition ` +
          `rather than a random secret; at least ${JWT_SECRET_MIN_DISTINCT} are required`
        : null;

  if (problem) {
    console.error(
      [
        '',
        '  ✗ Cannot start: JWT_SECRET is not strong enough.',
        '',
        `      ${problem}.`,
        '',
        '    Anyone who guesses this secret can forge a session token for any',
        '    account, including an administrator. Generate a real one:',
        '',
        '      openssl rand -base64 48',
        '',
      ].join('\n')
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Feature groups — optional at boot, validated at point of use
// ---------------------------------------------------------------------------
/**
 * Fixture mode. External calls (Gemini, Cloudinary) are replaced by
 * deterministic canned responses. Always on under NODE_ENV=test so the suite
 * never spends API quota, and switchable in development via MOCK_EXTERNAL.
 */
const mockAll = isTest || read('MOCK_EXTERNAL', 'false') === 'true';
const mockAi = mockAll || read('MOCK_AI', 'false') === 'true';
const mockUploads = mockAll || read('MOCK_UPLOADS', 'false') === 'true';
const mockChain = mockAll || read('MOCK_CHAIN', 'false') === 'true';
const mockEmail = mockAll || read('MOCK_EMAIL', 'false') === 'true';

const gemini = group(['GEMINI_API_KEY']);
const cloudinary = group(['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']);
const googleOAuth = group(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL']);
const email = group(['EMAIL_USER', 'EMAIL_PASS']);
const chain = group(['CONTRACT_ADDRESS', 'SEPOLIA_RPC_URL']);

export const config = Object.freeze({
  env: NODE_ENV,
  isProduction: NODE_ENV === 'production',
  isTest,
  port: Number.parseInt(read('PORT', '5000'), 10),

  clientUrl: read('CLIENT_URL', 'http://localhost:5173'),

  mongoUri: read('MONGO_URI'),
  dbName: read('MONGO_DB_NAME', 'openinfra'),

  jwt: Object.freeze({
    secret: read('JWT_SECRET'),
    expiresIn: read('JWT_EXPIRES_IN', '7d'),
  }),

  gemini: Object.freeze({
    ...gemini,
    // A mocked integration is "ready" regardless of keys — nothing is called.
    ready: mockAi || gemini.ready,
    mock: mockAi,
    apiKey: read('GEMINI_API_KEY'),
    // Vision-capable model used for both the relevance gate and milestone verification.
    model: read('GEMINI_MODEL', 'gemini-2.5-flash'),
  }),

  /**
   * Reporting context. The AI estimate is only meaningful against a currency
   * and a market, so both are configurable rather than hardcoded in the prompt.
   */
  report: Object.freeze({
    currency: read('REPORT_CURRENCY', 'INR'),
    region: read('REPORT_REGION', 'India'),
    maxUploadMb: Number.parseInt(read('MAX_UPLOAD_MB', '10'), 10),
  }),

  /**
   * Bid anomaly detection (Phase 5).
   *
   * A bid is flagged when it exceeds the AI estimate's UPPER bound by more
   * than this margin. Scoring against maxCost rather than a point estimate is
   * deliberate — see docs in services/gemini.service.js on estimate variance.
   */
  bidding: Object.freeze({
    anomalyMarginPercent: Number.parseFloat(read('ANOMALY_MARGIN_PERCENT', '20')),
  }),

  cloudinary: Object.freeze({
    ...cloudinary,
    ready: mockUploads || cloudinary.ready,
    mock: mockUploads,
    cloudName: read('CLOUDINARY_CLOUD_NAME'),
    apiKey: read('CLOUDINARY_API_KEY'),
    apiSecret: read('CLOUDINARY_API_SECRET'),
    folder: read('CLOUDINARY_FOLDER', 'openinfra'),
  }),

  googleOAuth: Object.freeze({
    ...googleOAuth,
    clientId: read('GOOGLE_CLIENT_ID'),
    clientSecret: read('GOOGLE_CLIENT_SECRET'),
    callbackUrl: read('GOOGLE_CALLBACK_URL', 'http://localhost:5000/api/auth/google/callback'),
  }),

  email: Object.freeze({
    ...email,
    user: read('EMAIL_USER'),
    pass: read('EMAIL_PASS'),
    fromName: read('EMAIL_FROM_NAME', 'OpenInfra'),
    /**
     * Render emails to disk instead of sending them. On under NODE_ENV=test
     * and whenever MOCK_EMAIL is set, so the suite and routine development
     * never spend Gmail's daily quota or reach a real inbox.
     */
    preview: mockEmail,
    previewDir: read('EMAIL_PREVIEW_DIR', '.email-preview'),
  }),

  chain: Object.freeze({
    ...chain,
    contractAddress: read('CONTRACT_ADDRESS'),
    rpcUrl: read('SEPOLIA_RPC_URL'),
    // No signing key. Phase 9 moved every signature to the admin's own
    // MetaMask; the server prepares and verifies transactions but cannot send
    // one. See services/chain.service.js.
    chainId: Number.parseInt(read('CHAIN_ID', '11155111'), 10),
    /**
     * Block the escrow contract was deployed in. Used as the lower bound when
     * scanning event logs to recover a lost transaction hash — the contract
     * cannot have emitted anything earlier, and some RPC providers cap the
     * block range of a single getLogs call.
     */
    deployBlock: Number.parseInt(read('CONTRACT_DEPLOY_BLOCK', '11851337'), 10),
    /**
     * Largest block range this RPC provider accepts for one eth_getLogs call.
     * Alchemy's free tier allows TEN, which is why recovery targets a block by
     * timestamp rather than sweeping a range. Raise it on a paid plan.
     */
    logWindow: Number.parseInt(read('RPC_LOG_WINDOW', '10'), 10),
    etherscanBaseUrl: read('ETHERSCAN_BASE_URL', 'https://sepolia.etherscan.io'),
    /** Confirmations to wait for before treating a release as final. */
    confirmations: Number.parseInt(read('CHAIN_CONFIRMATIONS', '1'), 10),
    /**
     * Default test ETH escrowed per project when the admin does not specify.
     * Sepolia ETH has no value, so the figure is about being able to run the
     * flow repeatedly, not about matching the fiat award.
     */
    defaultEscrowEth: read('DEFAULT_ESCROW_ETH', '0.004'),
    mock: mockChain,
  }),
});

/** Feature groups that are not yet configured — logged once at boot. */
export const unconfiguredFeatures = Object.entries({
  Gemini: mockAi ? { ready: true, missing: [] } : gemini,
  Cloudinary: mockUploads ? { ready: true, missing: [] } : cloudinary,
  'Google OAuth': googleOAuth,
  Email: mockEmail ? { ready: true, missing: [] } : email,
  Blockchain: mockChain ? { ready: true, missing: [] } : chain,
})
  .filter(([, g]) => !g.ready)
  .map(([name, g]) => ({ name, missing: g.missing }));

export default config;
