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
import { ServiceUnavailableError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

const assertConfigured = () => {
  if (!config.cloudinary.ready) {
    throw new ServiceUnavailableError(
      `Image storage is not configured on this server (missing ${config.cloudinary.missing.join(', ')}).`
    );
  }
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
          logger.error('Cloudinary upload failed:', err.message);
          return reject(new ServiceUnavailableError('Could not store the image. Please try again.', { cause: err }));
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
 * Delete an asset.
 *
 * Used to clean up an orphaned upload when a later step in the same request
 * fails. Never throws: a failed cleanup must not mask the original error.
 */
export const deleteImage = async (publicId) => {
  if (!publicId || !config.cloudinary.ready) return false;
  if (config.cloudinary.mock) {
    logger.debug(`Cloudinary fixture mode: pretend-deleted ${publicId}`);
    return true;
  }
  try {
    await getCloudinary().uploader.destroy(publicId);
    logger.debug(`Deleted orphaned Cloudinary asset: ${publicId}`);
    return true;
  } catch (err) {
    logger.warn(`Could not delete Cloudinary asset ${publicId}: ${err.message}`);
    return false;
  }
};
