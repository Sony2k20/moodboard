import { z } from 'zod';
import { AssetCard, FacetFilterSchema } from './asset-query';

/**
 * The write side (0006). Every edit is a person's: what it writes carries `origin = 'human'`, and
 * the guards keep it through every re-analysis (§5.6).
 */

/** How long an asset stays in the trash before the worker purges it (§9). */
export const DEFAULT_TRASH_RETENTION_DAYS = 30;
/** Most assets one bulk action touches. */
export const MAX_BULK_ASSETS = 100;

const nullableText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().trim().max(max).nullable(),
  );

/** `PATCH /api/assets/:id`. An empty string clears the field. */
export const AssetTextPatchSchema = z
  .object({
    title: nullableText(200).optional(),
    description: nullableText(4000).optional(),
  })
  .strict()
  .refine((patch) => patch.title !== undefined || patch.description !== undefined, {
    message: 'Nothing to change: send title and/or description',
  });
export type AssetTextPatch = z.infer<typeof AssetTextPatchSchema>;

/**
 * `PUT /api/assets/:id/facets/:facet`: the facet's whole value set as the person chose it. An
 * empty list is a decision too — "none of these" (0006).
 */
export const FacetValuesSchema = z
  .object({ values: z.array(z.string().min(1).max(64)).max(30) })
  .strict();

/** `PUT /api/assets/:id/tags`: the whole tag list. Tags left in place count as confirmed. */
export const TagListSchema = z
  .object({ tags: z.array(z.string().max(200)).max(50) })
  .strict();

const ids = z.array(z.uuid()).min(1).max(MAX_BULK_ASSETS);
const tagNames = z.array(z.string().max(200)).max(20).default([]);
const facetFilters = z.array(FacetFilterSchema).max(20).default([]);

/** `POST /api/assets/bulk`. Each asset goes through the same edit as a single change would. */
export const BulkActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('tags'), ids, add: tagNames, remove: tagNames }).strict(),
  z
    .object({ action: z.literal('facets'), ids, add: facetFilters, remove: facetFilters })
    .strict(),
  z.object({ action: z.literal('trash'), ids }).strict(),
]);
export type BulkAction = z.infer<typeof BulkActionSchema>;

export interface BulkResult {
  readonly changed: number;
}

/** `GET /api/trash`: own assets for members, all for admins (§9). */
export interface TrashItem extends AssetCard {
  readonly deletedAt: string;
  /** When the worker removes it for good, rows and files. */
  readonly purgeAt: string;
}
