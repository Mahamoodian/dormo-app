// Bed assignment (tenancy) lifecycle: assign, edit/transfer, collect, vacate.
import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db/pool.js';
import { ah, notFound, badRequest } from '../utils/http.js';
import { parse, zUuid, zDate, zMoney, zOptText, zMethod } from '../middleware/validate.js';
import { today, periodEnd } from '../utils/dates.js';
import { round2 } from '../utils/money.js';
import { clientSchema, insertClient } from './clients.js';
import { applyPayment, syncAssignment, lockAssignment, allocate, depositHeld } from '../services/rentEngine.js';
import { buildVacatePlan, finalizeVacate } from '../services/vacate.js';

const r = Router();

const assignSchema = z.object({
  client_id: zUuid.optional(),
  new_client: clientSchema.optional(),
  bed_id: zUuid,
  start_date: zDate,
  expiry_date: zDate.optional(), // end of the first (prepaid) period; defaults to one frequency period
  rent_amount: zMoney,
  frequency_unit: z.enum(['day', 'week', 'month']),
  frequency_count: z.coerce.number().int().min(1).max(365).default(1),
  first_period_amount: zMoney.optional(),
  deposit_amount: zMoney.default(0),
  rent_collected: zMoney.default(0),
  deposit_collected: zMoney.default(0),
  payment_method: zMethod,
  notes: zOptText(2000),
}).refine((d) => d.client_id || d.new_client, { message: 'Select an existing client or add a new one', path: ['client_id'] });

r.post('/', ah(async (req, res) => {
  const d = parse(assignSchema, req.body);
  const expiry = d.expiry_date || periodEnd(d.start_date, d.frequency_unit, d.frequency_count);
  if (expiry < d.start_date) throw badRequest('Expiry date must be on or after the start date');
  const firstAmount = d.first_period_amount ?? d.rent_amount;
  if (d.rent_collected > firstAmount) throw badRequest('Rent collected exceeds the first period amount');
  if (d.deposit_collected > d.deposit_amount) throw badRequest('Deposit collected exceeds the deposit amount');

  const result = await tx(async (db) => {
    const { rows: bedRows } = await db.query('SELECT * FROM beds WHERE id=$1 AND owner_id=$2 FOR UPDATE', [d.bed_id, req.ownerId]);
    const bed = bedRows[0];
    if (!bed) throw notFound('Bed not found');
    if (!bed.in_service) throw badRequest('This bed is marked under maintenance');

    let clientId = d.client_id;
    if (!clientId) clientId = (await insertClient(db, req.ownerId, d.new_client)).id;
    else {
      const { rows } = await db.query('SELECT id FROM clients WHERE id=$1 AND owner_id=$2', [clientId, req.ownerId]);
      if (!rows[0]) throw notFound('Client not found');
    }

    const { rows: aRows } = await db.query(
      `INSERT INTO assignments (owner_id, client_id, bed_id, start_date, rent_amount, frequency_unit, frequency_count,
                                deposit_amount, current_period_start, current_period_end, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$4,$9,$10) RETURNING *`,
      [req.ownerId, clientId, d.bed_id, d.start_date, d.rent_amount, d.frequency_unit, d.frequency_count, d.deposit_amount, expiry, d.notes],
    );
    const a = aRows[0];
    const opts = { method: d.payment_method, paid_on: d.start_date > today() ? today() : d.start_date };

    // First (usually prepaid) rent period
    const { rows: rentRows } = await db.query(
      `INSERT INTO receivables (owner_id, assignment_id, client_id, kind, period_start, period_end, due_date, amount_due, description)
       VALUES ($1,$2,$3,'rent',$4,$5,$4,$6,$7) RETURNING *`,
      [req.ownerId, a.id, clientId, d.start_date, expiry, firstAmount, `Rent ${d.start_date} → ${expiry}`],
    );
    if (d.rent_collected > 0) await applyPayment(db, rentRows[0], d.rent_collected, opts);

    // Security deposit
    if (d.deposit_amount > 0) {
      const { rows: depRows } = await db.query(
        `INSERT INTO receivables (owner_id, assignment_id, client_id, kind, due_date, amount_due, description)
         VALUES ($1,$2,$3,'deposit',$4,$5,'Security deposit') RETURNING *`,
        [req.ownerId, a.id, clientId, d.start_date, d.deposit_amount],
      );
      if (d.deposit_collected > 0) await applyPayment(db, depRows[0], d.deposit_collected, opts);
    }

    // Back-dated entries: bill any periods that have already started
    await syncAssignment(db, a);
    return a;
  });
  res.status(201).json(result);
}));

r.get('/:id', ah(async (req, res) => {
  parse(zUuid, req.params.id);
  const { rows } = await query(
    `SELECT a.*, c.full_name AS client_name, c.phone AS client_phone, bd.label AS bed_label, ar.name AS area_name,
            f.name AS flat_name, b.name AS building_name
     FROM assignments a JOIN clients c ON c.id=a.client_id JOIN beds bd ON bd.id=a.bed_id
     JOIN areas ar ON ar.id=bd.area_id JOIN flats f ON f.id=ar.flat_id JOIN buildings b ON b.id=f.building_id
     WHERE a.id=$1 AND a.owner_id=$2`, [req.params.id, req.ownerId]);
  if (!rows[0]) throw notFound('Tenancy not found');
  const [recv, held] = await Promise.all([
    query(`SELECT *, amount_due-amount_paid-amount_written_off AS balance FROM receivables
           WHERE assignment_id=$1 AND owner_id=$2 ORDER BY due_date DESC`, [req.params.id, req.ownerId]),
    depositHeld({ query }, req.params.id),
  ]);
  res.json({ ...rows[0], receivables: recv.rows, deposit_held: held, today: today() });
}));

