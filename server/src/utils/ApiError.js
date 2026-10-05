/**
 * Custom error classes.
 *
 * Every error thrown deliberately by our own code is an ApiError, which carries
 * the HTTP status with it. The centralized error handler can then trust
 * `err.isOperational`: true means "we anticipated this, show the client the real
 * message"; false/absent means an unexpected bug, whose message must never be
 * leaked to the client in production.
 */
export class ApiError extends Error {
  /**
   * @param {number} statusCode  HTTP status to respond with.
   * @param {string} message     Safe to show the client.
   * @param {object} [options]
   * @param {Array}  [options.details]  Field-level validation details.
   * @param {string} [options.code]     Stable machine-readable code for the client.
   * @param {Error}  [options.cause]    Underlying error, logged but never sent.
   */
  constructor(statusCode, message, { details, code, cause } = {}) {
    super(message, { cause });
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = true;
    if (details) this.details = details;
    if (code) this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}

/** 400 — malformed or invalid input. */
export class BadRequestError extends ApiError {
  constructor(message = 'Invalid request.', options) {
    super(400, message, { code: 'BAD_REQUEST', ...options });
  }
}

/** 401 — not authenticated (missing/invalid/expired token). */
export class UnauthorizedError extends ApiError {
  constructor(message = 'Authentication required.', options) {
    super(401, message, { code: 'UNAUTHORIZED', ...options });
  }
}

/** 403 — authenticated, but this role may not do this. */
export class ForbiddenError extends ApiError {
  constructor(message = 'You do not have permission to perform this action.', options) {
    super(403, message, { code: 'FORBIDDEN', ...options });
  }
}

/** 404 — resource does not exist. */
export class NotFoundError extends ApiError {
  constructor(message = 'Resource not found.', options) {
    super(404, message, { code: 'NOT_FOUND', ...options });
  }
}

/** 409 — request conflicts with current state (duplicate email, milestone already paid). */
export class ConflictError extends ApiError {
  constructor(message = 'Request conflicts with the current state.', options) {
    super(409, message, { code: 'CONFLICT', ...options });
  }
}

/** 422 — well-formed but semantically invalid (e.g. milestone percentages ≠ 100). */
export class ValidationError extends ApiError {
  constructor(message = 'Validation failed.', options) {
    super(422, message, { code: 'VALIDATION_FAILED', ...options });
  }
}

/**
 * 503 — an external integration we depend on is unavailable or unconfigured.
 * Used by services whose feature group is not `ready` in config, so a missing
 * API key surfaces as a clear message instead of a TypeError deep in a client lib.
 */
export class ServiceUnavailableError extends ApiError {
  constructor(message = 'An upstream service is unavailable.', options) {
    super(503, message, { code: 'SERVICE_UNAVAILABLE', ...options });
  }
}
