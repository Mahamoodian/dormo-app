// Receivables register, quick collection, write-offs and payment reversal.
import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db/pool.js';
import { ah, badRequest, notFound } from '../utils/http.js';
import { parse, zUuid, zDate, zMoney, zOptText, zMethod } from '../middleware/validate.js';
import { today, addDays, diffDays } from '../utils/dates.js';
import { round2, balanceOf } from '../utils/money.js';
import { lockReceivable, lockAssignment, allocate, writeOff, saveReceivable, depositHeld } from '../services/rentEngine.js';

const r = Router();

const BASE = `
  SELECT rv.*, rv.amount_due-rv.amount_paid-rv.amount_written_off AS balance,
         c.full_name AS client_name, c.phone AS client_phone, a.status AS assignment_status,
         bd.label AS bed_label, ar.name AS area_name, f.name AS flat_name, b.name AS building_name
  FROM receivables rv
  JOIN clients c ON c.id=rv.client_id
  JOIN assignments a ON a.id=rv.assignment_id
  JOIN beds bd ON bd.id=a.bed_id JOIN areas ar ON ar.id=bd.area_id
  JOIN flats f ON f.id=ar.flat_id JOIN buildings b ON b.id=f.building_id
  WHERE rv.owner_id=$1`;

r.get('/', ah(async (req, res) => {
  const tab = String(req.query.tab || 'due');
  const q = String(req.query.q || '').trim();
  const t = today();
  const search = `AND ($3 = '' OR c.full_name ILIKE '%'||$3||'%' OR c.phone ILIKE '%'||$3||'%' OR bd.label ILIKE '%'||$3||'%' OR f.name ILIKE '%'||$3||'%')`;

  if (tab === 'upcoming') {
    // Tenancies whose paid period expires within the next 7 days (next rent not yet billed)
    const { rows } = await query(
      `SELECT a.id AS assignment_id, a.current_period_end, a.rent_amount, a.frequency_unit, a.frequency_count,
              c.full_name AS client_name, c.phone AS client_phone,
              bd.label AS bed_label, ar.name AS area_name, f.name AS flat_name, b.name AS building_name
       FROM assignments a JOIN clients c ON c.id=a.client_id JOIN beds bd ON bd.id=a.bed_id
       JOIN areas ar ON ar.id=bd.area_id JOIN flats f ON f.id=ar.flat_id JOIN buildings b ON b.id=f.building_id
       WHERE a.owner_id=$1 AND a.status='active' AND a.current_period_end BETWEEN $2 AND $4 ${search}
       ORDER BY a.current_period_end`,
      [req.ownerId, t, q, addDays(t, 7)],
    );
    return res.json({ today: t, rows: rows.map((x) => ({ ...x, next_due: addDays(x.current_period_end, 1), days_left: diffDays(t, x.current_period_end) })) });
  }

  const where = {
    due: `AND rv.status='open' AND rv.due_date <= $2`,
    open: `AND rv.status='open' AND $2::date IS NOT NULL`,
    closed: `AND rv.status IN ('paid','written_off') AND $2::date IS NOT NULL`,
  }[tab];
  if (!where) throw badRequest('Unknown tab');
  const { rows } = await query(
    `${BASE} ${where} ${search} ORDER BY ${tab === 'closed' ? 'rv.updated_at DESC LIMIT 300' : 'rv.due_date, c.full_name'}`,
    [req.ownerId, t, q],
  );
  res.json({ today: t, rows: rows.map((x) => ({ ...x, days_overdue: x.status === 'open' ? Math.max(0, diffDays(x.due_date, t)) : 0 })) });
}));

r.get('/summary', ah(async (req, res) => {
  const t = today();
  const { rows } = await query(
    `SELECT
       COALESCE(SUM(amount_due-amount_paid-amount_written_off) FILTER (WHERE due_date <= $2),0) AS overdue_total,
       COUNT(*) FILTER (WHERE due_date <= $2) AS overdue_count,
       COALESCE(SUM(amount_due-amount_paid-amount_written_off),0) AS open_total,
       COUNT(*) AS open_count
     FROM receivables WHERE owner_id=$1 AND status='open'`, [req.ownerId, t]);
  const { rows: up } = await query(
    `SELECT COUNT(*) AS n FROM assignments WHERE owner_id=$1 AND status='active' AND current_period_end BETWEEN $2 AND $3`,
    [req.ownerId, t, addDays(t, 7)]);
  res.json({ ...rows[0], upcoming_count: up[0].n });
}));

