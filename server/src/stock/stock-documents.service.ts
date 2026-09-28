import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service.js';
import { requireScope, scopeIds, type AuthUser } from '../auth/auth-user.js';
import { notFound } from '../common/errors.js';
import { likeEscape, offset, type Page } from '../common/validation.js';

@Injectable()
export class StockDocumentsService {
  constructor(private readonly db: DbService) {}

  async list(user: AuthUser, f: {
    page: number; pageSize: number; substationId?: number; docType?: string; status?: string;
    from?: string; to?: string; q?: string; itemId?: number;
  }): Promise<Page<any>> {
    if (f.substationId) requireScope(user, f.substationId, 'inventory.view');
    const params: unknown[] = [];
    const where: string[] = [];
    const add = (sql: string, ...vals: unknown[]) => {
      let s = sql;
      for (const v of vals) { params.push(v); s = s.replace('?', `$${params.length}`); }
      where.push(s);
    };
    const scope = scopeIds(user);
    if (scope) add('d.substation_id = ANY(?)', scope);
    if (f.substationId) add('d.substation_id = ?', f.substationId);
    if (f.docType) add('d.doc_type = ?', f.docType);
    if (f.status) add('d.status = ?', f.status);
    if (f.from) add('d.doc_date >= ?::date', f.from);
    if (f.to) add('d.doc_date <= ?::date', f.to);
    if (f.itemId) add('EXISTS (SELECT 1 FROM stock_document_lines l WHERE l.document_id = d.id AND l.item_id = ?)', f.itemId);
    if (f.q) {
      const like = `%${likeEscape(f.q)}%`;
      add('(d.doc_number ILIKE ? OR d.reference_no ILIKE ? OR d.counterparty ILIKE ?)', like, like, like);
    }
    params.push(f.pageSize, offset(f));
    const { rows } = await this.db.query(
      `SELECT d.id, d.doc_number, d.doc_type, d.status, d.doc_date, d.reference_no, d.counterparty,
              d.reason_code, r.name AS reason_name, d.created_at, d.posted_at,
              d.substation_id, s.code AS substation_code, s.name AS substation_name,
              u.full_name AS created_by_name,
              (SELECT count(*) FROM stock_document_lines l WHERE l.document_id = d.id) AS line_count,
              count(*) OVER() AS total
         FROM stock_documents d
         JOIN substations s ON s.id = d.substation_id
         JOIN users u ON u.id = d.created_by
         LEFT JOIN transaction_reasons r ON r.code = d.reason_code
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY d.created_at DESC, d.id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { items: rows.map(({ total, ...r }) => r), total: rows[0]?.total ?? 0, page: f.page, pageSize: f.pageSize };
  }

  async get(user: AuthUser, id: number) {
    const doc = await this.db.one(
      `SELECT d.*, s.code AS substation_code, s.name AS substation_name, r.name AS reason_name,
              cu.full_name AS created_by_name, pu.full_name AS posted_by_name,
              od.doc_number AS reverses_doc_number, rd.doc_number AS reversed_by_doc_number
         FROM stock_documents d
         JOIN substations s ON s.id = d.substation_id
         JOIN users cu ON cu.id = d.created_by
         LEFT JOIN users pu ON pu.id = d.posted_by
         LEFT JOIN transaction_reasons r ON r.code = d.reason_code
         LEFT JOIN stock_documents od ON od.id = d.reverses_document_id
         LEFT JOIN stock_documents rd ON rd.id = d.reversed_by_document_id
        WHERE d.id = $1`, [id]);
    if (!doc) throw notFound('Document');
    requireScope(user, doc.substation_id, 'inventory.view');
    const { rows: lines } = await this.db.query(
      `SELECT l.line_no, l.item_id, i.code AS item_code, i.name AS item_name, u.code AS unit,
              l.quantity, l.remarks, t.balance_before, t.balance_after
         FROM stock_document_lines l
         JOIN items i ON i.id = l.item_id
         JOIN units u ON u.id = i.unit_id
         LEFT JOIN inventory_transactions t ON t.line_id = l.id
        WHERE l.document_id = $1 ORDER BY l.line_no`, [id]);
    const { idempotency_key, ...rest } = doc;
    return { ...rest, lines };
  }

  async reasons(docType?: string) {
    const { rows } = await this.db.query(
      `SELECT code, doc_type, name, requires_reference FROM transaction_reasons
        WHERE is_active AND ($1::text IS NULL OR doc_type = $1) ORDER BY doc_type, name`, [docType ?? null]);
    return rows;
  }
}
