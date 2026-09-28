import { DbService } from './db.service.js';
import { migrate } from './migrate.js';
import { seedBase, seedDemo } from './seed.js';

const adminUsername = process.env.SEED_ADMIN_USERNAME ?? 'superadmin';
const adminPassword = process.env.SEED_ADMIN_PASSWORD;
if (!adminPassword) {
  console.error('SEED_ADMIN_PASSWORD must be set (see .env.example).');
  process.exit(1);
}

const db = new DbService();
try {
  await migrate(db.pool);
  await seedBase(db, { adminUsername, adminPassword });
  console.log(`Base data ready. Super administrator: ${adminUsername} (must change password on first login).`);
  if (process.argv.includes('--demo')) {
    const demoPassword = process.env.DEMO_USER_PASSWORD;
    if (!demoPassword) throw new Error('DEMO_USER_PASSWORD must be set for --demo');
    await seedDemo(db, demoPassword);
  }
} finally {
  await db.pool.end();
}
