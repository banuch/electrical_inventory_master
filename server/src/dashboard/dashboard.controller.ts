import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, RequirePermissions, requireScope, scopeIds, type AuthUser } from '../auth/auth-user.js';
import { DbService } from '../db/db.service.js';
import { optionalId, parse } from '../common/validation.js';

@Controller('dashboard')
@RequirePermissions('inventory.view')
export class DashboardController {
  constructor(private readonly db: DbService) {}

  /**
   * Exception-focused dashboard for one substation, or across the user's whole scope when none is given.
   * Quantities of unlike units are never summed.
   */
  @Get()
  async get(@CurrentUser() user: AuthUser, @Query('substationId') sidRaw?: string) {
    const sid = parse(optionalId, sidRaw);
    if (sid) requireScope(user, sid, 'inventory.view');
    const scope: number[] | null = sid ? [sid] : scopeIds(user);
    const p = [scope];

    const cards = await this.db.one(
      `WITH tracked AS (
         SELECT i.id, i.is_critical, COALESCE(b.quantity, 0) AS qty, COALESCE(st.min_level, 0) AS min_level
           FROM inventory_balances b
           FULL JOIN item_substation_settings st ON st.substation_id = b.substation_id AND st.item_id = b.item_id
           JOIN items i ON i.id = COALESCE(b.item_id, st.item_id) AND i.is_active
           JOIN substations s ON s.id = COALESCE(b.substation_id, st.substation_id) AND s.is_active
          WHERE ($1::bigint[] IS NULL OR s.id = ANY($1::bigint[]))
       )
       SELECT count(DISTINCT id) FILTER (WHERE qty > 0) AS active_item_types,
              count(*) FILTER (WHERE min_level > 0 AND qty < min_level) AS low_stock,
              count(*) FILTER (WHERE qty = 0) AS out_of_stock,
              count(*) FILTER (WHERE is_critical AND min_level > 0 AND qty < min_level) AS critical_below_min
         FROM tracked`, p);

    const activity = await this.db.one(
      `SELECT count(*) FILTER (WHERE doc_type = 'RECEIPT') AS receipts_30d,
              count(*) FILTER (WHERE doc_type = 'ISSUE') AS issues_30d,
              count(*) FILTER (WHERE doc_type IN ('ADJUSTMENT', 'SCRAP', 'REVERSAL')) AS exceptions_30d
         FROM stock_documents
        WHERE posted_at > now() - interval '30 days' AND ($1::bigint[] IS NULL OR substation_id = ANY($1::bigint[]))`, p);

    const { rows: recent } = await this.db.query(
      `SELECT d.id, d.doc_number, d.doc_type, d.status, d.posted_at, d.reference_no, s.code AS substation_code,
              u.full_name AS user_name, (SELECT count(*) FROM stock_document_lines l WHERE l.document_id = d.id) AS line_count
         FROM stock_documents d JOIN substations s ON s.id = d.substation_id JOIN users u ON u.id = d.created_by
        WHERE ($1::bigint[] IS NULL OR d.substation_id = ANY($1::bigint[]))
        ORDER BY d.created_at DESC LIMIT 10`, p);

    const { rows: lowStock } = await this.db.query(
      `SELECT i.id AS item_id, i.code, i.name, i.is_critical, u.code AS unit, s.id AS substation_id, s.code AS substation_code,
              COALESCE(b.quantity, 0) AS quantity, st.min_level
         FROM item_substation_settings st
         JOIN items i ON i.id = st.item_id AND i.is_active
         JOIN units u ON u.id = i.unit_id
         JOIN substations s ON s.id = st.substation_id AND s.is_active
         LEFT JOIN inventory_balances b ON b.substation_id = st.substation_id AND b.item_id = st.item_id
        WHERE st.min_level > 0 AND COALESCE(b.quantity, 0) < st.min_level
          AND ($1::bigint[] IS NULL OR st.substation_id = ANY($1::bigint[]))
        ORDER BY i.is_critical DESC, COALESCE(b.quantity, 0) / st.min_level, i.name
        LIMIT 10`, p);

    let organization = null;
    if (!sid && user.orgWide) {
      organization = await this.db.one(
        `SELECT (SELECT count(*) FROM substations WHERE is_active) AS active_substations,
                (SELECT count(*) FROM users WHERE is_active) AS active_users,
                (SELECT count(*) FROM items WHERE is_active) AS active_items,
                (SELECT count(*) FROM substations s WHERE s.is_active AND NOT EXISTS (
                   SELECT 1 FROM inventory_balances b WHERE b.substation_id = s.id AND b.last_txn_at > now() - interval '30 days'))
                  AS stale_substations`);
    }

    return { cards: { ...cards, ...activity }, recent, lowStock, organization };
  }
}
