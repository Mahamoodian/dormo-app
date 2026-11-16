// Building -> Flat/Dormitory -> Area -> Bed hierarchy. All queries are owner-scoped.
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { ah, notFound, badRequest } from '../utils/http.js';
import { parse, zUuid, zOptText, zMoney } from '../middleware/validate.js';
import { today } from '../utils/dates.js';

const r = Router();

async function ensureOwned(table, id, ownerId, label) {
  parse(zUuid, id);
  const { rows } = await query(`SELECT * FROM ${table} WHERE id=$1 AND owner_id=$2`, [id, ownerId]);
  if (!rows[0]) throw notFound(`${label} not found`);
  return rows[0];
}

function updateBuilder(data) {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined);
  if (!keys.length) throw badRequest('Nothing to update');
  return { sets: keys.map((k, i) => `${k}=$${i + 3}`).join(', '), values: keys.map((k) => data[k]) };
}

// ---------- Full tree with live bed status (used by Properties + Beds board)
r.get('/tree', ah(async (req, res) => {
  const t = today();
  const [b, f, a, beds] = await Promise.all([
    query('SELECT * FROM buildings WHERE owner_id=$1 ORDER BY name', [req.ownerId]),
    query('SELECT * FROM flats WHERE owner_id=$1 ORDER BY name', [req.ownerId]),
    query('SELECT * FROM areas WHERE owner_id=$1 ORDER BY name', [req.ownerId]),
    query(
      `SELECT bd.*, a.id AS assignment_id, a.client_id, c.full_name AS client_name, c.phone AS client_phone,
              a.rent_amount, a.frequency_unit, a.frequency_count, a.current_period_end, a.start_date,
              COALESCE(o.balance,0) AS overdue_balance
       FROM beds bd
       LEFT JOIN assignments a ON a.bed_id=bd.id AND a.status='active'
       LEFT JOIN clients c ON c.id=a.client_id
       LEFT JOIN LATERAL (
         SELECT SUM(amount_due-amount_paid-amount_written_off) AS balance FROM receivables
         WHERE assignment_id=a.id AND status='open' AND due_date <= $2
       ) o ON TRUE
       WHERE bd.owner_id=$1 ORDER BY bd.label`,
      [req.ownerId, t],
    ),
  ]);
  const bedStatus = (bd) =>
    bd.assignment_id ? (Number(bd.overdue_balance) > 0 ? 'overdue' : 'occupied') : bd.in_service ? 'available' : 'maintenance';
  const tree = b.rows.map((bl) => ({
    ...bl,
    flats: f.rows.filter((x) => x.building_id === bl.id).map((fl) => ({
      ...fl,
      areas: a.rows.filter((x) => x.flat_id === fl.id).map((ar) => ({
        ...ar,
        beds: beds.rows.filter((x) => x.area_id === ar.id).map((bd) => ({ ...bd, status: bedStatus(bd) })),
      })),
    })),
  }));
  res.json({ buildings: tree, today: t });
}));

// ---------- Buildings
const buildingSchema = z.object({ name: z.string().trim().min(1).max(120), address: zOptText(300), notes: zOptText(1000) });

r.post('/buildings', ah(async (req, res) => {
  const d = parse(buildingSchema, req.body);
  const { rows } = await query(
    'INSERT INTO buildings (owner_id, name, address, notes) VALUES ($1,$2,$3,$4) RETURNING *',
    [req.ownerId, d.name, d.address, d.notes],
  );
  res.status(201).json(rows[0]);
}));
r.patch('/buildings/:id', ah(async (req, res) => {
  await ensureOwned('buildings', req.params.id, req.ownerId, 'Building');
  const { sets, values } = updateBuilder(parse(buildingSchema.partial(), req.body));
  const { rows } = await query(`UPDATE buildings SET ${sets} WHERE id=$1 AND owner_id=$2 RETURNING *`, [req.params.id, req.ownerId, ...values]);
  res.json(rows[0]);
}));
r.delete('/buildings/:id', ah(async (req, res) => {
  await ensureOwned('buildings', req.params.id, req.ownerId, 'Building');
  await query('DELETE FROM buildings WHERE id=$1 AND owner_id=$2', [req.params.id, req.ownerId]);
  res.status(204).end();
}));

