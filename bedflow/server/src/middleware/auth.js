import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { HttpError, forbidden } from '../utils/http.js';

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, tv: user.token_version }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

export const publicUser = (u) => ({
  id: u.id,
  role: u.role,
  full_name: u.full_name,
  business_name: u.business_name,
  email: u.email,
  phone: u.phone,
  currency: u.currency,
  must_change_password: u.must_change_password,
  is_active: u.is_active,
});

/**
 * Verifies the JWT AND re-loads the user on every request, so that disabling an
 * account or resetting a password (token_version bump) takes effect immediately.
 */
export async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new HttpError(401, 'Authentication required', 'UNAUTHENTICATED');
    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      throw new HttpError(401, 'Session expired, please log in again', 'UNAUTHENTICATED');
    }
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [payload.sub]);
    const user = rows[0];
    if (!user || user.token_version !== payload.tv) throw new HttpError(401, 'Session expired, please log in again', 'UNAUTHENTICATED');
    if (!user.is_active) throw new HttpError(401, 'Your account has been disabled', 'ACCOUNT_DISABLED');
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}

/** Blocks everything until a user with a default/reset password sets their own. */
export function requirePasswordChanged(req, _res, next) {
  if (req.user?.must_change_password) {
    return next(forbidden('You must change your password before continuing', 'PASSWORD_CHANGE_REQUIRED'));
  }
  next();
}

export const requireRole = (role) => (req, _res, next) =>
  req.user?.role === role ? next() : next(forbidden('You do not have access to this resource'));

/** Owner-scoped routes: sets req.ownerId which every query MUST filter on. */
export function ownerScope(req, _res, next) {
  if (req.user?.role !== 'owner') return next(forbidden('Business owner account required'));
  req.ownerId = req.user.id;
  next();
}
