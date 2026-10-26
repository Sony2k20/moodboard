import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { resolve } from 'node:path';
import { createDatabase } from './client';

/**
 * The migration entry point.
 *
 * Idempotent and self-contained, because in the cluster this runs as an ArgoCD `PreSync` job
 * (§4.11) rather than through `helm upgrade`: ArgoCD aborts the sync when it fails, so it must
 * exit non-zero on failure and close its pool on success, or the job never completes.
 *
 * Drizzle's migrator tracks applied migrations in `drizzle.__drizzle_migrations` and runs each
 * file once, so a second run is a no-op.
 */
export async function runMigrations(
  migrationsFolder = resolve(__dirname, '../../migrations'),
): Promise<void> {
  const handle = createDatabase();
  try {
    await migrate(handle.db, { migrationsFolder });
  } finally {
    await handle.close();
  }
}
