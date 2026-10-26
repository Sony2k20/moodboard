import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

loadEnv();

/**
 * `drizzle-kit generate` needs no database — it diffs the schema against the committed
 * migrations. Only `migrate` and `push` connect, and we never use `push`: every schema change
 * goes through a reviewed migration file, because in the cluster the migration runs as an ArgoCD
 * PreSync job (§4.11) and has to be forward compatible.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './libs/db/src/lib/schema/index.ts',
  out: './libs/db/migrations',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/moodboard',
  },
  strict: true,
  verbose: true,
});
