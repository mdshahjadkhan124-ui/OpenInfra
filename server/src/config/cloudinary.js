/**
 * Cloudinary client.
 *
 * Configured lazily so the server still boots when the keys are absent; the
 * upload service checks `config.cloudinary.ready` and throws a clear 503
 * instead of letting the SDK fail with an opaque error.
 */
import { v2 as cloudinary } from 'cloudinary';
import { config } from './env.js';

let configured = false;

export const getCloudinary = () => {
  if (!configured) {
    cloudinary.config({
      cloud_name: config.cloudinary.cloudName,
      api_key: config.cloudinary.apiKey,
      api_secret: config.cloudinary.apiSecret,
      secure: true,
    });
    configured = true;
  }
  return cloudinary;
};

export default getCloudinary;
