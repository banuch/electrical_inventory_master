import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { DbService } from '../src/db/db.service.js';
import type { AuthUser } from '../src/auth/auth-user.js';
import { balance, doc, makeItem, makeSubstation, makeUser, resetDb, services } from './helpers.js';

let db: DbService;
let svc: ReturnType<typeof services>;
let ss1: number, ss2: number;
let admin: AuthUser, store1: AuthUser, incharge1: AuthUser;

const status = (err: any) => err?.getStatus?.();

before(async () => {
  db = await resetDb();
  svc = services(db);
  ss1 = await makeSubstation(db, 'T01');
  ss2 = await makeSubstation(db, 'T02');
  admin = await makeUser(db, 'admin1', 'INVENTORY_ADMIN', { orgWide: true });
  store1 = await makeUser(db, 'store1', 'STOREKEEPER', { substationIds: [ss1] });
  incharge1 = await makeUser(db, 'incharge1', 'SUBSTATION_INCHARGE', { substationIds: [ss1] });
});

after(async () => { await db.pool.end(); });

describe('stock posting', () => {
  it('posts receipt and issue with ledger rows that match the balance', async () => {
    const item = await makeItem(db, 'P-1');
    await svc.posting.post(store1, doc(ss1, 'RECEIPT', [[item, '10']]));
    await svc.posting.post(store1, doc(ss1, 'ISSUE', [[item, '3']]));
    assert.equal(await balance(db, ss1, item), '7.0000');
    const { rows } = await db.query(
      'SELECT txn_type, quantity, balance_before, balance_after FROM inventory_transactions WHERE item_id = $1 ORDER BY id', [item]);
    assert.deepEqual(rows.map((r) => [r.txn_type, r.quantity, r.balance_before, r.balance_after]),
      [['RECEIPT', '10.0000', '0.0000', '10.0000'], ['ISSUE', '-3.0000', '10.0000', '7.0000']]);
  });

  it('rejects issues beyond available stock without partial posting of multi-line documents', async () => {
    const a = await makeItem(db, 'P-2A');
    const b = await makeItem(db, 'P-2B');
    await svc.posting.post(store1, doc(ss1, 'RECEIPT', [[a, '5'], [b, '1']]));
    await assert.rejects(
      svc.posting.post(store1, doc(ss1, 'ISSUE', [[a, '2'], [b, '2']])),
      (e: any) => e.getResponse().code === 'INSUFFICIENT_STOCK');
    assert.equal(await balance(db, ss1, a), '5.0000', 'first line must be rolled back');
    const docs = await db.one(`SELECT count(*) AS n FROM stock_documents WHERE doc_type = 'ISSUE' AND substation_id = $1
      AND id IN (SELECT document_id FROM stock_document_lines WHERE item_id = $2)`, [ss1, a]);
    assert.equal(docs!.n, 0);
  });

  it('never oversells under concurrent issues (row locking)', async () => {
    const item = await makeItem(db, 'P-3');
    await svc.posting.post(store1, doc(ss1, 'RECEIPT', [[item, '10']]));
    const results = await Promise.allSettled(
      Array.from({ length: 25 }, () => svc.posting.post(store1, doc(ss1, 'ISSUE', [[item, '1']]))));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    assert.equal(ok, 10);
    assert.equal(await balance(db, ss1, item), '0.0000');
    const ledger = await db.one('SELECT sum(quantity) AS s FROM inventory_transactions WHERE item_id = $1', [item]);
    assert.equal(ledger!.s, '0.0000');
  });

  it('does not deadlock when concurrent multi-item documents list items in opposite order', async () => {
    const a = await makeItem(db, 'P-4A');
    const b = await makeItem(db, 'P-4B');
    await svc.posting.post(store1, doc(ss1, 'RECEIPT', [[a, '100'], [b, '100']]));
    await Promise.all(Array.from({ length: 20 }, (_, i) =>
      svc.posting.post(store1, doc(ss1, 'ISSUE', i % 2 ? [[a, '1'], [b, '1']] : [[b, '1'], [a, '1']]))));
    assert.equal(await balance(db, ss1, a), '80.0000');
    assert.equal(await balance(db, ss1, b), '80.0000');
  });

  it('is idempotent: retries (including concurrent ones) with the same key post once', async () => {
    const item = await makeItem(db, 'P-5');
    const input = doc(ss1, 'RECEIPT', [[item, '4']]);
    const results = await Promise.all([1, 2, 3, 4].map(() => svc.posting.post(store1, input)));
    assert.equal(new Set(results.map((r) => r.documentId)).size, 1);
    assert.equal(results.filter((r) => !r.replayed).length, 1);
    assert.equal(await balance(db, ss1, item), '4.0000');
  });

  it('enforces unit precision and positive quantities', async () => {
    const nos = await makeItem(db, 'P-6N', 'NOS');
    const metres = await makeItem(db, 'P-6M', 'M');
    await assert.rejects(svc.posting.post(store1, doc(ss1, 'RECEIPT', [[nos, '1.5']])), (e: any) => status(e) === 400);
    await assert.rejects(svc.posting.post(store1, doc(ss1, 'RECEIPT', [[nos, '-1']])), (e: any) => status(e) === 400);
    await assert.rejects(svc.posting.post(store1, doc(ss1, 'RECEIPT', [[nos, '0']])), (e: any) => status(e) === 400);
    await assert.rejects(svc.posting.post(store1, doc(ss1, 'RECEIPT', [[metres, '1.255']])), (e: any) => status(e) === 400);
    await svc.posting.post(store1, doc(ss1, 'RECEIPT', [[metres, '12.25']]));
    assert.equal(await balance(db, ss1, metres), '12.2500');
  });

  it('adds exact decimals without floating point drift', async () => {
    const item = await makeItem(db, 'P-7', 'L');
    for (let i = 0; i < 10; i++) await svc.posting.post(store1, doc(ss1, 'RECEIPT', [[item, '0.1']]));
    assert.equal(await balance(db, ss1, item), '1.0000');
  });

  it('requires reasons / references configured for the type', async () => {
    const item = await makeItem(db, 'P-8');
    await assert.rejects(svc.posting.post(store1, doc(ss1, 'RECEIPT', [[item, '1']], { reasonCode: undefined })), (e: any) => status(e) === 400);
    await assert.rejects(svc.posting.post(store1, doc(ss1, 'RECEIPT', [[item, '1']], { referenceNo: '' })), (e: any) => status(e) === 400);
  });

  it('rejects future-dated documents', async () => {
    const item = await makeItem(db, 'P-9');
    await assert.rejects(svc.posting.post(store1, doc(ss1, 'RECEIPT', [[item, '1']], { docDate: '2999-01-01' })), (e: any) => status(e) === 400);
  });
});

