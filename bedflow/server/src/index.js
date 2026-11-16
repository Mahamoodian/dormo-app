import { config } from './config.js';
import { createApp } from './app.js';
import { pool, tx } from './db/pool.js';
import { syncOwner } from './services/rentEngine.js';

const app = createApp();
const server = app.listen(config.port, () => console.log(`BedFlow API listening on :${config.port}`));

// Background job: bill newly-started rent periods for every owner (hourly).
async function syncAll() {
  try {
    const { rows } = await pool.query(`SELECT DISTINCT owner_id FROM assignments WHERE status='active'`);
    for (const { owner_id } of rows) await tx((db) => syncOwner(db, owner_id));
  } catch (e) {
    console.error('Rent sync failed', e.message);
  }
}
syncAll();
const timer = setInterval(syncAll, 60 * 60 * 1000);

const shutdown = () => {
  clearInterval(timer);
  server.close(() => pool.end().then(() => process.exit(0)));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
