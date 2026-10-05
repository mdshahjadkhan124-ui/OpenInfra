/**
 * Health check — the one endpoint that exists from Phase 1 onward.
 *
 * Reports not just "the process is up" but whether its dependencies are usable,
 * which is what makes it worth calling from a deploy pipeline or uptime monitor.
 */
import mongoose from 'mongoose';
import { dbState, isDbConnected } from '../config/db.js';
import { config, unconfiguredFeatures } from '../config/env.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const getHealth = asyncHandler(async (req, res) => {
  const database = dbState();

  // readyState alone only proves a socket was opened. A ping proves the server
  // is actually answering, which is the thing a monitor cares about.
  let ping = null;
  if (isDbConnected()) {
    const startedAt = performance.now();
    try {
      await mongoose.connection.db.admin().command({ ping: 1 });
      ping = Math.round(performance.now() - startedAt);
    } catch {
      ping = null;
    }
  }

  const healthy = isDbConnected() && ping !== null;

  return sendSuccess(res, {
    statusCode: healthy ? 200 : 503,
    message: healthy ? 'OpenInfra API is healthy.' : 'OpenInfra API is degraded.',
    data: {
      status: healthy ? 'ok' : 'degraded',
      service: 'openinfra-api',
      environment: config.env,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      database: { ...database, pingMs: ping },
      // Surfaced so the developer can see at a glance which integrations are
      // still waiting on keys — useful while the project is built in phases.
      pendingIntegrations: unconfiguredFeatures.map((f) => f.name),
    },
  });
});

export default getHealth;
