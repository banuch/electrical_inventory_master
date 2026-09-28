import { Injectable } from '@nestjs/common';
import { DbService, type Queryable } from '../db/db.service.js';
import type { AuthUser } from '../auth/auth-user.js';
import { offset, type Page } from '../common/validation.js';

export interface AuditEntry {
  userId: number | null;
  action: string;
  entityType: string;
  entityId?: string | number | null;
  substationId?: number | null;
  details?: Record<string, unknown>;
  ip?: string | null;
}

const SECRET_KEYS = /password|token|secret|hash/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SECRET_KEYS.test(k) ? '[REDACTED]' : redact(v)]),
    );
  }
  return value;
}

@Injectable()
export class AuditService {
  constructor(private readonly db: DbService) {}

  /** Pass the transaction client so the audit row commits/rolls back with the change it describes. */
  async log(q: Queryable, e: AuditEntry): Promise<void> {
    await q.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, substation_id, details, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [e.userId, e.action, e.entityType, e.entityId == null ? null : String(e.entityId),
        e.substationId ?? null, JSON.stringify(redact(e.details ?? {})), e.ip ?? null],
    );
  }

  async list(user: AuthUser, f: {
    page: number; pageSize: number; userId?: number; entityType?: string; entityId?: string;
    action?: string; substationId?: number; from?: string; to?: string;
  }): Promise<Page<any>> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
    if (!user.orgWide) add('a.substation_id = ANY(?)', user.substationIds);
    if (f.userId) add('a.user_id = ?', f.userId);
    if (f.entityType) add('a.entity_type = ?', f.entityType);
    if (f.entityId) add('a.entity_id = ?', f.entityId);
    if (f.action) add('a.action = ?', f.action);
    if (f.substationId) add('a.substation_id = ?', f.substationId);
    if (f.from) add('a.occurred_at >= ?::date', f.from);
    if (f.to) add(`a.occurred_at < ?::date + 1`, f.to);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(f.pageSize, offset(f));
    const { rows } = await this.db.query(
      `SELECT a.id, a.occurred_at, a.action, a.entity_type, a.entity_id, a.details, a.ip,
              a.user_id, u.username, u.full_name, a.substation_id, s.code AS substation_code,
              count(*) OVER() AS total
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id
         LEFT JOIN substations s ON s.id = a.substation_id
         ${whereSql}
        ORDER BY a.occurred_at DESC, a.id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: rows.map(({ total, ...r }) => r), total: rows[0]?.total ?? 0, page: f.page, pageSize: f.pageSize };
  }

  async loginHistory(f: { page: number; pageSize: number; userId?: number; success?: boolean }): Promise<Page<any>> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (f.userId) { params.push(f.userId); where.push(`l.user_id = $${params.length}`); }
    if (f.success !== undefined) { params.push(f.success); where.push(`l.success = $${params.length}`); }
    params.push(f.pageSize, offset(f));
    const { rows } = await this.db.query(
      `SELECT l.*, count(*) OVER() AS total FROM login_history l
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY l.occurred_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: rows.map(({ total, ...r }) => r), total: rows[0]?.total ?? 0, page: f.page, pageSize: f.pageSize };
  }
}
