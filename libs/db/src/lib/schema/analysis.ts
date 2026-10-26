import {
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { assets, tstz, users } from './core';
import { analysisRunStatus } from './enums';

/**
 * §5.3 Colour. Lab values, so colour proximity is perceptual rather than RGB-based.
 */
export const assetColors = pgTable(
  'asset_color',
  {
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    hex: varchar('hex', { length: 7 }).notNull(),
    labL: real('lab_l').notNull(),
    labA: real('lab_a').notNull(),
    labB: real('lab_b').notNull(),
    /** Share of the image covered by this colour, 0..1. */
    ratio: real('ratio').notNull(),
    /** Rank within the palette, 0 = dominant. */
    position: integer('position').notNull(),
  },
  (table) => [index('asset_color_asset_id_idx').on(table.assetId)],
);

/**
 * §5.5 Traceability. In phase 1 from day one, for three reasons: reproducibility (which model at
 * which prompt version produced this?), targeted re-analysis (re-run everything below
 * `prompt_version < N`) and cost transparency. Without a record from the start, none of the three
 * can be reconstructed (§2).
 */
export const analysisRuns = pgTable(
  'analysis_run',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    promptVersion: integer('prompt_version').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costUsd: real('cost_usd'),
    /** The raw provider response, kept as an audit trail. */
    rawResponse: jsonb('raw_response').$type<unknown>(),
    status: analysisRunStatus('status').notNull().default('pending'),
    error: text('error'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('analysis_run_asset_id_idx').on(table.assetId),
    index('analysis_run_prompt_version_idx').on(table.promptVersion),
  ],
);

/**
 * §5.5 Audit log. It is what allows metadata editing to stay open to everyone (§9): traceability
 * without friction.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id),
    /** Technical key, translated at display time only (§13.3). */
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: uuid('entity_id'),
    diff: jsonb('diff').$type<unknown>(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('audit_log_created_at_idx').on(table.createdAt),
    index('audit_log_entity_idx').on(table.entity, table.entityId),
  ],
);
