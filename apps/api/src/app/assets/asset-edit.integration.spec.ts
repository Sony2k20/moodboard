import { PGlite } from '@electric-sql/pglite';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  assetFacetValues,
  assets,
  assetTags,
  auditLog,
  Database,
  facets,
  facetValues,
  schema,
  seedVocabulary,
  tags,
  users,
} from '@moodboard/db';
import { BulkActionSchema, StorageService } from '@moodboard/shared';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { join } from 'node:path';
import { AssetEditService, Editor } from './asset-edit.service';
import { AssetSearchService } from './asset-search.service';

/**
 * Editing against a real Postgres with the real guards (0006). What matters here is what a
 * re-analysis does afterwards, so `reclassify` replays the classify step's writes: delete the ai
 * rows, insert the model's values as ai.
 */

const MIGRATIONS = join(__dirname, '../../../../../libs/db/migrations');
const MODEL_NOTES = {
  composition: 'model composition',
  imagery: '',
  surfaces: '',
  shapes: '',
  typography: '',
  components: '',
  details: '',
};
const storage = { url: (path: string) => `/files/${path}` } as StorageService;

let client: PGlite;
let db: Database;
let edit: AssetEditService;
let search: AssetSearchService;
let ada: Editor;
let bob: Editor;
let admin: Editor;

async function valueId(key: string): Promise<string> {
  const [facet, value] = key.split(':');
  const [row] = await db
    .select({ id: facetValues.id })
    .from(facetValues)
    .innerJoin(facets, eq(facets.id, facetValues.facetId))
    .where(and(eq(facets.key, facet), eq(facetValues.value, value)));
  return row.id;
}

/** What the classify step writes, in the same order (classify.step.ts). */
async function reclassify(assetId: string, facetKeys: string[], tagNames: string[] = []) {
  // Resolved outside the transaction: PGlite has one connection, and a query on `db` while a
  // transaction is open would wait for that transaction forever.
  const valueIds = await Promise.all(facetKeys.map(valueId));
  await db.transaction(async (tx) => {
    await tx
      .delete(assetFacetValues)
      .where(and(eq(assetFacetValues.assetId, assetId), eq(assetFacetValues.origin, 'ai')));
    for (const facetValueId of valueIds) {
      await tx
        .insert(assetFacetValues)
        .values({ assetId, facetValueId, origin: 'ai', confidence: 0.8 })
        .onConflictDoNothing();
    }
    await tx
      .delete(assetTags)
      .where(and(eq(assetTags.assetId, assetId), eq(assetTags.origin, 'ai')));
    for (const name of tagNames) {
      await tx.insert(tags).values({ name }).onConflictDoNothing();
      const [tag] = await tx.select({ id: tags.id }).from(tags).where(eq(tags.name, name));
      await tx
        .insert(assetTags)
        .values({ assetId, tagId: tag.id, origin: 'ai' })
        .onConflictDoNothing();
    }
    await tx
      .update(assets)
      .set({
        description: 'model description',
        descriptionOrigin: 'ai',
        title: 'Model title',
        titleOrigin: 'ai',
        designNotes: MODEL_NOTES,
        designNotesOrigin: 'ai',
      })
      .where(eq(assets.id, assetId));
  });
}

async function newAsset(owner: Editor, facetKeys: string[] = [], tagNames: string[] = []) {
  const [row] = await db
    .insert(assets)
    .values({ type: 'image', title: 'asset', createdBy: owner.id, status: 'ready' })
    .returning({ id: assets.id });
  await reclassify(row.id, facetKeys, tagNames);
  return row.id;
}

async function facetsOf(id: string) {
  const detail = await search.detail(id);
  return detail?.facets.map((f) => `${f.facet}:${f.value}:${f.origin}`).sort();
}

async function tagsOf(id: string) {
  const detail = await search.detail(id);
  return detail?.tags.map((t) => `${t.name}:${t.origin}`).sort();
}

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Database;
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
  await seedVocabulary(db);
  edit = new AssetEditService(db);
  search = new AssetSearchService(db, storage);

  const rows = await db
    .insert(users)
    .values([
      { sub: 'ada', email: 'ada@example.com', displayName: 'Ada' },
      { sub: 'bob', email: 'bob@example.com', displayName: 'Bob' },
      { sub: 'root', email: 'root@example.com', displayName: 'Root', role: 'admin' },
    ])
    .returning({ id: users.id, role: users.role });
  [ada, bob, admin] = rows;
}, 60_000);

