import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { databaseConfigFromEnv, DatabaseConfig } from './config';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  readonly db: Database;
  readonly pool: Pool;
  close(): Promise<void>;
}

/**
 * Opens a connection pool. The caller owns it — Nest closes it on shutdown, the migration and
 * seed entry points close it before exiting, which is what keeps the PreSync job (§4.11) from
 * hanging.
 */
export function createDatabase(
  config: DatabaseConfig = databaseConfigFromEnv(),
): DatabaseHandle {
  const pool = new Pool({ connectionString: config.url });
  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    close: () => pool.end(),
  };
}

export { schema };
