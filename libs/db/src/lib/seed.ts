import { VOCABULARY } from '@moodboard/shared';
import { eq } from 'drizzle-orm';
import { Database, createDatabase } from './client';
import { facetValues, facets } from './schema';

export interface SeedReport {
  readonly facets: number;
  readonly values: number;
}

/**
 * Seeds the controlled vocabulary from `@moodboard/shared` (concept §6, §11 "Data").
 *
 * Idempotent by design: it upserts on `facet.key` and on `(facet_id, value)` and never deletes.
 * Not deleting is the important half — a value removed from the vocabulary in code may still be
 * assigned to assets, possibly with `origin = 'human'`, and the seed is the wrong place to decide
 * that such an assignment is to be destroyed. Removing a value is a deliberate migration.
 *
 * The seed touches `facet` and `facet_value` only. It never writes into `asset_facet_value`, so
 * it cannot collide with the invariant in §5.6.
 */
export async function seedVocabulary(db: Database): Promise<SeedReport> {
  let seededValues = 0;

  for (const [facetIndex, facet] of VOCABULARY.entries()) {
    const [facetRow] = await db
      .insert(facets)
      .values({
        key: facet.key,
        isMultiValue: facet.isMultiValue,
        label: facet.label,
        description: facet.description,
        sortOrder: facetIndex,
      })
      .onConflictDoUpdate({
        target: facets.key,
        set: {
          isMultiValue: facet.isMultiValue,
          label: facet.label,
          description: facet.description,
          sortOrder: facetIndex,
        },
      })
      .returning({ id: facets.id });

    if (!facetRow) {
      throw new Error(`Seeding facet ${facet.key} returned no row`);
    }

    for (const [valueIndex, value] of facet.values.entries()) {
      const label = (
        facet.valueLabels as Record<string, { en: string; de: string }>
      )[value];

      await db
        .insert(facetValues)
        .values({
          facetId: facetRow.id,
          value,
          sortOrder: valueIndex,
          label,
        })
        .onConflictDoUpdate({
          target: [facetValues.facetId, facetValues.value],
          set: { sortOrder: valueIndex, label },
        });

      seededValues += 1;
    }
  }

  return { facets: VOCABULARY.length, values: seededValues };
}

/** Standalone entry point, used by `npm run db:seed`. */
export async function runSeed(): Promise<SeedReport> {
  const handle = createDatabase();
  try {
    return await seedVocabulary(handle.db);
  } finally {
    await handle.close();
  }
}

/** Looks a facet up by its key — used by the seed's verification and by the API later. */
export async function findFacetByKey(db: Database, key: string) {
  const [row] = await db.select().from(facets).where(eq(facets.key, key));
  return row ?? null;
}
