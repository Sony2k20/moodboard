import { PGlite } from '@electric-sql/pglite';
import { assets, auditLog, Database, schema, seedVocabulary, users } from '@moodboard/db';
import { ComponentCodeSchema, StorageService } from '@moodboard/shared';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { join } from 'node:path';
import { AssetSearchService } from './asset-search.service';
import { AssetsService } from './assets.service';
import { PipelineQueue } from './pipeline.queue';

/** Components as code (0018) against a real Postgres: what is recorded, and what a save does. */

const MIGRATIONS = join(__dirname, '../../../../../libs/db/migrations');
const storage = { url: (path: string) => `/files/${path}` } as StorageService;

let client: PGlite;
let db: Database;
let service: AssetsService;
let search: AssetSearchService;
let userId: string;
const startPipeline = jest.fn(async () => true);
const button = ComponentCodeSchema.parse({
  html: '<button class="go">Go</button>',
  css: '.go { transition: transform .2s } .go:hover { transform: scale(1.05) }',
  width: 390,
});

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Database;
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
  await seedVocabulary(db);
  [{ id: userId }] = await db
    .insert(users)
    .values({ sub: 'ada', email: 'ada@example.com', displayName: 'Ada' })
    .returning({ id: users.id });
  service = new AssetsService(db, storage, { startPipeline } as unknown as PipelineQueue);
  search = new AssetSearchService(db, storage);
}, 60_000);

afterAll(() => client.close());

beforeEach(() => startPipeline.mockClear());

describe('components', () => {
  it('records the code as the asset, the type as the person’s, and starts the component pipeline', async () => {
    const { id } = await service.ingestComponent({ code: button, title: 'Go button', userId });
    const detail = await search.detail(id);
    expect(detail).toMatchObject({
      type: 'component',
      status: 'pending',
      title: 'Go button',
      titleOrigin: 'human',
      decidedFacets: ['type'],
      component: { html: button.html, css: button.css, js: '', width: 390 },
    });
    expect(startPipeline).toHaveBeenCalledWith(id, 'component');
  });

  it('leaves an untitled component to the model to name', async () => {
    const { id } = await service.ingestComponent({ code: button, userId });
    expect(await search.detail(id)).toMatchObject({ title: null, titleOrigin: 'ai' });
  });

  it('saves a new version, keeps the old one in the audit log, and renders again', async () => {
    const { id } = await service.ingestComponent({ code: button, userId });
    startPipeline.mockClear();
    const next = { ...button, css: '.go { color: red }', width: 1280 };
    expect(await service.updateComponent(id, next, userId)).toBe(true);
    expect((await search.detail(id))?.component).toEqual({ html: button.html, css: next.css, js: '', width: 1280 });
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'component.updated'));
    expect(entry).toMatchObject({ entityId: id, userId, diff: { before: { css: button.css, width: 390 } } });
    expect(startPipeline).toHaveBeenCalledWith(id, 'component');
  });

  it('refuses to save into a trashed asset or one that is no component', async () => {
    const { id } = await service.ingestComponent({ code: button, userId });
    await db.update(assets).set({ deletedAt: new Date() }).where(eq(assets.id, id));
    expect(await service.updateComponent(id, button, userId)).toBe(false);
    const { id: website } = await service.ingestUrl({ url: 'https://example.com/', userId });
    expect(await service.updateComponent(website, button, userId)).toBe(false);
  });
});
