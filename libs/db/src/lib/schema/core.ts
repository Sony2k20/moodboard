import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { CaptureFailure, DesignNotes } from '@moodboard/shared';
import { sql } from 'drizzle-orm';
import { assetFileKind, assetStatus, locale, origin, userRole } from './enums';

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
    /**
     * Who chose the title (0007): a person (a file name they picked, or an edit) or the model.
     * `asset_title_origin_guard` keeps a person's title through every re-analysis (§5.6).
     */
    titleOrigin: origin('title_origin').notNull().default('ai'),
    /** LLM-generated, English by decision (§13.3). Primary search material. */
    description: text('description'),
    /**
     * Who wrote the description (0004). The description is the one piece of LLM output that lives
     * on `asset` rather than in a join table, so it carries its own provenance: `origin = 'human'`
     * wins here exactly as on facets (§5.6), enforced by `asset_description_origin_guard`.
     */
    descriptionOrigin: origin('description_origin').notNull().default('ai'),
    /**
     * How the reference looks beyond the facets (0009) — composition, imagery, surfaces, shapes,
     * typography, components, details. Model output a person may correct, so it carries its own
     * provenance; `asset_design_notes_origin_guard` keeps a person's notes (§5.6).
     */
    designNotes: jsonb('design_notes').$type<DesignNotes>(),
    designNotesOrigin: origin('design_notes_origin').notNull().default('ai'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
    sourceUrl: text('source_url'),
    license: text('license'),
    status: assetStatus('status').notNull().default('pending'),
    /**
     * Why a website capture failed (0011): one of `CAPTURE_FAILURES`. Text rather than an enum,
     * because the list will grow with what real sites do, and an enum value cannot be dropped.
     */
    statusReason: text('status_reason').$type<CaptureFailure>(),
    /** Soft delete, 30-day trash (§9). Every query filters on this. */
    deletedAt: tstz('deleted_at'),
  },
  (table) => [
    // The overview's keyset order (0005): newest first, id as tie-breaker, trash excluded.
    index('asset_created_at_id_idx')
      .on(table.createdAt.desc(), table.id.desc())
      .where(sql`${table.deletedAt} is null`),
    index('asset_created_by_idx').on(table.createdBy),
    index('asset_status_idx').on(table.status),
    // The trash and the purge (0006) read only deleted rows.
    index('asset_deleted_at_idx')
      .on(table.deletedAt)
      .where(sql`${table.deletedAt} is not null`),
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

/**
 * Personal API tokens for MCP clients (0010). Only a SHA-256 of the token is stored: tokens are
 * 32 random bytes, so a slow hash adds nothing. `prefix` lets a person recognise a token in the
 * list without the token itself.
 */
export const apiTokens = pgTable(
  'api_token',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    prefix: text('prefix').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
    lastUsedAt: tstz('last_used_at'),
    revokedAt: tstz('revoked_at'),
  },
  (table) => [
    uniqueIndex('api_token_token_hash_key').on(table.tokenHash),
    index('api_token_user_id_idx').on(table.userId),
  ],
);
