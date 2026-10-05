/**
 * One response envelope for the whole API, so the frontend never has to guess
 * the shape of a payload.
 *
 *   success → { success: true,  message, data, meta? }
 *   failure → { success: false, message, code, details? }   (see errorHandler)
 */
export const sendSuccess = (res, { statusCode = 200, message = 'OK', data = null, meta } = {}) => {
  const body = { success: true, message, data };
  if (meta) body.meta = meta;
  return res.status(statusCode).json(body);
};

export default sendSuccess;
