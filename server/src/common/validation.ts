import { z } from 'zod';
import { badRequest } from './errors.js';

export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw badRequest('Validation failed', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return r.data;
}

const blankToUndefined = (v: unknown) => (v === '' || v === undefined || v === null ? undefined : v);

export const id = z.coerce.number().int().positive();
export const optionalId = z.preprocess(blankToUndefined, id.optional());
export const boolQuery = z.preprocess(
  (v) => (v === undefined || v === '' ? undefined : v === true || v === 'true' || v === '1'),
  z.boolean().optional(),
);
export const text = (max = 200) => z.string().trim().max(max);
export const reqText = (max = 200) => z.string().trim().min(1, 'Required').max(max);
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export const optionalDate = z.preprocess(blankToUndefined, isoDate.optional());
export const optionalText = (max = 200) => z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
export const offset = (p: { page: number; pageSize: number }) => (p.page - 1) * p.pageSize;

/** Escape LIKE wildcards in user input. */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
