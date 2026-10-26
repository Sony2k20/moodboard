import { LocalizedText } from '@moodboard/shared';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { assets, tstz, users } from './core';
import { origin } from './enums';

/**
 * §5.2 Taxonomy.
 *
 * The controlled vocabulary is **normalised**, not JSONB rows on the asset, so referential
 * integrity holds and a value can be renamed globally without touching a single asset.
 *
 * `label` and `description` are `jsonb` with `{en, de}` — decided now because splitting a text
 * column later would be a migration that moves data (§2, §13.5).
 */

export const facets = pgTable(
  'facet',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Machine-readable, single-language, never translated (§13.3). */
    key: varchar('key', { length: 64 }).notNull(),
    isMultiValue: boolean('is_multi_value').notNull(),
    label: jsonb('label').$type<LocalizedText>().notNull(),
    description: jsonb('description').$type<LocalizedText>(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [uniqueIndex('facet_key_key').on(table.key)],
);

export const facetValues = pgTable(
  'facet_value',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facetId: uuid('facet_id')
      .notNull()
      .references(() => facets.id, { onDelete: 'cascade' }),
    /** The machine-readable key: feeds the Zod enums, the LLM prompt and the MCP filters. */
    value: varchar('value', { length: 64 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    label: jsonb('label').$type<LocalizedText>().notNull(),
    description: jsonb('description').$type<LocalizedText>(),
  },
  (table) => [
    uniqueIndex('facet_value_facet_id_value_key').on(table.facetId, table.value),
  ],
);

/**
 * The join carrying provenance. `origin` is here from day one: introduced later it would be
 * impossible to reconstruct which values a human had corrected, and the first re-analysis would
 * silently overwrite all of it (§2, §5.6).
 *
 * The invariant `origin='human'` beats `origin='ai'` is enforced by a trigger, see
 * `migrations/0001_invariant.sql`.
 */
export const assetFacetValues = pgTable(
  'asset_facet_value',
  {
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    facetValueId: uuid('facet_value_id')
      .notNull()
      .references(() => facetValues.id, { onDelete: 'cascade' }),
    origin: origin('origin').notNull(),
    /** Only meaningful when `origin = 'ai'`. */
    confidence: real('confidence'),
    setBy: uuid('set_by').references(() => users.id),
    setAt: tstz('set_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'asset_facet_value_pkey',
      columns: [table.assetId, table.facetValueId],
    }),
    index('asset_facet_value_facet_value_id_idx').on(table.facetValueId),
    index('asset_facet_value_origin_idx').on(table.origin),
  ],
);

/** Free-form tags, flat. The taxonomy's escape valve — any language, never translated (§13.3). */
export const tags = pgTable(
  'tag',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
  },
  (table) => [uniqueIndex('tag_name_key').on(table.name)],
);

export const assetTags = pgTable(
  'asset_tag',
  {
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    origin: origin('origin').notNull(),
    setBy: uuid('set_by').references(() => users.id),
    setAt: tstz('set_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'asset_tag_pkey',
      columns: [table.assetId, table.tagId],
    }),
    index('asset_tag_tag_id_idx').on(table.tagId),
  ],
);
