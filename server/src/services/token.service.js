/**
 * JWT issuing and verification.
 *
 * Isolated from auth.service so the OAuth flow, the local flow and any future
 * token type all mint tokens the same way.
 */
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';

const ISSUER = 'openinfra-api';

/**
 * Sign an access token.
 *
 * The payload carries `role` purely as a hint for the client UI. The auth
 * middleware re-reads the role from the database on every request rather than
 * trusting this claim — see middlewares/auth.js for why.
 */
export const signAccessToken = (user) =>
  jwt.sign({ sub: user.id ?? user._id.toString(), role: user.role }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
    issuer: ISSUER,
  });

/** Verify and decode a token. Throws jwt errors, which the error handler translates. */
export const verifyAccessToken = (token) =>
  jwt.verify(token, config.jwt.secret, { issuer: ISSUER });

/** Seconds until a decoded token expires — surfaced to the client so it can refresh. */
export const expiresInSeconds = (decoded) =>
  Math.max(0, decoded.exp - Math.floor(Date.now() / 1000));
