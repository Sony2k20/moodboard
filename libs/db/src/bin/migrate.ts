import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { runMigrations } from '../lib/migrate';

loadEnv();

/**
 * `npm run db:migrate`. Also the command the ArgoCD PreSync job runs (§4.11), which is why it
 * exits non-zero on failure: ArgoCD aborts the sync on a failed hook, and a migration that fails
 * silently would let the new application version start against an old schema.
 */
runMigrations(resolve(__dirname, '../../migrations'))
  .then(() => {
    console.log('Migrations applied.');
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
