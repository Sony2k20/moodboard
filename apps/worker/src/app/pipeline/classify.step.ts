import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ASSET_CLASSIFIER,
  AssetClassifier,
  ClassificationRefusedError,
  InvalidClassificationError,
  PROMPT_VERSION,
} from '@moodboard/classify';
import {
  analysisRuns,
  assetFacetValues,
  assets,
  assetTags,
  Database,
  facets,
  facetValues,
  tags,
} from '@moodboard/db';
import { AnalysisResult, normaliseTags } from '@moodboard/shared';
import { UnrecoverableError } from 'bullmq';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { DATABASE } from '../database.module';
import { ImageSteps } from './image.steps';

export const LLM_COST_LIMIT = Symbol('LLM_COST_LIMIT');

/** Thrown when the month's budget is spent; the reconciler retries next month (§7.4). */
export class CostLimitReachedError extends UnrecoverableError {}

/** The facet rows a result implies: one per value, single-value facets as a one-element list. */
export function facetAssignments(
  result: AnalysisResult,
): Array<{ facet: string; value: string }> {
  return Object.entries(result.facets).flatMap(([facet, value]) =>
    (Array.isArray(value) ? value : [value]).map((v) => ({
      facet,
      value: v as string,
    })),
  );
}


/**
 * `classify` (§7.1). Every attempt leaves an `analysis_run` row — failed ones included — so cost
 * and failure rate stay visible and re-analysis can be targeted (§5.5).
 *
 * Writes go in as `origin = 'ai'` and rely on the database to protect human decisions (§5.6): the
 * facet and tag triggers discard ai writes where a human has decided, the description trigger
 * does the same for the description. Nothing here checks first; the invariant is not this
 * code's to keep.
 */
@Injectable()
export class ClassifyStep {
  private readonly logger = new Logger(ClassifyStep.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ASSET_CLASSIFIER)
    private readonly classifier: AssetClassifier | null,
    @Inject(LLM_COST_LIMIT) private readonly monthlyLimitUsd: number,
    private readonly images: ImageSteps,
  ) {}

  get enabled(): boolean {
    return this.classifier !== null;
  }

  async run(assetId: string): Promise<void> {
    const classifier = this.classifier;
    if (!classifier) {
      return;
    }
    await this.checkBudget();

    const [asset] = await this.db
      .select({ title: assets.title, sourceUrl: assets.sourceUrl })
      .from(assets)
      .where(eq(assets.id, assetId))
      .limit(1);
    if (!asset) {
      throw new UnrecoverableError(`Asset ${assetId} does not exist`);
    }

    const image = await this.images.modelImage(assetId);
    let output;
    try {
      output = await classifier.classify({
        images: [{ mime: 'image/webp', data: new Uint8Array(image) }],
        context: {
          title: asset.title ?? undefined,
          sourceUrl: asset.sourceUrl ?? undefined,
        },
      });
    } catch (error) {
      const raw =
        error instanceof ClassificationRefusedError ||
        error instanceof InvalidClassificationError
          ? error.rawResponse
          : null;
      await this.db.insert(analysisRuns).values({
        assetId,
        provider: classifier.providerId,
        model: classifier.modelId,
        promptVersion: PROMPT_VERSION,
        rawResponse: raw as object | null,
        status: 'failed',
        error: String(error instanceof Error ? error.message : error).slice(
          0,
          2000,
        ),
      });
      // A refusal would refuse again; anything else (rate limit, network) is worth a retry.
      if (error instanceof ClassificationRefusedError) {
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }

    const result = output.result;
    await this.db.transaction(async (tx) => {
      await tx.insert(analysisRuns).values({
        assetId,
        provider: classifier.providerId,
        model: classifier.modelId,
        promptVersion: output.promptVersion,
        inputTokens: output.inputTokens,
        outputTokens: output.outputTokens,
        costUsd: output.costUsd,
        rawResponse: output.rawResponse as object,
        status: 'succeeded',
      });

      // Facets: replace the ai rows; the trigger drops whatever a human has already decided.
      const wanted = facetAssignments(result);
      const valueRows = await tx
        .select({
          id: facetValues.id,
          facet: facets.key,
          value: facetValues.value,
        })
        .from(facetValues)
        .innerJoin(facets, eq(facets.id, facetValues.facetId));
      const idOf = new Map(
        valueRows.map((r) => [`${r.facet}:${r.value}`, r.id]),
      );
      await tx
        .delete(assetFacetValues)
        .where(
          and(
            eq(assetFacetValues.assetId, assetId),
            eq(assetFacetValues.origin, 'ai'),
          ),
        );
      const facetInserts = wanted
        .map((w) => idOf.get(`${w.facet}:${w.value}`))
        .filter((id): id is string => Boolean(id))
        .map((facetValueId) => ({
          assetId,
          facetValueId,
          origin: 'ai' as const,
          confidence: result.confidence,
        }));
      if (facetInserts.length > 0) {
        await tx
          .insert(assetFacetValues)
          .values(facetInserts)
          .onConflictDoNothing();
      }

      // Free tags: same pattern, scoped per (asset, tag) by its own trigger.
      const names = normaliseTags(result.free_tags);
      await tx
        .delete(assetTags)
        .where(and(eq(assetTags.assetId, assetId), eq(assetTags.origin, 'ai')));
      if (names.length > 0) {
        await tx
          .insert(tags)
          .values(names.map((name) => ({ name })))
          .onConflictDoNothing();
        const tagRows = await tx
          .select({ id: tags.id })
          .from(tags)
          .where(inArray(tags.name, names));
        await tx
          .insert(assetTags)
          .values(
            tagRows.map((t) => ({
              assetId,
              tagId: t.id,
              origin: 'ai' as const,
            })),
          )
          .onConflictDoNothing();
      }

      // `asset.type` mirrors the type facet, so it follows whatever survived the trigger.
      const [typeRow] = await tx
        .select({ value: facetValues.value })
        .from(assetFacetValues)
        .innerJoin(
          facetValues,
          eq(facetValues.id, assetFacetValues.facetValueId),
        )
        .innerJoin(facets, eq(facets.id, facetValues.facetId))
        .where(
          and(eq(assetFacetValues.assetId, assetId), eq(facets.key, 'type')),
        )
        .limit(1);

      await tx
        .update(assets)
        .set({
          // All guarded: a person's description, title or notes stay (0004, 0007, 0009).
          description: result.description,
          descriptionOrigin: 'ai',
          title: result.title.trim().replace(/\.$/, '').slice(0, 200),
          titleOrigin: 'ai',
          designNotes: result.design_notes,
          designNotesOrigin: 'ai',
          ...(typeRow ? { type: typeRow.value } : {}),
          updatedAt: new Date(),
        })
        .where(eq(assets.id, assetId));
    });
    this.logger.log(
      `Classified ${assetId}: ${output.inputTokens ?? '?'} in / ${output.outputTokens ?? '?'} out, $${output.costUsd?.toFixed(4) ?? '?'}`,
    );
  }

  /** A guard against runaway loops, not a budget (§7.4). */
  private async checkBudget(): Promise<void> {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const [{ spent }] = await this.db
      .select({ spent: sql<number>`coalesce(sum(${analysisRuns.costUsd}), 0)` })
      .from(analysisRuns)
      .where(gte(analysisRuns.createdAt, monthStart));
    if (Number(spent) >= this.monthlyLimitUsd) {
      throw new CostLimitReachedError(
        `Monthly LLM limit of $${this.monthlyLimitUsd} reached ($${Number(spent).toFixed(2)} spent)`,
      );
    }
  }
}
