// Development-only PostgreSQL 17 cluster (no Docker / system install needed).
// Data persists in server/.data/pg. Stop with Ctrl+C.
import 'dotenv/config';
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import path from 'node:path';

const databaseDir = path.resolve(import.meta.dirname, '..', '.data', 'pg');
const port = Number(process.env.DEV_DB_PORT ?? 5433);
const user = process.env.DEV_DB_USER ?? 'cmg';
const password = process.env.DEV_DB_PASSWORD ?? 'cmg_dev_password';
const dbName = process.env.DEV_DB_NAME ?? 'cmg_inventory';

const pg = new EmbeddedPostgres({
  databaseDir, port, user, password, persistent: true, authMethod: 'scram-sha-256',
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  postgresFlags: ['-c', 'listen_addresses=127.0.0.1'],
  onLog: () => {},
});

const fresh = !existsSync(path.join(databaseDir, 'PG_VERSION'));
if (fresh) await pg.initialise();
await pg.start();

const client = pg.getPgClient('postgres', '127.0.0.1');
await client.connect();
for (const name of [dbName, `${dbName}_test`]) {
  const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (!rowCount) await pg.createDatabase(name);
}
await client.end();

console.log(`PostgreSQL ready on 127.0.0.1:${port} (databases: ${dbName}, ${dbName}_test). Ctrl+C to stop.`);
const shutdown = async () => { await pg.stop(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
setInterval(() => {}, 1 << 30);
