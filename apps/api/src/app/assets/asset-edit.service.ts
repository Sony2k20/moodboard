import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  assetFacetDecisions,
  assetFacetValues,
  assets,
  assetTagRejections,
  assetTags,
  auditLog,
  Database,
  declareActor,
  facets,
  facetValues,
  tags,
} from '@moodboard/db';
import {
  AssetTextPatch,
  BulkAction,
  BulkResult,
  FacetFilter,
  normaliseTags,
} from '@moodboard/shared';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { DATABASE } from '../database.module';

/** A transaction of the database, as drizzle hands it to `transaction()`. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface Editor {
  readonly id: string;
  readonly role: 'admin' | 'member';
}

interface FacetInfo {
  readonly id: string;
  readonly key: string;
  readonly isMultiValue: boolean;
  /** value key → facet_value id */
  readonly values: ReadonlyMap<string, string>;
}

/**
 * The write side (0006). Every change is a person's and goes in as `origin = 'human'`, in a
 * transaction that declares the actor — the only way the guards let a `human` row be deleted
 * (migration 0006). Single edits and bulk actions share the same `apply…` steps, so a bulk action
 * means exactly what the same edit on each asset would mean.
 */
@Injectable()
export class AssetEditService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async updateText(id: string, patch: AssetTextPatch, editor: Editor): Promise<void> {
    await this.asHuman(async (tx) => {
      const [before] = await this.live(tx, [id]);
      const change: Partial<typeof assets.$inferInsert> = { updatedAt: new Date() };
      if (patch.title !== undefined) {
        change.title = patch.title;
      }
      if (patch.description !== undefined) {
        change.description = patch.description;
        change.descriptionOrigin = 'human';
      }
      await tx.update(assets).set(change).where(eq(assets.id, id));
      await this.audit(tx, editor, 'asset.updated', id, {
        before: pick(before, patch),
        after: patch,
      });
    });
  }

  async setFacet(id: string, facetKey: string, values: readonly string[], editor: Editor) {
    await this.asHuman(async (tx) => {
      await this.live(tx, [id]);
      const facet = await this.facet(tx, facetKey);
      await this.applyFacet(tx, id, facet, this.valueIds(facet, values), editor);
    });
  }

  async setTags(id: string, wanted: readonly string[], editor: Editor): Promise<void> {
    await this.asHuman(async (tx) => {
      await this.live(tx, [id]);
      const current = (await this.tagsOf(tx, [id])).map((t) => t.name);
      const names = normaliseTags(wanted);
      await this.applyTags(tx, id, {
        add: names.filter((n) => !current.includes(n)),
        remove: current.filter((n) => !names.includes(n)),
        confirmRest: true,
      }, editor);
    });
  }

  async bulk(action: BulkAction, editor: Editor): Promise<BulkResult> {
    const ids = [...new Set(action.ids)];
    await this.asHuman(async (tx) => {
      const rows = await this.live(tx, ids);
      switch (action.action) {
        case 'tags': {
          const add = normaliseTags(action.add);
          const remove = normaliseTags(action.remove).filter((n) => !add.includes(n));
          for (const id of ids) {
            await this.applyTags(tx, id, { add, remove, confirmRest: false }, editor);
          }
          break;
        }
        case 'facets':
          await this.bulkFacets(tx, ids, action.add, action.remove, editor);
          break;
        case 'trash':
          this.mayDelete(rows, editor);
          await tx
            .update(assets)
            .set({ deletedAt: new Date() })
            .where(inArray(assets.id, ids));
          for (const id of ids) {
            await this.audit(tx, editor, 'asset.deleted', id, { bulk: true });
          }
          break;
      }
    });
    return { changed: ids.length };
  }

  async trash(id: string, editor: Editor): Promise<void> {
    await this.asHuman(async (tx) => {
      this.mayDelete(await this.live(tx, [id]), editor);
      await tx.update(assets).set({ deletedAt: new Date() }).where(eq(assets.id, id));
      await this.audit(tx, editor, 'asset.deleted', id, {});
    });
  }

  async restore(id: string, editor: Editor): Promise<void> {
    await this.asHuman(async (tx) => {
      const rows = await tx
        .select({ id: assets.id, createdBy: assets.createdBy })
        .from(assets)
        .where(and(eq(assets.id, id), isNotNull(assets.deletedAt)));
      if (rows.length === 0) {
        throw new NotFoundException('Not in the trash');
      }
      this.mayDelete(rows, editor);
      await tx.update(assets).set({ deletedAt: null }).where(eq(assets.id, id));
      await this.audit(tx, editor, 'asset.restored', id, {});
    });
  }

  // -------------------------------------------------------------------------------------------

  /**
   * Replaces the facet's whole value set, every value as `human` — also values the model had set
   * and the person kept: left as `ai`, the next re-analysis would delete them and the guard would
   * discard the replacement. The decision row records the facet as decided even when empty.
   */
  private async applyFacet(
    tx: Tx,
    assetId: string,
    facet: FacetInfo,
    valueIds: readonly string[],
    editor: Editor,
  ): Promise<void> {
    const allIds = [...facet.values.values()];
    const before = await tx
      .select({ id: assetFacetValues.facetValueId, origin: assetFacetValues.origin })
      .from(assetFacetValues)
      .where(
        and(eq(assetFacetValues.assetId, assetId), inArray(assetFacetValues.facetValueId, allIds)),
      );

    await tx
      .delete(assetFacetValues)
      .where(
        and(eq(assetFacetValues.assetId, assetId), inArray(assetFacetValues.facetValueId, allIds)),
      );
    if (valueIds.length > 0) {
      await tx.insert(assetFacetValues).values(
        valueIds.map((facetValueId) => ({
          assetId,
          facetValueId,
          origin: 'human' as const,
          setBy: editor.id,
        })),
      );
    }
    await tx
      .insert(assetFacetDecisions)
      .values({ assetId, facetId: facet.id, decidedBy: editor.id })
      .onConflictDoUpdate({
        target: [assetFacetDecisions.assetId, assetFacetDecisions.facetId],
        set: { decidedBy: editor.id, decidedAt: new Date() },
      });

    // `asset.type` mirrors the type facet (0001); an emptied type keeps the old mirror value.
    const typeValue =
      facet.key === 'type' && valueIds.length > 0 ? this.keyOf(facet, valueIds[0]) : undefined;
    await tx
      .update(assets)
      .set({ updatedAt: new Date(), ...(typeValue ? { type: typeValue } : {}) })
      .where(eq(assets.id, assetId));

    await this.audit(tx, editor, 'asset.facet_set', assetId, {
      facet: facet.key,
      before: before.map((b) => ({ value: this.keyOf(facet, b.id), origin: b.origin })),
      after: valueIds.map((id) => this.keyOf(facet, id)),
    });
  }

  /**
   * Adds tags as `human`, removes tags and remembers each removal as a rejection, so a
   * re-analysis does not bring it back. `confirmRest` marks the remaining tags as `human` too —
   * for a saved tag list, where the person saw them and kept them; not for a bulk action.
   */
  private async applyTags(
    tx: Tx,
    assetId: string,
    change: { add: readonly string[]; remove: readonly string[]; confirmRest: boolean },
    editor: Editor,
  ): Promise<void> {
    const before = await this.tagsOf(tx, [assetId]);

    if (change.remove.length > 0) {
      const removed = await tx
        .select({ id: tags.id })
        .from(tags)
        .where(inArray(tags.name, [...change.remove]));
      const removedIds = removed.map((t) => t.id);
      if (removedIds.length > 0) {
        await tx
          .delete(assetTags)
          .where(and(eq(assetTags.assetId, assetId), inArray(assetTags.tagId, removedIds)));
        await tx
          .insert(assetTagRejections)
          .values(removedIds.map((tagId) => ({ assetId, tagId, rejectedBy: editor.id })))
          .onConflictDoNothing();
      }
    }

    if (change.add.length > 0) {
      await tx
        .insert(tags)
        .values(change.add.map((name) => ({ name, createdBy: editor.id })))
        .onConflictDoNothing();
      const added = await tx
        .select({ id: tags.id })
        .from(tags)
        .where(inArray(tags.name, [...change.add]));
      const addedIds = added.map((t) => t.id);
      await tx
        .delete(assetTagRejections)
        .where(
          and(eq(assetTagRejections.assetId, assetId), inArray(assetTagRejections.tagId, addedIds)),
        );
      await tx
        .insert(assetTags)
        .values(
          addedIds.map((tagId) => ({
            assetId,
            tagId,
            origin: 'human' as const,
            setBy: editor.id,
          })),
        )
        .onConflictDoUpdate({
          target: [assetTags.assetId, assetTags.tagId],
          set: { origin: 'human', setBy: editor.id, setAt: new Date() },
        });
    }

    if (change.confirmRest) {
      await tx
        .update(assetTags)
        .set({ origin: 'human', setBy: editor.id, setAt: new Date() })
        .where(and(eq(assetTags.assetId, assetId), eq(assetTags.origin, 'ai')));
    }

    const after = (await this.tagsOf(tx, [assetId])).map((t) => t.name);
    if (
      change.add.length > 0 ||
      change.remove.some((name) => before.some((t) => t.name === name)) ||
      (change.confirmRest && before.some((t) => t.origin === 'ai'))
    ) {
      await tx.update(assets).set({ updatedAt: new Date() }).where(eq(assets.id, assetId));
      await this.audit(tx, editor, 'asset.tags_changed', assetId, {
        before: before.map((t) => t.name),
        after,
      });
    }
  }

  /** Per asset: current values of each touched facet, plus `add`, minus `remove`. */
  private async bulkFacets(
    tx: Tx,
    ids: readonly string[],
    add: readonly FacetFilter[],
    remove: readonly FacetFilter[],
    editor: Editor,
  ): Promise<void> {
    const keys = [...new Set([...add, ...remove].map((f) => f.facet))];
    const infos = new Map<string, FacetInfo>();
    for (const key of keys) {
      const facet = await this.facet(tx, key);
      this.valueIds(facet, [...add, ...remove].filter((f) => f.facet === key).map((f) => f.value));
      infos.set(key, facet);
    }

    for (const id of ids) {
      for (const [key, facet] of infos) {
        const current = await tx
          .select({ id: assetFacetValues.facetValueId })
          .from(assetFacetValues)
          .where(
            and(
              eq(assetFacetValues.assetId, id),
              inArray(assetFacetValues.facetValueId, [...facet.values.values()]),
            ),
          );
        const adding = this.valueIds(facet, add.filter((f) => f.facet === key).map((f) => f.value));
        const removing = new Set(
          this.valueIds(facet, remove.filter((f) => f.facet === key).map((f) => f.value)),
        );
        // A single-value facet takes the added value instead of the old one.
        const kept = facet.isMultiValue || adding.length === 0 ? current.map((c) => c.id) : [];
        const next = [...new Set([...kept, ...adding])].filter((v) => !removing.has(v));
        await this.applyFacet(tx, id, facet, next, editor);
      }
    }
  }

  private async asHuman<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await declareActor(tx, 'human');
      return work(tx);
    });
  }

  /** The assets, not in the trash, locked for this transaction; 404 if any is missing. */
  private async live(tx: Tx, ids: readonly string[]) {
    const rows = await tx
      .select({
        id: assets.id,
        createdBy: assets.createdBy,
        title: assets.title,
        description: assets.description,
      })
      .from(assets)
      .where(and(inArray(assets.id, [...ids]), isNull(assets.deletedAt)))
      .for('update');
    if (rows.length !== new Set(ids).size) {
      throw new NotFoundException(
        ids.length === 1 ? 'Asset not found' : 'Some of these assets do not exist or are in the trash',
      );
    }
    return rows;
  }

  /** Deleting and restoring: own assets only, admins everything (§9). */
  private mayDelete(rows: ReadonlyArray<{ createdBy: string }>, editor: Editor): void {
    if (editor.role !== 'admin' && rows.some((row) => row.createdBy !== editor.id)) {
      throw new ForbiddenException('Only your own assets can be deleted or restored');
    }
  }

  private async facet(tx: Tx, key: string): Promise<FacetInfo> {
    const rows = await tx
      .select({
        id: facets.id,
        isMultiValue: facets.isMultiValue,
        valueId: facetValues.id,
        value: facetValues.value,
      })
      .from(facets)
      .leftJoin(facetValues, eq(facetValues.facetId, facets.id))
      .where(eq(facets.key, key));
    if (rows.length === 0) {
      throw new BadRequestException(`Unknown facet "${key}" — see GET /api/vocabulary`);
    }
    return {
      id: rows[0].id,
      key,
      isMultiValue: rows[0].isMultiValue,
      values: new Map(
        rows.flatMap((r) => (r.valueId && r.value ? [[r.value, r.valueId] as const] : [])),
      ),
    };
  }

  /** Value keys → ids, refusing unknown values and a second value on a single-value facet. */
  private valueIds(facet: FacetInfo, values: readonly string[]): string[] {
    const unique = [...new Set(values)];
    if (!facet.isMultiValue && unique.length > 1) {
      throw new BadRequestException(`"${facet.key}" takes one value`);
    }
    return unique.map((value) => {
      const id = facet.values.get(value);
      if (!id) {
        throw new BadRequestException(
          `Unknown facet value "${facet.key}:${value}" — see GET /api/vocabulary`,
        );
      }
      return id;
    });
  }

  private keyOf(facet: FacetInfo, valueId: string): string {
    for (const [value, id] of facet.values) {
      if (id === valueId) {
        return value;
      }
    }
    return valueId;
  }

  private tagsOf(tx: Tx, ids: readonly string[]) {
    return tx
      .select({ name: tags.name, origin: assetTags.origin })
      .from(assetTags)
      .innerJoin(tags, eq(tags.id, assetTags.tagId))
      .where(inArray(assetTags.assetId, [...ids]))
      .orderBy(tags.name);
  }

  private async audit(
    tx: Tx,
    editor: Editor,
    action: AssetAuditAction,
    assetId: string,
    diff: unknown,
  ): Promise<void> {
    await tx.insert(auditLog).values({
      userId: editor.id,
      action,
      entity: 'asset',
      entityId: assetId,
      diff,
    });
  }
}

/** Audit actions are technical keys, translated at display time only (§13.3). */
type AssetAuditAction =
  | 'asset.updated'
  | 'asset.facet_set'
  | 'asset.tags_changed'
  | 'asset.deleted'
  | 'asset.restored';

function pick(
  row: { title: string | null; description: string | null },
  patch: AssetTextPatch,
): Partial<AssetTextPatch> {
  return {
    ...(patch.title !== undefined ? { title: row.title } : {}),
    ...(patch.description !== undefined ? { description: row.description } : {}),
  };
}
