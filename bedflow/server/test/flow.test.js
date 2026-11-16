// End-to-end API tests against a real PostgreSQL database.
// Usage: DATABASE_URL=postgres://.../bedflow_test npm test   (the DB is wiped!)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import process from 'node:process';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'test-secret-test-secret-test-secret-123';

const { pool } = await import('../src/db/pool.js');
const { createApp } = await import('../src/app.js');
const { hashPassword } = await import('../src/utils/password.js');
const { today, addDays, addMonths } = await import('../src/utils/dates.js');

let server, base;
const T = today();

async function api(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function loginAndChange(email, pw, newPw) {
  let r = await api('POST', '/api/auth/login', { email, password: pw });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.user.must_change_password, true);
  r = await api('POST', '/api/auth/change-password', { current_password: pw, new_password: newPw }, r.body.token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.token;
}

before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await pool.query(fs.readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8'));
  await pool.query(
    `INSERT INTO users (role, full_name, email, password_hash) VALUES ('super_admin','Root','root@test.io',$1)`,
    [await hashPassword('Initial123')],
  );
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await pool.end(); });

const S = {};

test('super admin must change default password before access', async () => {
  const r = await api('POST', '/api/auth/login', { email: 'root@test.io', password: 'Initial123' });
  const blocked = await api('GET', '/api/admin/reports', null, r.body.token);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'PASSWORD_CHANGE_REQUIRED');
  const weak = await api('POST', '/api/auth/change-password', { current_password: 'Initial123', new_password: 'short' }, r.body.token);
  assert.equal(weak.status, 400);
  S.admin = await loginAndChange('root@test.io', 'Initial123', 'RootPass2026');
  assert.equal((await api('GET', '/api/admin/reports', null, S.admin)).status, 200);
});

test('admin creates owners with temp passwords; owners forced to change', async () => {
  const a = await api('POST', '/api/admin/users', { full_name: 'Owner A', email: 'a@test.io', business_name: 'A Beds' }, S.admin);
  assert.equal(a.status, 201);
  assert.match(a.body.temp_password, /^Bf-/);
  const b = await api('POST', '/api/admin/users', { full_name: 'Owner B', email: 'b@test.io' }, S.admin);
  const dup = await api('POST', '/api/admin/users', { full_name: 'Dup', email: 'A@test.io' }, S.admin);
  assert.equal(dup.status, 409);
  S.aId = a.body.user.id; S.bId = b.body.user.id;
  S.a = await loginAndChange('a@test.io', a.body.temp_password, 'OwnerA2026');
  S.b = await loginAndChange('b@test.io', b.body.temp_password, 'OwnerB2026');
  // owners cannot reach admin APIs
  assert.equal((await api('GET', '/api/admin/users', null, S.a)).status, 403);
});

test('property hierarchy + tenant isolation', async () => {
  const bl = await api('POST', '/api/properties/buildings', { name: 'Tower 1' }, S.a);
  const fl = await api('POST', '/api/properties/flats', { building_id: bl.body.id, name: 'Flat 101', kind: 'dormitory' }, S.a);
  const ar = await api('POST', '/api/properties/areas', { flat_id: fl.body.id, name: 'Room A' }, S.a);
  const beds = await api('POST', '/api/properties/beds', { area_id: ar.body.id, count: 3, default_rent: 900 }, S.a);
  assert.equal(beds.body.length, 3);
  assert.deepEqual(beds.body.map((b) => b.label), ['Bed 1', 'Bed 2', 'Bed 3']);
  Object.assign(S, { building: bl.body.id, flat: fl.body.id, area: ar.body.id, beds: beds.body.map((b) => b.id) });

  // Owner B cannot see / attach to / modify Owner A's data
  assert.equal((await api('POST', '/api/properties/flats', { building_id: S.building, name: 'Hack' }, S.b)).status, 404);
  assert.equal((await api('PATCH', `/api/properties/buildings/${S.building}`, { name: 'x' }, S.b)).status, 404);
  assert.equal((await api('DELETE', `/api/properties/beds/${S.beds[0]}`, null, S.b)).status, 404);
  assert.equal((await api('GET', '/api/properties/tree', null, S.b)).body.buildings.length, 0);
  // DB-level guard too: composite FK rejects cross-tenant reference even if app checks were bypassed
  await assert.rejects(pool.query(`INSERT INTO flats (owner_id, building_id, name) VALUES ($1,$2,'x')`, [S.bId, S.building]));

  // Super admin can view, but has no write route into tenant data
  const view = await api('GET', `/api/admin/users/${S.aId}/view`, null, S.admin);
  assert.equal(view.status, 200);
  assert.equal(view.body.properties.length, 3);
  assert.equal((await api('POST', '/api/properties/buildings', { name: 'Admin' }, S.admin)).status, 403);
});

