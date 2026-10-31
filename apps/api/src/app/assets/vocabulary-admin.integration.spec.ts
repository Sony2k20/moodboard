import { PGlite } from '@electric-sql/pglite';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  assetFacetValues,
  assets,
  auditLog,
  Database,
  declareActor,
  facets,
  facetValues,
  schema,
  seedVocabulary,
  users,
} from '@moodboard/db';
import { StorageService, VocabularyValueCreateSchema } from '@moodboard/shared';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { join } from 'node:path';
import { AssetSearchService } from './asset-search.service';
import { VocabularyAdminService } from './vocabulary-admin.service';

/** Maintaining `project` values (0014) against a real Postgres: the real seed and constraints. */

const MIGRATIONS = join(__dirname, '../../../../../libs/db/migrations');

let client: PGlite;
let db: Database;
let service: VocabularyAdminService;
let search: AssetSearchService;
let admin: { id: string; role: 'admin' };
let member: { id: string; role: 'member' };

const create = (value: string, en: string, editor: { id: string; role: 'admin' | 'member' } = admin) =>
  service.create(
    'project',
    VocabularyValueCreateSchema.parse({ value, label: { en, de: `${en} (de)` } }),
    editor,
  );

const projectValues = async () =>
  (await search.vocabulary()).find((facet) => facet.key === 'project')?.values ?? [];

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Database;
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
  await seedVocabulary(db);
  service = new VocabularyAdminService(db);
  search = new AssetSearchService(db, { url: (path: string) => path } as StorageService);
  const [a, m] = await db
    .insert(users)
    .values([
      { sub: 'ada', email: 'ada@example.com', displayName: 'Ada', role: 'admin' },
      { sub: 'bob', email: 'bob@example.com', displayName: 'Bob' },
    ])
    .returning({ id: users.id });
  admin = { id: a.id, role: 'admin' };
  member = { id: m.id, role: 'member' };
}, 60_000);

afterAll(() => client.close());

describe('VocabularyAdminService', () => {
  it('adds project values in order, with both labels, and audits each', async () => {
    await create('client-x', 'Client X');
    await create('relaunch-2027', 'Relaunch 2027');
    expect(await projectValues()).toEqual([
      { value: 'client-x', label: { en: 'Client X', de: 'Client X (de)' }, description: null },
      { value: 'relaunch-2027', label: { en: 'Relaunch 2027', de: 'Relaunch 2027 (de)' }, description: null },
    ]);
    const entries = await db
      .select({ action: auditLog.action, entity: auditLog.entity, userId: auditLog.userId })
      .from(auditLog)
      .where(eq(auditLog.action, 'vocabulary.value_created'));
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({ action: 'vocabulary.value_created', entity: 'facet_value', userId: admin.id });
  });

  it('refuses a key that exists, a member, and a classified facet', async () => {
    await expect(create('client-x', 'Again')).rejects.toBeInstanceOf(ConflictException);
    await expect(create('client-y', 'Client Y', member)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.create(
        'style',
        VocabularyValueCreateSchema.parse({ value: 'art-deco', label: { en: 'Art deco', de: 'Art déco' } }),
        admin,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create('colour', VocabularyValueCreateSchema.parse({ value: 'red', label: { en: 'Red', de: 'Rot' } }), admin),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('relabels a value without touching its key', async () => {
    await service.update(
      'project',
      'client-x',
      { label: { en: 'Client X GmbH', de: 'Kunde X GmbH' }, description: { en: 'Pitch', de: 'Pitch' } },
      admin,
    );
    expect((await projectValues())[0]).toEqual({
      value: 'client-x',
      label: { en: 'Client X GmbH', de: 'Kunde X GmbH' },
      description: { en: 'Pitch', de: 'Pitch' },
    });
    await expect(
      service.update('project', 'nope', { description: null }, admin),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deletes a value only while no asset carries it, trashed ones included', async () => {
    const [value] = await db
      .select({ id: facetValues.id })
      .from(facetValues)
      .innerJoin(facets, eq(facets.id, facetValues.facetId))
      .where(and(eq(facets.key, 'project'), eq(facetValues.value, 'client-x')));
    const [asset] = await db
      .insert(assets)
      .values({ type: 'image', title: 'in the trash', createdBy: admin.id, status: 'ready', deletedAt: new Date() })
      .returning({ id: assets.id });
    await db
      .insert(assetFacetValues)
      .values({ assetId: asset.id, facetValueId: value.id, origin: 'human', setBy: admin.id });

    await expect(service.remove('project', 'client-x', admin)).rejects.toBeInstanceOf(ConflictException);

    await db.transaction(async (tx) => {
      await declareActor(tx, 'purge');
      await tx.delete(assets).where(eq(assets.id, asset.id));
    });
    await service.remove('project', 'client-x', admin);
    expect((await projectValues()).map((v) => v.value)).toEqual(['relaunch-2027']);
    const [deleted] = await db
      .select({ entityId: auditLog.entityId })
      .from(auditLog)
      .where(eq(auditLog.action, 'vocabulary.value_deleted'));
    expect(deleted.entityId).toBe(value.id);
  });

  it('keeps admin values when the seed runs again on the next deploy', async () => {
    await seedVocabulary(db);
    expect((await projectValues()).map((v) => v.value)).toEqual(['relaunch-2027']);
  });
});
