import {
  ASSET_FILE_KINDS,
  ASSET_STATUSES,
  LOCALES,
  ORIGINS,
  USER_ROLES,
} from '@moodboard/shared';
import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Postgres enums, all of them derived from `@moodboard/shared`. Adding a value in the shared
 * library and forgetting the migration is then a failing `drizzle-kit generate` diff, not a
 * runtime surprise.
 */
export const assetStatus = pgEnum('asset_status', ASSET_STATUSES);
export const assetFileKind = pgEnum('asset_file_kind', ASSET_FILE_KINDS);
export const origin = pgEnum('origin', ORIGINS);
export const userRole = pgEnum('user_role', USER_ROLES);
export const locale = pgEnum('locale', LOCALES);

export const analysisRunStatus = pgEnum('analysis_run_status', [
  'pending',
  'succeeded',
  'failed',
]);
