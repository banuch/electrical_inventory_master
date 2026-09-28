import { Injectable } from '@nestjs/common';
import type pg from 'pg';
import { DbService } from '../db/db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { requireScope, type AuthUser } from '../auth/auth-user.js';
import type { Permission } from '../auth/permissions.js';
import { badRequest, conflict, notFound, pgCode, pgConstraint, unprocessable } from '../common/errors.js';
import { fractionDigits, isNegative, isQuantity, isZero, negate } from '../common/decimal.js';

export const POSTABLE_TYPES = ['OPENING', 'RECEIPT', 'ISSUE', 'RETURN', 'ADJUSTMENT', 'SCRAP'] as const;
export type PostableType = (typeof POSTABLE_TYPES)[number];
export type DocType = PostableType | 'REVERSAL';

const TYPE_PERMISSION: Record<PostableType, Permission> = {
  OPENING: 'stock.opening',
  RECEIPT: 'stock.receive',
  ISSUE: 'stock.issue',
  RETURN: 'stock.return',
  ADJUSTMENT: 'stock.adjust',
  SCRAP: 'stock.scrap',
};

const PREFIX: Record<DocType, string> = {
  OPENING: 'OPN', RECEIPT: 'RCP', ISSUE: 'ISS', RETURN: 'RTN', ADJUSTMENT: 'ADJ', SCRAP: 'SCR', REVERSAL: 'REV',
};

/** Sign applied to the (positive) entered quantity. ADJUSTMENT lines carry their own sign. */
const DIRECTION: Record<Exclude<PostableType, 'ADJUSTMENT'>, 1 | -1> = {
  OPENING: 1, RECEIPT: 1, RETURN: 1, ISSUE: -1, SCRAP: -1,
};

export interface DocumentInput {
  docType: PostableType;
  substationId: number;
  docDate: string;
  reasonCode?: string;
  referenceNo: string;
  counterparty: string;
  remarks: string;
  idempotencyKey: string;
  lines: { itemId: number; quantity: string; remarks?: string }[];
}

export interface PostResult {
  documentId: number;
  docNumber: string;
  replayed: boolean;
}

interface Movement { lineNo: number; itemId: number; delta: string; remarks: string }

export const MAX_LINES = 200;

@Injectable()
export class StockPostingService {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  async post(user: AuthUser, input: DocumentInput, ip: string | null = null): Promise<PostResult> {
    requireScope(user, input.substationId, TYPE_PERMISSION[input.docType]);

    const existing = await this.findByIdempotencyKey(user, input.idempotencyKey);
    if (existing) return existing;

    const movements = await this.validate(input);

    try {
      return await this.db.tx(async (c) => {
        const sub = await this.activeSubstation(c, input.substationId);
        const docNumber = await this.nextNumber(c, input.docType, sub.code, input.docDate);
        const { rows: [doc] } = await c.query(
          `INSERT INTO stock_documents (doc_number, doc_type, status, substation_id, doc_date, reason_code,
             reference_no, counterparty, remarks, idempotency_key, created_by, posted_by, posted_at)
           VALUES ($1, $2, 'POSTED', $3, $4, $5, $6, $7, $8, $9, $10, $10, now())
           RETURNING id`,
          [docNumber, input.docType, input.substationId, input.docDate, input.reasonCode ?? null,
            input.referenceNo, input.counterparty, input.remarks, input.idempotencyKey, user.id]);

        const ledger = await this.applyMovements(c, {
          documentId: doc.id, substationId: input.substationId, docType: input.docType,
          docDate: input.docDate, userId: user.id, movements,
          beforeApply: input.docType === 'OPENING' ? (ids) => this.assertNoOpeningStock(c, input.substationId, ids) : undefined,
        });

        await this.audit.log(c, {
          userId: user.id, action: `STOCK_${input.docType}_POSTED`, entityType: 'stock_document', entityId: doc.id,
          substationId: input.substationId, ip,
          details: { docNumber, referenceNo: input.referenceNo, reasonCode: input.reasonCode, lines: ledger },
        });
        return { documentId: doc.id, docNumber, replayed: false };
      });
    } catch (err) {
      // A concurrent retry with the same key won the race: return its result instead of failing.
      if (pgCode(err) === '23505' && pgConstraint(err) === 'stock_documents_idempotency_key_key') {
        const replay = await this.findByIdempotencyKey(user, input.idempotencyKey);
        if (replay) return replay;
      }
      throw err;
    }
  }

