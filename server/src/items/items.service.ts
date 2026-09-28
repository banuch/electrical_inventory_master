import { Injectable } from '@nestjs/common';
import { DbService, type Queryable } from '../db/db.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth-user.js';
import { badRequest, conflict, notFound, pgCode } from '../common/errors.js';
import { likeEscape, offset, type Page } from '../common/validation.js';

export function normalizeName(name: string): string {
  return name.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}.\/+%-]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

export interface ItemInput {
  code: string; name: string; description: string; categoryId: number; unitId: number;
  specification: string; rating: string; manufacturer: string; model: string;
  isCritical: boolean; isActive: boolean; aliases: string[];
}

const ITEM_FIELDS = `i.id, i.code, i.name, i.description, i.category_id, c.name AS category_name, c.parent_id AS category_parent_id,
  i.unit_id, u.code AS unit, u.decimal_places, i.specification, i.rating, i.manufacturer, i.model,
  i.is_critical, i.is_active, i.created_at, i.updated_at,
  COALESCE((SELECT array_agg(a.alias ORDER BY a.alias) FROM item_aliases a WHERE a.item_id = i.id), '{}') AS aliases`;

@Injectable()
export class ItemsService {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  async list(f: { q?: string; categoryId?: number; active?: boolean; page: number; pageSize: number }): Promise<Page<any>> {
    const params: unknown[] = [];
    const where: string[] = [];
    const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replaceAll('?', `$${params.length}`)); };
    if (f.q) add(`(lower(i.code) LIKE ? OR i.normalized_name LIKE ? OR lower(i.specification || ' ' || i.rating || ' ' || i.manufacturer || ' ' || i.model) LIKE ?)`,
      `%${likeEscape(f.q.trim().toLowerCase())}%`);
    if (f.categoryId) add('(i.category_id = ? OR c.parent_id = ?)', f.categoryId);
    if (f.active !== undefined) add('i.is_active = ?', f.active);
    params.push(f.pageSize, offset(f));
    const { rows } = await this.db.query(
      `SELECT ${ITEM_FIELDS}, count(*) OVER() AS total
         FROM items i JOIN item_categories c ON c.id = i.category_id JOIN units u ON u.id = i.unit_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY i.code LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { items: rows.map(({ total, ...r }) => r), total: rows[0]?.total ?? 0, page: f.page, pageSize: f.pageSize };
  }

  async get(id: number) {
    const row = await this.db.one(
      `SELECT ${ITEM_FIELDS} FROM items i JOIN item_categories c ON c.id = i.category_id JOIN units u ON u.id = i.unit_id
        WHERE i.id = $1`, [id]);
    if (!row) throw notFound('Item');
    return row;
  }

  /** Possible duplicates for the create form: same code, or similar normalized names. */
  async similar(name: string, code?: string, excludeId?: number) {
    const { rows } = await this.db.query(
      `SELECT i.id, i.code, i.name, i.specification, i.rating, i.is_active,
              round(similarity(i.normalized_name, $1)::numeric, 2) AS score
         FROM items i
        WHERE (i.normalized_name % $1 OR upper(i.code) = upper($2))
          AND ($3::bigint IS NULL OR i.id <> $3)
        ORDER BY upper(i.code) = upper($2) DESC, similarity(i.normalized_name, $1) DESC
        LIMIT 8`, [normalizeName(name), code ?? '', excludeId ?? null]);
    return rows;
  }

  async create(user: AuthUser, input: ItemInput, ip: string | null) {
    await this.checkRefs(input);
    const normalized = normalizeName(input.name);
    await this.assertNoExactDuplicate(normalized, input.specification, input.rating);
    try {
      return await this.db.tx(async (c) => {
        const { rows: [row] } = await c.query(
          `INSERT INTO items (code, name, normalized_name, description, category_id, unit_id, specification, rating,
             manufacturer, model, is_critical, is_active, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
          [input.code.toUpperCase(), input.name, normalized, input.description, input.categoryId, input.unitId,
            input.specification, input.rating, input.manufacturer, input.model, input.isCritical, input.isActive, user.id]);
        await this.replaceAliases(c, row.id, input.aliases);
        await this.audit.log(c, { userId: user.id, action: 'ITEM_CREATED', entityType: 'item', entityId: row.id, ip, details: { ...input } });
        return { id: row.id };
      });
    } catch (err) {
      if (pgCode(err) === '23505') throw conflict(`Item code ${input.code.toUpperCase()} already exists`);
      throw err;
    }
  }

  async update(user: AuthUser, id: number, input: ItemInput, ip: string | null) {
    const before = await this.get(id);
    await this.checkRefs(input);
    const normalized = normalizeName(input.name);
    await this.assertNoExactDuplicate(normalized, input.specification, input.rating, id);
    if (before.unit_id !== input.unitId) {
      const used = await this.db.one('SELECT 1 FROM inventory_transactions WHERE item_id = $1 LIMIT 1', [id]);
      if (used) throw conflict('The unit cannot be changed after stock has been posted for this item');
    }
    try {
      await this.db.tx(async (c) => {
        await c.query(
          `UPDATE items SET code = $2, name = $3, normalized_name = $4, description = $5, category_id = $6, unit_id = $7,
             specification = $8, rating = $9, manufacturer = $10, model = $11, is_critical = $12, is_active = $13,
             updated_at = now()
           WHERE id = $1`,
          [id, input.code.toUpperCase(), input.name, normalized, input.description, input.categoryId, input.unitId,
            input.specification, input.rating, input.manufacturer, input.model, input.isCritical, input.isActive]);
        await this.replaceAliases(c, id, input.aliases);
        await this.audit.log(c, { userId: user.id, action: 'ITEM_UPDATED', entityType: 'item', entityId: id, ip, details: { before, after: input } });
      });
    } catch (err) {
      if (pgCode(err) === '23505') throw conflict(`Item code ${input.code.toUpperCase()} already exists`);
      throw err;
    }
    return { id };
  }

  private async checkRefs(input: ItemInput) {
    const cat = await this.db.one('SELECT is_active FROM item_categories WHERE id = $1', [input.categoryId]);
    if (!cat?.is_active) throw badRequest('Category not found or inactive');
    const unit = await this.db.one('SELECT is_active FROM units WHERE id = $1', [input.unitId]);
    if (!unit?.is_active) throw badRequest('Unit not found or inactive');
  }

  /** Same normalized name + specification + rating is treated as a duplicate technical item. */
  private async assertNoExactDuplicate(normalized: string, spec: string, rating: string, excludeId?: number) {
    const dup = await this.db.one(
      `SELECT code FROM items WHERE normalized_name = $1 AND lower(specification) = lower($2) AND lower(rating) = lower($3)
          AND ($4::bigint IS NULL OR id <> $4)`, [normalized, spec, rating, excludeId ?? null]);
    if (dup) throw conflict(`An item with the same name, specification and rating already exists (${dup.code})`);
  }

  private async replaceAliases(c: Queryable, itemId: number, aliases: string[]) {
    const clean = [...new Set(aliases.map((a) => a.trim()).filter(Boolean).map((a) => a.slice(0, 200)))];
    await c.query('DELETE FROM item_aliases WHERE item_id = $1', [itemId]);
    if (clean.length) {
      await c.query('INSERT INTO item_aliases (item_id, alias) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING', [itemId, clean]);
    }
  }

  // ---- categories & units -----------------------------------------------------------

  async categories() {
    const { rows } = await this.db.query(
      `SELECT c.id, c.code, c.name, c.parent_id, p.name AS parent_name, c.is_active,
              (SELECT count(*) FROM items i WHERE i.category_id = c.id) AS item_count
         FROM item_categories c LEFT JOIN item_categories p ON p.id = c.parent_id
        ORDER BY COALESCE(p.name, c.name), c.parent_id NULLS FIRST, c.name`);
    return rows;
  }

  async saveCategory(user: AuthUser, id: number | null, input: { code: string; name: string; parentId?: number; isActive: boolean }, ip: string | null) {
    if (input.parentId) {
      const parent = await this.db.one('SELECT parent_id FROM item_categories WHERE id = $1', [input.parentId]);
      if (!parent) throw badRequest('Parent category not found');
      if (parent.parent_id) throw badRequest('Subcategories can only be one level deep');
      if (id && input.parentId === id) throw badRequest('A category cannot be its own parent');
    }
    try {
      return await this.db.tx(async (c) => {
        const { rows: [row] } = id
          ? await c.query(`UPDATE item_categories SET code = $2, name = $3, parent_id = $4, is_active = $5 WHERE id = $1 RETURNING id`,
            [id, input.code.toUpperCase(), input.name, input.parentId ?? null, input.isActive])
          : await c.query(`INSERT INTO item_categories (code, name, parent_id, is_active) VALUES ($1, $2, $3, $4) RETURNING id`,
            [input.code.toUpperCase(), input.name, input.parentId ?? null, input.isActive]);
        if (!row) throw notFound('Category');
        await this.audit.log(c, { userId: user.id, action: id ? 'CATEGORY_UPDATED' : 'CATEGORY_CREATED', entityType: 'item_category', entityId: row.id, ip, details: input });
        return { id: row.id };
      });
    } catch (err) {
      if (pgCode(err) === '23505') throw conflict(`Category code ${input.code.toUpperCase()} already exists`);
      throw err;
    }
  }

  async units() {
    const { rows } = await this.db.query('SELECT id, code, name, decimal_places, is_active FROM units ORDER BY code');
    return rows;
  }

  async saveUnit(user: AuthUser, id: number | null, input: { code: string; name: string; decimalPlaces: number; isActive: boolean }, ip: string | null) {
    if (id) {
      const cur = await this.db.one('SELECT decimal_places FROM units WHERE id = $1', [id]);
      if (!cur) throw notFound('Unit');
      if (input.decimalPlaces < cur.decimal_places) {
        const used = await this.db.one(
          'SELECT 1 FROM inventory_transactions t JOIN items i ON i.id = t.item_id WHERE i.unit_id = $1 LIMIT 1', [id]);
        if (used) throw conflict('Decimal precision cannot be reduced once stock has been posted in this unit');
      }
    }
    try {
      return await this.db.tx(async (c) => {
        const { rows: [row] } = id
          ? await c.query('UPDATE units SET code = $2, name = $3, decimal_places = $4, is_active = $5 WHERE id = $1 RETURNING id',
            [id, input.code.toUpperCase(), input.name, input.decimalPlaces, input.isActive])
          : await c.query('INSERT INTO units (code, name, decimal_places, is_active) VALUES ($1, $2, $3, $4) RETURNING id',
            [input.code.toUpperCase(), input.name, input.decimalPlaces, input.isActive]);
        await this.audit.log(c, { userId: user.id, action: id ? 'UNIT_UPDATED' : 'UNIT_CREATED', entityType: 'unit', entityId: row.id, ip, details: input });
        return { id: row.id };
      });
    } catch (err) {
      if (pgCode(err) === '23505') throw conflict(`Unit code ${input.code.toUpperCase()} already exists`);
      throw err;
    }
  }
}
