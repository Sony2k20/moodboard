import { PGlite } from '@electric-sql/pglite';
import {
  assetFacetValues,
  assets,
  Database,
  facets,
  facetValues,
  schema,
  seedVocabulary,
  users,
} from '@moodboard/db';
import { AssetQuerySchema, StorageService } from '@moodboard/shared';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { join } from 'node:path';
import { AssetSearchService } from './asset-search.service';
import { AssetsService } from './assets.service';
import { PipelineQueue } from './pipeline.queue';

/**
 * Websites as assets (0011) against a real Postgres with the real guards: what the api records,
 * what a re-analysis may not change, and which failures the overview shows.
 */

const MIGRATIONS = join(__dirname, '../../../../../libs/db/migrations');
const storage = { url: (path: string) => `/files/${path}` } as StorageService;

let client: PGlite;
let db: Database;
let service: AssetsService;
let search: AssetSearchService;
let userId: string;
const startPipeline = jest.fn(async () => true);

async function valueId(key: string): Promise<string> {
  const [facet, value] = key.split(':');
  const [row] = await db
    .select({ id: facetValues.id })
    .from(facetValues)
    .innerJoin(facets, eq(facets.id, facetValues.facetId))
    .where(and(eq(facets.key, facet), eq(facetValues.value, value)));
  return row.id;
}

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

describe('AssetsService.ingestUrl', () => {
  it('records a pending website with its URL and starts the website pipeline', async () => {
    const { id } = await service.ingestUrl({ url: 'https://example.com/', userId });
    const detail = await search.detail(id);
    expect(detail).toMatchObject({
      type: 'website',
      status: 'pending',
      statusReason: null,
      sourceUrl: 'https://example.com/',
      title: null,
      titleOrigin: 'ai',
    });
    expect(startPipeline).toHaveBeenCalledWith(id, 'website');
  });

  it('decides the type as the person’s, so a re-analysis cannot call it an image', async () => {
    const { id } = await service.ingestUrl({ url: 'https://example.org/', userId });
    expect((await search.detail(id))?.decidedFacets).toEqual(['type']);

    // What the classify step writes when the model sees a screenshot and says "image".
    const image = await valueId('type:image');
    await db.transaction(async (tx) => {
      await tx
        .delete(assetFacetValues)
        .where(and(eq(assetFacetValues.assetId, id), eq(assetFacetValues.origin, 'ai')));
      await tx
        .insert(assetFacetValues)
        .values({ assetId: id, facetValueId: image, origin: 'ai', confidence: 0.9 })
        .onConflictDoNothing();
    });

    const facetsAfter = (await search.detail(id))?.facets.filter((f) => f.facet === 'type');
    expect(facetsAfter).toEqual([
      expect.objectContaining({ value: 'website', origin: 'human' }),
    ]);
  });

  it('keeps a title the person gave', async () => {
    const { id } = await service.ingestUrl({
      url: 'https://example.net/',
      title: 'Linear pricing',
      userId,
    });
    expect(await search.detail(id)).toMatchObject({
      title: 'Linear pricing',
      titleOrigin: 'human',
    });
  });
});

describe('failed captures', () => {
  it('are listed in the overview with their reason, unlike failed uploads', async () => {
    const { id: site } = await service.ingestUrl({ url: 'https://blocked.example/', userId });
    await db
      .update(assets)
      .set({ status: 'failed', statusReason: 'blocked' })
      .where(eq(assets.id, site));
    const [{ id: upload }] = await db
      .insert(assets)
      .values({ type: 'image', createdBy: userId, status: 'failed' })
      .returning({ id: assets.id });

    const { items } = await search.search(AssetQuerySchema.parse({ limit: 100 }));
    const ids = items.map((item) => item.id);
    expect(ids).toContain(site);
    expect(ids).not.toContain(upload);
    expect(items.find((item) => item.id === site)).toMatchObject({
      status: 'failed',
      statusReason: 'blocked',
      sourceUrl: 'https://blocked.example/',
    });
  });

  it('can be retried, which clears the reason; nothing else can', async () => {
    const { id } = await service.ingestUrl({ url: 'https://retry.example/', userId });
    expect(await service.retryCapture(id, userId)).toBe(false); // still pending

    await db
      .update(assets)
      .set({ status: 'failed', statusReason: 'timeout' })
      .where(eq(assets.id, id));
    startPipeline.mockClear();
    expect(await service.retryCapture(id, userId)).toBe(true);
    expect(await search.detail(id)).toMatchObject({ status: 'pending', statusReason: null });
    expect(startPipeline).toHaveBeenCalledWith(id, 'website');

    const [{ id: upload }] = await db
      .insert(assets)
      .values({ type: 'image', createdBy: userId, status: 'failed' })
      .returning({ id: assets.id });
    expect(await service.retryCapture(upload, userId)).toBe(false);
  });
});
