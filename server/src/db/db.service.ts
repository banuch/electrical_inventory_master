import { Injectable, OnModuleDestroy } from '@nestjs/common';
import pg from 'pg';
import { config } from '../config.js';

// bigint ids / counts fit comfortably in JS numbers; NUMERIC stays a string (exact decimals).
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v); // keep 'YYYY-MM-DD'

/** Anything that can run a parameterized query: DbService, a Pool or a transaction client. */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<pg.QueryResult<any>>;
}

@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool: pg.Pool;

  constructor(connectionString: string = config.databaseUrl) {
    this.pool = new pg.Pool({ connectionString, max: 20, idleTimeoutMillis: 30_000 });
  }

  query<R extends pg.QueryResultRow = any>(text: string, params?: unknown[]) {
    return this.pool.query<R>(text, params);
  }

  async one<R extends pg.QueryResultRow = any>(text: string, params?: unknown[]): Promise<R | undefined> {
    return (await this.pool.query<R>(text, params)).rows[0];
  }

  /** Run fn inside a single database transaction; any throw rolls everything back. */
  async tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
