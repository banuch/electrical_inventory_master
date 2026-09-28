import { randomUUID } from 'node:crypto';
import { DbService } from '../src/db/db.service.js';
import { migrate } from '../src/db/migrate.js';
import { seedBase } from '../src/db/seed.js';
import { AuditService } from '../src/audit/audit.service.js';
import { StockPostingService, type DocumentInput } from '../src/stock/stock-posting.service.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { DEFAULT_ROLES, type Permission } from '../src/auth/permissions.js';
import type { AuthUser } from '../src/auth/auth-user.js';
import { config } from '../src/config.js';

export const TEST_DB_URL = process.env.DATABASE_URL_TEST ?? `${config.databaseUrl}_test`;
export const ADMIN_PASSWORD = 'Test!Admin-Pass1';

/** Fresh schema + base seed in the dedicated *_test database. */
export async function resetDb(): Promise<DbService> {
  const db = new DbService(TEST_DB_URL);
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(db.pool, () => {});
  await seedBase(db, { adminUsername: 'superadmin', adminPassword: ADMIN_PASSWORD });
  return db;
}

export function services(db: DbService) {
  const audit = new AuditService(db);
  return { audit, posting: new StockPostingService(db, audit), inventory: new InventoryService(db, audit) };
}

export async function makeSubstation(db: DbService, code: string) {
  return (await db.one('INSERT INTO substations (code, name) VALUES ($1, $2) RETURNING id', [code, `Substation ${code}`]))!.id as number;
}

export async function makeItem(db: DbService, code: string, unit = 'NOS') {
  return (await db.one(
    `INSERT INTO items (code, name, normalized_name, category_id, unit_id)
     VALUES ($1, $2, lower($2), (SELECT id FROM item_categories WHERE code = 'CONS'), (SELECT id FROM units WHERE code = $3))
     RETURNING id`, [code, `Test item ${code}`, unit]))!.id as number;
}

/** In-memory AuthUser backed by a real users row (FKs need it). */
export async function makeUser(db: DbService, username: string, role: string, opts: { orgWide?: boolean; substationIds?: number[] } = {}): Promise<AuthUser> {
  const { id } = (await db.one(
    `INSERT INTO users (username, full_name, password_hash, org_wide, must_change_password) VALUES ($1, $1, 'x', $2, false) RETURNING id`,
    [username, opts.orgWide ?? false]))!;
  await db.query('INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = $2', [id, role]);
  for (const s of opts.substationIds ?? []) await db.query('INSERT INTO user_substation_assignments VALUES ($1, $2)', [id, s]);
  return {
    id, username, fullName: username, orgWide: opts.orgWide ?? false, mustChangePassword: false,
    permissions: new Set(DEFAULT_ROLES.find((r) => r.code === role)!.permissions as Permission[]),
    substationIds: opts.substationIds ?? [], sessionId: 'test', csrfToken: 'test',
  };
}

export const today = () => new Date().toISOString().slice(0, 10);

export function doc(substationId: number, docType: DocumentInput['docType'], lines: [number, string][], extra: Partial<DocumentInput> = {}): DocumentInput {
  const defaults: Partial<Record<DocumentInput['docType'], Partial<DocumentInput>>> = {
    RECEIPT: { reasonCode: 'RCV_PURCHASE', referenceNo: 'PO-1' },
    ISSUE: { reasonCode: 'ISS_CONSUMPTION' },
    RETURN: { reasonCode: 'RTN_RECOVERED' },
    ADJUSTMENT: { reasonCode: 'ADJ_COUNT', referenceNo: 'COUNT-1', remarks: 'Physical count' },
    SCRAP: { reasonCode: 'SCR_DAMAGED', referenceNo: 'BOARD-1', remarks: 'Burnt' },
  };
  return {
    docType, substationId, docDate: today(), referenceNo: '', counterparty: '', remarks: '',
    idempotencyKey: randomUUID(), lines: lines.map(([itemId, quantity]) => ({ itemId, quantity })),
    ...defaults[docType], ...extra,
  };
}

export async function balance(db: DbService, substationId: number, itemId: number): Promise<string> {
  return (await db.one('SELECT quantity FROM inventory_balances WHERE substation_id = $1 AND item_id = $2', [substationId, itemId]))?.quantity ?? '0';
}
