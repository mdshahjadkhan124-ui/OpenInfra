/**
 * The error vocabulary the whole API depends on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ApiError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  ServiceUnavailableError,
} from '../src/utils/ApiError.js';

test('each error class carries the right status and code', () => {
  const cases = [
    [new BadRequestError(), 400, 'BAD_REQUEST'],
    [new UnauthorizedError(), 401, 'UNAUTHORIZED'],
    [new ForbiddenError(), 403, 'FORBIDDEN'],
    [new NotFoundError(), 404, 'NOT_FOUND'],
    [new ConflictError(), 409, 'CONFLICT'],
    [new ValidationError(), 422, 'VALIDATION_FAILED'],
    [new ServiceUnavailableError(), 503, 'SERVICE_UNAVAILABLE'],
  ];
  for (const [err, status, code] of cases) {
    assert.ok(err instanceof ApiError, `${err.name} should extend ApiError`);
    assert.equal(err.statusCode, status);
    assert.equal(err.code, code);
    // isOperational is what tells the handler this message is safe to show.
    assert.equal(err.isOperational, true);
  }
});

test('details and cause are preserved', () => {
  const cause = new Error('underlying');
  const err = new ValidationError('Percentages must sum to 100.', {
    details: [{ field: 'milestones', message: 'sum was 90' }],
    cause,
  });
  assert.equal(err.statusCode, 422);
  assert.equal(err.details[0].field, 'milestones');
  assert.equal(err.cause, cause);
});
