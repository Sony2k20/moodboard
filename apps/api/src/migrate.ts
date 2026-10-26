import { runMigrations } from '@moodboard/db';
import { resolve } from 'node:path';

/**
 * The migration entry point of the api image, run by the ArgoCD `PreSync` job (§4.11).
 *
 * It exits non-zero on failure on purpose: ArgoCD aborts the sync when the hook fails, which is
 * the only thing standing between a failed migration and a new application version starting
 * against an old schema.
 *
 * The SQL sits beside the bundle, copied there by the webpack `assets` entry.
 */
runMigrations(resolve(__dirname, 'migrations'))
  .then(() => {
    console.log('Migrations applied.');
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
