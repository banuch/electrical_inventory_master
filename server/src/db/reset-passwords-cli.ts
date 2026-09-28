// DEVELOPMENT ONLY: resets every account to the default passwords from .env,
// clears lockouts and signs everyone out. Refuses to run with NODE_ENV=production.
import { DbService } from './db.service.js';
import { hashPassword } from '../auth/auth.service.js';

if (process.env.NODE_ENV === 'production') {
  console.error('reset-passwords is a development tool and cannot run in production.');
  process.exit(1);
}
const adminUsername = process.env.SEED_ADMIN_USERNAME ?? 'superadmin';
const adminPassword = process.env.SEED_ADMIN_PASSWORD;
const demoPassword = process.env.DEMO_USER_PASSWORD;
if (!adminPassword || !demoPassword) {
  console.error('SEED_ADMIN_PASSWORD and DEMO_USER_PASSWORD must be set in server/.env');
  process.exit(1);
}

const db = new DbService();
try {
  const adminHash = await hashPassword(adminPassword);
  const demoHash = await hashPassword(demoPassword);
  const rows = await db.tx(async (c) => {
    const { rows } = await c.query(
      `UPDATE users
          SET password_hash = CASE WHEN lower(username) = lower($1) THEN $2 ELSE $3 END,
              must_change_password = false, failed_login_count = 0, locked_until = NULL, is_active = true,
              password_changed_at = now(), updated_at = now()
        RETURNING username, lower(username) = lower($1) AS is_admin`,
      [adminUsername, adminHash, demoHash]);
    await c.query('UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL');
    await c.query(
      `INSERT INTO audit_logs (action, entity_type, details) VALUES ('DEV_PASSWORDS_RESET', 'system', $1)`,
      [JSON.stringify({ users: rows.length })]);
    return rows;
  });
  for (const r of rows.sort((a, b) => a.username.localeCompare(b.username))) {
    console.log(`  ${r.username.padEnd(16)} -> ${r.is_admin ? 'SEED_ADMIN_PASSWORD' : 'DEMO_USER_PASSWORD'}`);
  }
  console.log(`Reset ${rows.length} account(s); lockouts cleared; all sessions signed out.`);
} finally {
  await db.pool.end();
}
