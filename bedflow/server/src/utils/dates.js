// Pure date helpers operating on 'YYYY-MM-DD' strings in UTC (no DST surprises).
import { config } from '../config.js';

const DAY = 86_400_000;
const toUTC = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUTC = (t) => new Date(t).toISOString().slice(0, 10);

export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fromUTC(toUTC(s)) === s;

/** Business "today" in the configured timezone. */
export function today(tz = config.timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export const addDays = (s, n) => fromUTC(toUTC(s) + n * DAY);

export function addMonths(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return fromUTC(target.getTime());
}

/** Start date + one billing period (exclusive end). */
export function addPeriod(s, unit, count = 1) {
  if (unit === 'day') return addDays(s, count);
  if (unit === 'week') return addDays(s, 7 * count);
  if (unit === 'month') return addMonths(s, count);
  throw new Error(`Unknown frequency unit ${unit}`);
}

/** Inclusive end date of a period that starts on `start`. */
export const periodEnd = (start, unit, count) => addDays(addPeriod(start, unit, count), -1);

/** Number of days between two dates, inclusive of both. */
export const daysInclusive = (a, b) => Math.round((toUTC(b) - toUTC(a)) / DAY) + 1;

/** Days from a to b (b - a). */
export const diffDays = (a, b) => Math.round((toUTC(b) - toUTC(a)) / DAY);

export function monthRange(ym) {
  const start = `${ym}-01`;
  return { start, end: addDays(addMonths(start, 1), -1) };
}