  /** Posts a linked REVERSAL document that exactly negates a POSTED document, then marks it REVERSED. */
  async reverse(user: AuthUser, documentId: number, opts: { remarks: string; idempotencyKey: string }, ip: string | null = null): Promise<PostResult> {
    const original = await this.db.one('SELECT id, substation_id FROM stock_documents WHERE id = $1', [documentId]);
    if (!original) throw notFound('Document');
    requireScope(user, original.substation_id, 'stock.reverse');
    if (!opts.remarks.trim()) throw badRequest('A reason for the reversal is required');

    const existing = await this.findByIdempotencyKey(user, opts.idempotencyKey);
    if (existing) return existing;

    try {
      return await this.db.tx(async (c) => {
        const { rows: [doc] } = await c.query(
          `SELECT d.*, s.code AS substation_code FROM stock_documents d JOIN substations s ON s.id = d.substation_id
            WHERE d.id = $1 FOR UPDATE OF d`, [documentId]);
        if (doc.status !== 'POSTED') throw conflict(`Document ${doc.doc_number} is ${doc.status} and cannot be reversed`);
        if (doc.doc_type === 'REVERSAL') throw conflict('A reversal cannot itself be reversed; post a new document instead');

        const { rows: lines } = await c.query(
          `SELECT l.line_no, l.item_id, t.quantity FROM stock_document_lines l
             JOIN inventory_transactions t ON t.line_id = l.id
            WHERE l.document_id = $1 ORDER BY l.line_no`, [documentId]);

        const today = (await c.query(`SELECT to_char(current_date, 'YYYY-MM-DD') AS d`)).rows[0].d as string;
        await this.activeSubstation(c, doc.substation_id);
        const docNumber = await this.nextNumber(c, 'REVERSAL', doc.substation_code, today);
        const { rows: [rev] } = await c.query(
          `INSERT INTO stock_documents (doc_number, doc_type, status, substation_id, doc_date, reference_no,
             remarks, idempotency_key, reverses_document_id, created_by, posted_by, posted_at)
           VALUES ($1, 'REVERSAL', 'POSTED', $2, $3, $4, $5, $6, $7, $8, $8, now())
           RETURNING id`,
          [docNumber, doc.substation_id, today, doc.doc_number, opts.remarks.trim(), opts.idempotencyKey, doc.id, user.id]);

        const ledger = await this.applyMovements(c, {
          documentId: rev.id, substationId: doc.substation_id, docType: 'REVERSAL', docDate: today, userId: user.id,
          movements: lines.map((l) => ({ lineNo: l.line_no, itemId: l.item_id, delta: negate(l.quantity), remarks: '' })),
        });

        await c.query(`UPDATE stock_documents SET status = 'REVERSED', reversed_by_document_id = $2 WHERE id = $1`,
          [doc.id, rev.id]);
        await this.audit.log(c, {
          userId: user.id, action: 'STOCK_DOCUMENT_REVERSED', entityType: 'stock_document', entityId: doc.id,
          substationId: doc.substation_id, ip,
          details: { docNumber: doc.doc_number, reversalNumber: docNumber, remarks: opts.remarks, lines: ledger },
        });
        return { documentId: rev.id, docNumber, replayed: false };
      });
    } catch (err) {
      if (pgCode(err) === '23505' && pgConstraint(err) === 'stock_documents_idempotency_key_key') {
        const replay = await this.findByIdempotencyKey(user, opts.idempotencyKey);
        if (replay) return replay;
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------------

  private async findByIdempotencyKey(user: AuthUser, key: string): Promise<PostResult | null> {
    const row = await this.db.one('SELECT id, doc_number, created_by FROM stock_documents WHERE idempotency_key = $1', [key]);
    if (!row) return null;
    if (row.created_by !== user.id) throw conflict('Duplicate submission key');
    return { documentId: row.id, docNumber: row.doc_number, replayed: true };
  }

  /** Stateless validation (before opening a transaction). Returns signed movements. */
  private async validate(input: DocumentInput): Promise<Movement[]> {
    if (!input.lines.length) throw badRequest('At least one item line is required');
    if (input.lines.length > MAX_LINES) throw badRequest(`A document may contain at most ${MAX_LINES} lines`);

    const seen = new Set<number>();
    for (const [i, l] of input.lines.entries()) {
      if (seen.has(l.itemId)) throw badRequest(`Line ${i + 1}: the same item appears more than once`);
      seen.add(l.itemId);
      if (!isQuantity(l.quantity) || isZero(l.quantity)) throw badRequest(`Line ${i + 1}: invalid quantity`);
      if (input.docType !== 'ADJUSTMENT' && isNegative(l.quantity)) {
        throw badRequest(`Line ${i + 1}: quantity must be positive`);
      }
    }

    const future = await this.db.one(`SELECT $1::date > current_date AS future`, [input.docDate]);
    if (future?.future) throw badRequest('Document date cannot be in the future');

    const reasons = (await this.db.query(
      'SELECT code, requires_reference FROM transaction_reasons WHERE doc_type = $1 AND is_active', [input.docType])).rows;
    if (reasons.length) {
      const reason = reasons.find((r) => r.code === input.reasonCode);
      if (!reason) throw badRequest('A valid reason is required for this transaction type');
      if (reason.requires_reference && !input.referenceNo) throw badRequest('A reference number is required for this reason');
    } else if (input.reasonCode) {
      throw badRequest('This transaction type does not take a reason');
    }
    if ((input.docType === 'ADJUSTMENT' || input.docType === 'SCRAP') && (!input.referenceNo || !input.remarks)) {
      throw badRequest('Adjustments and scrap require a supporting reference and remarks');
    }

    const { rows: items } = await this.db.query(
      `SELECT i.id, i.code, i.is_active, u.decimal_places, u.code AS unit
         FROM items i JOIN units u ON u.id = i.unit_id WHERE i.id = ANY($1)`, [[...seen]]);
    const byId = new Map(items.map((r) => [r.id, r]));
    for (const [i, l] of input.lines.entries()) {
      const item = byId.get(l.itemId);
      if (!item) throw badRequest(`Line ${i + 1}: item not found`);
      if (!item.is_active) throw badRequest(`Line ${i + 1}: item ${item.code} is inactive`);
      if (fractionDigits(l.quantity) > item.decimal_places) {
        throw badRequest(`Line ${i + 1}: ${item.code} is measured in ${item.unit}, which allows ${item.decimal_places} decimal place(s)`);
      }
    }

    return input.lines.map((l, i) => ({
      lineNo: i + 1,
      itemId: l.itemId,
      delta: input.docType === 'ADJUSTMENT' || DIRECTION[input.docType] === 1 ? l.quantity : negate(l.quantity),
      remarks: l.remarks?.trim() ?? '',
    }));
  }

  private async activeSubstation(c: pg.PoolClient, substationId: number) {
    const { rows: [sub] } = await c.query('SELECT id, code, is_active FROM substations WHERE id = $1', [substationId]);
    if (!sub) throw notFound('Substation');
    if (!sub.is_active) throw badRequest(`Substation ${sub.code} is inactive`);
    return sub as { id: number; code: string };
  }

  /** Per-substation, per-type, per-year sequence: e.g. RCP-SLP-2026-000042. */
  private async nextNumber(c: pg.PoolClient, type: DocType, substationCode: string, docDate: string): Promise<string> {
    const year = docDate.slice(0, 4);
    const key = `${PREFIX[type]}-${substationCode.toUpperCase()}-${year}`;
    const { rows: [r] } = await c.query(
      `INSERT INTO number_sequences (key, next_value) VALUES ($1, 2)
       ON CONFLICT (key) DO UPDATE SET next_value = number_sequences.next_value + 1
       RETURNING next_value - 1 AS n`, [key]);
    return `${key}-${String(r.n).padStart(6, '0')}`;
  }

  private async assertNoOpeningStock(c: pg.PoolClient, substationId: number, itemIds: number[]) {
    const { rows } = await c.query(
      `SELECT i.code FROM stock_document_lines l
         JOIN stock_documents d ON d.id = l.document_id
         JOIN items i ON i.id = l.item_id
        WHERE d.doc_type = 'OPENING' AND d.status = 'POSTED' AND d.substation_id = $1 AND l.item_id = ANY($2)`,
      [substationId, itemIds]);
    if (rows.length) {
      throw conflict(`Opening stock is already established for: ${rows.map((r) => r.code).join(', ')}. Use an adjustment instead.`);
    }
  }

  /**
   * Core posting pattern: lock balance rows in item-id order (deadlock-safe), validate against
   * the locked quantities, write immutable ledger rows and update balances. Caller owns the transaction.
   */
  private async applyMovements(c: pg.PoolClient, a: {
    documentId: number; substationId: number; docType: DocType; docDate: string; userId: number;
    movements: Movement[]; beforeApply?: (itemIds: number[]) => Promise<void>;
  }) {
    const sorted = [...a.movements].sort((x, y) => x.itemId - y.itemId);
    const itemIds = sorted.map((m) => m.itemId);

    await c.query(
      `INSERT INTO inventory_balances (substation_id, item_id)
       SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING`, [a.substationId, itemIds]);
    const { rows: locked } = await c.query(
      `SELECT b.item_id, b.quantity, i.code, u.code AS unit FROM inventory_balances b
         JOIN items i ON i.id = b.item_id JOIN units u ON u.id = i.unit_id
        WHERE b.substation_id = $1 AND b.item_id = ANY($2)
        ORDER BY b.item_id FOR UPDATE OF b`, [a.substationId, itemIds]);
    const current = new Map(locked.map((r) => [r.item_id, r]));

    await a.beforeApply?.(itemIds);

    const ledger: { itemId: number; code: string; quantity: string; before: string; after: string }[] = [];
    for (const m of sorted) {
      const { rows: [line] } = await c.query(
        `INSERT INTO stock_document_lines (document_id, line_no, item_id, quantity, remarks)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`, [a.documentId, m.lineNo, m.itemId, m.delta, m.remarks]);
      const upd = await c.query(
        `UPDATE inventory_balances
            SET quantity = quantity + $3::numeric, version = version + 1, last_txn_at = now()
          WHERE substation_id = $1 AND item_id = $2 AND quantity + $3::numeric >= 0
          RETURNING quantity - $3::numeric AS before, quantity AS after`,
        [a.substationId, m.itemId, m.delta]);
      if (!upd.rowCount) {
        const bal = current.get(m.itemId);
        throw unprocessable('INSUFFICIENT_STOCK',
          `Insufficient stock for ${bal?.code}: available ${bal?.quantity} ${bal?.unit}, requested ${negate(m.delta)}`,
          { itemId: m.itemId, available: bal?.quantity });
      }
      const { before, after } = upd.rows[0];
      await c.query(
        `INSERT INTO inventory_transactions (document_id, line_id, substation_id, item_id, txn_type, quantity,
           balance_before, balance_after, doc_date, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [a.documentId, line.id, a.substationId, m.itemId, a.docType, m.delta, before, after, a.docDate, a.userId]);
      ledger.push({ itemId: m.itemId, code: current.get(m.itemId)?.code, quantity: m.delta, before, after });
    }
    return ledger;
  }
}
