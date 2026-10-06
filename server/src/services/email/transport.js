/**
 * Nodemailer transport (Gmail).
 *
 * Three modes, decided by configuration:
 *
 *   live     — real SMTP send.
 *   preview  — render to `.email-preview/` on disk and do not send. Used by
 *              development and by phase verification, so all 21 templates can
 *              be inspected without burning Gmail's daily send quota or
 *              spamming real inboxes.
 *   disabled — no credentials: log the event and move on.
 *
 * NOTHING here is allowed to throw at a caller. A notification is a side
 * effect of an action that has already succeeded — a filed report, an on-chain
 * payment — and a dead SMTP server must never turn that into a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

let transporter = null;
let verified = null;

/**
 * Gmail App Passwords are shown as four groups of four ("abcd efgh ijkl mnop").
 * Copied verbatim that is 19 characters and SMTP auth fails with a misleading
 * "Username and Password not accepted", so strip whitespace rather than
 * leaving the operator to discover it.
 */
const normalisePassword = (pass) => (pass ?? '').replace(/\s+/g, '');

export const emailMode = () => {
  if (config.email.preview) return 'preview';
  if (!config.email.ready) return 'disabled';
  return 'live';
};

const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: config.email.user,
        pass: normalisePassword(config.email.pass),
      },
      // Reuse one connection for a burst of notifications (an award emails
      // every losing bidder), rather than reconnecting per message.
      pool: true,
      maxConnections: 2,
      maxMessages: 50,
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transporter;
};

/**
 * Check the credentials once, at boot.
 * Returns a result rather than throwing: a bad password should surface as a
 * clear warning, not stop the server from serving an API that works fine
 * without email.
 */
export const verifyTransport = async () => {
  const mode = emailMode();
  if (mode !== 'live') return { ok: true, mode };
  if (verified !== null) return verified;

  try {
    await getTransporter().verify();
    verified = { ok: true, mode, user: config.email.user };
    logger.success(`Email transport ready (${config.email.user})`);
  } catch (err) {
    verified = { ok: false, mode, error: err.message };
    logger.warn(`Email transport failed to verify: ${err.message}`);
    if (/Username and Password not accepted|BadCredentials/i.test(err.message)) {
      logger.warn('Hint: EMAIL_PASS must be a Gmail App Password, and 2-Step Verification must be on.');
    }
  }
  return verified;
};

// ---------------------------------------------------------------------------
// Preview mode
// ---------------------------------------------------------------------------

const previewDir = () => path.resolve(process.cwd(), config.email.previewDir);

const writePreview = ({ event, to, subject, html, text }) => {
  const dir = previewDir();
  fs.mkdirSync(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeEvent = event.replace(/[^a-z0-9._-]/gi, '_');
  const base = path.join(dir, `${stamp}__${safeEvent}`);

  // The header comment records what a live send would have done, so a preview
  // file is self-describing when opened on its own.
  fs.writeFileSync(
    `${base}.html`,
    `<!-- event: ${event} | to: ${to} | subject: ${subject} -->\n${html}`
  );
  fs.writeFileSync(`${base}.txt`, `event: ${event}\nto: ${to}\nsubject: ${subject}\n\n${text}`);

  return { file: `${base}.html` };
};

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

/** Node-level network errors worth another attempt. */
const RETRYABLE_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ESOCKET',
  'ECONNECTION',
  'EDNS',
]);

/**
 * Decide whether a send is worth retrying.
 *
 * Driven by the SMTP response code and the error code, NOT by a regex over the
 * error text. An earlier version matched /4\d\d/ against the message, and
 * Gmail's rejection embeds a session id like "5a478bee46e88-…" — the "478" in
 * it matched, so permanent credential failures were retried three times with
 * backoff, repeatedly presenting bad logins to Gmail. That is exactly the
 * behaviour that gets a sending account throttled.
 *
 * SMTP semantics: 4xx is transient and may be retried, 5xx is permanent and
 * must not be. An authentication failure is never transient.
 */
const isRetryable = (err) => {
  if (err?.code === 'EAUTH') return false;

  const response = Number(err?.responseCode);
  if (Number.isFinite(response)) return response >= 400 && response < 500;

  return RETRYABLE_CODES.has(err?.code);
};

/**
 * Send one message.
 *
 * Always resolves. The return value says what happened so callers can log or
 * assert on it, but a failure is never thrown.
 */
export const sendMail = async ({ event, to, subject, html, text }) => {
  const mode = emailMode();

  if (mode === 'disabled') {
    logger.debug(`[email:disabled] ${event} -> ${to} :: ${subject}`);
    return { delivered: false, mode, reason: 'transport-not-configured' };
  }

  if (mode === 'preview') {
    try {
      const { file } = writePreview({ event, to, subject, html, text });
      logger.debug(`[email:preview] ${event} -> ${to} :: ${path.basename(file)}`);
      return { delivered: false, mode, previewFile: file };
    } catch (err) {
      logger.warn(`Could not write email preview for ${event}: ${err.message}`);
      return { delivered: false, mode, reason: 'preview-write-failed' };
    }
  }

  const from = `"${config.email.fromName}" <${config.email.user}>`;
  const maxAttempts = 3;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const info = await getTransporter().sendMail({
        from,
        to,
        subject,
        html,
        text,
        // Groups the thread in Gmail and gives support something to grep for.
        headers: { 'X-OpenInfra-Event': event },
      });

      logger.info(`Email sent: ${event} -> ${to} (${info.messageId})`);
      return { delivered: true, mode, messageId: info.messageId, accepted: info.accepted };
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || attempt === maxAttempts) break;

      const backoff = 2 ** (attempt - 1) * 1000;
      logger.warn(`Email ${event} attempt ${attempt} failed (${err.message}); retrying in ${backoff}ms`);
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }

  // Logged loudly, swallowed deliberately. See the file header.
  // Gmail's rejections are multi-line; only the first line is useful in a log.
  const permanent = lastError?.code === 'EAUTH' || Number(lastError?.responseCode) >= 500;
  const firstLine = String(lastError?.message ?? '').split('\n')[0];

  logger.error(`Email '${event}' to ${to} could not be delivered: ${firstLine}`);
  if (permanent) {
    logger.error('Permanent failure — check EMAIL_USER / EMAIL_PASS. Not retrying.');
  }

  return {
    delivered: false,
    mode,
    reason: permanent ? 'send-failed-permanent' : 'send-failed',
    error: firstLine,
  };
};

/** Close the pooled connections on shutdown. */
export const closeTransport = () => {
  if (transporter) {
    transporter.close();
    transporter = null;
    verified = null;
  }
};

export default sendMail;
