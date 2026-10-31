import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { assetFacetValues, auditLog, Database, facets, facetValues } from '@moodboard/db';
import {
  CURATED_FACET_KEYS,
  VocabularyValueCreate,
  VocabularyValuePatch,
} from '@moodboard/shared';
import { and, count, eq, max } from 'drizzle-orm';
import { DATABASE } from '../database.module';
import type { Editor } from './asset-edit.service';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Audit actions are technical keys, translated at display time only (§13.3). */
type VocabularyAuditAction =
  | 'vocabulary.value_created'
  | 'vocabulary.value_updated'
  | 'vocabulary.value_deleted';

/**
 * Maintaining the curated facets (0014): admins add, relabel and delete `project` values. The
 * classified facets are refused — their values are built into the prompt and change in code.
 * Keys never change; a used value is never deleted, because that would also delete people's
 * assignments (§5.6).
 */
@Injectable()
export class VocabularyAdminService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(facetKey: string, input: VocabularyValueCreate, editor: Editor): Promise<void> {
    this.requireAdmin(editor);
    await this.db.transaction(async (tx) => {
      const facet = await this.curatedFacet(tx, facetKey);
      const [{ last }] = await tx
        .select({ last: max(facetValues.sortOrder) })
        .from(facetValues)
        .where(eq(facetValues.facetId, facet.id));
      const [row] = await tx
        .insert(facetValues)
        .values({
          facetId: facet.id,
          value: input.value,
          label: input.label,
          description: input.description,
          sortOrder: (last ?? -1) + 1,
        })
        .onConflictDoNothing()
        .returning({ id: facetValues.id });
      if (!row) {
        throw new ConflictException(`"${facetKey}:${input.value}" already exists`);
      }
      await this.audit(tx, editor, 'vocabulary.value_created', row.id, {
        facet: facetKey,
        value: input.value,
        label: input.label,
        description: input.description,
      });
    });
  }

  async update(
    facetKey: string,
    value: string,
    patch: VocabularyValuePatch,
    editor: Editor,
  ): Promise<void> {
    this.requireAdmin(editor);
    await this.db.transaction(async (tx) => {
      const facet = await this.curatedFacet(tx, facetKey);
      const existing = await this.value(tx, facet.id, facetKey, value);
      await tx
        .update(facetValues)
        .set({
          ...(patch.label ? { label: patch.label } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
        })
        .where(eq(facetValues.id, existing.id));
      await this.audit(tx, editor, 'vocabulary.value_updated', existing.id, {
        facet: facetKey,
        value,
        before: { label: existing.label, description: existing.description },
        after: patch,
      });
    });
  }

  async remove(facetKey: string, value: string, editor: Editor): Promise<void> {
    this.requireAdmin(editor);
    await this.db.transaction(async (tx) => {
      const facet = await this.curatedFacet(tx, facetKey);
      const existing = await this.value(tx, facet.id, facetKey, value);
      // Trashed assets count too: restoring one must not find its project gone.
      const [{ uses }] = await tx
        .select({ uses: count() })
        .from(assetFacetValues)
        .where(eq(assetFacetValues.facetValueId, existing.id));
      if (uses > 0) {
        throw new ConflictException(
          `"${facetKey}:${value}" is used by ${uses} asset${uses === 1 ? '' : 's'} — remove it from them first`,
        );
      }
      await tx.delete(facetValues).where(eq(facetValues.id, existing.id));
      await this.audit(tx, editor, 'vocabulary.value_deleted', existing.id, {
        facet: facetKey,
        value,
        label: existing.label,
      });
    });
  }

  private requireAdmin(editor: Editor): void {
    if (editor.role !== 'admin') {
      throw new ForbiddenException('Only admins maintain the vocabulary (§9)');
    }
  }

  private async curatedFacet(tx: Tx, key: string): Promise<{ id: string }> {
    const [facet] = await tx.select({ id: facets.id }).from(facets).where(eq(facets.key, key));
    if (!facet) {
      throw new NotFoundException(`Unknown facet "${key}"`);
    }
    if (!CURATED_FACET_KEYS.includes(key)) {
      throw new BadRequestException(
        `"${key}" is classified by the model; its values change in code, with a new prompt version`,
      );
    }
    return facet;
  }

  private async value(tx: Tx, facetId: string, facetKey: string, value: string) {
    const [row] = await tx
      .select({ id: facetValues.id, label: facetValues.label, description: facetValues.description })
      .from(facetValues)
      .where(and(eq(facetValues.facetId, facetId), eq(facetValues.value, value)));
    if (!row) {
      throw new NotFoundException(`Unknown value "${facetKey}:${value}"`);
    }
    return row;
  }

  private async audit(
    tx: Tx,
    editor: Editor,
    action: VocabularyAuditAction,
    facetValueId: string,
    diff: unknown,
  ): Promise<void> {
    await tx.insert(auditLog).values({
      userId: editor.id,
      action,
      entity: 'facet_value',
      entityId: facetValueId,
      diff,
    });
  }
}
