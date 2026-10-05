/**
 * Minimal level-aware logger.
 *
 * Deliberately dependency-free: the project already pulls in a lot of SDKs, and
 * nothing here needs transports or log shipping. Swapping in pino later means
 * changing this one file.
 */
import { config } from '../config/env.js';

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

// Colour codes become noise in aggregated production logs.
const paint = (color, text) => (config.isProduction ? text : `${COLORS[color]}${text}${COLORS.reset}`);

const timestamp = () => new Date().toISOString();

const emit = (stream, color, label, args) => {
  if (config.isTest) return; // keep test output clean
  stream(`${paint('dim', timestamp())} ${paint(color, label)}`, ...args);
};

export const logger = {
  info: (...args) => emit(console.log, 'cyan', 'INFO ', args),
  success: (...args) => emit(console.log, 'green', 'OK   ', args),
  warn: (...args) => emit(console.warn, 'yellow', 'WARN ', args),
  error: (...args) => emit(console.error, 'red', 'ERROR', args),
  debug: (...args) => {
    if (!config.isProduction) emit(console.log, 'blue', 'DEBUG', args);
  },
};

export default logger;