// Change rent terms for FUTURE periods, update notes, or transfer to another bed
r.patch('/:id', ah(async (req, res) => {
  parse(zUuid, req.params.id);
  const d = parse(z.object({
    rent_amount: zMoney.optional(),
    frequency_unit: z.enum(['day', 'week', 'month']).optional(),
    frequency_count: z.coerce.number().int().min(1).max(365).optional(),
    current_period_end: zDate.optional(), // extend/shorten the current expiry date
    bed_id: zUuid.optional(),
    notes: zOptText(2000),
  }), req.body);
  const out = await tx(async (db) => {
    const a = await lockAssignment(db, req.ownerId, req.params.id);
    if (a.status !== 'active') throw badRequest('Only active tenancies can be edited');
    if (d.bed_id && d.bed_id !== a.bed_id) {
      const { rows } = await db.query('SELECT * FROM beds WHERE id=$1 AND owner_id=$2', [d.bed_id, req.ownerId]);
      if (!rows[0]) throw notFound('Bed not found');
      if (!rows[0].in_service) throw badRequest('Target bed is under maintenance');
    }
    if (d.current_period_end) {
      if (d.current_period_end < a.current_period_start) throw badRequest('Expiry cannot be before the current period start');
      await db.query(
        `UPDATE receivables SET period_end=$3, description='Rent '||period_start||' → '||$3::text
         WHERE assignment_id=$1 AND owner_id=$2 AND kind='rent' AND period_start=$4`,
        [a.id, req.ownerId, d.current_period_end, a.current_period_start],
      );
    }
    const keys = Object.keys(d).filter((k) => d[k] !== undefined);
    if (!keys.length) throw badRequest('Nothing to update');
    const { rows } = await db.query(
      `UPDATE assignments SET ${keys.map((k, i) => `${k}=$${i + 3}`).join(', ')} WHERE id=$1 AND owner_id=$2 RETURNING *`,
      [a.id, req.ownerId, ...keys.map((k) => d[k])],
    );
    await syncAssignment(db, rows[0]);
    return rows[0];
  });
  res.json(out);
}));

// Collect against a tenancy: pays oldest dues first; surplus pre-pays upcoming periods.
r.post('/:id/collect', ah(async (req, res) => {
  parse(zUuid, req.params.id);
  const d = parse(z.object({
    amount: zMoney.refine((n) => n > 0, 'must be greater than 0'),
    method: zMethod,
    paid_on: zDate.optional(),
    note: zOptText(500),
  }), req.body);
  const out = await tx(async (db) => {
    const a = await lockAssignment(db, req.ownerId, req.params.id);
    await syncAssignment(db, a);
    const { payments, leftover } = await allocate(db, a, d.amount, { method: d.method, paid_on: d.paid_on || today(), note: d.note },
      { allowAdvance: a.status === 'active' });
    if (leftover > 0) throw badRequest(`Amount exceeds everything owed by ${leftover}`);
    return { payments, paid_through: a.current_period_end };
  });
  res.json(out);
}));

const vacateSchema = z.object({
  vacate_date: zDate,
  settlement_mode: z.enum(['prorata', 'full', 'custom', 'waive']).default('prorata'),
  settlement_custom_amount: zMoney.optional(),
  collect_amount: zMoney.default(0),
  collect_method: zMethod,
  deposit_deductions: z.array(z.object({ label: z.string().trim().max(120).default('Deduction'), amount: zMoney })).max(20).default([]),
  deposit_apply_to_dues: zMoney.default(0),
  refund_method: zMethod,
  write_off_remaining: z.boolean().default(false),
  write_off_reason: zOptText(300),
  notes: zOptText(2000),
});

// Preview runs the real computation in a transaction and ROLLS BACK — no side effects.
r.post('/:id/vacate/preview', ah(async (req, res) => {
  parse(zUuid, req.params.id);
  const { vacate_date } = parse(z.object({ vacate_date: zDate }), req.body);
  let plan;
  try {
    await tx(async (db) => {
      const a = await lockAssignment(db, req.ownerId, req.params.id);
      plan = await buildVacatePlan(db, a, vacate_date);
      throw Object.assign(new Error('rollback'), { __rollback: true });
    });
  } catch (e) {
    if (!e.__rollback) throw e;
  }
  delete plan._internal;
  res.json(plan);
}));

r.post('/:id/vacate', ah(async (req, res) => {
  parse(zUuid, req.params.id);
  const d = parse(vacateSchema, req.body);
  if (d.settlement_mode === 'custom' && d.settlement_custom_amount === undefined) throw badRequest('Enter the custom settlement amount');
  const summary = await tx(async (db) => {
    const a = await lockAssignment(db, req.ownerId, req.params.id);
    return finalizeVacate(db, a, d);
  });
  res.json({ ok: true, summary: { ...summary, total_settled: round2(summary.collected + summary.deposit_applied_to_dues) } });
}));

export default r;
