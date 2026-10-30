import { PGlite } from '@electric-sql/pglite';
import {
  assetFacetValues,
  assets,
  auditLog,
  Database,
  declareActor,
  facetValues,
  schema,
  seedVocabulary,
  users,
} from '@moodboard/db';
import { StorageService } from '@moodboard/shared';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { join } from 'node:path';
import { Purger } from './purger';

const MIGRATIONS = join(__dirname, '../../../../../libs/db/migrations');
const DAY = 86_400_000;

let client: PGlite;
let db: Database;
let owner: string;
const deleteAsset = jest.fn(async () => undefined);
const storage = { deleteAsset } as unknown as StorageService;

/** An asset with a person's facet value — what the guard refused to cascade-delete before 0006. */
async function trashed(daysAgo: number): Promise<string> {
  const [row] = await db
    .insert(assets)
    .values({
      type: 'image',
      createdBy: owner,
      status: 'ready',
      deletedAt: new Date(Date.now() - daysAgo * DAY),
    })
    .returning({ id: assets.id });
  const [value] = await db.select({ id: facetValues.id }).from(facetValues).limit(1);
  await db.transaction(async (tx) => {
    await declareActor(tx, 'human');
    await tx
      .insert(assetFacetValues)
      .values({ assetId: row.id, facetValueId: value.id, origin: 'human', setBy: owner });
  });
  return row.id;
}

const exists = async (id: string) =>
  (await db.select({ id: assets.id }).from(assets).where(eq(assets.id, id))).length > 0;

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Database;
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
  await seedVocabulary(db);
  [{ id: owner }] = await db
    .insert(users)
    .values({ sub: 'ada', email: 'ada@example.com', displayName: 'Ada' })
    .returning({ id: users.id });
}, 60_000);

afterAll(() => client.close());

describe('Purger', () => {
  it('removes what is older than the retention period, rows and files, and keeps the rest', async () => {
    const old = await trashed(31);
    const recent = await trashed(5);

    const purged = await new Purger(db, storage, 30).run();

    expect(purged).toBe(1);
    expect(await exists(old)).toBe(false);
    expect(await exists(recent)).toBe(true);
    expect(deleteAsset).toHaveBeenCalledWith(old);
    expect(deleteAsset).not.toHaveBeenCalledWith(recent);

    const [entry] = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.entityId, old));
    expect(entry.action).toBe('asset.purged');
  });

  it('needs the declared actor: without it the guard refuses the cascade', async () => {
    const id = await trashed(40);
    const error = await db
      .delete(assets)
      .where(eq(assets.id, id))
      .then(() => null, (e: Error & { cause?: Error }) => e);
    expect(error?.cause?.message ?? error?.message).toMatch(/human assignment/);
    expect(await exists(id)).toBe(true);
  });
});
