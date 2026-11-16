export function money(n, currency = 'AED') {
  const v = Number(n || 0);
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(v);
  } catch {
    return `${currency} ${v.toFixed(2)}`;
  }
}
export const num = (n) => new Intl.NumberFormat().format(Number(n || 0));

export function fmtDate(s) {
  if (!s) return '—';
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
export const fmtDateTime = (s) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
export function addDaysISO(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function addPeriodISO(s, unit, count = 1) {
  const [y, m, d] = s.split('-').map(Number);
  if (unit === 'day') return addDaysISO(s, count);
  if (unit === 'week') return addDaysISO(s, 7 * count);
  const t = new Date(Date.UTC(y, m - 1 + count, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}
export const periodEndISO = (start, unit, count) => addDaysISO(addPeriodISO(start, unit, count), -1);

export function freqLabel(unit, count = 1) {
  const n = Number(count) || 1;
  const names = { day: 'day', week: 'week', month: 'month' };
  return n === 1 ? `per ${names[unit]}` : `every ${n} ${names[unit]}s`;
}
export const bedPath = (r) => [r.building_name, r.flat_name, r.area_name, r.bed_label].filter(Boolean).join(' › ');
export const methods = [
  ['cash', 'Cash'], ['card', 'Card'], ['bank_transfer', 'Bank transfer'], ['cheque', 'Cheque'], ['online', 'Online'], ['other', 'Other'],
];
