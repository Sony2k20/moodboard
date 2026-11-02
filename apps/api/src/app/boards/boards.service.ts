import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  assetFiles,
  assets,
  auditLog,
  boardFilters,
  boardItems,
  boards,
  Database,
  users,
} from '@moodboard/db';
import {
  AssetDetail,
  AssetQuery,
  assetQueryParams,
  AssetQuerySchema,
  BoardCreateSchema,
  BoardDetail,
  BoardItem,
  BoardItemPatchSchema,
  BoardItemsAddSchema,
  BoardPatch,
  boardPrompt,
  BoardSummary,
  boardTokens,
  BoardTokens,
  deriveBoard,
  MAX_BOARD_ITEMS,
  SMART_BOARD_LIMIT,
  STORAGE_SERVICE,
  StorageService,
} from '@moodboard/shared';
import { and, asc, count, desc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AssetSearchService } from '../assets/asset-search.service';
import { DATABASE } from '../database.module';

/** A transaction of the database, as drizzle hands it to `transaction()`. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface BoardEditor {
  readonly id: string;
  readonly role: 'admin' | 'member';
}

/** Pictures on a board's card in the list. */
const CARD_THUMBNAILS = 4;

/**
 * Boards (0019): the briefing package. Reading goes through `AssetSearchService.detail` and
 * `search`, so an item shows exactly what the asset's page and `get_asset` show, and a smart board
 * is exactly the overview's result for its filter. Everyone may edit every board (§9); deleting
 * one is its creator's or an admin's.
 */
