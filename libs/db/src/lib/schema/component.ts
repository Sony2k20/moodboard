import { integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { assets, tstz, users } from './core';

/**
 * A component's code (0018) — the asset itself, as an uploaded file is for an image. People write
 * it, never a model, so it carries no `origin`; every save goes to `audit_log` with the code it
 * replaced.
 */
export const componentCode = pgTable('component_code', {
  assetId: uuid('asset_id')
    .primaryKey()
    .references(() => assets.id, { onDelete: 'cascade' }),
  html: text('html').notNull(),
  css: text('css').notNull().default(''),
  js: text('js').notNull().default(''),
  /** The preview width it is rendered at: 390, 768 or 1280. */
  width: integer('width').notNull().default(1280),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
});
