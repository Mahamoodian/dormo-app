// Vacate workflow: settlement preview + finalization (run inside one transaction).
import { daysInclusive, today } from '../utils/dates.js';
import { round2, balanceOf } from '../utils/money.js';
import { badRequest } from '../utils/http.js';
import { syncAssignment, saveReceivable, depositHeld, allocate, writeOff, openReceivables } from './rentEngine.js';

/**
 * Builds the settlement picture for vacating on `vacateDate`.
 * Rent periods are generated up to the vacate date first (if the client stays past
 * the paid expiry, the unpaid period that contains the vacate date is the one that
 * gets pro-rated).
 */
export async function buildVacatePlan(client, a, vacateDate) {
  if (a.status !== 'active') throw badRequest('This tenancy has already been vacated');
  if (vacateDate < a.start_date) throw badRequest('Vacate date cannot be before the start date');
  await syncAssignment(client, a, vacateDate > today() ? vacateDate : today());

  const { rows: recs } = await client.query(
    `SELECT * FROM receivables WHERE assignment_id=$1 AND owner_id=$2 ORDER BY due_date, created_at FOR UPDATE`,
    [a.id, a.owner_id],
  );
  const rent = recs.filter((r) => r.kind === 'rent');
  const current = rent.find((r) => r.period_start <= vacateDate && vacateDate <= r.period_end) || null;
  const future = rent.filter((r) => r.period_start > vacateDate);
  const futureUnpaid = future.filter((r) => balanceOf(r) > 0);
  const futurePrepaid = round2(future.reduce((s, r) => s + Number(r.amount_paid), 0));
  const depositOpen = recs.filter((r) => r.kind === 'deposit' && r.status === 'open');
  const arrears = recs.filter(
    (r) => r.status === 'open' && r.kind !== 'deposit' && r !== current && !future.includes(r),
  );

  let settlement = null;
  if (current && balanceOf(current) > 0) {
    const periodDays = daysInclusive(current.period_start, current.period_end);
    const usedDays = daysInclusive(current.period_start, vacateDate);
    const prorataTotal = round2((Number(current.amount_due) * usedDays) / periodDays);
    const already = round2(Number(current.amount_paid) + Number(current.amount_written_off));
    settlement = {
      receivable_id: current.id,
      period_start: current.period_start,
      period_end: current.period_end,
      period_days: periodDays,
      used_days: usedDays,
      period_amount: Number(current.amount_due),
      already_settled: already,
      prorata_due: round2(Math.max(0, prorataTotal - already)),
      full_due: balanceOf(current),
    };
  }

  let unused = null;
  if (current && balanceOf(current) === 0 && vacateDate < current.period_end) {
    const periodDays = daysInclusive(current.period_start, current.period_end);
    const unusedDays = periodDays - daysInclusive(current.period_start, vacateDate);
    unused = {
      unused_days: unusedDays,
      unused_value: round2((Number(current.amount_paid) * unusedDays) / periodDays),
    };
  }

  return {
    assignment_id: a.id,
    vacate_date: vacateDate,
    paid_through: rent.filter((r) => balanceOf(r) === 0 && r.status !== 'void').map((r) => r.period_end).sort().pop() || null,
    settlement,
    arrears: arrears.map((r) => ({
      id: r.id, kind: r.kind, description: r.description, due_date: r.due_date, balance: balanceOf(r),
    })),
    arrears_total: round2(arrears.reduce((s, r) => s + balanceOf(r), 0)),
    future_periods_to_cancel: futureUnpaid.length,
    future_prepaid: futurePrepaid,
    unpaid_deposit_to_cancel: round2(depositOpen.reduce((s, r) => s + balanceOf(r), 0)),
    unused_prepaid: unused,
    deposit_held: await depositHeld(client, a.id),
    _internal: { current, futureUnpaid, depositOpen },
  };
}

/**
 * input: {
 *   vacate_date, settlement_mode: 'prorata'|'full'|'custom'|'waive', settlement_custom_amount,
 *   collect_amount, collect_method,
 *   deposit_deductions: [{label, amount}], deposit_apply_to_dues, refund_method,
 *   write_off_remaining, write_off_reason, notes
 * }
 */
