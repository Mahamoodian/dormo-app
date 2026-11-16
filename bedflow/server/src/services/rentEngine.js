// Rent engine: period generation, payment allocation, write-offs and deposit ledger.
// Every function takes a pg client that is already inside a transaction.
import { addDays, periodEnd, today } from '../utils/dates.js';
import { round2, balanceOf } from '../utils/money.js';
import { badRequest, notFound } from '../utils/http.js';

const MAX_PERIODS_PER_SYNC = 1000;

/** Status of a receivable; when it closes, `closedBy` (the closing action) decides paid vs written_off. */
export function statusFor(r, closedBy = 'paid') {
  const bal = balanceOf(r);
  if (bal > 0) return 'open';
  if (Number(r.amount_due) === 0) return 'void';
  if (Number(r.amount_paid) === 0 && Number(r.amount_written_off) > 0) return 'written_off';
  if (Number(r.amount_written_off) === 0) return 'paid';
  return closedBy;
}

export async function saveReceivable(client, r, closedBy) {
  r.status = statusFor(r, closedBy);
  await client.query(
    `UPDATE receivables SET amount_due=$2, amount_paid=$3, amount_written_off=$4, status=$5,
            description=$6, updated_at=now() WHERE id=$1`,
    [r.id, round2(r.amount_due), round2(r.amount_paid), round2(r.amount_written_off), r.status, r.description],
  );
  return r;
}

/** Bill the next rent period for an assignment (period after current_period_end). */
export async function generateNextPeriod(client, a) {
  const start = addDays(a.current_period_end, 1);
  const end = periodEnd(start, a.frequency_unit, a.frequency_count);
  const { rows } = await client.query(
    `INSERT INTO receivables (owner_id, assignment_id, client_id, kind, period_start, period_end, due_date, amount_due, description)
     VALUES ($1,$2,$3,'rent',$4,$5,$4,$6,$7)
     ON CONFLICT (assignment_id, period_start) WHERE kind = 'rent' DO NOTHING
     RETURNING *`,
    [a.owner_id, a.id, a.client_id, start, end, a.rent_amount, `Rent ${start} → ${end}`],
  );
  await client.query(`UPDATE assignments SET current_period_start=$2, current_period_end=$3 WHERE id=$1`, [a.id, start, end]);
  a.current_period_start = start;
  a.current_period_end = end;
  return rows[0] || null;
}

/** Generate every rent period that has started on or before `upto` (default: today). */
export async function syncAssignment(client, a, upto = today()) {
  let n = 0;
  while (a.status === 'active' && a.current_period_end < upto && n++ < MAX_PERIODS_PER_SYNC) {
    await generateNextPeriod(client, a);
  }
  return a;
}

/** Bring all of an owner's active tenancies up to date. Cheap when nothing is due. */
export async function syncOwner(client, ownerId, upto = today()) {
  const { rows } = await client.query(
    `SELECT * FROM assignments WHERE owner_id=$1 AND status='active' AND current_period_end < $2
     ORDER BY id FOR UPDATE`,
    [ownerId, upto],
  );
  for (const a of rows) await syncAssignment(client, a, upto);
  return rows.length;
}

export async function lockAssignment(client, ownerId, id) {
  const { rows } = await client.query(`SELECT * FROM assignments WHERE id=$1 AND owner_id=$2 FOR UPDATE`, [id, ownerId]);
  if (!rows[0]) throw notFound('Tenancy not found');
  return rows[0];
}

export async function lockReceivable(client, ownerId, id) {
  const { rows } = await client.query(`SELECT * FROM receivables WHERE id=$1 AND owner_id=$2 FOR UPDATE`, [id, ownerId]);
  if (!rows[0]) throw notFound('Receivable not found');
  return rows[0];
}

/** Apply `amount` (<= balance) to one receivable and record the payment. */
export async function applyPayment(client, r, amount, { method = 'cash', paid_on = today(), note = null } = {}) {
  amount = round2(amount);
  if (amount <= 0) return null;
  if (amount > balanceOf(r)) throw badRequest('Amount exceeds the outstanding balance');
  r.amount_paid = round2(Number(r.amount_paid) + amount);
  await saveReceivable(client, r);
  const { rows } = await client.query(
    `INSERT INTO payments (owner_id, receivable_id, assignment_id, client_id, amount, method, paid_on, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [r.owner_id, r.id, r.assignment_id, r.client_id, amount, method, paid_on, note],
  );
  const payment = rows[0];
  if (r.kind === 'deposit') {
    await client.query(
      `INSERT INTO deposit_ledger (owner_id, assignment_id, payment_id, entry_type, amount, method, entry_date, reason)
       VALUES ($1,$2,$3,'collected',$4,$5,$6,'Security deposit received')`,
      [r.owner_id, r.assignment_id, payment.id, amount, method, paid_on],
    );
  }
  return payment;
}

export async function openReceivables(client, ownerId, assignmentId, { kinds } = {}) {
  const { rows } = await client.query(
    `SELECT * FROM receivables WHERE owner_id=$1 AND assignment_id=$2 AND status='open'
       ${kinds ? 'AND kind = ANY($3)' : ''}
     ORDER BY due_date, CASE kind WHEN 'deposit' THEN 0 ELSE 1 END, created_at FOR UPDATE`,
    kinds ? [ownerId, assignmentId, kinds] : [ownerId, assignmentId],
  );
  return rows;
}

/**
 * Allocate an amount across a tenancy's open receivables, oldest due first,
 * starting with `firstId` if given. With allowAdvance, any surplus pre-pays
 * future rent periods (billing them early). Returns { payments, leftover }.
 */
export async function allocate(client, a, amount, opts = {}, { firstId, allowAdvance = false, kinds } = {}) {
  let left = round2(amount);
  const payments = [];
  const open = await openReceivables(client, a.owner_id, a.id, { kinds });
  if (firstId) open.sort((x, y) => (x.id === firstId ? -1 : y.id === firstId ? 1 : 0));
  for (const r of open) {
    if (left <= 0) break;
    const take = Math.min(left, balanceOf(r));
    const p = await applyPayment(client, r, take, opts);
    if (p) payments.push(p);
    left = round2(left - take);
  }
  let guard = 0;
  while (allowAdvance && left > 0 && a.status === 'active' && Number(a.rent_amount) > 0 && guard++ < 60) {
    const r = await generateNextPeriod(client, a);
    if (!r) break;
    const take = Math.min(left, balanceOf(r));
    payments.push(await applyPayment(client, r, take, { ...opts, note: opts.note || 'Advance payment' }));
    left = round2(left - take);
  }
  return { payments, leftover: left };
}

export async function writeOff(client, r, amount, reason, date = today()) {
  amount = round2(amount ?? balanceOf(r));
  if (amount <= 0) return null;
  if (amount > balanceOf(r)) throw badRequest('Write-off exceeds the outstanding balance');
  r.amount_written_off = round2(Number(r.amount_written_off) + amount);
  await saveReceivable(client, r, 'written_off');
  const { rows } = await client.query(
    `INSERT INTO write_offs (owner_id, receivable_id, amount, reason, written_off_on) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [r.owner_id, r.id, amount, reason || null, date],
  );
  return rows[0];
}

export async function depositHeld(client, assignmentId) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(CASE WHEN entry_type='collected' THEN amount ELSE -amount END),0) AS held
     FROM deposit_ledger WHERE assignment_id=$1`,
    [assignmentId],
  );
  return round2(rows[0].held);
}
