import { index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { assets, tstz, users } from './core';
import { boardKind, boardRole, boardWeight } from './enums';

/**
 * §5.4 Boards (0019): a curated combination of assets for a purpose — the briefing package an
 * agent works from. Every row is a person's curation, never a model's, so none carries `origin`;
 * every change goes to `audit_log` with entity `board`.
 */
export const boards = pgTable(
  'board',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    /** Free text: what should come out of this. */
    briefing: text('briefing').notNull().default(''),
    kind: boardKind('kind').notNull().default('manual'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (table) => [index('board_updated_at_idx').on(table.updatedAt.desc())],
);

/**
 * One asset in one role. The same asset may hold several roles in a board — a site can give the
 * palette and the layout — but each role once. A trashed asset's item stays, hidden, so restoring
 * the asset restores its place; the purge removes it with the asset.
 */
export const boardItems = pgTable(
  'board_item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    role: boardRole('role').notNull().default('overall'),
    weight: boardWeight('weight').notNull().default('primary'),
    /** "the animation only, not the colours" */
    note: text('note'),
    addedBy: uuid('added_by').references(() => users.id),
    addedAt: tstz('added_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('board_item_board_asset_role_key').on(table.boardId, table.assetId, table.role),
    index('board_item_board_position_idx').on(table.boardId, table.position),
    index('board_item_asset_id_idx').on(table.assetId),
  ],
);

/** A smart board's filter, in the URL form of the overview's query (`assetQueryParams`). */
export const boardFilters = pgTable(
  'board_filter',
  {
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    filter: jsonb('filter').$type<Record<string, string | string[]>>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.boardId] })],
);