describe('authorization and scope', () => {
  it('blocks posting at substations outside the user scope', async () => {
    const item = await makeItem(db, 'S-1');
    await assert.rejects(svc.posting.post(store1, doc(ss2, 'RECEIPT', [[item, '1']])), (e: any) => status(e) === 403);
  });

  it('blocks transaction types the role does not grant', async () => {
    const item = await makeItem(db, 'S-2');
    await assert.rejects(svc.posting.post(store1, doc(ss1, 'ADJUSTMENT', [[item, '1']])), (e: any) => status(e) === 403);
    await assert.rejects(svc.posting.post(incharge1, doc(ss1, 'RECEIPT', [[item, '1']])), (e: any) => status(e) === 403);
    await assert.rejects(svc.posting.post(store1, doc(ss1, 'OPENING', [[item, '1']])), (e: any) => status(e) === 403);
  });

  it('limits substation inventory views to scope', async () => {
    await assert.rejects(svc.inventory.substationBalances(store1, ss2, { status: 'all', page: 1, pageSize: 10 }), (e: any) => status(e) === 403);
    const own = await svc.inventory.substationBalances(store1, ss1, { status: 'all', page: 1, pageSize: 10 });
    assert.ok(own.total > 0);
  });
});

describe('opening stock, adjustments and reversals', () => {
  it('allows opening stock once per substation and item', async () => {
    const item = await makeItem(db, 'O-1');
    await svc.posting.post(admin, doc(ss2, 'OPENING', [[item, '6']]));
    await assert.rejects(svc.posting.post(admin, doc(ss2, 'OPENING', [[item, '1']])), (e: any) => status(e) === 409);
    assert.equal(await balance(db, ss2, item), '6.0000');
  });

  it('posts signed adjustments with reference and remarks', async () => {
    const item = await makeItem(db, 'A-1');
    await svc.posting.post(store1, doc(ss1, 'RECEIPT', [[item, '10']]));
    await svc.posting.post(incharge1, doc(ss1, 'ADJUSTMENT', [[item, '-2']]));
    assert.equal(await balance(db, ss1, item), '8.0000');
    await assert.rejects(svc.posting.post(incharge1, doc(ss1, 'ADJUSTMENT', [[item, '-9']])), (e: any) => e.getResponse().code === 'INSUFFICIENT_STOCK');
    await assert.rejects(svc.posting.post(incharge1, doc(ss1, 'ADJUSTMENT', [[item, '1']], { remarks: '' })), (e: any) => status(e) === 400);
  });

  it('reverses a document exactly once via a linked reversal', async () => {
    const item = await makeItem(db, 'R-1');
    const rcpt = await svc.posting.post(store1, doc(ss1, 'RECEIPT', [[item, '5']]));
    const rev = await svc.posting.reverse(incharge1, rcpt.documentId, { remarks: 'Wrong item', idempotencyKey: randomUUID() });
    assert.equal(await balance(db, ss1, item), '0.0000');
    const orig = await db.one('SELECT status, reversed_by_document_id FROM stock_documents WHERE id = $1', [rcpt.documentId]);
    assert.deepEqual([orig!.status, orig!.reversed_by_document_id], ['REVERSED', rev.documentId]);
    await assert.rejects(svc.posting.reverse(incharge1, rcpt.documentId, { remarks: 'again', idempotencyKey: randomUUID() }), (e: any) => status(e) === 409);
    await assert.rejects(svc.posting.reverse(incharge1, rev.documentId, { remarks: 'undo', idempotencyKey: randomUUID() }), (e: any) => status(e) === 409);
  });

  it('refuses a reversal that would make stock negative', async () => {
    const item = await makeItem(db, 'R-2');
    const rcpt = await svc.posting.post(store1, doc(ss1, 'RECEIPT', [[item, '5']]));
    await svc.posting.post(store1, doc(ss1, 'ISSUE', [[item, '4']]));
    await assert.rejects(svc.posting.reverse(incharge1, rcpt.documentId, { remarks: 'x', idempotencyKey: randomUUID() }),
      (e: any) => e.getResponse().code === 'INSUFFICIENT_STOCK');
    const orig = await db.one('SELECT status FROM stock_documents WHERE id = $1', [rcpt.documentId]);
    assert.equal(orig!.status, 'POSTED');
  });
});

