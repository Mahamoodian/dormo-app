import { z } from 'zod';
import { isDate } from '../utils/dates.js';

export const zDate = z.string().refine(isDate, 'must be a valid date (YYYY-MM-DD)');
export const zMoney = z.coerce.number().finite().min(0).max(100_000_000).transform((n) => Math.round(n * 100) / 100);
export const zPositiveMoney = zMoney.refine((n) => n > 0, 'must be greater than 0');
export const zUuid = z.string().uuid();
export const zOptText = (max = 500) =>
  z.string().trim().max(max).optional().nullable().transform((v) => (v === '' || v === undefined ? null : v));
export const zMethod = z.enum(['cash', 'card', 'bank_transfer', 'cheque', 'online', 'other']).default('cash');

export const parse = (schema, data) => schema.parse(data ?? {});
