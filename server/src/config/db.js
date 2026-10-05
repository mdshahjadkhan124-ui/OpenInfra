/**
 * MongoDB connection lifecycle.
 */
import mongoose from 'mongoose';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

// Reject writes to fields absent from the schema, rather than silently storing
// them. Catches typos like `walletAddres` before they become data corruption.
mongoose.set('strictQuery', true);

/** Human-readable name for mongoose's numeric readyState. */
const READY_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

export const dbState = () => ({
  status: READY_STATES[mongoose.connection.readyState] ?? 'unknown',
  readyState: mongoose.connection.readyState,
  name: mongoose.connection.name ?? null,
  host: mongoose.connection.host ?? null,
});

export const isDbConnected = () => mongoose.connection.readyState === 1;

export const connectDatabase = async () => {
  mongoose.connection.on('error', (err) => logger.error('MongoDB error:', err.message));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected.'));
  mongoose.connection.on('reconnected', () => logger.success('MongoDB reconnected.'));

  try {
    await mongoose.connect(config.mongoUri, {
      // An Atlas SRV string usually carries no database path, and mongoose then
      // silently uses `test`. Naming it here means every environment lands in
      // the same database whether or not the URI spells it out.
      dbName: config.dbName,
      // Fail fast with a clear message instead of hanging for the 30s default
      // when the URI is wrong or the IP is not allowlisted in Atlas.
      serverSelectionTimeoutMS: 10_000,
    });
    const { name, host } = dbState();
    logger.success(`MongoDB connected → ${host}/${name}`);
    return mongoose.connection;
  } catch (err) {
    logger.error('MongoDB connection failed:', err.message);
    if (/IP address|whitelist|allowlist/i.test(err.message)) {
      logger.error('Hint: add your current IP to the Atlas Network Access allowlist.');
    }
    if (/authentication failed/i.test(err.message)) {
      logger.error('Hint: check the username/password in MONGO_URI (URL-encode special characters).');
    }
    throw err;
  }
};

export const disconnectDatabase = async () => {
  await mongoose.connection.close();
  logger.info('MongoDB connection closed.');
};

export default connectDatabase;
