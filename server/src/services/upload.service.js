/**
 * Image storage (Cloudinary).
 *
 * Multer keeps uploads in memory rather than on disk — the files are small,
 * they are forwarded straight to Cloudinary, and nothing should ever persist a
 * user-supplied file on the API server's filesystem.
 */
import crypto from 'node:crypto';
import streamifier from 'node:stream';
import { getCloudinary } from '../config/cloudinary.js';
import { config } from '../config/env.js';
import { BadRequestError, ServiceUnavailableError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

const assertConfigured = () => {
  if (!config.cloudinary.ready) {
    throw new ServiceUnavailableError(
      `Image storage is not configured on this server (missing ${config.cloudinary.missing.join(', ')}).`
    );
  }
};

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

/**
 * Not every upload failure is worth retrying, and saying "please try again" to
 * all of them wastes the citizen's time on a request that cannot succeed.
 *
 * This was found in practice: a rotated Cloudinary API key had valid
 * credentials but was permission-scoped without `create`. Every upload returned
 * 403, and every citizen was told "Could not store the image. Please try
 * again." — inviting a retry that would fail identically forever, while nothing
 * in the message or the log pointed at the real cause.
 *
 * Keyed on the HTTP status the way the email service keys on the SMTP response
 * code, and for the same reason: matching on message text is fragile, and the
 * SDK rewrites the body on an unexpected status (a 403 arrives as
 * `UnexpectedResponse: Server returned unexpected status code - 403` with the
 * `actions=["create"]` detail already discarded).
 *
 * @returns {{kind: 'misconfigured'|'rejected-file'|'busy'|'transient', status: number|null}}
 */
const classifyUploadFailure = (err) => {
  const status = err?.http_code ?? err?.error?.http_code ?? null;

  switch (status) {
    // Credentials present but refused: wrong key/secret, a key lacking the
    // `create` permission, or a suspended account. No amount of retrying fixes
    // any of them.
    case 401:
    case 403:
      return { kind: 'misconfigured', status };

    // The upload endpoint itself is addressed by cloud name, so a 404 here
    // means the configured cloud does not exist — a typo, not an outage.
    case 404:
      return { kind: 'misconfigured', status };

    // Cloudinary's rate limiting. Genuinely temporary.
    case 420:
    case 429:
      return { kind: 'busy', status };

    // The file was rejected: not an image, corrupt, or over the plan's size
    // limit. The citizen can act on this, but only if told it is about the
    // photo rather than about the server.
    case 400:
      return { kind: 'rejected-file', status };

    default:
      // 5xx, a socket hang-up, DNS failure, timeout, or no status at all.
      return { kind: 'transient', status };
  }
};

/** Printed once per process; the one-line error still logs every time. */
let remediationLogged = false;

/**
 * Turn a Cloudinary failure into the right error for the caller, and say
 * something useful in the log for whoever operates the server.
 *
 * Exported so the mapping is unit-testable — the same reason
 * `public.service.publicBids` is. Which failures invite a retry and which do
 * not is a decision worth pinning, and most of these statuses cannot be
 * provoked on demand from a real account.
 */
export const translateUploadFailure = (err) => {
  const { kind, status } = classifyUploadFailure(err);
  const detail = err?.message ?? 'no message';

  if (kind === 'misconfigured') {
    logger.error(
      `Cloudinary REFUSED the upload (HTTP ${status}): ${detail} — ` +
        'this is a server configuration problem and will not resolve on its own.'
    );

    if (!remediationLogged) {
      remediationLogged = true;
      logger.error(
        [
          '',
          '  Image uploads are failing for every user until this is fixed.',
          '',
          `    cloud name: ${config.cloudinary.cloudName}`,
          `    HTTP status: ${status}`,
          '',
          status === 404
            ? '    A 404 from the upload endpoint means CLOUDINARY_CLOUD_NAME does not\n' +
              '    match an existing cloud. Check it for a typo.'
            : '    A 401/403 means the credentials were understood and refused. Either the\n' +
              '    key/secret pair is wrong, or — easy to miss — the API key is permission\n' +
              '    scoped and lacks the "create" action, which is what uploading needs.\n' +
              '    Check Cloudinary Console -> Settings -> API Keys.',
          '',
          '    A signed admin ping will still succeed with a key that cannot upload,',
          '    so "the credentials work" is not evidence that uploads do.',
          '',
        ].join('\n')
      );
    }

    // No claim that anyone has been notified: nothing in this codebase alerts
    // an operator, and telling a citizen otherwise would be a lie.
    return new ServiceUnavailableError(
      'Image uploads are temporarily unavailable because of a problem with this server, ' +
        'not with your photo. Retrying now will not help — please come back later, and do ' +
        'report it if it is still broken.',
      { code: 'IMAGE_STORAGE_MISCONFIGURED', cause: err }
    );
  }

  if (kind === 'rejected-file') {
    logger.warn(`Cloudinary rejected the file (HTTP ${status}): ${detail}`);
    // Deliberately not Cloudinary's own wording, which can name internal
    // limits and account details.
    return new BadRequestError(
      'That image could not be processed. Please try a different photo — a JPEG or PNG under the size limit.',
      { code: 'IMAGE_REJECTED', cause: err }
    );
  }

  if (kind === 'busy') {
    logger.warn(`Cloudinary rate-limited the upload (HTTP ${status}): ${detail}`);
    return new ServiceUnavailableError(
      'Image storage is busy right now. Please try again in a minute.',
      { code: 'IMAGE_STORAGE_BUSY', cause: err }
    );
  }

  // The genuinely transient case, which keeps the original retry wording.
  logger.error(`Cloudinary upload failed${status ? ` (HTTP ${status})` : ''}: ${detail}`);
  return new ServiceUnavailableError('Could not store the image. Please try again.', {
    code: 'IMAGE_STORAGE_UNAVAILABLE',
    cause: err,
  });
};

/**
 * Upload a buffer to Cloudinary.
 *
 * @param {Buffer} buffer
 * @param {object} options
 * @param {string} options.folder    Sub-folder under the configured root folder.
 * @param {object} [options.context] Arbitrary key/value metadata stored on the asset.
 * @returns {Promise<{url: string, publicId: string, width: number, height: number, bytes: number, format: string}>}
 */
export const uploadImage = async (buffer, { folder, context } = {}) => {
  // Fixture mode: derive a stable fake asset from the bytes. No network call,
  // so the test suite neither needs credentials nor leaves assets behind.
  if (config.cloudinary.mock) {
    const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 20);
    const publicId = [config.cloudinary.folder, folder, hash].filter(Boolean).join('/');
    logger.debug(`Cloudinary fixture mode: ${publicId}`);
    return {
      url: `https://res.cloudinary.com/fixture/image/upload/${publicId}.jpg`,
      publicId,
      width: 1600,
      height: 1200,
      bytes: buffer.length,
      format: 'jpg',
      mock: true,
    };
  }

  assertConfigured();
  const cloudinary = getCloudinary();

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: [config.cloudinary.folder, folder].filter(Boolean).join('/'),
        resource_type: 'image',
        // Strip EXIF (which can carry the reporter's GPS and device) and cap
        // dimensions. The original is never needed: Gemini sees the buffer
        // before upload, and the UI never shows more than ~1600px.
        transformation: [{ width: 1600, height: 1600, crop: 'limit', quality: 'auto:good' }],
        context,
      },
      (err, result) => {
        if (err) {
          // Classified rather than blanket-retried: see translateUploadFailure.
          return reject(translateUploadFailure(err));
        }
        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          width: result.width,
          height: result.height,
          bytes: result.bytes,
          format: result.format,
        });
      }
    );

    streamifier.Readable.from(buffer).pipe(stream);
  });
};

