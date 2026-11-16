// Flat/dormitory-wise expense tracking with pre-defined + custom categories
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { ah, notFound, badRequest } from '../utils/http.js';
import { parse, zUuid, zDate, zPositiveMoney, zOptText } from '../middleware/validate.js';
import { monthRange } from '../utils/dates.js';

const r = Router();

r.get('/categories', ah(async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, (owner_id IS NULL) AS is_system FROM expense_categories
     WHERE owner_id IS NULL OR owner_id=$1 ORDER BY (owner_id IS NULL) DESC, name`, [req.ownerId]);
  res.json(rows);
}));
r.post('/categories', ah(async (req, res) => {
  const { name } = parse(z.object({ name: z.string().trim().min(1).max(60) }), req.body);
  const { rows: sys } = await query('SELECT id FROM expense_categories WHERE owner_id IS NULL AND lower(name)=lower($1)', [name]);
  if (sys[0]) throw badRequest('A built-in category with this name already exists');
  const { rows } = await query('INSERT INTO expense_categories (owner_id, name) VALUES ($1,$2) RETURNING id, name, false AS is_system', [req.ownerId, name]);
  res.status(201).json(rows[0]);
}));
r.delete('/categories/:id', ah(async (req, res) => {
  parse(zUuid, req.params.id);
  const { rowCount } = await query('DELETE FROM expense_categories WHERE id=$1 AND owner_id=$2', [req.params.id, req.ownerId]);
  if (!rowCount) throw notFound('Category not found (built-in categories cannot be deleted)');
  res.status(204).end();
}));

const expenseSchema = z.object({
  flat_id: zUuid,
  category_id: zUuid,
  description: zOptText(500),
  amount: zPositiveMoney,
  expense_date: zDate,
  payment_method: zOptText(40),
  vendor: zOptText(120),
});

async function checkRefs(ownerId, d) {
  if (d.flat_id) {
    const { rows } = await query('SELECT 1 FROM flats WHERE id=$1 AND owner_id=$2', [d.flat_id, ownerId]);
    if (!rows[0]) throw notFound('Flat not found');
  }
  if (d.category_id) {
    const { rows } = await query('SELECT 1 FROM expense_categories WHERE id=$1 AND (owner_id IS NULL OR owner_id=$2)', [d.category_id, ownerId]);
    if (!rows[0]) throw notFound('Category not found');
  }
}

r.get('/', ah(async (req, res) => {
  const { month, flat_id, category_id } = req.query;
  let from = req.query.from, to = req.query.to;
  if (month) ({ start: from, end: to } = monthRange(String(month)));
  const params = [req.ownerId];
  let where = 'e.owner_id=$1';
  if (from) { params.push(parse(zDate, from)); where += ` AND e.expense_date >= $${params.length}`; }
  if (to) { params.push(parse(zDate, to)); where += ` AND e.expense_date <= $${params.length}`; }
  if (flat_id) { params.push(parse(zUuid, flat_id)); where += ` AND e.flat_id = $${params.length}`; }
  if (category_id) { params.push(parse(zUuid, category_id)); where += ` AND e.category_id = $${params.length}`; }
  const { rows } = await query(
    `SELECT e.*, ec.name AS category_name, f.name AS flat_name, b.name AS building_name
     FROM expenses e JOIN expense_categories ec ON ec.id=e.category_id
     JOIN flats f ON f.id=e.flat_id JOIN buildings b ON b.id=f.building_id
     WHERE ${where} ORDER BY e.expense_date DESC, e.created_at DESC LIMIT 1000`, params);
  const total = rows.reduce((s, x) => s + Number(x.amount), 0);
  res.json({ rows, total: Math.round(total * 100) / 100 });
}));

r.post('/', ah(async (req, res) => {
  const d = parse(expenseSchema, req.body);
  await checkRefs(req.ownerId, d);
  const { rows } = await query(
    `INSERT INTO expenses (owner_id, flat_id, category_id, description, amount, expense_date, payment_method, vendor)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.ownerId, d.flat_id, d.category_id, d.description, d.amount, d.expense_date, d.payment_method, d.vendor]);
  res.status(201).json(rows[0]);
}));

r.patch('/:id', ah(async (req, res) => {
  parse(zUuid, req.params.id);
  const d = parse(expenseSchema.partial(), req.body);
  await checkRefs(req.ownerId, d);
  const keys = Object.keys(d).filter((k) => d[k] !== undefined);
  if (!keys.length) throw badRequest('Nothing to update');
  const { rows } = await query(
    `UPDATE expenses SET ${keys.map((k, i) => `${k}=$${i + 3}`).join(', ')} WHERE id=$1 AND owner_id=$2 RETURNING *`,
    [req.params.id, req.ownerId, ...keys.map((k) => d[k])]);
  if (!rows[0]) throw notFound('Expense not found');
  res.json(rows[0]);
}));

r.delete('/:id', ah(async (req, res) => {
  parse(zUuid, req.params.id);
  const { rowCount } = await query('DELETE FROM expenses WHERE id=$1 AND owner_id=$2', [req.params.id, req.ownerId]);
  if (!rowCount) throw notFound('Expense not found');
  res.status(204).end();
}));

export default r;
