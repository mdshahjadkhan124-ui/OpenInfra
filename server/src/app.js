/**
 * Express application assembly.
 *
 * Exported *without* being started, so tests can import the app and drive it
 * with supertest-style requests without binding a port. src/server.js owns the
 * listening and the database connection.
 *
 * Middleware order matters and is deliberate:
 *   security headers → cors → body parsing → compression → logging
 *   → rate limit → routes → 404 → error handler
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

import { initPassport } from './config/passport.js';

import { config } from './config/env.js';
import apiRoutes from './routes/index.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import { ForbiddenError } from './utils/ApiError.js';

export const createApp = () => {
  const app = express();

  // Behind a reverse proxy (Render/Railway/nginx) this makes req.ip and the
  // rate limiter read the real client IP from X-Forwarded-For instead of the
  // proxy's. `1` = trust exactly one hop; trusting all hops lets a client spoof.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // --- Security headers --------------------------------------------------
  app.use(
    helmet({
      // The API serves JSON, not HTML, and images are hosted on Cloudinary;
      // CSP here would only restrict resources this origin never serves.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  // --- CORS --------------------------------------------------------------
  // Allowlist rather than `*`: credentials are sent on the OAuth callback flow,
  // and `*` is invalid with credentials.
  const allowedOrigins = new Set([config.clientUrl, 'http://localhost:5173', 'http://127.0.0.1:5173']);
  app.use(
    cors({
      origin: (origin, callback) => {
        // No origin = same-origin, curl, or a server-to-server call.
        if (!origin || allowedOrigins.has(origin)) return callback(null, true);
        // Must be an ApiError, not a bare Error: the error handler would
        // otherwise classify a rejected origin as an unexpected 500.
        return callback(new ForbiddenError(`Origin ${origin} is not allowed by CORS.`));
      },
      credentials: true,
    })
  );

  // --- Body parsing ------------------------------------------------------
  // 1mb is ample for JSON; images go through Multer/Cloudinary, not the JSON body.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  app.use(compression());

  // Passport is used statelessly (no sessions) — it only runs the Google
  // OAuth handshake, after which we issue our own JWT.
  app.use(initPassport().initialize());

  // --- Request logging ---------------------------------------------------
  if (!config.isTest) {
    app.use(morgan(config.isProduction ? 'combined' : 'dev'));
  }

  // --- Rate limiting -----------------------------------------------------
  // Baseline protection on the whole API. Phase 2 adds a much tighter limiter
  // on the auth routes specifically, where brute force actually matters.
  app.use(
    '/api',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: config.isProduction ? 300 : 2000,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      // Health checks from monitors shouldn't consume a user's budget.
      skip: (req) => req.path === '/health',
      message: { success: false, message: 'Too many requests. Please try again shortly.', code: 'RATE_LIMITED' },
    })
  );

  // --- Routes ------------------------------------------------------------
  app.get('/', (req, res) =>
    res.json({
      success: true,
      message: 'OpenInfra API',
      data: { docs: '/api/health', version: '0.1.0' },
    })
  );

  app.use('/api', apiRoutes);

  // --- Fallbacks (must be last) ------------------------------------------
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

export default createApp;
