export class HttpError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const badRequest = (m, d) => new HttpError(400, m, 'BAD_REQUEST', d);
export const notFound = (m = 'Not found') => new HttpError(404, m, 'NOT_FOUND');
export const forbidden = (m = 'Forbidden', code = 'FORBIDDEN') => new HttpError(403, m, code);
export const conflict = (m) => new HttpError(409, m, 'CONFLICT');

/** Wrap async route handlers so thrown errors reach the error middleware. */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
