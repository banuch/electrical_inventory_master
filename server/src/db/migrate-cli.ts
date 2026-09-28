import { DbService } from './db.service.js';
import { migrate } from './migrate.js';

const db = new DbService();
try {
  await migrate(db.pool);
  console.log('Migrations complete.');
} finally {
  await db.pool.end();
}
