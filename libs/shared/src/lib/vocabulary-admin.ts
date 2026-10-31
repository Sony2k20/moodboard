import { z } from 'zod';
import { LocalizedTextSchema } from './localized-text';

/**
 * Facets whose values admins maintain at runtime (0014). Every other facet is classified by the
 * model: its values are built into the prompt and the output grammar (§7.2), so they change in
 * code, with a new prompt version.
 */
export const CURATED_FACET_KEYS: readonly string[] = ['project'];

/**
 * A value key: lowercase words joined by hyphens. It appears in URLs and MCP filters as
 * `facet:value` and is never translated (§13.3), so it is restricted to what reads well there.
 */
export const VOCABULARY_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const Label = LocalizedTextSchema.extend({
  en: z.string().trim().min(1).max(80),
  de: z.string().trim().min(1).max(80),
});

const Description = LocalizedTextSchema.extend({
  en: z.string().trim().min(1).max(300),
  de: z.string().trim().min(1).max(300),
}).nullable();

/** `POST /api/vocabulary/:facet/values`. */
export const VocabularyValueCreateSchema = z
  .object({
    value: z
      .string()
      .max(64)
      .regex(VOCABULARY_KEY_PATTERN, 'Lowercase letters and digits, joined by hyphens'),
    label: Label,
    description: Description.default(null),
  })
  .strict();
export type VocabularyValueCreate = z.infer<typeof VocabularyValueCreateSchema>;

/** `PATCH /api/vocabulary/:facet/values/:value`. The key never changes. */
export const VocabularyValuePatchSchema = z
  .object({ label: Label.optional(), description: Description.optional() })
  .strict()
  .refine((patch) => patch.label !== undefined || patch.description !== undefined, {
    message: 'Nothing to change',
  });
export type VocabularyValuePatch = z.infer<typeof VocabularyValuePatchSchema>;

/** The key a form proposes for a label: `Client X — Relaunch 2027` → `client-x-relaunch-2027`. */
export function vocabularyKeyFrom(label: string): string {
  return label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
}
