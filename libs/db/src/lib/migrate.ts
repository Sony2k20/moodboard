import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { resolve } from 'node:path';
import { createDatabase } from './client';
import { seedVocabulary } from './seed';

/**
 * Session-level advisory lock held while migrating. The number is `moodboard` as ASCII
 * (`0x6D6F6F64`), so it is recognisable in `pg_locks` and cannot collide with another
 * application's lock by accident.
 */
const MIGRATION_LOCK_KEY = 0x6d6f6f64;

/**
 * Applies the migrations. Idempotent: Drizzle records what it has run in
 * `drizzle.__drizzle_migrations` and skips it next time.
 *
 * This runs as an initContainer in front of the api and the worker (§4.11), so it is entered
 * concurrently whenever more than one pod starts at once — and Drizzle's migrator takes no lock
 * of its own: it reads the last applied migration and then executes the statements. Two runners
 * would therefore both decide to create the same table and one would fail.
 *
 * Hence the advisory lock. The second runner waits for the first and then finds nothing to do,
 * rather than racing it. `pg_advisory_lock` blocks instead of failing, which is what we want: a
 * waiting pod is correct behaviour, a pod that gives up because another one was faster is not.
 */
export async function runMigrations(
  migrationsFolder = resolve(__dirname, '../../migrations'),
): Promise<void> {
  const handle = createDatabase();
  // A dedicated connection: the lock lives for the session that took it, and the migration
  // itself borrows other connections from the pool.
  const lockHolder = await handle.pool.connect();

  try {
    await lockHolder.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await migrate(handle.db, { migrationsFolder });
    // The vocabulary follows the code on every deploy (0009): a new facet in `libs/shared` is in
    // the database before the new version starts. Idempotent and never deleting — see
    // `seedVocabulary` — and under the same lock, so two pods do not seed at once.
    await seedVocabulary(handle.db);
  } finally {
    try {
      await lockHolder.query('select pg_advisory_unlock($1)', [
        MIGRATION_LOCK_KEY,
      ]);
    } finally {
      // Releasing the connection also drops the lock, so a crash here cannot wedge the next
      // deployment: Postgres frees session locks when the connection goes away.
      lockHolder.release();
      await handle.close();
    }
  }
}
