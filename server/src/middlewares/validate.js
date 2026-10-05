/**
 * express-validator result collector.
 *
 * Runs a list of validation chains, then converts any failures into our
 * standard 422 envelope with per-field details, so the frontend can place an
 * error message next to the right input.
 */
import { validationResult } from 'express-validator';
import { ValidationError } from '../utils/ApiError.js';

export const validate = (chains) => async (req, res, next) => {
  await Promise.all(chains.map((chain) => chain.run(req)));

  const result = validationResult(req);
  if (result.isEmpty()) return next();

  const details = result.array({ onlyFirstError: true }).map((e) => ({
    field: e.path ?? e.param,
    message: e.msg,
  }));

  next(new ValidationError('Some fields need your attention.', { details }));
};

export default validate;