export async function finalizeVacate(client, a, input) {
  const plan = await buildVacatePlan(client, a, input.vacate_date);
  const { current, futureUnpaid, depositOpen } = plan._internal;
  const date = input.vacate_date;
  const opts = { method: input.collect_method || 'cash', paid_on: today() };

  // 1. Cancel unpaid future rent periods (after the vacate date) and any uncollected deposit.
  for (const r of [...futureUnpaid, ...depositOpen]) {
    r.amount_due = round2(Number(r.amount_paid) + Number(r.amount_written_off));
    r.description = `${r.description || ''} (cancelled – vacated ${date})`.trim();
    await saveReceivable(client, r);
  }

  // 2. Settle the period in which the client vacates.
  let settlementCharged = 0;
  if (plan.settlement) {
    const s = plan.settlement;
    const mode = input.settlement_mode || 'prorata';
    let charge;
    if (mode === 'prorata') charge = s.prorata_due;
    else if (mode === 'full') charge = s.full_due;
    else if (mode === 'custom') charge = round2(input.settlement_custom_amount ?? 0);
    else charge = 0; // waive
    if (charge < 0) throw badRequest('Settlement amount cannot be negative');
    current.amount_due = round2(s.already_settled + charge);
    current.period_end = date;
    current.description =
      mode === 'prorata'
        ? `Rent ${s.period_start} → ${date} (pro-rata ${s.used_days}/${s.period_days} days)`
        : `Rent ${s.period_start} → ${date} (vacate settlement – ${mode})`;
    await saveReceivable(client, current);
    await client.query(`UPDATE receivables SET period_end=$2 WHERE id=$1`, [current.id, date]);
    settlementCharged = charge;
  }

  // 3. Deposit: apply to dues, convert deductions to revenue, refund the rest.
  const held = plan.deposit_held;
  const deductions = (input.deposit_deductions || []).filter((d) => Number(d.amount) > 0);
  const deductionTotal = round2(deductions.reduce((s, d) => s + Number(d.amount), 0));
  let applyToDues = round2(input.deposit_apply_to_dues || 0);
  if (round2(deductionTotal + applyToDues) > held) {
    throw badRequest(`Deductions (${round2(deductionTotal + applyToDues)}) exceed the deposit held (${held})`);
  }
  if (applyToDues > 0) {
    const { leftover } = await allocate(client, a, applyToDues, {
      method: 'deposit_adjustment', paid_on: today(), note: 'Adjusted from security deposit',
    }, { kinds: ['rent', 'settlement'] });
    if (leftover > 0) throw badRequest('Deposit applied to dues exceeds the outstanding dues');
    await ledger(client, a, 'applied_to_dues', applyToDues, 'Applied to outstanding rent', null, date);
  }
  for (const d of deductions) {
    await ledger(client, a, 'converted_to_revenue', round2(d.amount), d.label || 'Deduction', null, date);
  }
  const refund = round2(held - deductionTotal - applyToDues);
  if (refund > 0) await ledger(client, a, 'refunded', refund, 'Deposit refund on vacate', input.refund_method || 'cash', date);

  // 4. Collect cash now (oldest dues first).
  let collected = 0;
  if (Number(input.collect_amount) > 0) {
    const { leftover } = await allocate(client, a, input.collect_amount, opts, { kinds: ['rent', 'settlement'] });
    if (leftover > 0) throw badRequest(`Collected amount exceeds the outstanding dues by ${leftover}`);
    collected = round2(input.collect_amount);
  }

  // 5. Write off whatever remains, or leave it in the receivables register.
  let writtenOff = 0;
  const remaining = await openReceivables(client, a.owner_id, a.id);
  if (input.write_off_remaining) {
    for (const r of remaining) {
      const w = await writeOff(client, r, balanceOf(r), input.write_off_reason || 'Written off on vacate', date);
      writtenOff = round2(writtenOff + (w?.amount || 0));
    }
  }
  const stillOpen = input.write_off_remaining ? 0 : round2(remaining.reduce((s, r) => s + balanceOf(r), 0));

  const summary = {
    vacate_date: date,
    settlement_mode: plan.settlement ? input.settlement_mode || 'prorata' : null,
    settlement_charged: settlementCharged,
    collected,
    deposit_held: held,
    deposit_deductions: deductions,
    deposit_applied_to_dues: applyToDues,
    deposit_refunded: refund,
    written_off: writtenOff,
    balance_left_in_receivables: stillOpen,
  };

  await client.query(
    `UPDATE assignments SET status='vacated', vacate_date=$2, vacate_summary=$3,
       notes = COALESCE($4, notes) WHERE id=$1`,
    [a.id, date, summary, input.notes || null],
  );
  return summary;
}

async function ledger(client, a, type, amount, reason, method, date) {
  await client.query(
    `INSERT INTO deposit_ledger (owner_id, assignment_id, entry_type, amount, reason, method, entry_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [a.owner_id, a.id, type, amount, reason, method, date],
  );
}
