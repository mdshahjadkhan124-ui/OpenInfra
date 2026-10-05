/**
 * Centralized error handling.
 *
 * Everything that goes wrong anywhere in the app converges here, so the API has
 * exactly one place that decides what the client sees. Two jobs:
 *
 *  1. Translate third-party errors (Mongoose, JWT, Multer) into our own ApiError
 *     vocabulary, so a duplicate-key failure reads as "Email already registered"
 *     rather than "E11000 duplicate key error collection".
 *  2. Never leak internals. Unexpected errors become a generic 500 in production;
 *     the real message and stack are logged server-side only.
 */
import mongoose from 'mongoose';
import { ApiError } from '../utils/ApiError.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

/** Map a known third-party error onto an ApiError. Returns null if unrecognised. */
const translate = (err) => {
  // Invalid ObjectId in a route param — a 404 is more honest than a 500.
  if (err instanceof mongoose.Error.CastError) {
    return new ApiError(400, `Invalid value '${err.value}' for parameter '${err.path}'.`, {
      code: 'INVALID_ID',
    });
  }

  // Schema validation — surface every failing field at once, not just the first.
  if (err instanceof mongoose.Error.ValidationError) {
    return new ApiError(422, 'Validation failed.', {
      code: 'VALIDATION_FAILED',
      details: Object.values(err.errors).map((e) => ({ field: e.path, message: e.message })),
    });
  }

  // Unique index violation.
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue ?? {})[0] ?? 'field';
    return new ApiError(409, `That ${field} is already in use.`, {
      code: 'DUPLICATE_KEY',
      details: [{ field, message: 'Already exists.' }],
    });
  }

  // JWT failures (Phase 2 onward).
  if (err.name === 'JsonWebTokenError') {
    return new ApiError(401, 'Invalid authentication token.', { code: 'INVALID_TOKEN' });
  }
  if (err.name === 'TokenExpiredError') {
    return new ApiError(401, 'Your session has expired. Please log in again.', {
      code: 'TOKEN_EXPIRED',
    });
  }

  // Multer upload failures (Phase 3 onward).
  if (err.name === 'MulterError') {
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'Image is too large.'
        : err.code === 'LIMIT_UNEXPECTED_FILE'
          ? `Unexpected file field '${err.field}'.`
          : 'File upload failed.';
    return new ApiError(400, message, { code: err.code });
  }

  // Malformed JSON body — express.json() throws this.
  if (err.type === 'entity.parse.failed') {
    return new ApiError(400, 'Request body is not valid JSON.', { code: 'MALFORMED_JSON' });
  }

  return null;
};

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity (4 args).
export const errorHandler = (err, req, res, next) => {
  const error = err instanceof ApiError ? err : (translate(err) ?? err);
  const statusCode = error.statusCode ?? 500;
  const isUnexpected = !error.isOperational || statusCode >= 500;

  // Log unexpected errors with a stack; expected ones get a single line.
  if (isUnexpected) {
    logger.error(`${req.method} ${req.originalUrl} → ${statusCode}`, '\n', err.stack ?? err);
  } else {
    logger.warn(`${req.method} ${req.originalUrl} → ${statusCode} ${error.message}`);
  }

  const body = {
    success: false,
    // Generic text for unexpected 5xx in production; real message otherwise.
    message:
      isUnexpected && config.isProduction
        ? 'Something went wrong on our end. Please try again.'
        : error.message,
    code: error.code ?? (statusCode >= 500 ? 'INTERNAL_ERROR' : 'ERROR'),
  };

  if (error.details) body.details = error.details;
  // Stack traces are a development affordance only.
  if (!config.isProduction && isUnexpected) body.stack = err.stack;

  res.status(statusCode).json(body);
};

/** 404 fallback for unmatched routes — runs just before the error handler. */
export const notFoundHandler = (req, res, next) => {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`, {
    code: 'ROUTE_NOT_FOUND',
  }));
};

export default errorHandler;
