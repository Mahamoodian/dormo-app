// Client register (master directory of the owner's clients)
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { ah, notFound, badRequest } from '../utils/http.js';
import { parse, zUuid, zOptText } from '../middleware/validate.js';
import { today } from '../utils/dates.js';

const r = Router();

export const clientSchema = z.object({
  full_name: z.string().trim().min(1).max(160),
  phone: zOptText(40),
  email: zOptText(160),
  id_type: zOptText(40),
  id_number: zOptText(60),
  nationality: zOptText(80),
  emergency_contact: zOptText(200),
  notes: zOptText(2000),
});

export async function insertClient(db, ownerId, d) {
  const { rows } = await db.query(
    `INSERT INTO clients (owner_id, full_name, phone, email, id_type, id_number, nationality, emergency_contact, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [ownerId, d.full_name, d.phone, d.email, d.id_type, d.id_number, d.nationality, d.emergency_contact, d.notes],
  );
  return rows[0];
}

r.get('/', ah(async (req, res) => {
  const { q = '', status = 'all' } = req.query;
  const { rows } = await query(
    `SELECT c.*, a.id AS assignment_id, a.current_period_end, a.rent_amount,
            bd.label AS bed_label, ar.name AS area_name, f.name AS flat_name, b.name AS building_name,
            COALESCE(rb.balance,0) AS balance
     FROM clients c
     LEFT JOIN assignments a ON a.client_id=c.id AND a.status='active'
     LEFT JOIN beds bd ON bd.id=a.bed_id
     LEFT JOIN areas ar ON ar.id=bd.area_id
     LEFT JOIN flats f ON f.id=ar.flat_id
     LEFT JOIN buildings b ON b.id=f.building_id
     LEFT JOIN LATERAL (SELECT SUM(amount_due-amount_paid-amount_written_off) AS balance
                        FROM receivables WHERE client_id=c.id AND status='open') rb ON TRUE
     WHERE c.owner_id=$1
       AND ($2 = '' OR c.full_name ILIKE '%'||$2||'%' OR c.phone ILIKE '%'||$2||'%' OR c.id_number ILIKE '%'||$2||'%')
       AND ($3 = 'all' OR ($3='active' AND a.id IS NOT NULL) OR ($3='past' AND a.id IS NULL))
     ORDER BY (a.id IS NULL), c.full_name
     LIMIT 500`,
    [req.ownerId, String(q).trim(), String(status)],
  );
  res.json(rows);
}));

r.post('/', ah(async (req, res) => {
  res.status(201).json(await insertClient({ query }, req.ownerId, parse(clientSchema, req.body)));
}));

r.get('/:id', ah(async (req, res) => {
  parse(zUuid, req.params.id);
  const { rows } = await query('SELECT * FROM clients WHERE id=$1 AND owner_id=$2', [req.params.id, req.ownerId]);
  if (!rows[0]) throw notFound('Client not found');
  const [assignments, receivables, payments, deposits] = await Promise.all([
    query(
      `SELECT a.*, bd.label AS bed_label, ar.name AS area_name, f.name AS flat_name, b.name AS building_name
       FROM assignments a JOIN beds bd ON bd.id=a.bed_id JOIN areas ar ON ar.id=bd.area_id
       JOIN flats f ON f.id=ar.flat_id JOIN buildings b ON b.id=f.building_id
       WHERE a.client_id=$1 AND a.owner_id=$2 ORDER BY a.start_date DESC`, [req.params.id, req.ownerId]),
    query(
      `SELECT *, amount_due-amount_paid-amount_written_off AS balance FROM receivables
       WHERE client_id=$1 AND owner_id=$2 ORDER BY due_date DESC, created_at DESC`, [req.params.id, req.ownerId]),
    query(`SELECT * FROM payments WHERE client_id=$1 AND owner_id=$2 ORDER BY paid_on DESC, created_at DESC`, [req.params.id, req.ownerId]),
    query(
      `SELECT dl.* FROM deposit_ledger dl JOIN assignments a ON a.id=dl.assignment_id
       WHERE a.client_id=$1 AND dl.owner_id=$2 ORDER BY dl.entry_date DESC, dl.created_at DESC`, [req.params.id, req.ownerId]),
  ]);
  res.json({ client: rows[0], assignments: assignments.rows, receivables: receivables.rows, payments: payments.rows, deposit_ledger: deposits.rows, today: today() });
}));

r.patch('/:id', ah(async (req, res) => {
  parse(zUuid, req.params.id);
  const d = parse(clientSchema.partial(), req.body);
  const keys = Object.keys(d).filter((k) => d[k] !== undefined);
  if (!keys.length) throw badRequest('Nothing to update');
  const { rows } = await query(
    `UPDATE clients SET ${keys.map((k, i) => `${k}=$${i + 3}`).join(', ')} WHERE id=$1 AND owner_id=$2 RETURNING *`,
    [req.params.id, req.ownerId, ...keys.map((k) => d[k])],
  );
  if (!rows[0]) throw notFound('Client not found');
  res.json(rows[0]);
}));

r.delete('/:id', ah(async (req, res) => {
  parse(zUuid, req.params.id);
  const { rowCount } = await query('DELETE FROM clients WHERE id=$1 AND owner_id=$2', [req.params.id, req.ownerId]);
  if (!rowCount) throw notFound('Client not found');
  res.status(204).end();
}));

export default r;
