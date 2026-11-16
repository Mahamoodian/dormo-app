// Super Admin: user management + macro reports + READ-ONLY view of a user's data.
// There are deliberately no admin routes that write operational (tenant) data.
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { ah, notFound, badRequest } from '../utils/http.js';
import { hashPassword, generateTempPassword } from '../utils/password.js';
import { parse, zUuid, zOptText } from '../middleware/validate.js';
import { publicUser } from '../middleware/auth.js';
import { today } from '../utils/dates.js';

const r = Router();

const audit = (req, action, target, meta) =>
  query('INSERT INTO admin_audit (admin_id, action, target_user_id, meta) VALUES ($1,$2,$3,$4)', [req.user.id, action, target, meta || null]);

async function getOwner(id) {
  parse(zUuid, id);
  const { rows } = await query(`SELECT * FROM users WHERE id=$1 AND role='owner'`, [id]);
  if (!rows[0]) throw notFound('User not found');
  return rows[0];
}

// Per-user macro metrics (counts only — no tenant-level records)
const USER_METRICS_SQL = `
  SELECT u.id, u.full_name, u.business_name, u.email, u.phone, u.currency, u.is_active, u.must_change_password,
         u.last_login_at, u.created_at,
    (SELECT count(*) FROM buildings b WHERE b.owner_id=u.id) AS buildings,
    (SELECT count(*) FROM flats f WHERE f.owner_id=u.id) AS flats,
    (SELECT count(*) FROM beds bd WHERE bd.owner_id=u.id) AS beds,
    (SELECT count(*) FROM assignments a WHERE a.owner_id=u.id AND a.status='active') AS occupied_beds,
    (SELECT count(*) FROM clients c WHERE c.owner_id=u.id) AS clients,
    (SELECT count(*) FROM receivables rv WHERE rv.owner_id=u.id AND rv.status='open' AND rv.due_date <= $1) AS overdue_items
  FROM users u WHERE u.role='owner'`;

r.get('/reports', ah(async (_req, res) => {
  const { rows } = await query(`${USER_METRICS_SQL} ORDER BY u.created_at DESC`, [today()]);
  const users = rows.map((u) => ({ ...u, occupancy_rate: u.beds ? Math.round((u.occupied_beds / u.beds) * 1000) / 10 : 0 }));
  const sum = (k) => users.reduce((s, u) => s + Number(u[k] || 0), 0);
  res.json({
    totals: {
      users: users.length,
      active_users: users.filter((u) => u.is_active).length,
      disabled_users: users.filter((u) => !u.is_active).length,
      pending_first_login: users.filter((u) => u.must_change_password).length,
      buildings: sum('buildings'),
      flats: sum('flats'),
      beds: sum('beds'),
      occupied_beds: sum('occupied_beds'),
      clients: sum('clients'),
      platform_occupancy: sum('beds') ? Math.round((sum('occupied_beds') / sum('beds')) * 1000) / 10 : 0,
    },
    users,
  });
}));

r.get('/users', ah(async (_req, res) => {
  const { rows } = await query(`${USER_METRICS_SQL} ORDER BY u.created_at DESC`, [today()]);
  res.json({ users: rows });
}));

const userSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  business_name: zOptText(160),
  email: z.string().trim().toLowerCase().email(),
  phone: zOptText(40),
  currency: z.string().trim().toUpperCase().length(3).default('AED'),
});

r.post('/users', ah(async (req, res) => {
  const data = parse(userSchema, req.body);
  const tempPassword = generateTempPassword();
  const { rows } = await query(
    `INSERT INTO users (role, full_name, business_name, email, phone, currency, password_hash, must_change_password, created_by)
     VALUES ('owner',$1,$2,$3,$4,$5,$6,TRUE,$7) RETURNING *`,
    [data.full_name, data.business_name, data.email, data.phone, data.currency, await hashPassword(tempPassword), req.user.id],
  );
  await audit(req, 'user.create', rows[0].id, { email: data.email });
  res.status(201).json({ user: publicUser(rows[0]), temp_password: tempPassword });
}));

