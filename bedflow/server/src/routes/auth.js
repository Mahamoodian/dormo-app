import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { ah, HttpError, badRequest } from '../utils/http.js';
import { verifyPassword, hashPassword, validatePasswordStrength } from '../utils/password.js';
import { authenticate, signToken, publicUser } from '../middleware/auth.js';
import { parse } from '../middleware/validate.js';

const r = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in a few minutes.', code: 'RATE_LIMITED' },
});

r.post('/login', loginLimiter, ah(async (req, res) => {
  const { email, password } = parse(z.object({ email: z.string().trim().email(), password: z.string().min(1) }), req.body);
  const { rows } = await query('SELECT * FROM users WHERE lower(email)=lower($1)', [email]);
  const user = rows[0];
  // Always run bcrypt to avoid user-enumeration timing differences
  const ok = await verifyPassword(password, user?.password_hash || '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
  if (!user || !ok) throw new HttpError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');
  if (!user.is_active) throw new HttpError(403, 'Your account has been disabled. Contact the administrator.', 'ACCOUNT_DISABLED');
  await query('UPDATE users SET last_login_at=now() WHERE id=$1', [user.id]);
  res.json({ token: signToken(user), user: publicUser(user) });
}));

r.get('/me', authenticate, (req, res) => res.json({ user: publicUser(req.user) }));

r.post('/change-password', authenticate, ah(async (req, res) => {
  const { current_password, new_password } = parse(
    z.object({ current_password: z.string().min(1), new_password: z.string() }), req.body,
  );
  if (!(await verifyPassword(current_password, req.user.password_hash))) throw badRequest('Current password is incorrect');
  const weak = validatePasswordStrength(new_password);
  if (weak) throw badRequest(weak);
  if (await verifyPassword(new_password, req.user.password_hash)) throw badRequest('New password must be different from the current one');
  const { rows } = await query(
    `UPDATE users SET password_hash=$2, must_change_password=FALSE, password_changed_at=now(),
       token_version = token_version + 1, updated_at=now() WHERE id=$1 RETURNING *`,
    [req.user.id, await hashPassword(new_password)],
  );
  res.json({ token: signToken(rows[0]), user: publicUser(rows[0]) });
}));

export default r;