test('assign bed (back-dated) -> overdue receivable appears', async () => {
  const start = addDays(T, -40);
  const r = await api('POST', '/api/assignments', {
    new_client: { full_name: 'Ali Khan', phone: '0500000001' },
    bed_id: S.beds[0], start_date: start, rent_amount: 900, frequency_unit: 'month', deposit_amount: 500,
    rent_collected: 900, deposit_collected: 500, payment_method: 'cash',
  }, S.a);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  S.asg = r.body.id; S.client = r.body.client_id;

  // Second assignment to the same bed must fail
  const dup = await api('POST', '/api/assignments', {
    new_client: { full_name: 'Other' }, bed_id: S.beds[0], start_date: T, rent_amount: 1, frequency_unit: 'day',
  }, S.a);
  assert.equal(dup.status, 409);

  const due = await api('GET', '/api/receivables?tab=due', null, S.a);
  assert.equal(due.body.rows.length, 1, JSON.stringify(due.body));
  const rec = due.body.rows[0];
  assert.equal(rec.kind, 'rent');
  assert.equal(rec.period_start, addMonths(start, 1));
  assert.equal(Number(rec.balance), 900);
  S.rec = rec.id;
  const tree = await api('GET', '/api/properties/tree', null, S.a);
  assert.equal(tree.body.buildings[0].flats[0].areas[0].beds[0].status, 'overdue');
});

test('partial collection keeps balance; write-off closes it', async () => {
  let r = await api('POST', `/api/receivables/${S.rec}/collect`, { amount: 600 }, S.a);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(Number(r.body.receivable.balance), 300);
  assert.equal(r.body.receivable.status, 'open');
  r = await api('POST', `/api/receivables/${S.rec}/write-off`, { amount: 100, reason: 'Goodwill' }, S.a);
  assert.equal(Number(r.body.receivable.amount_written_off), 100);
  r = await api('POST', `/api/receivables/${S.rec}/collect`, { amount: 200 }, S.a);
  assert.equal(r.body.receivable.status, 'paid');
  const due = await api('GET', '/api/receivables?tab=due', null, S.a);
  assert.equal(due.body.rows.length, 0);
});

test('payment reversal reopens the balance', async () => {
  const pays = await api('GET', '/api/payments', null, S.a);
  const last = pays.body.find((p) => Number(p.amount) === 200);
  assert.equal((await api('DELETE', `/api/payments/${last.id}`, null, S.a)).status, 204);
  const due = await api('GET', '/api/receivables?tab=due', null, S.a);
  assert.equal(Number(due.body.rows[0].balance), 200);
  await api('POST', `/api/receivables/${due.body.rows[0].id}/collect`, { amount: 200 }, S.a);
});

test('overpayment pre-pays the next period', async () => {
  const before = await api('GET', `/api/assignments/${S.asg}`, null, S.a);
  const r = await api('POST', `/api/assignments/${S.asg}/collect`, { amount: 1000 }, S.a);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const after = await api('GET', `/api/assignments/${S.asg}`, null, S.a);
  assert.ok(after.body.current_period_end > before.body.current_period_end);
  // 900 pays next period fully, 100 partially pays the one after
  const open = after.body.receivables.filter((x) => x.status === 'open');
  assert.equal(open.length, 1);
  assert.equal(Number(open[0].balance), 800);
});

test('vacate after expiry: pro-rata settlement, deposit deductions, refund', async () => {
  // Fresh tenancy: weekly 700, expired 3 days ago and unpaid since
  const start = addDays(T, -10);
  const r = await api('POST', '/api/assignments', {
    new_client: { full_name: 'Sara Lee' }, bed_id: S.beds[1], start_date: start, expiry_date: addDays(T, -4),
    rent_amount: 700, frequency_unit: 'week', deposit_amount: 1000, rent_collected: 700, deposit_collected: 1000,
  }, S.a);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.id;
  const vacateDate = addDays(T, -1); // stayed 3 days into the unpaid week (T-3..T+3)
  const p = await api('POST', `/api/assignments/${id}/vacate/preview`, { vacate_date: vacateDate }, S.a);
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(p.body.settlement.used_days, 3);
  assert.equal(p.body.settlement.period_days, 7);
  assert.equal(p.body.settlement.prorata_due, 300);
  assert.equal(p.body.deposit_held, 1000);
  // preview must not have side-effects
  const again = await api('POST', `/api/assignments/${id}/vacate/preview`, { vacate_date: vacateDate }, S.a);
  assert.deepEqual(again.body, p.body);

  const v = await api('POST', `/api/assignments/${id}/vacate`, {
    vacate_date: vacateDate, settlement_mode: 'prorata',
    deposit_deductions: [{ label: 'Cleaning', amount: 150 }], deposit_apply_to_dues: 300,
  }, S.a);
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal(v.body.summary.deposit_refunded, 550);
  assert.equal(v.body.summary.balance_left_in_receivables, 0);
  const tree = await api('GET', '/api/properties/tree', null, S.a);
  assert.equal(tree.body.buildings[0].flats[0].areas[0].beds[1].status, 'available');
  // re-vacate blocked
  assert.equal((await api('POST', `/api/assignments/${id}/vacate`, { vacate_date: vacateDate }, S.a)).status, 400);
});

