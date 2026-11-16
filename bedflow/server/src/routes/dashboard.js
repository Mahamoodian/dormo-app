import { Router } from 'express';
import { query } from '../db/pool.js';
import { ah } from '../utils/http.js';
import { today, monthRange, addDays } from '../utils/dates.js';
import { round2 } from '../utils/money.js';

const r = Router();

r.get('/', ah(async (req, res) => {
  const t = today();
  const ym = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : t.slice(0, 7);
  const { start, end } = monthRange(ym);
  const o = req.ownerId;

  const [beds, collected, billed, recv, deposits, expenses, byCat, recentExp, recentPay, flats, expiring] = await Promise.all([
    query(`SELECT COUNT(*) AS total,
                  COUNT(a.id) AS occupied,
                  COUNT(*) FILTER (WHERE a.id IS NULL AND bd.in_service) AS available,
                  COUNT(*) FILTER (WHERE a.id IS NULL AND NOT bd.in_service) AS maintenance
           FROM beds bd LEFT JOIN assignments a ON a.bed_id=bd.id AND a.status='active' WHERE bd.owner_id=$1`, [o]),
    query(`SELECT COALESCE(SUM(p.amount),0) AS amount FROM payments p JOIN receivables rv ON rv.id=p.receivable_id
           WHERE p.owner_id=$1 AND rv.kind IN ('rent','settlement') AND p.paid_on BETWEEN $2 AND $3`, [o, start, end]),
    query(`SELECT COALESCE(SUM(amount_due),0) AS amount FROM receivables
           WHERE owner_id=$1 AND kind IN ('rent','settlement') AND due_date BETWEEN $2 AND $3`, [o, start, end]),
    query(`SELECT COALESCE(SUM(amount_due-amount_paid-amount_written_off),0) AS outstanding,
                  COALESCE(SUM(amount_due-amount_paid-amount_written_off) FILTER (WHERE due_date <= $2),0) AS overdue,
                  COUNT(DISTINCT client_id) FILTER (WHERE due_date <= $2) AS overdue_clients
           FROM receivables WHERE owner_id=$1 AND status='open'`, [o, t]),
    query(`SELECT COALESCE(SUM(CASE WHEN entry_type='collected' THEN amount ELSE -amount END),0) AS held,
                  COALESCE(SUM(amount) FILTER (WHERE entry_type='converted_to_revenue' AND entry_date BETWEEN $2 AND $3),0) AS converted
           FROM deposit_ledger WHERE owner_id=$1`, [o, start, end]),
    query(`SELECT COALESCE(SUM(amount),0) AS amount FROM expenses WHERE owner_id=$1 AND expense_date BETWEEN $2 AND $3`, [o, start, end]),
    query(`SELECT ec.name, SUM(e.amount) AS amount FROM expenses e JOIN expense_categories ec ON ec.id=e.category_id
           WHERE e.owner_id=$1 AND e.expense_date BETWEEN $2 AND $3 GROUP BY ec.name ORDER BY 2 DESC`, [o, start, end]),
    query(`SELECT e.id, e.expense_date, e.amount, e.description, ec.name AS category_name, f.name AS flat_name
           FROM expenses e JOIN expense_categories ec ON ec.id=e.category_id JOIN flats f ON f.id=e.flat_id
           WHERE e.owner_id=$1 ORDER BY e.expense_date DESC, e.created_at DESC LIMIT 6`, [o]),
    query(`SELECT p.id, p.amount, p.paid_on, p.method, c.full_name AS client_name, rv.kind
           FROM payments p JOIN clients c ON c.id=p.client_id JOIN receivables rv ON rv.id=p.receivable_id
           WHERE p.owner_id=$1 ORDER BY p.paid_on DESC, p.created_at DESC LIMIT 6`, [o]),
    query(`SELECT f.id, f.name, f.kind, b.name AS building_name, COUNT(bd.id) AS beds, COUNT(a.id) AS occupied,
                  COALESCE((SELECT SUM(amount) FROM expenses e WHERE e.flat_id=f.id AND e.expense_date BETWEEN $2 AND $3),0) AS expenses
           FROM flats f JOIN buildings b ON b.id=f.building_id
           LEFT JOIN areas ar ON ar.flat_id=f.id LEFT JOIN beds bd ON bd.area_id=ar.id
           LEFT JOIN assignments a ON a.bed_id=bd.id AND a.status='active'
           WHERE f.owner_id=$1 GROUP BY f.id, b.name ORDER BY b.name, f.name`, [o, start, end]),
    query(`SELECT COUNT(*) AS n FROM assignments WHERE owner_id=$1 AND status='active' AND current_period_end BETWEEN $2 AND $3`,
      [o, t, addDays(t, 7)]),
  ]);

  const b = beds.rows[0];
  const income = round2(Number(collected.rows[0].amount) + Number(deposits.rows[0].converted));
  res.json({
    month: ym,
    today: t,
    beds: { ...b, occupancy_rate: b.total ? round2((b.occupied / b.total) * 100) : 0 },
    revenue: {
      rent_collected: collected.rows[0].amount,
      rent_billed: billed.rows[0].amount,
      deposit_converted: deposits.rows[0].converted,
      total_income: income,
      expenses: expenses.rows[0].amount,
      net: round2(income - Number(expenses.rows[0].amount)),
    },
    receivables: recv.rows[0],
    deposits_held: deposits.rows[0].held,
    expiring_soon: expiring.rows[0].n,
    expenses_by_category: byCat.rows,
    recent_expenses: recentExp.rows,
    recent_payments: recentPay.rows,
    flats: flats.rows,
  });
}));

export default r;
