import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { DbService } from '../src/db/db.service.js';
import type { AuthUser } from '../src/auth/auth-user.js';
import { doc, makeItem, makeSubstation, makeUser, resetDb, services } from './helpers.js';

let db: DbService;
let svc: ReturnType<typeof services>;
let ss1: number, ss2: number, ss3: number;
let admin: AuthUser, store1: AuthUser;
const base = { availableOnly: false, page: 1, pageSize: 25 };

before(async () => {
  db = await resetDb();
  svc = services(db);
  ss1 = await makeSubstation(db, 'Q01');
  ss2 = await makeSubstation(db, 'Q02');
  ss3 = await makeSubstation(db, 'Q03');
  admin = await makeUser(db, 'qadmin', 'INVENTORY_ADMIN', { orgWide: true });
  store1 = await makeUser(db, 'qstore', 'STOREKEEPER', { substationIds: [ss1] });
});

after(async () => { await db.pool.end(); });

describe('global search', () => {
  it('ranks exact code, then code prefix, then name matches', async () => {
    const exact = await makeItem(db, 'LA-33');
    const prefix = await makeItem(db, 'LA-33-10KA');
    await db.query(`UPDATE items SET name = 'Arrester LA-33 compatible bracket', normalized_name = 'arrester la-33 compatible bracket' WHERE id = $1`,
      [await makeItem(db, 'BRK-1')]);
    const r = await svc.inventory.search(store1, { ...base, q: 'la-33' });
    assert.deepEqual(r.items.slice(0, 2).map((i) => i.id), [exact, prefix]);
    assert.ok(r.items.some((i) => i.code === 'BRK-1'));
  });

  it('totals only current balances, and available-only hides zero-stock items', async () => {
    const item = await makeItem(db, 'TOT-1');
    await svc.posting.post(admin, doc(ss1, 'RECEIPT', [[item, '4']]));
    await svc.posting.post(admin, doc(ss2, 'RECEIPT', [[item, '6']]));
    await svc.posting.post(admin, doc(ss2, 'ISSUE', [[item, '6']]));
    const r = await svc.inventory.search(store1, { ...base, q: 'TOT-1' });
    assert.equal(r.items[0].total_quantity, '4.0000');
    assert.equal(r.items[0].substations_with_stock, 1);
    const empty = await makeItem(db, 'TOT-EMPTY');
    const avail = await svc.inventory.search(store1, { ...base, availableOnly: true, q: 'TOT-' });
    assert.ok(!avail.items.some((i) => i.id === empty));
  });

  it('flags items short at a substation that has never held them', async () => {
    const item = await makeItem(db, 'CRIT-1');
    await svc.posting.post(admin, doc(ss2, 'RECEIPT', [[item, '10']]));
    await svc.inventory.setLevels(admin, ss3, item, '2', '2', null);
    const r = await svc.inventory.search(store1, { ...base, q: 'CRIT-1' });
    assert.equal(r.items[0].stock_status, 'LOW_SOMEWHERE');
    assert.equal(r.items[0].substations_low, 1);
    const a = await svc.inventory.availability(store1, item, true);
    assert.equal(a.substations.find((s: any) => s.substation_id === ss3).status, 'OUT');
  });

  it('finds items through aliases and tolerates misspellings', async () => {
    const item = await makeItem(db, 'MEG-5KV');
    await db.query(`UPDATE items SET name = 'Insulation Resistance Tester', normalized_name = 'insulation resistance tester' WHERE id = $1`, [item]);
    await db.query(`INSERT INTO item_aliases (item_id, alias) VALUES ($1, 'megger')`, [item]);
    assert.ok((await svc.inventory.search(store1, { ...base, q: 'megger' })).items.some((i) => i.id === item));
    assert.ok((await svc.inventory.search(store1, { ...base, q: 'insulaton resistence tester' })).items.some((i) => i.id === item));
  });

  it('treats LIKE wildcards in the query literally', async () => {
    const r = await svc.inventory.search(store1, { ...base, q: '%' });
    assert.equal(r.total, 0);
  });
});