@Injectable()
export class BoardsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    private readonly search: AssetSearchService,
  ) {}

  async list(): Promise<BoardSummary[]> {
    const rows = await this.db
      .select({
        id: boards.id,
        title: boards.title,
        kind: boards.kind,
        briefing: boards.briefing,
        updatedAt: boards.updatedAt,
        authorId: users.id,
        authorName: users.displayName,
        filter: boardFilters.filter,
      })
      .from(boards)
      .innerJoin(users, eq(users.id, boards.createdBy))
      .leftJoin(boardFilters, eq(boardFilters.boardId, boards.id))
      .orderBy(desc(boards.updatedAt));
    if (rows.length === 0) {
      return [];
    }

    const manualIds = rows.filter((r) => r.kind === 'manual').map((r) => r.id);
    const [counts, thumbs] = manualIds.length
      ? await Promise.all([
          this.db
            .select({ boardId: boardItems.boardId, count: count() })
            .from(boardItems)
            .innerJoin(assets, eq(assets.id, boardItems.assetId))
            .where(and(inArray(boardItems.boardId, manualIds), isNull(assets.deletedAt)))
            .groupBy(boardItems.boardId),
          // The first pictures of each board, by position; one row per board and asset.
          this.db
            .selectDistinctOn([boardItems.boardId, boardItems.position, boardItems.assetId], {
              boardId: boardItems.boardId,
              path: assetFiles.path,
            })
            .from(boardItems)
            .innerJoin(assets, eq(assets.id, boardItems.assetId))
            .innerJoin(
              assetFiles,
              and(eq(assetFiles.assetId, boardItems.assetId), eq(assetFiles.kind, 'thumb_md')),
            )
            .where(and(inArray(boardItems.boardId, manualIds), isNull(assets.deletedAt)))
            .orderBy(asc(boardItems.boardId), asc(boardItems.position), asc(boardItems.assetId)),
        ])
      : [[], []];

    return Promise.all(
      rows.map(async (row) => {
        let itemCount = counts.find((c) => c.boardId === row.id)?.count ?? 0;
        let thumbnails = [
          ...new Set(thumbs.filter((t) => t.boardId === row.id).map((t) => this.storage.url(t.path))),
        ].slice(0, CARD_THUMBNAILS);
        if (row.kind === 'smart') {
          const result = await this.search.search({ ...this.query(row.filter), limit: CARD_THUMBNAILS });
          itemCount = Math.min(result.total, SMART_BOARD_LIMIT);
          thumbnails = result.items.flatMap((i) => (i.thumbnail ? [i.thumbnail.url] : []));
        }
        return {
          id: row.id,
          title: row.title,
          kind: row.kind,
          briefing: row.briefing,
          itemCount,
          author: { id: row.authorId, displayName: row.authorName },
          updatedAt: row.updatedAt.toISOString(),
          thumbnails,
        };
      }),
    );
  }

  async create(input: z.output<typeof BoardCreateSchema>, editor: BoardEditor): Promise<{ id: string }> {
    return this.db.transaction(async (tx) => {
      const [{ id }] = await tx
        .insert(boards)
        .values({
          title: input.title,
          briefing: input.briefing,
          kind: input.filter ? 'smart' : 'manual',
          createdBy: editor.id,
          updatedBy: editor.id,
        })
        .returning({ id: boards.id });
      const filter = input.filter ? this.filterParams(input.filter) : null;
      if (filter) {
        await tx.insert(boardFilters).values({ boardId: id, filter });
      }
      await this.audit(tx, editor, 'board.created', id, { title: input.title, filter });
      return { id };
    });
  }

  async detail(id: string): Promise<BoardDetail | null> {
    const [board] = await this.db
      .select({
        id: boards.id,
        title: boards.title,
        kind: boards.kind,
        briefing: boards.briefing,
        createdAt: boards.createdAt,
        updatedAt: boards.updatedAt,
        authorId: users.id,
        authorName: users.displayName,
        filter: boardFilters.filter,
      })
      .from(boards)
      .innerJoin(users, eq(users.id, boards.createdBy))
      .leftJoin(boardFilters, eq(boardFilters.boardId, boards.id))
      .where(eq(boards.id, id));
    if (!board) {
      return null;
    }

    const items = board.kind === 'smart' ? await this.smartItems(board.filter) : await this.manualItems(id);
    const vocabulary = await this.search.vocabulary();
    const derived = deriveBoard(items);
    return {
      id: board.id,
      title: board.title,
      kind: board.kind,
      briefing: board.briefing,
      filter: board.filter,
      author: { id: board.authorId, displayName: board.authorName },
      createdAt: board.createdAt.toISOString(),
      updatedAt: board.updatedAt.toISOString(),
      items,
      derived,
      tokens: boardTokens(derived, items),
      prompt: boardPrompt({ title: board.title, briefing: board.briefing, items, derived }, vocabulary),
    };
  }

  /** Tokens of one asset, as if it were the only primary item of a board (`get_design_tokens`). */
  async assetTokens(assetId: string): Promise<BoardTokens | null> {
    const asset = await this.search.detail(assetId);
    if (!asset) {
      return null;
    }
    const items = [{ role: 'overall' as const, weight: 'primary' as const, asset }];
    return boardTokens(deriveBoard(items), items);
  }

  async update(id: string, patch: BoardPatch, editor: BoardEditor): Promise<void> {
    await this.db.transaction(async (tx) => {
      const before = await this.board(tx, id);
      await tx
        .update(boards)
        .set({ ...patch, updatedBy: editor.id, updatedAt: new Date() })
        .where(eq(boards.id, id));
      await this.audit(tx, editor, 'board.updated', id, {
        before: {
          ...(patch.title !== undefined ? { title: before.title } : {}),
          ...(patch.briefing !== undefined ? { briefing: before.briefing } : {}),
        },
        after: patch,
      });
    });
  }

  /** Final: the audit log keeps what the board held; its assets stay. */
  async remove(id: string, editor: BoardEditor): Promise<void> {
    await this.db.transaction(async (tx) => {
      const board = await this.board(tx, id);
      if (board.createdBy !== editor.id && editor.role !== 'admin') {
        throw new ForbiddenException('Only its creator or an admin may delete a board');
      }
      const [items, [filter]] = await Promise.all([
        tx
          .select({
            assetId: boardItems.assetId,
            position: boardItems.position,
            role: boardItems.role,
            weight: boardItems.weight,
            note: boardItems.note,
          })
          .from(boardItems)
          .where(eq(boardItems.boardId, id))
          .orderBy(asc(boardItems.position)),
        tx.select({ filter: boardFilters.filter }).from(boardFilters).where(eq(boardFilters.boardId, id)),
      ]);
      await tx.delete(boards).where(eq(boards.id, id));
      await this.audit(tx, editor, 'board.deleted', id, {
        title: board.title,
        briefing: board.briefing,
        kind: board.kind,
        filter: filter?.filter ?? null,
        items,
      });
    });
  }

  /** Appends in the given order; an asset already on the board in that role is skipped. */
  async addItems(
    id: string,
    input: z.output<typeof BoardItemsAddSchema>,
    editor: BoardEditor,
  ): Promise<{ added: number }> {
    return this.db.transaction(async (tx) => {
      const board = await this.manual(tx, id);
      const wanted = [...new Set(input.assetIds)];
      const live = await tx
        .select({ id: assets.id })
        .from(assets)
        .where(and(inArray(assets.id, wanted), isNull(assets.deletedAt)));
      if (live.length !== wanted.length) {
        throw new NotFoundException('An asset does not exist or is in the trash');
      }
      const present = await tx
        .select({ assetId: boardItems.assetId })
        .from(boardItems)
        .where(and(eq(boardItems.boardId, id), eq(boardItems.role, input.role)));
      const fresh = wanted.filter((a) => !present.some((p) => p.assetId === a));
      const [{ total }] = await tx
        .select({ total: count() })
        .from(boardItems)
        .where(eq(boardItems.boardId, id));
      if (total + fresh.length > MAX_BOARD_ITEMS) {
        throw new ConflictException(`A board holds at most ${MAX_BOARD_ITEMS} items`);
      }
      if (fresh.length > 0) {
        const [{ last }] = await tx
          .select({ last: max(boardItems.position) })
          .from(boardItems)
          .where(eq(boardItems.boardId, id));
        const start = (last ?? -1) + 1;
        await tx.insert(boardItems).values(
          fresh.map((assetId, i) => ({
            boardId: id,
            assetId,
            position: start + i,
            role: input.role,
            weight: input.weight,
            addedBy: editor.id,
          })),
        );
        await this.touch(tx, board.id, editor);
        await this.audit(tx, editor, 'board.items_added', id, {
          assetIds: fresh,
          role: input.role,
          weight: input.weight,
        });
      }
      return { added: fresh.length };
    });
  }

  async updateItem(
    id: string,
    itemId: string,
    patch: z.output<typeof BoardItemPatchSchema>,
    editor: BoardEditor,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.manual(tx, id);
      const before = await this.item(tx, id, itemId);
      if (patch.role !== undefined && patch.role !== before.role) {
        const [taken] = await tx
          .select({ id: boardItems.id })
          .from(boardItems)
          .where(
            and(
              eq(boardItems.boardId, id),
              eq(boardItems.assetId, before.assetId),
              eq(boardItems.role, patch.role),
            ),
          );
        if (taken) {
          throw new ConflictException('This asset already has that role on the board');
        }
      }
      await tx.update(boardItems).set(patch).where(eq(boardItems.id, itemId));
      await this.touch(tx, id, editor);
      await this.audit(tx, editor, 'board.item_updated', id, {
        itemId,
        assetId: before.assetId,
        before: Object.fromEntries(Object.keys(patch).map((k) => [k, before[k as keyof typeof before]])),
        after: patch,
      });
    });
  }

  async removeItem(id: string, itemId: string, editor: BoardEditor): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.manual(tx, id);
      const before = await this.item(tx, id, itemId);
      await tx.delete(boardItems).where(eq(boardItems.id, itemId));
      await this.touch(tx, id, editor);
      await this.audit(tx, editor, 'board.item_removed', id, { itemId, ...before });
    });
  }

  /**
   * The given items take the positions they held between them, in the new order. Items not
   * given — those of trashed assets, which the page does not show — keep theirs, so a restored
   * asset comes back where it was.
   */
  async reorder(id: string, itemIds: readonly string[], editor: BoardEditor): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.manual(tx, id);
      const unique = [...new Set(itemIds)];
      if (unique.length !== itemIds.length) {
        throw new BadRequestException('An item is listed twice');
      }
      if (unique.length === 0) {
        return;
      }
      const rows = await tx
        .select({ id: boardItems.id, position: boardItems.position })
        .from(boardItems)
        .where(and(eq(boardItems.boardId, id), inArray(boardItems.id, unique)));
      if (rows.length !== unique.length) {
        throw new BadRequestException('An item does not belong to this board');
      }
      const positions = rows.map((r) => r.position).sort((a, b) => a - b);
      for (const [i, itemId] of unique.entries()) {
        await tx.update(boardItems).set({ position: positions[i] }).where(eq(boardItems.id, itemId));
      }
      await this.touch(tx, id, editor);
      await this.audit(tx, editor, 'board.reordered', id, {
        before: [...rows].sort((a, b) => a.position - b.position).map((r) => r.id),
        after: unique,
      });
    });
  }

  private async manualItems(id: string): Promise<BoardItem[]> {
    const rows = await this.db
      .select({
        id: boardItems.id,
        assetId: boardItems.assetId,
        role: boardItems.role,
        weight: boardItems.weight,
        note: boardItems.note,
      })
      .from(boardItems)
      .innerJoin(assets, eq(assets.id, boardItems.assetId))
      .where(and(eq(boardItems.boardId, id), isNull(assets.deletedAt)))
      .orderBy(asc(boardItems.position), asc(boardItems.addedAt));
    const details = await this.details(rows.map((r) => r.assetId));
    return rows.flatMap(({ assetId, ...row }) => {
      const asset = details.get(assetId);
      return asset ? [{ ...row, asset }] : [];
    });
  }

  private async smartItems(filter: Record<string, string | string[]> | null): Promise<BoardItem[]> {
    const { items } = await this.search.search({ ...this.query(filter), limit: SMART_BOARD_LIMIT });
    const details = await this.details(items.map((i) => i.id));
    return items.flatMap((card) => {
      const asset = details.get(card.id);
      return asset ? [{ id: null, role: 'overall' as const, weight: 'primary' as const, note: null, asset }] : [];
    });
  }

  private async details(ids: readonly string[]): Promise<Map<string, AssetDetail>> {
    const unique = [...new Set(ids)];
    const found = await Promise.all(unique.map((id) => this.search.detail(id)));
    return new Map(found.flatMap((a) => (a ? [[a.id, a] as const] : [])));
  }

  /** A stored filter as the search takes it. One that no longer parses finds nothing new. */
  private query(filter: Record<string, string | string[]> | null): AssetQuery {
    return AssetQuerySchema.parse({ ...(filter ?? {}) });
  }

  private filterParams(query: AssetQuery): Record<string, string | string[]> {
    return assetQueryParams({ ...query, cursor: undefined, limit: undefined, review: 'off' });
  }

  private async board(tx: Tx, id: string) {
    const [board] = await tx.select().from(boards).where(eq(boards.id, id)).for('update');
    if (!board) {
      throw new NotFoundException();
    }
    return board;
  }

  /** Items are curated on manual boards only; a smart board's are its filter's result. */
  private async manual(tx: Tx, id: string) {
    const board = await this.board(tx, id);
    if (board.kind !== 'manual') {
      throw new ConflictException('A smart board’s items come from its filter');
    }
    return board;
  }

  private async item(tx: Tx, boardId: string, itemId: string) {
    const [item] = await tx
      .select({
        assetId: boardItems.assetId,
        position: boardItems.position,
        role: boardItems.role,
        weight: boardItems.weight,
        note: boardItems.note,
      })
      .from(boardItems)
      .where(and(eq(boardItems.id, itemId), eq(boardItems.boardId, boardId)));
    if (!item) {
      throw new NotFoundException();
    }
    return item;
  }

  private async touch(tx: Tx, id: string, editor: BoardEditor): Promise<void> {
    await tx.update(boards).set({ updatedBy: editor.id, updatedAt: sql`now()` }).where(eq(boards.id, id));
  }

  private async audit(
    tx: Tx,
    editor: BoardEditor,
    action: BoardAuditAction,
    boardId: string,
    diff: unknown,
  ): Promise<void> {
    await tx.insert(auditLog).values({
      userId: editor.id,
      action,
      entity: 'board',
      entityId: boardId,
      diff,
    });
  }
}

/** Audit actions are technical keys, translated at display time only (§13.3). */
type BoardAuditAction =
  | 'board.created'
  | 'board.updated'
  | 'board.deleted'
  | 'board.items_added'
  | 'board.item_updated'
  | 'board.item_removed'
  | 'board.reordered';
