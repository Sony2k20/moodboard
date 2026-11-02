import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PGlite } from '@electric-sql/pglite';
import { assetColors, assets, auditLog, Database, schema, seedVocabulary, users } from '@moodboard/db';
import { BoardCreateSchema, BoardItemPatchSchema, BoardItemsAddSchema, StorageService } from '@moodboard/shared';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { join } from 'node:path';
import { AssetEditService } from '../assets/asset-edit.service';
import { AssetSearchService } from '../assets/asset-search.service';
import { BoardsService } from './boards.service';

/** Boards (0019) against a real Postgres: curation, smart boards, trash, permissions. */

const MIGRATIONS = join(__dirname, '../../../../../libs/db/migrations');
const storage = { url: (path: string) => `/files/${path}` } as StorageService;

let client: PGlite;
let db: Database;
let boards: BoardsService;
let edit: AssetEditService;
let ada: { id: string; role: 'member' };
let bob: { id: string; role: 'member' };
const admin = { id: '', role: 'admin' as const };

async function asset(title: string, hex?: string): Promise<string> {
  const [{ id }] = await db
    .insert(assets)
    .values({ type: 'image', title, titleOrigin: 'human', createdBy: ada.id, status: 'ready' })
    .returning({ id: assets.id });
  if (hex) {
    await db.insert(assetColors).values({ assetId: id, hex, labL: 0, labA: 0, labB: 0, ratio: 1, position: 0 });
  }
  return id;
}

const create = (input: unknown, editor = ada) => boards.create(BoardCreateSchema.parse(input), editor);
const add = (id: string, input: unknown, editor = ada) =>
  boards.addItems(id, BoardItemsAddSchema.parse(input), editor);

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Database;
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
  await seedVocabulary(db);
  const rows = await db
    .insert(users)
    .values([
      { sub: 'ada', email: 'ada@example.com', displayName: 'Ada' },
      { sub: 'bob', email: 'bob@example.com', displayName: 'Bob' },
      { sub: 'eve', email: 'eve@example.com', displayName: 'Eve', role: 'admin' },
    ])
    .returning({ id: users.id });
  ada = { id: rows[0].id, role: 'member' };
  bob = { id: rows[1].id, role: 'member' };
  admin.id = rows[2].id;
  const search = new AssetSearchService(db, storage);
  boards = new BoardsService(db, storage, search);
  edit = new AssetEditService(db);
}, 60_000);

afterAll(() => client.close());

