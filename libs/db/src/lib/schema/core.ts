import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { assetFileKind, assetStatus, locale, userRole } from './enums';

/** Shorthand: every timestamp is `timestamptz`. A design memory outlives one timezone. */
export const tstz = (name: string) => timestamp(name, { withTimezone: true });

// ---------------------------------------------------------------------------------------------
// §5.1 Core
// ---------------------------------------------------------------------------------------------

export const users = pgTable(
  'user',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The OIDC subject from Authentik. The stable identity; e-mail may change. */
    sub: text('sub').notNull(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    role: userRole('role').notNull().default('member'),
    /** UI language, persisted so it survives across devices (§13.2). */
    locale: locale('locale').notNull().default('en'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('user_sub_key').on(table.sub)],
);

export const assets = pgTable(
  'asset',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Mirrors the single-value `type` facet for convenience. The facet row remains authoritative,
     * so one query path covers every facet; this column exists because `type` is filtered on
     * almost every request.
     */
    type: text('type').notNull(),
    title: text('title'),
    /** LLM-generated, English by decision (§13.3). Primary search material. */
    description: text('description'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
    sourceUrl: text('source_url'),
    license: text('license'),
    status: assetStatus('status').notNull().default('pending'),
    /** Soft delete, 30-day trash (§9). Every query filters on this. */
    deletedAt: tstz('deleted_at'),
  },
  (table) => [
    index('asset_created_at_idx').on(table.createdAt),
    index('asset_created_by_idx').on(table.createdBy),
    index('asset_status_idx').on(table.status),
    index('asset_deleted_at_idx').on(table.deletedAt),
  ],
);

export const assetFiles = pgTable(
  'asset_file',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    kind: assetFileKind('kind').notNull(),
    /** Storage key as built by `assetFilePath`, never a host path (§4.2). */
    path: text('path').notNull(),
    mime: text('mime').notNull(),
    width: integer('width'),
    height: integer('height'),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    durationMs: integer('duration_ms'),
  },
  (table) => [
    index('asset_file_asset_id_idx').on(table.assetId),
    uniqueIndex('asset_file_path_key').on(table.path),
  ],
);
