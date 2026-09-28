import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { hasPermission, requireScope, scopeIds, type AuthUser } from '../auth/auth-user.js';
import { badRequest, notFound } from '../common/errors.js';
import { fractionDigits, isNegative, isQuantity } from '../common/decimal.js';
import { likeEscape, offset, type Page } from '../common/validation.js';

export type StockStatusFilter = 'all' | 'low' | 'out' | 'critical' | 'in_stock';

/** Substations whose quantities the user may see in search / availability views (null = all). */
function visibleSubstations(user: AuthUser): number[] | null {
  return hasPermission(user, 'inventory.global_view') ? null : scopeIds(user);
}

/** Shared SQL for per-balance stock status. Expects aliases b (balance) and st (settings). */
const STATUS_SQL = `CASE
  WHEN COALESCE(b.quantity, 0) = 0 THEN 'OUT'
  WHEN COALESCE(st.min_level, 0) > 0 AND b.quantity < st.min_level THEN 'LOW'
  WHEN COALESCE(st.reorder_level, 0) > 0 AND b.quantity <= st.reorder_level THEN 'REORDER'
  ELSE 'OK' END`;

@Injectable()
export class InventoryService {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  /**
   * Organization-wide search. Ranking: exact code > code prefix > name prefix > all tokens
   * contained > alias > fuzzy (trigram) name. Fuzzy only ranks Item Master records; it never merges items.
   * Totals are always computed from current per-substation balances.
   */
  async search(user: AuthUser, f: {
    q?: string; categoryId?: number; critical?: boolean; availableOnly: boolean;
    manufacturer?: string; rating?: string; page: number; pageSize: number;
  }): Promise<Page<any>> {
    const q = (f.q ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    const tokens = q ? q.split(' ').slice(0, 8).map((t) => `%${likeEscape(t)}%`) : [];
    const params: unknown[] = [q, `${likeEscape(q)}%`, tokens, visibleSubstations(user)];
    const filters: string[] = ['i.is_active'];
    const add = (sql: string, v: unknown) => { params.push(v); filters.push(sql.replaceAll('?', `$${params.length}`)); };
    if (f.categoryId) add('(i.category_id = ? OR c.parent_id = ?)', f.categoryId);
    if (f.critical !== undefined) add('i.is_critical = ?', f.critical);
    if (f.manufacturer) add('i.manufacturer ILIKE ?', `%${likeEscape(f.manufacturer)}%`);
    if (f.rating) add('i.rating ILIKE ?', `%${likeEscape(f.rating)}%`);

    params.push(f.pageSize, offset(f));
    const matchSql = q ? `AND (
        lower(i.code) = $1
        OR lower(i.code) LIKE $2
        OR i.normalized_name % $1
        OR lower(i.code || ' ' || i.name || ' ' || i.specification || ' ' || i.rating || ' ' || i.manufacturer || ' ' || i.model) LIKE ALL ($3::text[])
        OR EXISTS (SELECT 1 FROM item_aliases a WHERE a.item_id = i.id AND lower(a.alias) LIKE ALL ($3::text[])))` : '';

    const { rows } = await this.db.query(
      `WITH matched AS (
         SELECT i.id, i.code, i.name, i.specification, i.rating, i.manufacturer, i.model, i.is_critical,
                c.name AS category_name, u.code AS unit, u.decimal_places,
                CASE WHEN $1 = '' THEN 9
                     WHEN lower(i.code) = $1 THEN 0
                     WHEN lower(i.code) LIKE $2 THEN 1
                     WHEN i.normalized_name LIKE $2 THEN 2
                     WHEN lower(i.code || ' ' || i.name || ' ' || i.specification || ' ' || i.rating || ' ' || i.manufacturer || ' ' || i.model) LIKE ALL ($3::text[]) THEN 3
                     WHEN EXISTS (SELECT 1 FROM item_aliases a WHERE a.item_id = i.id AND lower(a.alias) LIKE ALL ($3::text[])) THEN 4
                     ELSE 5 END AS rank,
                CASE WHEN $1 = '' THEN 0 ELSE similarity(i.normalized_name, $1) END AS sim
           FROM items i
           JOIN item_categories c ON c.id = i.category_id
           JOIN units u ON u.id = i.unit_id
          WHERE ${filters.join(' AND ')} ${matchSql}
       ), agg AS (
         SELECT b.item_id,
                sum(b.quantity) AS total_quantity,
                count(*) FILTER (WHERE b.quantity > 0) AS substations_with_stock,
                max(b.last_txn_at) AS last_movement_at
           FROM inventory_balances b
           JOIN substations s ON s.id = b.substation_id AND s.is_active
          WHERE b.item_id IN (SELECT id FROM matched)
            AND ($4::bigint[] IS NULL OR b.substation_id = ANY($4::bigint[]))
          GROUP BY b.item_id
       ), low AS (
         -- Driven from level settings so substations that have never held the item still count as short.
         SELECT st.item_id, count(*) AS substations_low
           FROM item_substation_settings st
           JOIN substations s ON s.id = st.substation_id AND s.is_active
           LEFT JOIN inventory_balances b ON b.substation_id = st.substation_id AND b.item_id = st.item_id
          WHERE st.item_id IN (SELECT id FROM matched) AND st.min_level > 0
            AND COALESCE(b.quantity, 0) < st.min_level
            AND ($4::bigint[] IS NULL OR st.substation_id = ANY($4::bigint[]))
          GROUP BY st.item_id
       )
       SELECT m.*, COALESCE(a.total_quantity, 0) AS total_quantity,
              COALESCE(a.substations_with_stock, 0) AS substations_with_stock,
              COALESCE(l.substations_low, 0) AS substations_low,
              a.last_movement_at,
              CASE WHEN COALESCE(a.total_quantity, 0) = 0 THEN 'OUT'
                   WHEN COALESCE(l.substations_low, 0) > 0 THEN 'LOW_SOMEWHERE' ELSE 'AVAILABLE' END AS stock_status,
              count(*) OVER() AS total
         FROM matched m LEFT JOIN agg a ON a.item_id = m.id LEFT JOIN low l ON l.item_id = m.id
        ${f.availableOnly ? 'WHERE COALESCE(a.total_quantity, 0) > 0' : ''}
        ORDER BY m.rank, m.sim DESC, m.name
        LIMIT $${params.length - 1} OFFSET $${params.length}`, params);

    return {
      items: rows.map(({ total, rank, sim, decimal_places, ...r }) => r),
      total: rows[0]?.total ?? 0, page: f.page, pageSize: f.pageSize,
    };
  }

  /** Per-substation availability of one item across the substations the user may see. */
  async availability(user: AuthUser, itemId: number, includeZero: boolean) {
    const item = await this.db.one(
      `SELECT i.id, i.code, i.name, i.description, i.specification, i.rating, i.manufacturer, i.model,
              i.is_critical, i.is_active, c.name AS category_name, u.code AS unit, u.name AS unit_name
         FROM items i JOIN item_categories c ON c.id = i.category_id JOIN units u ON u.id = i.unit_id
        WHERE i.id = $1`, [itemId]);
    if (!item) throw notFound('Item');
    const { rows } = await this.db.query(
      `SELECT s.id AS substation_id, s.code AS substation_code, s.name AS substation_name,
              s.contact_name, s.contact_phone,
              COALESCE(b.quantity, 0) AS quantity, b.last_txn_at,
              COALESCE(st.min_level, 0) AS min_level, COALESCE(st.reorder_level, 0) AS reorder_level,
              ${STATUS_SQL} AS status
         FROM substations s
         LEFT JOIN inventory_balances b ON b.substation_id = s.id AND b.item_id = $1
         LEFT JOIN item_substation_settings st ON st.substation_id = s.id AND st.item_id = $1
        WHERE s.is_active
          AND ($2::bigint[] IS NULL OR s.id = ANY($2::bigint[]))
          AND ($3::bool OR COALESCE(b.quantity, 0) > 0)
        ORDER BY COALESCE(b.quantity, 0) DESC, s.code`,
      [itemId, visibleSubstations(user), includeZero]);
    const total = rows.length
      ? (await this.db.one(
        `SELECT COALESCE(sum(b.quantity), 0) AS total FROM inventory_balances b
           JOIN substations s ON s.id = b.substation_id AND s.is_active
          WHERE b.item_id = $1 AND ($2::bigint[] IS NULL OR b.substation_id = ANY($2::bigint[]))`,
        [itemId, visibleSubstations(user)]))!.total
      : '0';
    return { item, totalQuantity: total, substations: rows };
  }

  /** Ledger history for an item, limited to the user's substation scope. */
  async itemTransactions(user: AuthUser, itemId: number, f: { substationId?: number; page: number; pageSize: number }): Promise<Page<any>> {
    if (f.substationId) requireScope(user, f.substationId, 'inventory.view');
    const { rows } = await this.db.query(
      `SELECT t.id, t.txn_time, t.doc_date, t.txn_type, t.quantity, t.balance_before, t.balance_after,
              t.substation_id, s.code AS substation_code, d.id AS document_id, d.doc_number, d.reference_no,
              d.counterparty, d.status AS document_status, u.full_name AS user_name,
              count(*) OVER() AS total
         FROM inventory_transactions t
         JOIN substations s ON s.id = t.substation_id
         JOIN stock_documents d ON d.id = t.document_id
         JOIN users u ON u.id = t.created_by
        WHERE t.item_id = $1
          AND ($2::bigint[] IS NULL OR t.substation_id = ANY($2::bigint[]))
          AND ($3::bigint IS NULL OR t.substation_id = $3)
        ORDER BY t.txn_time DESC, t.id DESC
        LIMIT $4 OFFSET $5`,
      [itemId, scopeIds(user), f.substationId ?? null, f.pageSize, offset(f)]);
    return { items: rows.map(({ total, ...r }) => r), total: rows[0]?.total ?? 0, page: f.page, pageSize: f.pageSize };
  }

  /** "My Substation Inventory": tracked items (balance row or level settings) at one substation. */
  async substationBalances(user: AuthUser, substationId: number, f: {
    q?: string; status: StockStatusFilter; categoryId?: number; page: number; pageSize: number;
  }): Promise<Page<any>> {
    requireScope(user, substationId, 'inventory.view');
    const params: unknown[] = [substationId];
    const filters: string[] = ['(b.item_id IS NOT NULL OR st.item_id IS NOT NULL)'];
    const add = (sql: string, v: unknown) => { params.push(v); filters.push(sql.replaceAll('?', `$${params.length}`)); };
    if (f.q) {
      const like = `%${likeEscape(f.q.trim().toLowerCase())}%`;
      add(`(lower(i.code) LIKE ? OR i.normalized_name LIKE ? OR lower(i.specification || ' ' || i.rating || ' ' || i.manufacturer) LIKE ?)`, like);
    }
    if (f.categoryId) add('(i.category_id = ? OR c.parent_id = ?)', f.categoryId);
    const statusFilter: Record<StockStatusFilter, string> = {
      all: '', in_stock: 'b.quantity > 0', out: 'COALESCE(b.quantity, 0) = 0',
      low: `${STATUS_SQL} IN ('LOW', 'OUT') AND COALESCE(st.min_level, 0) > 0`,
      critical: `i.is_critical AND COALESCE(st.min_level, 0) > 0 AND COALESCE(b.quantity, 0) < st.min_level`,
    };
    if (statusFilter[f.status]) filters.push(statusFilter[f.status]);
    params.push(f.pageSize, offset(f));
    const { rows } = await this.db.query(
      `SELECT i.id AS item_id, i.code, i.name, i.specification, i.rating, i.is_critical, i.is_active,
              c.name AS category_name, u.code AS unit, u.decimal_places,
              COALESCE(b.quantity, 0) AS quantity, b.last_txn_at,
              COALESCE(st.min_level, 0) AS min_level, COALESCE(st.reorder_level, 0) AS reorder_level,
              ${STATUS_SQL} AS status, count(*) OVER() AS total
         FROM items i
         JOIN item_categories c ON c.id = i.category_id
         JOIN units u ON u.id = i.unit_id
         LEFT JOIN inventory_balances b ON b.item_id = i.id AND b.substation_id = $1
         LEFT JOIN item_substation_settings st ON st.item_id = i.id AND st.substation_id = $1
        WHERE ${filters.join(' AND ')}
        ORDER BY CASE ${STATUS_SQL} WHEN 'OUT' THEN 0 WHEN 'LOW' THEN 1 WHEN 'REORDER' THEN 2 ELSE 3 END,
                 i.is_critical DESC, i.name
        LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { items: rows.map(({ total, ...r }) => r), total: rows[0]?.total ?? 0, page: f.page, pageSize: f.pageSize };
  }

  async setLevels(user: AuthUser, substationId: number, itemId: number, minLevel: string, reorderLevel: string, ip: string | null) {
    requireScope(user, substationId, 'stock.min_levels');
    const item = await this.db.one(
      'SELECT i.code, u.decimal_places FROM items i JOIN units u ON u.id = i.unit_id WHERE i.id = $1', [itemId]);
    if (!item) throw notFound('Item');
    for (const [label, v] of [['Minimum level', minLevel], ['Reorder level', reorderLevel]] as const) {
      if (!isQuantity(v) || isNegative(v)) throw badRequest(`${label} must be a non-negative number`);
      if (fractionDigits(v) > item.decimal_places) throw badRequest(`${label} has too many decimal places for this unit`);
    }
    await this.db.tx(async (c) => {
      const { rows: [prev] } = await c.query(
        'SELECT min_level, reorder_level FROM item_substation_settings WHERE substation_id = $1 AND item_id = $2',
        [substationId, itemId]);
      await c.query(
        `INSERT INTO item_substation_settings (substation_id, item_id, min_level, reorder_level, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (substation_id, item_id) DO UPDATE
           SET min_level = EXCLUDED.min_level, reorder_level = EXCLUDED.reorder_level,
               updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [substationId, itemId, minLevel, reorderLevel, user.id]);
      await this.audit.log(c, {
        userId: user.id, action: 'STOCK_LEVELS_SET', entityType: 'item_substation_settings',
        entityId: `${substationId}:${itemId}`, substationId, ip,
        details: { itemCode: item.code, before: prev ?? null, after: { minLevel, reorderLevel } },
      });
    });
  }
}