afterAll(() => client.close());

describe('facet edits', () => {
  it('keeps an edited facet through a re-analysis, with the kept model values now human', async () => {
    const id = await newAsset(ada, ['mood:calm', 'mood:warm', 'style:minimal']);
    await edit.setFacet(id, 'mood', ['calm', 'playful'], bob);

    await reclassify(id, ['mood:serious', 'style:swiss']);

    expect(await facetsOf(id)).toEqual([
      'mood:calm:human',
      'mood:playful:human',
      'style:swiss:ai',
    ]);
    expect((await search.detail(id))?.decidedFacets).toEqual(['mood']);
  });

  it('keeps an emptied facet empty through a re-analysis', async () => {
    const id = await newAsset(ada, ['motion:parallax', 'theme:light']);
    await edit.setFacet(id, 'motion', [], ada);

    await reclassify(id, ['motion:fade', 'theme:dark']);

    expect(await facetsOf(id)).toEqual(['theme:dark:ai']);
    expect((await search.detail(id))?.decidedFacets).toEqual(['motion']);
  });

  it('lets a person change their own earlier correction', async () => {
    const id = await newAsset(ada, ['theme:light']);
    await edit.setFacet(id, 'theme', ['dark'], ada);
    await edit.setFacet(id, 'theme', ['both'], bob);
    expect(await facetsOf(id)).toEqual(['theme:both:human']);
  });

  it('mirrors the type facet into asset.type', async () => {
    const id = await newAsset(ada, ['type:image']);
    await edit.setFacet(id, 'type', ['website'], ada);
    const [row] = await db.select({ type: assets.type }).from(assets).where(eq(assets.id, id));
    expect(row.type).toBe('website');
  });

  it('refuses unknown values and a second value on a single-value facet', async () => {
    const id = await newAsset(ada);
    await expect(edit.setFacet(id, 'mood', ['grumpy'], ada)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(edit.setFacet(id, 'theme', ['light', 'dark'], ada)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(edit.setFacet(id, 'colour', [], ada)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('still refuses a model deleting a human value outside an edit', async () => {
    const id = await newAsset(ada);
    await edit.setFacet(id, 'mood', ['calm'], ada);
    // Drizzle wraps the database error; the guard's message is its cause.
    const error = await db
      .delete(assetFacetValues)
      .where(eq(assetFacetValues.assetId, id))
      .then(() => null, (e: Error & { cause?: Error }) => e);
    expect(error?.cause?.message ?? error?.message).toMatch(/human assignment/);
    expect(await facetsOf(id)).toEqual(['mood:calm:human']);
  });
});

describe('tag edits', () => {
  it('remembers a removed tag, so a re-analysis does not bring it back', async () => {
    const id = await newAsset(ada, [], ['wireframe', 'blue']);
    await edit.setTags(id, ['blue', 'Client X'], ada);

    expect(await tagsOf(id)).toEqual(['blue:human', 'client x:human']);
    await reclassify(id, [], ['wireframe', 'mockup']);
    expect(await tagsOf(id)).toEqual(['blue:human', 'client x:human', 'mockup:ai']);
  });

  it('lifts the rejection when the tag is added again by hand', async () => {
    const id = await newAsset(ada, [], ['wireframe']);
    await edit.setTags(id, [], ada);
    await edit.setTags(id, ['wireframe'], ada);
    await reclassify(id, [], ['wireframe']);
    expect(await tagsOf(id)).toEqual(['wireframe:human']);
  });
});

describe('text edits', () => {
  it('keeps a person’s description through a re-analysis', async () => {
    const id = await newAsset(ada);
    await edit.updateText(id, { description: 'A calm hero, by hand.', title: 'Hero' }, bob);
    await reclassify(id, [], []);
    const detail = await search.detail(id);
    expect(detail).toMatchObject({
      title: 'Hero',
      description: 'A calm hero, by hand.',
      descriptionOrigin: 'human',
      titleOrigin: 'human',
    });
  });

  it('gives a title nobody chose to the model, and keeps one a person chose (0007)', async () => {
    const [unnamed] = await db
      .insert(assets)
      .values({ type: 'image', title: null, createdBy: ada.id, status: 'ready' })
      .returning({ id: assets.id });
    const [named] = await db
      .insert(assets)
      .values({
        type: 'image',
        title: 'Stripe pricing page',
        titleOrigin: 'human',
        createdBy: ada.id,
        status: 'ready',
      })
      .returning({ id: assets.id });

    await reclassify(unnamed.id, []);
    await reclassify(named.id, []);

    expect(await search.detail(unnamed.id)).toMatchObject({
      title: 'Model title',
      titleOrigin: 'ai',
    });
    expect(await search.detail(named.id)).toMatchObject({
      title: 'Stripe pricing page',
      titleOrigin: 'human',
    });
  });

  it('hands a cleared title back to the model', async () => {
    const id = await newAsset(ada);
    await edit.updateText(id, { title: 'My name for it' }, ada);
    await edit.updateText(id, { title: '' }, ada);
    await reclassify(id, []);
    expect(await search.detail(id)).toMatchObject({ title: 'Model title', titleOrigin: 'ai' });
  });

  it('keeps a person’s design notes through a re-analysis (0009)', async () => {
    const id = await newAsset(ada);
    expect((await search.detail(id))?.designNotes).toEqual(MODEL_NOTES);
    const mine = { ...MODEL_NOTES, surfaces: 'Sand relief, soft shadows — by hand.' };
    await db
      .update(assets)
      .set({ designNotes: mine, designNotesOrigin: 'human' })
      .where(eq(assets.id, id));
    await reclassify(id, []);
    expect(await search.detail(id)).toMatchObject({
      designNotes: mine,
      designNotesOrigin: 'human',
    });
  });

  it('does not let a model write take a person’s title, outside an edit', async () => {
    const id = await newAsset(ada);
    await edit.updateText(id, { title: 'Hand title' }, ada);
    await db
      .update(assets)
      .set({ title: null, titleOrigin: 'ai' })
      .where(eq(assets.id, id));
    expect(await search.detail(id)).toMatchObject({ title: 'Hand title', titleOrigin: 'human' });
  });
});

describe('bulk actions', () => {
  it('tags many assets at once and writes one audit entry per asset', async () => {
    const ids = [await newAsset(ada), await newAsset(bob), await newAsset(ada)];
    const result = await edit.bulk(
      BulkActionSchema.parse({ action: 'tags', ids, add: ['Client X'] }),
      bob,
    );
    expect(result.changed).toBe(3);
    for (const id of ids) {
      expect(await tagsOf(id)).toEqual(['client x:human']);
    }
    const audits = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(eq(auditLog.action, 'asset.tags_changed'));
    expect(audits.length).toBeGreaterThanOrEqual(3);
  });

  it('adds a facet value without dropping the others, and replaces a single value', async () => {
    const id = await newAsset(ada, ['style:minimal', 'theme:light']);
    await edit.bulk(
      BulkActionSchema.parse({
        action: 'facets',
        ids: [id],
        add: ['style:editorial', 'theme:dark'],
      }),
      ada,
    );
    expect(await facetsOf(id)).toEqual([
      'style:editorial:human',
      'style:minimal:human',
      'theme:dark:human',
    ]);
  });

  it('refuses to trash other people’s assets for a member, all or nothing', async () => {
    const own = await newAsset(ada);
    const other = await newAsset(bob);
    await expect(
      edit.bulk(BulkActionSchema.parse({ action: 'trash', ids: [own, other] }), ada),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await search.detail(own)).not.toBeNull();
  });
});

describe('trash', () => {
  it('moves an own asset to the trash and back', async () => {
    const id = await newAsset(ada);
    await edit.trash(id, ada);
    expect(await search.detail(id)).toBeNull();
    expect((await search.trash(ada, 30)).map((t) => t.id)).toContain(id);
    expect((await search.trash(bob, 30)).map((t) => t.id)).not.toContain(id);

    await edit.restore(id, ada);
    expect(await search.detail(id)).not.toBeNull();
  });

  it('lets an admin delete and restore anyone’s asset, and a member only their own', async () => {
    const id = await newAsset(bob);
    await expect(edit.trash(id, ada)).rejects.toBeInstanceOf(ForbiddenException);
    await edit.trash(id, admin);
    expect((await search.trash(admin, 30)).map((t) => t.id)).toContain(id);
    await expect(edit.restore(id, ada)).rejects.toBeInstanceOf(ForbiddenException);
    await edit.restore(id, admin);
  });

  it('does not edit an asset in the trash', async () => {
    const id = await newAsset(ada);
    await edit.trash(id, ada);
    await expect(edit.setTags(id, ['x'], ada)).rejects.toBeInstanceOf(NotFoundException);
  });
});