describe('database safeguards', () => {
  it('makes ledger, lines and audit rows immutable', async () => {
    await assert.rejects(db.query('UPDATE inventory_transactions SET quantity = 999'), /immutable/);
    await assert.rejects(db.query('DELETE FROM inventory_transactions'), /immutable/);
    await assert.rejects(db.query('DELETE FROM stock_document_lines'), /immutable/);
    await assert.rejects(db.query('UPDATE audit_logs SET action = $1', ['x']), /immutable/);
    await assert.rejects(db.query(`UPDATE stock_documents SET reference_no = 'tampered' WHERE status = 'POSTED'`), /immutable/);
    await assert.rejects(db.query(`DELETE FROM stock_documents WHERE status = 'POSTED'`), /cannot be deleted/);
  });

  it('rejects negative balances at the database level', async () => {
    await assert.rejects(db.query('UPDATE inventory_balances SET quantity = -1'), /inventory_balances_non_negative/);
  });

  it('keeps balances reconciled with the ledger', async () => {
    const { rows } = await db.query(`
      SELECT b.substation_id, b.item_id FROM inventory_balances b
      LEFT JOIN (SELECT substation_id, item_id, sum(quantity) q FROM inventory_transactions GROUP BY 1, 2) l
        ON l.substation_id = b.substation_id AND l.item_id = b.item_id
      WHERE b.quantity <> COALESCE(l.q, 0)`);
    assert.equal(rows.length, 0);
  });

  it('writes an audit record for every posted document', async () => {
    const r = await db.one(`SELECT
      (SELECT count(*) FROM stock_documents) AS docs,
      (SELECT count(*) FROM audit_logs WHERE entity_type = 'stock_document' AND action LIKE 'STOCK_%_POSTED') AS posted,
      (SELECT count(*) FROM audit_logs WHERE action = 'STOCK_DOCUMENT_REVERSED') AS reversed`);
    assert.equal(r!.docs, r!.posted + r!.reversed);
  });
});
