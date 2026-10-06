/**
 * Process entry point: connect the database, start listening, and shut down
 * cleanly.
 *
 * The database is connected *before* the port opens so the server never accepts
 * a request it cannot serve.
 */
import { createApp } from './app.js';
import { config, unconfiguredFeatures } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { logger } from './utils/logger.js';
import { verifyTransport, closeTransport, emailMode } from './services/email/transport.js';

const start = async () => {
  await connectDatabase();

  // Check the mail credentials once at boot rather than on the first send, so
  // a bad App Password shows up in the startup log instead of silently
  // swallowing a citizen's notification hours later.
  const mail = await verifyTransport();
  logger.info(`Email mode: ${emailMode()}${mail.ok ? '' : ` (unverified: ${mail.error})`}`);

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.success(`API listening on http://localhost:${config.port}  [${config.env}]`);
    logger.info(`Health check → http://localhost:${config.port}/api/health`);

    if (unconfiguredFeatures.length > 0) {
      logger.warn('Integrations not yet configured (fine during early phases):');
      for (const { name, missing } of unconfiguredFeatures) {
        logger.warn(`   • ${name} — missing ${missing.join(', ')}`);
      }
    }
  });

  // --- Graceful shutdown ---------------------------------------------------
  // Stop accepting new connections, let in-flight requests finish, then close
  // the DB. Without this, a redeploy can drop requests mid-flight.
  const shutdown = async (signal) => {
    logger.info(`${signal} received — shutting down.`);
    server.close(async () => {
      try {
        closeTransport();
        await disconnectDatabase();
      } finally {
        process.exit(0);
      }
    });
    // Don't hang forever on a stuck connection.
    setTimeout(() => {
      logger.error('Forced shutdown after 10s timeout.');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // A promise rejection nobody handled means state is unknown — log loudly and
  // let the process manager restart us rather than limping on.
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection:', reason);
    shutdown('unhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception:', err);
    process.exit(1);
  });
};

start().catch((err) => {
  logger.error('Failed to start server:', err.message);
  process.exit(1);
});
