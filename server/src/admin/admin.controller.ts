import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, RequirePermissions, requireScope, scopeIds, type AuthUser } from '../auth/auth-user.js';
import { AuditService } from '../audit/audit.service.js';
import { DbService } from '../db/db.service.js';
import { badRequest } from '../common/errors.js';
import { optionalDate, optionalId, parse } from '../common/validation.js';
import { z } from 'zod';

const MAX_EXPORT_ROWS = 100_000;

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function sendCsv(res: Response, filename: string, columns: [string, string][], rows: any[]) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  const lines = [columns.map(([, h]) => csvCell(h)).join(',')];
  for (const r of rows) lines.push(columns.map(([k]) => csvCell(r[k])).join(','));
  res.send('﻿' + lines.join('\r\n'));
}

@Controller()
export class AdminController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  /** Recalculates balances from the immutable ledger and lists any mismatch with inventory_balances. */
  @RequirePermissions('admin.reconcile')
  @Get('admin/reconciliation')
  async reconcile(@CurrentUser() user: AuthUser) {
    const { rows } = await this.db.query(
      `WITH ledger AS (
         SELECT substation_id, item_id, sum(quantity) AS ledger_qty FROM inventory_transactions GROUP BY 1, 2
       )
       SELECT COALESCE(b.substation_id, l.substation_id) AS substation_id, s.code AS substation_code,
              COALESCE(b.item_id, l.item_id) AS item_id, i.code AS item_code,
              COALESCE(b.quantity, 0) AS balance_qty, COALESCE(l.ledger_qty, 0) AS ledger_qty
         FROM inventory_balances b
         FULL JOIN ledger l ON l.substation_id = b.substation_id AND l.item_id = b.item_id
         JOIN substations s ON s.id = COALESCE(b.substation_id, l.substation_id)
         JOIN items i ON i.id = COALESCE(b.item_id, l.item_id)
        WHERE COALESCE(b.quantity, 0) <> COALESCE(l.ledger_qty, 0)
        ORDER BY 2, 4`);
    const checked = await this.db.one('SELECT count(*) AS n FROM inventory_balances');
    await this.audit.log(this.db, { userId: user.id, action: 'RECONCILIATION_RUN', entityType: 'system', details: { mismatches: rows.length } });
    return { checkedBalances: checked!.n, mismatches: rows, runAt: new Date().toISOString() };
  }

  @RequirePermissions('reports.export', 'inventory.view')
  @Get('reports/current-stock.csv')
  async currentStock(@CurrentUser() user: AuthUser, @Query() query: unknown, @Res() res: Response) {
    const { substationId } = parse(z.object({ substationId: optionalId }), query);
    if (substationId) requireScope(user, substationId);
    const { rows } = await this.db.query(
      `SELECT s.code AS substation_code, s.name AS substation_name, i.code AS item_code, i.name AS item_name,
              c.name AS category, i.specification, i.rating, i.manufacturer, u.code AS unit, b.quantity,
              COALESCE(st.min_level, 0) AS min_level, i.is_critical, b.last_txn_at
         FROM inventory_balances b
         JOIN substations s ON s.id = b.substation_id
         JOIN items i ON i.id = b.item_id
         JOIN item_categories c ON c.id = i.category_id
         JOIN units u ON u.id = i.unit_id
         LEFT JOIN item_substation_settings st ON st.substation_id = b.substation_id AND st.item_id = b.item_id
        WHERE ($1::bigint[] IS NULL OR b.substation_id = ANY($1::bigint[])) AND ($2::bigint IS NULL OR b.substation_id = $2)
        ORDER BY s.code, i.code LIMIT ${MAX_EXPORT_ROWS}`, [scopeIds(user), substationId ?? null]);
    await this.audit.log(this.db, { userId: user.id, action: 'EXPORT_CURRENT_STOCK', entityType: 'report', substationId: substationId ?? null, details: { rows: rows.length } });
    sendCsv(res, 'current-stock.csv', [
      ['substation_code', 'Substation'], ['substation_name', 'Substation Name'], ['item_code', 'Item Code'], ['item_name', 'Item'],
      ['category', 'Category'], ['specification', 'Specification'], ['rating', 'Rating'], ['manufacturer', 'Manufacturer'],
      ['unit', 'Unit'], ['quantity', 'Quantity'], ['min_level', 'Min Level'], ['is_critical', 'Critical'], ['last_txn_at', 'Last Movement'],
    ], rows);
  }

  @RequirePermissions('reports.export', 'inventory.view')
  @Get('reports/transactions.csv')
  async transactions(@CurrentUser() user: AuthUser, @Query() query: unknown, @Res() res: Response) {
    const f = parse(z.object({ substationId: optionalId, itemId: optionalId, from: optionalDate, to: optionalDate }), query);
    if (!f.from || !f.to) throw badRequest('A date range (from, to) is required');
    if (f.substationId) requireScope(user, f.substationId);
    const { rows } = await this.db.query(
      `SELECT t.txn_time, t.doc_date, s.code AS substation_code, d.doc_number, t.txn_type, i.code AS item_code, i.name AS item_name,
              u.code AS unit, t.quantity, t.balance_before, t.balance_after, d.reference_no, d.counterparty, r.name AS reason,
              d.status AS document_status, us.full_name AS user_name
         FROM inventory_transactions t
         JOIN stock_documents d ON d.id = t.document_id
         JOIN substations s ON s.id = t.substation_id
         JOIN items i ON i.id = t.item_id
         JOIN units u ON u.id = i.unit_id
         JOIN users us ON us.id = t.created_by
         LEFT JOIN transaction_reasons r ON r.code = d.reason_code
        WHERE t.doc_date BETWEEN $1::date AND $2::date
          AND ($3::bigint[] IS NULL OR t.substation_id = ANY($3::bigint[]))
          AND ($4::bigint IS NULL OR t.substation_id = $4) AND ($5::bigint IS NULL OR t.item_id = $5)
        ORDER BY t.txn_time, t.id LIMIT ${MAX_EXPORT_ROWS}`,
      [f.from, f.to, scopeIds(user), f.substationId ?? null, f.itemId ?? null]);
    await this.audit.log(this.db, { userId: user.id, action: 'EXPORT_TRANSACTIONS', entityType: 'report', substationId: f.substationId ?? null, details: { ...f, rows: rows.length } });
    sendCsv(res, `transactions-${f.from}-to-${f.to}.csv`, [
      ['txn_time', 'Posted At'], ['doc_date', 'Document Date'], ['substation_code', 'Substation'], ['doc_number', 'Document'],
      ['txn_type', 'Type'], ['item_code', 'Item Code'], ['item_name', 'Item'], ['unit', 'Unit'], ['quantity', 'Quantity'],
      ['balance_before', 'Balance Before'], ['balance_after', 'Balance After'], ['reference_no', 'Reference'],
      ['counterparty', 'Party'], ['reason', 'Reason'], ['document_status', 'Status'], ['user_name', 'User'],
    ], rows);
  }
}
