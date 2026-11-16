import { pool } from './pool.js';
import { hashPassword } from '../utils/password.js';

const email = process.env.SUPERADMIN_EMAIL;
const password = process.env.SUPERADMIN_PASSWORD;
const name = process.env.SUPERADMIN_NAME || 'Super Admin';

try {
  if (!email || !password) throw new Error('Set SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD');
  const { rows } = await pool.query('SELECT id FROM users WHERE lower(email)=lower($1)', [email]);
  if (rows.length) {
    console.log(`ℹ Super admin ${email} already exists`);
  } else {
    await pool.query(
      `INSERT INTO users (role, full_name, email, password_hash, must_change_password)
       VALUES ('super_admin', $1, $2, $3, TRUE)`,
      [name, email, await hashPassword(password)],
    );
    console.log(`✔ Super admin created: ${email} (password change required on first login)`);
  }
} catch (e) {
  console.error('✖ Seed failed:', e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