// Quick collection: enter amount -> Enter. Partial leaves a balance; surplus spills to the tenant's
// other dues and then pre-pays future periods (active tenancies only).
r.post('/:id/collect', ah(async (req, res) => {
  parse(zUuid, req.params.id);
  const d = parse(z.object({
    amount: zMoney.refine((n) => n > 0, 'must be greater than 0'),
    method: zMethod,
    paid_on: zDate.optional(),
    note: zOptText(500),
  }), req.body);
  const out = await tx(async (db) => {
    const rec = await lockReceivable(db, req.ownerId, req.params.id);
    if (rec.status !== 'open') throw badRequest('This item is already settled');
    const a = await lockAssignment(db, req.ownerId, rec.assignment_id);
    const { payments, leftover } = await allocate(db, a, d.amount,
      { method: d.method, paid_on: d.paid_on || today(), note: d.note },
      { firstId: rec.id, allowAdvance: a.status === 'active' });
    if (leftover > 0) throw badRequest(`Amount exceeds everything this client owes by ${leftover}`);
    const { rows } = await db.query('SELECT *, amount_due-amount_paid-amount_written_off AS balance FROM receivables WHERE id=$1', [rec.id]);
    return { receivable: rows[0], payments };
  });
  res.json(out);
}));

r.post('/:id/write-off', ah(async (req, res) => {
  parse(zUuid, req.params.id);
  const d = parse(z.object({ amount: zMoney.optional(), reason: zOptText(300) }), req.body);
  const out = await tx(async (db) => {
    const rec = await lockReceivable(db, req.ownerId, req.params.id);
    if (rec.status !== 'open') throw badRequest('This item is already settled');
    const w = await writeOff(db, rec, d.amount ?? balanceOf(rec), d.reason);
    return { write_off: w, receivable: rec };
  });
  res.json(out);
}));

// ---------- Payments
export const payments = Router();

payments.get('/', ah(async (req, res) => {
  const from = req.query.from || addDays(today(), -30);
  const to = req.query.to || today();
  parse(zDate, from); parse(zDate, to);
  const { rows } = await query(
    `SELECT p.*, c.full_name AS client_name, rv.kind, rv.description
     FROM payments p JOIN clients c ON c.id=p.client_id JOIN receivables rv ON rv.id=p.receivable_id
     WHERE p.owner_id=$1 AND p.paid_on BETWEEN $2 AND $3 ORDER BY p.paid_on DESC, p.created_at DESC LIMIT 1000`,
    [req.ownerId, from, to]);
  res.json(rows);
}));

// Reverse a mistaken payment entry
payments.delete('/:id', ah(async (req, res) => {
  parse(zUuid, req.params.id);
  await tx(async (db) => {
    const { rows } = await db.query('SELECT * FROM payments WHERE id=$1 AND owner_id=$2 FOR UPDATE', [req.params.id, req.ownerId]);
    const p = rows[0];
    if (!p) throw notFound('Payment not found');
    if (p.method === 'deposit_adjustment') throw badRequest('Deposit adjustments made at vacate cannot be reversed individually');
    const rec = await lockReceivable(db, req.ownerId, p.receivable_id);
    if (rec.status === 'void' && Number(rec.amount_due) === 0) throw badRequest('Cannot reverse a payment on a cancelled item');
    rec.amount_paid = round2(Number(rec.amount_paid) - Number(p.amount));
    if (rec.kind === 'deposit') {
      const held = await depositHeld(db, p.assignment_id);
      if (held < Number(p.amount)) throw badRequest('This deposit has already been refunded or used');
    }
    await saveReceivable(db, rec);
    await db.query('DELETE FROM payments WHERE id=$1', [p.id]); // cascades the deposit ledger row
  });
  res.status(204).end();
}));

export default r;
