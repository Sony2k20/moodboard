import { PGlite } from '@electric-sql/pglite';
import { BadRequestException } from '@nestjs/common';
import {
  analysisRuns,
  assetFacetDecisions,
  assetFacetValues,
  assetFiles,
  assets,
  assetTags,
  Database,
  facets,
  facetValues,
  schema,
  seedVocabulary,
  tags,
  users,
} from '@moodboard/db';
import { AssetQuerySchema, StorageService } from '@moodboard/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { join } from 'node:path';
import { AssetSearchService } from './asset-search.service';

/**
 * The search against a real Postgres (PGlite, in process): the real migrations, triggers and
 * `tsvector`. The semantics of 0005 live in SQL, so a mocked database would only test the mock.
 */

const MIGRATIONS = join(__dirname, '../../../../../libs/db/migrations');
const storage = { url: (path: string) => `/files/${path}` } as StorageService;

let client: PGlite;
let db: Database;
let service: AssetSearchService;
let ada: string;
let bob: string;

/** Creates an asset with the given facets and tags; `minutesAgo` orders them. */
async function asset(input: {
  title: string;
  minutesAgo: number;
  author?: string;
  facets?: string[];
  tags?: string[];
  description?: string;
  status?: 'pending' | 'ready' | 'failed';
  deleted?: boolean;
}): Promise<string> {
  const createdAt = new Date(Date.UTC(2026, 9, 30, 12) - input.minutesAgo * 60_000);
  const [row] = await db
    .insert(assets)
    .values({
      type: 'image',
      title: input.title,
      description: input.description ?? null,
      createdBy: input.author ?? ada,
      createdAt,
      status: input.status ?? 'ready',
      deletedAt: input.deleted ? new Date() : null,
    })
    .returning({ id: assets.id });

  for (const key of input.facets ?? []) {
    const [facet, value] = key.split(':');
    const [fv] = await db
      .select({ id: facetValues.id })
      .from(facetValues)
      .innerJoin(facets, eq(facets.id, facetValues.facetId))
      .where(and(eq(facets.key, facet), eq(facetValues.value, value)));
    await db
      .insert(assetFacetValues)
      .values({ assetId: row.id, facetValueId: fv.id, origin: 'ai', confidence: 0.9 });
  }
  for (const name of input.tags ?? []) {
    await db.insert(tags).values({ name }).onConflictDoNothing();
    const [tag] = await db.select({ id: tags.id }).from(tags).where(eq(tags.name, name));
    await db.insert(assetTags).values({ assetId: row.id, tagId: tag.id, origin: 'ai' });
  }
  await db.insert(assetFiles).values({
    assetId: row.id,
    kind: 'thumb_md',
    path: `${row.id}/thumb-md.webp`,
    mime: 'image/webp',
    width: 800,
    height: 600,
    bytes: 1,
  });
  if (input.facets?.length) {
    await db.insert(analysisRuns).values({
      assetId: row.id,
      provider: 'anthropic',
      model: 'claude-opus-5',
      promptVersion: 1,
      status: 'succeeded',
    });
  }
  return row.id;
}

const search = (raw: Record<string, unknown>) =>
  service.search(AssetQuerySchema.parse(raw));
const titles = async (raw: Record<string, unknown>) =>
  (await search(raw)).items.map((item) => item.title);

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Database;
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
  await seedVocabulary(db);
  service = new AssetSearchService(db, storage);

  [{ id: ada }, { id: bob }] = await db
    .insert(users)
    .values([
      { sub: 'ada', email: 'ada@example.com', displayName: 'Ada' },
      { sub: 'bob', email: 'bob@example.com', displayName: 'Bob' },
    ])
    .returning({ id: users.id });

  await asset({
    title: 'editorial dark',
    minutesAgo: 1,
    facets: ['style:editorial', 'theme:dark', 'ui_pattern:hero'],
    description: 'A dark editorial hero with oversized serif headlines.',
    tags: ['Dark-Mode'],
  });
  await asset({
    title: 'swiss light',
    minutesAgo: 2,
    facets: ['style:swiss', 'theme:light'],
    description: 'A pricing table on a strict grid.',
    author: bob,
  });
  await asset({
    title: 'swiss dark',
    minutesAgo: 3,
    facets: ['style:swiss', 'theme:dark'],
    description: 'Warm, earthy tones behind a product grid.',
  });
  await asset({ title: 'minimal light', minutesAgo: 4, facets: ['style:minimal', 'theme:light'] });
  await asset({ title: 'still pending', minutesAgo: 0, status: 'pending' });
  await asset({ title: 'unreadable', minutesAgo: 5, status: 'failed' });
  await asset({
    title: 'in the trash',
    minutesAgo: 6,
    facets: ['style:editorial', 'theme:dark'],
    deleted: true,
  });
}, 60_000);

afterAll(() => client.close());

