import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { INestApplication } from '@nestjs/common';
import { ADMIN_PASSWORD, doc, makeItem, makeSubstation, resetDb, TEST_DB_URL } from './helpers.js';
import type { DbService } from '../src/db/db.service.js';

let app: INestApplication;
let base: string;
let db: DbService;

before(async () => {
  db = await resetDb();
  process.env.DATABASE_URL = TEST_DB_URL;
  // config is read at import time, so load the app only after pointing it at the test database.
  const { config } = await import('../src/config.js');
  config.databaseUrl = TEST_DB_URL;
  const { createApp } = await import('../src/app.js');
  app = await createApp({ logger: false });
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/api`.replace('[::1]', '127.0.0.1');
});

after(async () => {
  await app?.close();
  await db.pool.end();
});

async function login(username: string, password: string) {
  const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const body = await res.json();
  const cookie = res.headers.get('set-cookie')?.split(';')[0] ?? '';
  return { res, body, cookie };
}

describe('HTTP security', () => {
  it('sets a HttpOnly SameSite=Strict session cookie and forces first-login password change', async () => {
    const { res, body, cookie } = await login('superadmin', ADMIN_PASSWORD);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('set-cookie')!, /HttpOnly/i);
    assert.match(res.headers.get('set-cookie')!, /SameSite=Strict/i);
    assert.equal(body.mustChangePassword, true);

    const blocked = await fetch(`${base}/items`, { headers: { cookie } });
    assert.equal(blocked.status, 403);
    assert.equal((await blocked.json()).code, 'PASSWORD_CHANGE_REQUIRED');

    const noCsrf = await fetch(`${base}/auth/change-password`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: ADMIN_PASSWORD, newPassword: 'Brand-New-Pass9' }),
    });
    assert.equal(noCsrf.status, 403);
    assert.equal((await noCsrf.json()).code, 'CSRF');

    const weak = await fetch(`${base}/auth/change-password`, {
      method: 'POST', headers: { cookie, 'x-csrf-token': body.csrfToken, 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: ADMIN_PASSWORD, newPassword: 'short' }),
    });
    assert.equal(weak.status, 400);

    const changed = await fetch(`${base}/auth/change-password`, {
      method: 'POST', headers: { cookie, 'x-csrf-token': body.csrfToken, 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: ADMIN_PASSWORD, newPassword: 'Brand-New-Pass9' }),
    });
    assert.equal(changed.status, 204);
    const ok = await fetch(`${base}/items`, { headers: { cookie } });
    assert.equal(ok.status, 200);
  });

  it('rejects bad credentials generically and locks the account after repeated failures', async () => {
    const unknown = await login('nobody', 'whatever');
    const wrong = await login('superadmin', 'wrong-password');
    assert.equal(unknown.res.status, 401);
    assert.equal(wrong.res.status, 401);
    assert.equal(unknown.body.message, wrong.body.message);
    for (let i = 0; i < 4; i++) await login('superadmin', 'wrong-password');
    const locked = await login('superadmin', 'Brand-New-Pass9');
    assert.equal(locked.res.status, 423);
    await db.query(`UPDATE users SET locked_until = NULL, failed_login_count = 0 WHERE username = 'superadmin'`);
  });

  it('requires a session for API routes and exposes health publicly', async () => {
    assert.equal((await fetch(`${base}/inventory/search`)).status, 401);
    assert.equal((await fetch(`${base}/health`)).status, 200);
  });

  it('prevents privilege escalation when creating users', async () => {
    const sub = await makeSubstation(db, 'H01');
    const { body, cookie } = await login('superadmin', 'Brand-New-Pass9');
    const headers = { cookie, 'x-csrf-token': body.csrfToken, 'content-type': 'application/json' };
    const roles: any[] = await (await fetch(`${base}/roles`, { headers })).json();
    const roleId = (code: string) => roles.find((r) => r.code === code).id;

    const mk = await fetch(`${base}/users`, { method: 'POST', headers, body: JSON.stringify({
      username: 'useradmin', fullName: 'User Admin', password: 'Temp-Pass-1234', roleIds: [roleId('VIEWER')], substationIds: [sub] }) });
    assert.equal(mk.status, 201);
    const { id: uaId } = await mk.json();
    // Give useradmin a custom role with only admin.users + inventory.view, then try to grant SUPER_ADMIN.
    await db.query(`INSERT INTO roles (code, name) VALUES ('USER_ADMIN', 'User admin')`);
    await db.query(`INSERT INTO role_permissions (role_id, permission_code) SELECT id, unnest(ARRAY['admin.users','inventory.view']) FROM roles WHERE code = 'USER_ADMIN'`);
    await db.query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = 'USER_ADMIN'`, [uaId]);
    await db.query(`UPDATE users SET must_change_password = false WHERE id = $1`, [uaId]);

    const ua = await login('useradmin', 'Temp-Pass-1234');
    const uaHeaders = { cookie: ua.cookie, 'x-csrf-token': ua.body.csrfToken, 'content-type': 'application/json' };
    const escalate = await fetch(`${base}/users`, { method: 'POST', headers: uaHeaders, body: JSON.stringify({
      username: 'sneaky', fullName: 'Sneaky', password: 'Temp-Pass-1234', roleIds: [roleId('SUPER_ADMIN')], substationIds: [sub] }) });
    assert.equal(escalate.status, 403);
  });

  it('posts stock over HTTP and returns the document number', async () => {
    const sub = await makeSubstation(db, 'H02');
    const item = await makeItem(db, 'H-ITEM');
    const { body, cookie } = await login('superadmin', 'Brand-New-Pass9');
    const res = await fetch(`${base}/stock/documents`, {
      method: 'POST', headers: { cookie, 'x-csrf-token': body.csrfToken, 'content-type': 'application/json' },
      body: JSON.stringify(doc(sub, 'RECEIPT', [[item, '3']])),
    });
    assert.equal(res.status, 201);
    assert.match((await res.json()).docNumber, /^RCP-H02-\d{4}-000001$/);
  });
});