describe('manual boards', () => {
  it('curates items with roles, weights, notes and order, and derives from them', async () => {
    const [red, blue, gray] = [await asset('Red', '#ff0000'), await asset('Blue', '#0000ff'), await asset('Gray')];
    const { id } = await create({ title: 'Relaunch', briefing: 'Calmer.' });
    expect(await add(id, { assetIds: [red, blue] })).toEqual({ added: 2 });
    // The same asset in another role is a second item; in the same role it is skipped.
    expect(await add(id, { assetIds: [red, gray], role: 'color' })).toEqual({ added: 2 });
    expect(await add(id, { assetIds: [red], role: 'color' })).toEqual({ added: 0 });

    let board = await boards.detail(id);
    expect(board?.items.map((i) => [i.asset.title, i.role])).toEqual([
      ['Red', 'overall'],
      ['Blue', 'overall'],
      ['Red', 'color'],
      ['Gray', 'color'],
    ]);
    const [first, second, , fourth] = board?.items ?? [];
    await boards.updateItem(id, fourth.id as string, BoardItemPatchSchema.parse({ weight: 'avoid', note: 'too flat' }), bob);
    await boards.reorder(id, [second.id, first.id].map(String), bob);

    board = await boards.detail(id);
    expect(board?.items.map((i) => [i.asset.title, i.role, i.weight, i.note])).toEqual([
      ['Blue', 'overall', 'primary', null],
      ['Red', 'overall', 'primary', null],
      ['Red', 'color', 'primary', null],
      ['Gray', 'color', 'avoid', 'too flat'],
    ]);
    expect(board?.derived.palette).toMatchObject({ source: 'role', colors: [{ hex: '#ff0000' }] });
    expect(board?.tokens.css).toContain('--color-palette-1: #ff0000;');
    expect(board?.prompt).toContain('What should come out of this:\nCalmer.');

    const changes = await db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.entityId, id));
    expect(changes.map((c) => c.action).sort()).toEqual(
      ['board.created', 'board.item_updated', 'board.items_added', 'board.items_added', 'board.reordered'].sort(),
    );
  });

  it('refuses a role an asset already holds on the board', async () => {
    const a = await asset('A');
    const { id } = await create({ title: 'Roles' });
    await add(id, { assetIds: [a] });
    await add(id, { assetIds: [a], role: 'layout' });
    const item = (await boards.detail(id))?.items[1];
    await expect(
      boards.updateItem(id, item?.id as string, BoardItemPatchSchema.parse({ role: 'overall' }), ada),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('hides a trashed asset and brings it back at its place on restore, across a reorder', async () => {
    const [a, b, c] = [await asset('A'), await asset('B'), await asset('C')];
    const { id } = await create({ title: 'Trash' });
    await add(id, { assetIds: [a, b, c] });
    await edit.trash(b, ada);
    const visible = (await boards.detail(id))?.items ?? [];
    expect(visible.map((i) => i.asset.title)).toEqual(['A', 'C']);
    expect((await boards.list()).find((s) => s.id === id)?.itemCount).toBe(2);

    await boards.reorder(id, [visible[1].id, visible[0].id].map(String), ada);
    await edit.restore(b, ada);
    expect((await boards.detail(id))?.items.map((i) => i.asset.title)).toEqual(['C', 'B', 'A']);
  });

  it('refuses a trashed asset', async () => {
    const a = await asset('A');
    await edit.trash(a, ada);
    const { id } = await create({ title: 'Limits' });
    await expect(add(id, { assetIds: [a] })).rejects.toThrow('trash');
  });

  it('lets only the creator or an admin delete a board, and keeps its content in the audit log', async () => {
    const a = await asset('A');
    const { id } = await create({ title: 'Mine' });
    await add(id, { assetIds: [a], weight: 'avoid' });
    await expect(boards.remove(id, bob)).rejects.toBeInstanceOf(ForbiddenException);
    await boards.remove(id, admin);
    expect(await boards.detail(id)).toBeNull();
    const [entry] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, id), eq(auditLog.action, 'board.deleted')));
    expect(entry.diff).toMatchObject({ title: 'Mine', items: [{ assetId: a, weight: 'avoid' }] });
    expect(await db.select().from(assets).where(eq(assets.id, a))).toHaveLength(1);
  });
});

describe('smart boards', () => {
  it('stores the filter and always shows its current result', async () => {
    expect(() => BoardCreateSchema.parse({ title: 'Empty', filter: {} })).toThrow('at least one filter');
    const { id } = await create({ title: 'Smart', filter: { q: 'Zebra', cursor: 'x', review: '1' } });
    let board = await boards.detail(id);
    expect(board).toMatchObject({ kind: 'smart', filter: { q: 'Zebra' }, items: [] });

    await asset('Zebra crossing');
    board = await boards.detail(id);
    expect(board?.items).toMatchObject([{ id: null, role: 'overall', weight: 'primary', asset: { title: 'Zebra crossing' } }]);
    expect((await boards.list()).find((s) => s.id === id)).toMatchObject({ kind: 'smart', itemCount: 1 });
  });

  it('refuses curating its items', async () => {
    const a = await asset('A');
    const { id } = await create({ title: 'Smart', filter: { q: 'A' } });
    await expect(add(id, { assetIds: [a] })).rejects.toBeInstanceOf(ConflictException);
  });
});
