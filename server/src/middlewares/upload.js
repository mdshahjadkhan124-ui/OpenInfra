/**
 * Multer image upload.
 *
 * Memory storage, not disk: the buffer goes straight to Gemini and Cloudinary,
 * and a user-supplied file should never be written to the API server's
 * filesystem — that is how path-traversal and leftover-temp-file problems
 * start. Files are capped well below any level where buffering matters.
 */
import multer from 'multer';
import { config } from '../config/env.js';
import { BadRequestError } from '../utils/ApiError.js';

/**
 * Formats Gemini can read and Cloudinary can store.
 * HEIC is included because it is the iPhone camera default.
 */
export const ALLOWED_IMAGE_TYPES = Object.freeze([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const MB = 1024 * 1024;

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype.toLowerCase())) {
    // Rejecting here produces a clean 400 rather than letting a PDF reach
    // Gemini and fail with something unreadable.
    return cb(
      new BadRequestError(
        `Unsupported file type '${file.mimetype}'. Upload a JPEG, PNG, WebP or HEIC image.`
      )
    );
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.report.maxUploadMb * MB,
    files: 1,
    // Keep the multipart body itself small; the image is the only large part.
    fieldSize: 16 * 1024,
  },
});

/**
 * Accept exactly one image under the field name `image`.
 * Multer's own errors (LIMIT_FILE_SIZE etc.) are translated by the central
 * error handler into 400s with readable messages.
 */
export const uploadSingleImage = upload.single('image');

/** Guard for routes where the image is mandatory. */
export const requireImage = (req, res, next) => {
  if (!req.file) {
    return next(
      new BadRequestError('A photo is required. Attach one as the "image" field of a multipart form.')
    );
  }
  next();
};

export default uploadSingleImage;