r.patch('/users/:id', ah(async (req, res) => {
  await getOwner(req.params.id);
  const data = parse(userSchema.partial(), req.body);
  const fields = Object.keys(data);
  if (!fields.length) throw badRequest('Nothing to update');
  const sets = fields.map((f, i) => `${f}=$${i + 2}`).join(', ');
  const { rows } = await query(`UPDATE users SET ${sets}, updated_at=now() WHERE id=$1 RETURNING *`, [req.params.id, ...fields.map((f) => data[f])]);
  await audit(req, 'user.update', req.params.id, data);
  res.json({ user: publicUser(rows[0]) });
}));

r.post('/users/:id/reset-password', ah(async (req, res) => {
  await getOwner(req.params.id);
  const tempPassword = generateTempPassword();
  await query(
    `UPDATE users SET password_hash=$2, must_change_password=TRUE, token_version=token_version+1, updated_at=now() WHERE id=$1`,
    [req.params.id, await hashPassword(tempPassword)],
  );
  await audit(req, 'user.reset_password', req.params.id);
  res.json({ temp_password: tempPassword });
}));

r.patch('/users/:id/status', ah(async (req, res) => {
  await getOwner(req.params.id);
  const { is_active } = parse(z.object({ is_active: z.boolean() }), req.body);
  const { rows } = await query(
    `UPDATE users SET is_active=$2, token_version = token_version + CASE WHEN $2 THEN 0 ELSE 1 END, updated_at=now()
     WHERE id=$1 RETURNING *`,
    [req.params.id, is_active],
  );
  await audit(req, is_active ? 'user.enable' : 'user.disable', req.params.id);
  res.json({ user: publicUser(rows[0]) });
}));

// ---------- Read-only view of a user's operational data
r.get('/users/:id/view', ah(async (req, res) => {
  const owner = await getOwner(req.params.id);
  const id = owner.id;
  const t = today();
  const [props, clients, expenses, recv] = await Promise.all([
    query(
      `SELECT b.id AS building_id, b.name AS building, f.id AS flat_id, f.name AS flat, f.kind,
              ar.id AS area_id, ar.name AS area, bd.id AS bed_id, bd.label AS bed, bd.in_service,
              (a.id IS NOT NULL) AS occupied, c.full_name AS occupant
       FROM buildings b
       LEFT JOIN flats f ON f.building_id=b.id
       LEFT JOIN areas ar ON ar.flat_id=f.id
       LEFT JOIN beds bd ON bd.area_id=ar.id
       LEFT JOIN assignments a ON a.bed_id=bd.id AND a.status='active'
       LEFT JOIN clients c ON c.id=a.client_id
       WHERE b.owner_id=$1 ORDER BY b.name, f.name, ar.name, bd.label`, [id]),
    query(
      `SELECT c.id, c.full_name, c.phone, c.nationality, c.created_at, (a.id IS NOT NULL) AS active
       FROM clients c LEFT JOIN assignments a ON a.client_id=c.id AND a.status='active'
       WHERE c.owner_id=$1 ORDER BY c.full_name`, [id]),
    query(
      `SELECT e.id, e.expense_date, e.amount, e.description, ec.name AS category, f.name AS flat
       FROM expenses e JOIN expense_categories ec ON ec.id=e.category_id JOIN flats f ON f.id=e.flat_id
       WHERE e.owner_id=$1 ORDER BY e.expense_date DESC LIMIT 100`, [id]),
    query(
      `SELECT COALESCE(SUM(amount_due-amount_paid-amount_written_off),0) AS outstanding,
              COALESCE(SUM(amount_due-amount_paid-amount_written_off) FILTER (WHERE due_date <= $2),0) AS overdue
       FROM receivables WHERE owner_id=$1 AND status='open'`, [id, t]),
  ]);
  await audit(req, 'user.view', id);
  res.json({ owner: publicUser(owner), properties: props.rows, clients: clients.rows, expenses: expenses.rows, receivables: recv.rows[0], read_only: true });
}));

r.get('/audit', ah(async (_req, res) => {
  const { rows } = await query(
    `SELECT a.*, u.email AS target_email FROM admin_audit a LEFT JOIN users u ON u.id=a.target_user_id
     ORDER BY a.created_at DESC LIMIT 200`,
  );
  res.json({ entries: rows });
}));

export default r;
