// Optional: creates a demo business owner with sample properties, tenants and expenses.
// Usage: npm run db:demo   ->  demo@bedflow.local / Demo12345
import { pool, tx } from './pool.js';
import { hashPassword } from '../utils/password.js';
import { today, addDays, addMonths, periodEnd } from '../utils/dates.js';
import { applyPayment, syncAssignment } from '../services/rentEngine.js';

const EMAIL = 'demo@bedflow.local';
const T = today();

try {
  await tx(async (db) => {
    const { rows: ex } = await db.query('SELECT id FROM users WHERE lower(email)=$1', [EMAIL]);
    if (ex[0]) await db.query('DELETE FROM users WHERE id=$1', [ex[0].id]);
    const { rows: [u] } = await db.query(
      `INSERT INTO users (role, full_name, business_name, email, phone, currency, password_hash, must_change_password)
       VALUES ('owner','Demo Owner','Marina Bedspace','${EMAIL}','+971500000000','AED',$1,FALSE) RETURNING *`,
      [await hashPassword('Demo12345')],
    );
    const o = u.id;
    const ins = async (sql, p) => (await db.query(sql, p)).rows[0];

    const beds = [];
    const flats = [];
    for (const [bName, flatDefs] of [['Marina Heights', [['Flat 1204', 'dormitory', [['Room A', 4], ['Room B', 4]]], ['Flat 1503', 'flat', [['Master', 2], ['Partition 1', 1], ['Partition 2', 1]]]]],
      ['Al Barsha Residence', [['Dorm 2', 'dormitory', [['Hall', 6]]]]]]) {
      const b = await ins('INSERT INTO buildings (owner_id, name, address) VALUES ($1,$2,$3) RETURNING *', [o, bName, 'Dubai, UAE']);
      for (const [fName, kind, areas] of flatDefs) {
        const f = await ins('INSERT INTO flats (owner_id, building_id, name, kind) VALUES ($1,$2,$3,$4) RETURNING *', [o, b.id, fName, kind]);
        flats.push(f);
        for (const [aName, n] of areas) {
          const a = await ins('INSERT INTO areas (owner_id, flat_id, name) VALUES ($1,$2,$3) RETURNING *', [o, f.id, aName]);
          for (let i = 1; i <= n; i++) beds.push(await ins('INSERT INTO beds (owner_id, area_id, label, default_rent) VALUES ($1,$2,$3,$4) RETURNING *', [o, a.id, `Bed ${i}`, kind === 'dormitory' ? 650 : 1200]));
        }
      }
    }

    const people = [['Arjun Menon', '+971501112233', 'India'], ['Joseph Mensah', '+971502223344', 'Ghana'], ['Maria Santos', '+971503334455', 'Philippines'],
      ['Ahmed Raza', '+971504445566', 'Pakistan'], ['Li Wei', '+971505556677', 'China'], ['Ravi Kumar', '+971506667788', 'India'],
      ['Grace Wanjiru', '+971507778899', 'Kenya'], ['Omar Haddad', '+971508889900', 'Jordan'], ['Sunil Perera', '+971509990011', 'Sri Lanka'],
      ['Fatima Noor', '+971501231234', 'Bangladesh'], ['Daniel Okafor', '+971504564567', 'Nigeria']];
    // [startOffsetDays, unit, rentPaidFirst?]
    const plans = [[-20, 'month', 1], [-50, 'month', 1], [-12, 'week', 1], [-5, 'month', 1], [-33, 'month', 1], [-3, 'week', 1],
      [-26, 'month', 1], [-9, 'day', 1], [-62, 'month', 1], [-15, 'month', 0.5], [-1, 'month', 1]];
    for (let i = 0; i < people.length; i++) {
      const [name, phone, nat] = people[i];
      const c = await ins('INSERT INTO clients (owner_id, full_name, phone, nationality, id_type) VALUES ($1,$2,$3,$4,$5) RETURNING *', [o, name, phone, nat, 'Passport']);
      const bed = beds[[0, 1, 2, 4, 5, 8, 9, 10, 12, 13, 15][i]];
      const [off, unit, paidRatio] = plans[i];
      const start = addDays(T, off);
      const count = unit === 'day' ? 7 : 1;
      const rent = unit === 'week' ? 200 : unit === 'day' ? 35 : Number(bed.default_rent);
      const end = periodEnd(start, unit, count);
      const a = await ins(
        `INSERT INTO assignments (owner_id, client_id, bed_id, start_date, rent_amount, frequency_unit, frequency_count, deposit_amount, current_period_start, current_period_end)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$4,$9) RETURNING *`, [o, c.id, bed.id, start, rent * (unit === 'day' ? 7 : 1), unit, count, 500, end]);
      const r = await ins(`INSERT INTO receivables (owner_id, assignment_id, client_id, kind, period_start, period_end, due_date, amount_due, description)
        VALUES ($1,$2,$3,'rent',$4,$5,$4,$6,$7) RETURNING *`, [o, a.id, c.id, start, end, a.rent_amount, `Rent ${start} → ${end}`]);
      await applyPayment(db, r, Math.round(a.rent_amount * paidRatio), { paid_on: start });
      const d = await ins(`INSERT INTO receivables (owner_id, assignment_id, client_id, kind, due_date, amount_due, description)
        VALUES ($1,$2,$3,'deposit',$4,500,'Security deposit') RETURNING *`, [o, a.id, c.id, start]);
      await applyPayment(db, d, 500, { paid_on: start });
      await syncAssignment(db, a);
    }
    // a few collections on generated periods
    const { rows: open } = await db.query(`SELECT * FROM receivables WHERE owner_id=$1 AND status='open' AND kind='rent' ORDER BY due_date LIMIT 3`, [o]);
    for (const r of open.slice(0, 2)) await applyPayment(db, r, Math.round(r.amount_due / 2), { paid_on: T, method: 'bank_transfer' });

    const { rows: cats } = await db.query('SELECT id, name FROM expense_categories WHERE owner_id IS NULL');
    const cat = (n) => cats.find((c) => c.name === n).id;
    const exp = [['Electricity', 780, 'DEWA bill'], ['Wi-Fi / Internet', 299, 'du Home'], ['Cleaning', 450, 'Weekly cleaning'], ['Maintenance', 220, 'AC servicing'],
      ['Supplies', 135, 'Toiletries & bulbs'], ['Water', 160, 'Water bill'], ['Pest Control', 300, 'Quarterly treatment']];
    for (let i = 0; i < exp.length; i++) {
      const [c, amt, desc] = exp[i];
      await db.query('INSERT INTO expenses (owner_id, flat_id, category_id, amount, description, expense_date) VALUES ($1,$2,$3,$4,$5,$6)',
        [o, flats[i % flats.length].id, cat(c), amt, desc, addDays(T, -(i * 3))]);
      await db.query('INSERT INTO expenses (owner_id, flat_id, category_id, amount, description, expense_date) VALUES ($1,$2,$3,$4,$5,$6)',
        [o, flats[(i + 1) % flats.length].id, cat(c), amt * 0.9, desc, addMonths(addDays(T, -(i * 3)), -1)]);
    }
  });
  console.log(`✔ Demo data created. Log in as ${EMAIL} / Demo12345`);
} catch (e) {
  console.error('✖ Demo seed failed:', e);
  process.exitCode = 1;
} finally {
  await pool.end();
}