// ---------- Flats / Dormitories
const flatSchema = z.object({
  building_id: zUuid,
  name: z.string().trim().min(1).max(120),
  kind: z.enum(['flat', 'dormitory']).default('flat'),
  notes: zOptText(1000),
});
r.get('/flats', ah(async (req, res) => {
  const { rows } = await query(
    `SELECT f.*, b.name AS building_name FROM flats f JOIN buildings b ON b.id=f.building_id
     WHERE f.owner_id=$1 ORDER BY b.name, f.name`, [req.ownerId]);
  res.json(rows);
}));
r.post('/flats', ah(async (req, res) => {
  const d = parse(flatSchema, req.body);
  await ensureOwned('buildings', d.building_id, req.ownerId, 'Building');
  const { rows } = await query(
    'INSERT INTO flats (owner_id, building_id, name, kind, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [req.ownerId, d.building_id, d.name, d.kind, d.notes],
  );
  res.status(201).json(rows[0]);
}));
r.patch('/flats/:id', ah(async (req, res) => {
  await ensureOwned('flats', req.params.id, req.ownerId, 'Flat');
  const d = parse(flatSchema.omit({ building_id: true }).partial(), req.body);
  const { sets, values } = updateBuilder(d);
  const { rows } = await query(`UPDATE flats SET ${sets} WHERE id=$1 AND owner_id=$2 RETURNING *`, [req.params.id, req.ownerId, ...values]);
  res.json(rows[0]);
}));
r.delete('/flats/:id', ah(async (req, res) => {
  await ensureOwned('flats', req.params.id, req.ownerId, 'Flat');
  await query('DELETE FROM flats WHERE id=$1 AND owner_id=$2', [req.params.id, req.ownerId]);
  res.status(204).end();
}));

// ---------- Areas
const areaSchema = z.object({ flat_id: zUuid, name: z.string().trim().min(1).max(120) });
r.post('/areas', ah(async (req, res) => {
  const d = parse(areaSchema, req.body);
  await ensureOwned('flats', d.flat_id, req.ownerId, 'Flat');
  const { rows } = await query('INSERT INTO areas (owner_id, flat_id, name) VALUES ($1,$2,$3) RETURNING *', [req.ownerId, d.flat_id, d.name]);
  res.status(201).json(rows[0]);
}));
r.patch('/areas/:id', ah(async (req, res) => {
  await ensureOwned('areas', req.params.id, req.ownerId, 'Area');
  const { sets, values } = updateBuilder(parse(areaSchema.omit({ flat_id: true }).partial(), req.body));
  const { rows } = await query(`UPDATE areas SET ${sets} WHERE id=$1 AND owner_id=$2 RETURNING *`, [req.params.id, req.ownerId, ...values]);
  res.json(rows[0]);
}));
r.delete('/areas/:id', ah(async (req, res) => {
  await ensureOwned('areas', req.params.id, req.ownerId, 'Area');
  await query('DELETE FROM areas WHERE id=$1 AND owner_id=$2', [req.params.id, req.ownerId]);
  res.status(204).end();
}));

// ---------- Beds (single or bulk)
const bedSchema = z.object({
  area_id: zUuid,
  label: z.string().trim().min(1).max(60).optional(),
  count: z.coerce.number().int().min(1).max(100).default(1),
  prefix: z.string().trim().max(40).default('Bed'),
  default_rent: zMoney.optional().nullable(),
});
r.post('/beds', ah(async (req, res) => {
  const d = parse(bedSchema, req.body);
  await ensureOwned('areas', d.area_id, req.ownerId, 'Area');
  const labels = [];
  if (d.count === 1 && d.label) labels.push(d.label);
  else {
    const { rows } = await query('SELECT count(*) AS n FROM beds WHERE area_id=$1 AND owner_id=$2', [d.area_id, req.ownerId]);
    const start = Number(rows[0].n) + 1;
    for (let i = 0; i < d.count; i++) labels.push(`${d.prefix} ${start + i}`);
  }
  const { rows } = await query(
    `INSERT INTO beds (owner_id, area_id, label, default_rent)
     SELECT $1, $2, l, $4 FROM unnest($3::text[]) AS l RETURNING *`,
    [req.ownerId, d.area_id, labels, d.default_rent ?? null],
  );
  res.status(201).json(rows);
}));
r.patch('/beds/:id', ah(async (req, res) => {
  await ensureOwned('beds', req.params.id, req.ownerId, 'Bed');
  const d = parse(z.object({
    label: z.string().trim().min(1).max(60).optional(),
    default_rent: zMoney.optional().nullable(),
    in_service: z.boolean().optional(),
  }), req.body);
  const { sets, values } = updateBuilder(d);
  const { rows } = await query(`UPDATE beds SET ${sets} WHERE id=$1 AND owner_id=$2 RETURNING *`, [req.params.id, req.ownerId, ...values]);
  res.json(rows[0]);
}));
r.delete('/beds/:id', ah(async (req, res) => {
  await ensureOwned('beds', req.params.id, req.ownerId, 'Bed');
  await query('DELETE FROM beds WHERE id=$1 AND owner_id=$2', [req.params.id, req.ownerId]);
  res.status(204).end();
}));

export default r;