describe('AssetSearchService.search', () => {
  it('lists newest first, pending included, failed and deleted left out', async () => {
    expect(await titles({})).toEqual([
      'still pending',
      'editorial dark',
      'swiss light',
      'swiss dark',
      'minimal light',
    ]);
  });

  it('combines values within a facet with OR and facets with AND', async () => {
    expect(await titles({ facet: ['style:editorial', 'style:swiss'] })).toEqual([
      'editorial dark',
      'swiss light',
      'swiss dark',
    ]);
    expect(
      await titles({ facet: ['style:editorial', 'style:swiss', 'theme:dark'] }),
    ).toEqual(['editorial dark', 'swiss dark']);
  });

  it('counts a facet without its own selection, and the others within the result', async () => {
    const { counts, total } = await search({ facet: ['style:swiss'] });
    const count = (key: string) =>
      counts.facets.find((c) => `${c.facet}:${c.value}` === key)?.count;

    expect(total).toBe(2);
    // Same facet: what the result would be with the value added (OR).
    expect(count('style:swiss')).toBe(2);
    expect(count('style:editorial')).toBe(1);
    expect(count('style:minimal')).toBe(1);
    // Other facets: within the current result.
    expect(count('theme:dark')).toBe(1);
    expect(count('theme:light')).toBe(1);
    expect(count('ui_pattern:hero')).toBeUndefined();
  });

  it('counts authors without the author filter', async () => {
    const { items, counts } = await search({ author: bob });
    expect(items.map((i) => i.title)).toEqual(['swiss light']);
    expect(counts.authors).toEqual([
      { id: ada, displayName: 'Ada', count: 4 },
      { id: bob, displayName: 'Bob', count: 1 },
    ]);
  });

  it('searches the description with English stemming, and tags exactly', async () => {
    expect(await titles({ q: 'prices' })).toEqual(['swiss light']);
    expect(await titles({ q: 'earthy warm' })).toEqual(['swiss dark']);
    expect(await titles({ q: 'dark-mode' })).toEqual(['editorial dark']);
    expect(await titles({ tag: 'dark-mode' })).toEqual(['editorial dark']);
    expect(await titles({ tag: 'darkmode' })).toEqual([]);
  });

  it('pages by cursor without gaps or repeats, also for assets created in the same instant', async () => {
    const twins = new Date(Date.UTC(2026, 9, 29, 12));
    const ids = await db
      .insert(assets)
      .values(
        Array.from({ length: 5 }, (_, i) => ({
          type: 'image',
          title: `twin ${i}`,
          createdBy: ada,
          createdAt: twins,
          status: 'ready' as const,
        })),
      )
      .returning({ id: assets.id });

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await search({ limit: '3', ...(cursor ? { cursor } : {}) });
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    expect(seen).toHaveLength(10);
    expect(new Set(seen).size).toBe(10);
    await db.delete(assets).where(inArray(assets.id, ids.map((r) => r.id)));
  });

  it('refuses an unknown facet value instead of returning nothing', async () => {
    await expect(search({ facet: 'style:nonsense' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(search({ facet: 'colour:red' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('returns cards with thumbnail, facet keys and tags', async () => {
    const [card] = (await search({ facet: 'ui_pattern:hero' })).items;
    expect(card).toMatchObject({
      title: 'editorial dark',
      classified: true,
      author: { id: ada, displayName: 'Ada' },
      thumbnail: { url: `/files/${card.id}/thumb-md.webp`, width: 800, height: 600 },
      tags: ['Dark-Mode'],
    });
    expect(card.facets).toEqual(
      expect.arrayContaining([
        { facet: 'style', value: 'editorial', origin: 'ai' },
        { facet: 'theme', value: 'dark', origin: 'ai' },
      ]),
    );
    expect(card.unconfirmedFacets).toBe(3);
  });

  it('counts a facet as confirmed once a person has decided it (0012)', async () => {
    const [before] = (await search({ facet: 'ui_pattern:hero' })).items;
    const [style] = await db.select({ id: facets.id }).from(facets).where(eq(facets.key, 'style'));
    await db.insert(assetFacetDecisions).values({ assetId: before.id, facetId: style.id });
    const [after] = (await search({ facet: 'ui_pattern:hero' })).items;
    expect(after.unconfirmedFacets).toBe(2);
    await db.delete(assetFacetDecisions).where(eq(assetFacetDecisions.assetId, before.id));
  });
});

describe('AssetSearchService.detail', () => {
  it('returns facets with their origin and the classification run', async () => {
    const [card] = (await search({ facet: 'ui_pattern:hero' })).items;
    const detail = await service.detail(card.id);
    expect(detail).toMatchObject({
      title: 'editorial dark',
      descriptionOrigin: 'ai',
      classification: { provider: 'anthropic', model: 'claude-opus-5', promptVersion: 1 },
      tags: [{ name: 'Dark-Mode', origin: 'ai' }],
    });
    expect(detail?.facets).toContainEqual({
      facet: 'style',
      value: 'editorial',
      origin: 'ai',
      confidence: 0.9,
    });
  });

  it('does not return an asset in the trash', async () => {
    const [trashed] = await db
      .select({ id: assets.id })
      .from(assets)
      .where(eq(assets.title, 'in the trash'));
    expect(await service.detail(trashed.id)).toBeNull();
  });
});

describe('AssetSearchService.vocabulary', () => {
  it('lists facets with their values in order, with labels in both languages', async () => {
    const vocabulary = await service.vocabulary();
    const theme = vocabulary.find((f) => f.key === 'theme');
    expect(theme?.values.map((v) => v.value)).toEqual(['light', 'dark', 'both']);
    expect(theme?.label).toEqual({ en: expect.any(String), de: expect.any(String) });
  });
});
