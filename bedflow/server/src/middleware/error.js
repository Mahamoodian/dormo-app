import { ZodError } from 'zod';
import { HttpError } from '../utils/http.js';

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return res.status(400).json({
      error: `${first.path.join('.') || 'input'}: ${first.message}`,
      code: 'VALIDATION_ERROR',
      details: err.issues,
    });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
  }
  // Postgres constraint errors -> friendly messages
  if (err.code === '23505') {
    const msg = err.constraint?.includes('bed_active')
      ? 'This bed is already occupied'
      : err.constraint?.includes('client_active')
        ? 'This client already occupies another bed. Vacate or transfer them first.'
        : err.constraint?.includes('email')
          ? 'A user with this email already exists'
          : 'Duplicate record';
    return res.status(409).json({ error: msg, code: 'CONFLICT' });
  }
  if (err.code === '23503') {
    return res.status(409).json({
      error: 'This record is linked to other records (e.g. tenancy history or expenses) and cannot be deleted',
      code: 'IN_USE',
    });
  }
  if (err.code === '23514') return res.status(400).json({ error: 'Invalid amount or value', code: 'CHECK_FAILED' });
  if (err.code === '22P02') return res.status(400).json({ error: 'Invalid identifier', code: 'BAD_ID' });
  console.error(`[${req.method} ${req.originalUrl}]`, err);
  res.status(500).json({ error: 'Something went wrong', code: 'INTERNAL' });
}
