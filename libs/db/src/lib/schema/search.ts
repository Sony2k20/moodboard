import { CssTechnique, DesignTokens, ElementStyles } from '@moodboard/shared';
import { sql } from 'drizzle-orm';
import {
  customType,
  index,
  jsonb,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { assets, tstz } from './core';

/** `tsvector` has no native Drizzle column type. */
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  },
});

/**
 * §5.3 Full-text search.
 *
 * `to_tsvector('english', …)` is one fixed stemming configuration, which is possible precisely
 * because descriptions are English by decision (§13.4). Free-form tags deliberately stay out of
 * the vector: they may well be German, and English stemming would mangle them. They are matched
 * separately and exactly.
 *
 * **Deviation from §5.3, with reason:** the concept calls `asset_search.tsv` a generated column.
 * A generated column can only reference columns of its own row, and title and description live
 * on `asset`. Keeping the separate table therefore means a trigger instead — see
 * `migrations/0001_invariant.sql`. The property that matters is preserved: no application code
 * maintains this value, so it cannot drift from title and description.
 */
export const assetSearch = pgTable(
  'asset_search',
  {
    assetId: uuid('asset_id')
      .primaryKey()
      .references(() => assets.id, { onDelete: 'cascade' }),
    tsv: tsvector('tsv').notNull(),
  },
  (table) => [
    index('asset_search_tsv_idx').using('gin', table.tsv),
  ],
);

/**
 * §5.3 Capture technique — the result of the in-page extraction from §8.2. This is the
 * difference between "looks smooth" and
 * `scroll-reveal via GSAP ScrollTrigger, 0.6s cubic-bezier(0.16,1,0.3,1)`.
 */
export const captureTech = pgTable('capture_tech', {
  assetId: uuid('asset_id')
    .primaryKey()
    .references(() => assets.id, { onDelete: 'cascade' }),
  /** `font-family` values actually in use. */
  fonts: jsonb('fonts').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  /** Transition, animation, transform and `:hover` values, counted (0011). */
  cssProperties: jsonb('css_properties')
    .$type<Partial<CssTechnique>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  /** Detected library signatures: GSAP, ScrollTrigger, Lenis, AOS, Framer Motion, … */
  libraries: jsonb('libraries')
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  /** `:root` custom properties and counted colours, radii, shadows, font sizes (0011 release 2). */
  tokens: jsonb('tokens').$type<DesignTokens>(),
  /** Computed styles of representative elements: headings, body text, button, link, card. */
  elements: jsonb('elements').$type<ElementStyles>(),
  /** The page's `<title>` at capture time; the asset's own title is the model's or a person's. */
  pageTitle: text('page_title'),
  /** The viewport the capture ran at, e.g. `1440x900@2`. */
  viewport: text('viewport').notNull(),
  capturedAt: tstz('captured_at').notNull().defaultNow(),
});

// `asset_embedding` (§5.3) belongs to phase 4 and is deliberately absent. It is computed from
// the stored description and can be backfilled across the whole corpus at any time (§7.6) — one
// of the few things here that genuinely can wait.