test('vacate with custom settlement left in receivables, then written off', async () => {
  const start = addDays(T, -45);
  const r = await api('POST', '/api/assignments', {
    new_client: { full_name: 'Tom' }, bed_id: S.beds[2], start_date: start, rent_amount: 1000,
    frequency_unit: 'month', deposit_amount: 0, rent_collected: 1000,
  }, S.a);
  const v = await api('POST', `/api/assignments/${r.body.id}/vacate`, {
    vacate_date: T, settlement_mode: 'custom', settlement_custom_amount: 450, collect_amount: 200,
  }, S.a);
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal(v.body.summary.balance_left_in_receivables, 250);
  const due = await api('GET', '/api/receivables?tab=due&q=Tom', null, S.a);
  assert.equal(due.body.rows.length, 1);
  assert.equal(Number(due.body.rows[0].balance), 250);
  // over-collection on a vacated tenancy is rejected (no advance billing)
  assert.equal((await api('POST', `/api/receivables/${due.body.rows[0].id}/collect`, { amount: 999 }, S.a)).status, 400);
  const w = await api('POST', `/api/receivables/${due.body.rows[0].id}/write-off`, { reason: 'Left country' }, S.a);
  assert.equal(w.body.receivable.status, 'written_off');
});

test('expenses with built-in and custom categories', async () => {
  const cats = await api('GET', '/api/expenses/categories', null, S.a);
  assert.ok(cats.body.find((c) => c.name === 'Utilities' && c.is_system));
  const custom = await api('POST', '/api/expenses/categories', { name: 'Laundry' }, S.a);
  assert.equal(custom.status, 201);
  // B cannot see A's custom category
  const bc = await api('GET', '/api/expenses/categories', null, S.b);
  assert.ok(!bc.body.find((c) => c.name === 'Laundry'));
  const e = await api('POST', '/api/expenses', { flat_id: S.flat, category_id: custom.body.id, amount: 120.5, expense_date: T, description: 'Weekly laundry' }, S.a);
  assert.equal(e.status, 201);
  assert.equal((await api('POST', '/api/expenses', { flat_id: S.flat, category_id: custom.body.id, amount: 1, expense_date: T }, S.b)).status, 404);
  const list = await api('GET', `/api/expenses?month=${T.slice(0, 7)}`, null, S.a);
  assert.equal(list.body.total, 120.5);
});

test('dashboard + admin report numbers', async () => {
  const d = await api('GET', '/api/dashboard', null, S.a);
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.equal(Number(d.body.beds.total), 3);
  assert.equal(Number(d.body.beds.occupied), 1);
  assert.equal(Number(d.body.deposits_held), 500);
  const rep = await api('GET', '/api/admin/reports', null, S.admin);
  const a = rep.body.users.find((u) => u.id === S.aId);
  assert.equal(Number(a.beds), 3);
  assert.equal(Number(a.occupied_beds), 1);
  assert.equal(rep.body.totals.users, 2);
});

test('disable blocks access immediately; reset password revokes sessions', async () => {
  await api('PATCH', `/api/admin/users/${S.bId}/status`, { is_active: false }, S.admin);
  assert.equal((await api('GET', '/api/dashboard', null, S.b)).status, 401);
  assert.equal((await api('POST', '/api/auth/login', { email: 'b@test.io', password: 'OwnerB2026' })).status, 403);
  await api('PATCH', `/api/admin/users/${S.bId}/status`, { is_active: true }, S.admin);
  assert.equal((await api('POST', '/api/auth/login', { email: 'b@test.io', password: 'OwnerB2026' })).status, 200);

  const reset = await api('POST', `/api/admin/users/${S.aId}/reset-password`, null, S.admin);
  assert.equal((await api('GET', '/api/dashboard', null, S.a)).status, 401);
  const login = await api('POST', '/api/auth/login', { email: 'a@test.io', password: reset.body.temp_password });
  assert.equal(login.body.user.must_change_password, true);
  assert.equal((await api('GET', '/api/dashboard', null, login.body.token)).status, 403);
});
