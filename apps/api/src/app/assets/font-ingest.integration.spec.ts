import { PGlite } from '@electric-sql/pglite';
import { assetFiles, assetFonts, Database, schema, seedVocabulary, users } from '@moodboard/db';
import { StorageService } from '@moodboard/shared';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AssetSearchService } from './asset-search.service';
import { AssetsService } from './assets.service';
import { UnreadableFontError } from './font-reader';
import { PipelineQueue } from './pipeline.queue';

/** Fonts as assets (0017) against a real Postgres: what the api records from the file. */

const MIGRATIONS = join(__dirname, '../../../../../libs/db/migrations');
/** Inter (OFL-1.1), from the `@fontsource-variable/inter` dev dependency. */
const INTER = join(
  __dirname,
  '../../../../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
);

const stored = new Map<string, Uint8Array>();
const storage = {
  url: (path: string) => `/files/${path}`,
  put: async (path: string, bytes: Uint8Array) => {
    stored.set(path, bytes);
    return { bytes: bytes.length };
  },
  delete: async (path: string) => void stored.delete(path),
} as unknown as StorageService;

let client: PGlite;
let db: Database;
let service: AssetsService;
let search: AssetSearchService;
let userId: string;
const startPipeline = jest.fn(async () => true);

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

describe('AssetsService.ingestFont', () => {
  it('stores the file, its facts and a decided type, and starts the font pipeline', async () => {
    const { id } = await service.ingestFont({ bytes: readFileSync(INTER), format: 'woff2', userId });
    const detail = await search.detail(id);
    expect(detail).toMatchObject({
      type: 'font',
      status: 'pending',
      title: 'Inter Regular',
      titleOrigin: 'human',
      decidedFacets: ['type'],
    });
    expect(detail?.facets).toEqual([expect.objectContaining({ facet: 'type', value: 'font', origin: 'human' })]);
    expect(detail?.font).toMatchObject({ family: 'Inter', weight: 400, axes: [expect.objectContaining({ tag: 'wght' })] });
    const [file] = await db.select().from(assetFiles).where(eq(assetFiles.assetId, id));
    expect(file).toMatchObject({ kind: 'original', mime: 'font/woff2', path: `${id}/original.woff2` });
    expect(stored.has(file.path)).toBe(true);
    expect(startPipeline).toHaveBeenCalledWith(id, 'font');
  });

  it('refuses a file that is not a font before storing anything', async () => {
    const before = stored.size;
    const fonts = (await db.select().from(assetFonts)).length;
    const fake = Buffer.concat([Buffer.from('OTTO'), Buffer.alloc(300, 1)]);
    await expect(service.ingestFont({ bytes: fake, format: 'otf', userId })).rejects.toBeInstanceOf(
      UnreadableFontError,
    );
    expect(stored.size).toBe(before);
    expect(await db.select().from(assetFonts)).toHaveLength(fonts);
  });
});