/**
 * Delete an asset, and purge it from the CDN.
 *
 * Two callers, with different stakes. Cleaning up an orphaned upload after a
 * later step fails is housekeeping. But `report.service.deleteReport` also
 * calls this when a **citizen deletes their own report**, and there the promise
 * made to them is that the photo stops being available.
 *
 * `invalidate: true` is what keeps that promise. Without it, `destroy` removes
 * the stored asset while Cloudinary's CDN carries on serving the delivery URL —
 * which is sent with `immutable, max-age=2592000`, so a withdrawn photo stays
 * publicly fetchable by anyone holding the link for up to **thirty days**.
 * Delivery URLs carry no authentication, and these are street photographs that
 * can contain identifying detail, so that gap is the difference between
 * deleting a record and deleting a photograph.
 *
 * Invalidation is **not instant**: Cloudinary propagates the purge across its
 * edges over a few minutes, so the URL can still serve the cached copy briefly
 * after this resolves. That is a smaller window than thirty days, not zero, and
 * there is no API that makes it zero.
 *
 * Never throws: a failed cleanup must not mask the original error.
 */
export const deleteImage = async (publicId) => {
  if (!publicId || !config.cloudinary.ready) return false;
  if (config.cloudinary.mock) {
    logger.debug(`Cloudinary fixture mode: pretend-deleted ${publicId}`);
    return true;
  }
  try {
    await getCloudinary().uploader.destroy(publicId, { invalidate: true });
    logger.debug(`Deleted and invalidated Cloudinary asset: ${publicId}`);
    return true;
  } catch (err) {
    logger.warn(`Could not delete Cloudinary asset ${publicId}: ${err.message}`);
    return false;
  }
};
