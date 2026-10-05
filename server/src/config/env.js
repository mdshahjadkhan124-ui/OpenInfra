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

// ---------------------------------------------------------------------------
// Feature groups — optional at boot, validated at point of use
// ---------------------------------------------------------------------------
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
    apiKey: read('GEMINI_API_KEY'),
    // Vision-capable model used for both the relevance gate and milestone verification.
    model: read('GEMINI_MODEL', 'gemini-2.0-flash'),
  }),

  cloudinary: Object.freeze({
    ...cloudinary,
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
  }),

  chain: Object.freeze({
    ...chain,
    contractAddress: read('CONTRACT_ADDRESS'),
    rpcUrl: read('SEPOLIA_RPC_URL'),
    etherscanBaseUrl: read('ETHERSCAN_BASE_URL', 'https://sepolia.etherscan.io'),
  }),
});

/** Feature groups that are not yet configured — logged once at boot. */
export const unconfiguredFeatures = Object.entries({
  Gemini: gemini,
  Cloudinary: cloudinary,
  'Google OAuth': googleOAuth,
  Email: email,
  Blockchain: chain,
})
  .filter(([, g]) => !g.ready)
  .map(([name, g]) => ({ name, missing: g.missing }));

export default config;
