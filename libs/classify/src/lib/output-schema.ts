import { AnalysisResult, AnalysisResultSchema } from '@moodboard/shared';
import { z } from 'zod';

/**
 * The JSON schema sent as `output_config.format`, derived from `AnalysisResultSchema`.
 *
 * **Why not `zodOutputFormat` (CLAUDE.md, §7.2):** the SDK helper in the installed version moves
 * every `enum` into the description text, so the facet values are no longer enforced by the
 * grammar — the model can then emit a value outside the vocabulary and the response fails
 * validation afterwards. Here `enum` is kept, so a value outside the vocabulary cannot be
 * produced in the first place. The Zod schema is still the contract: the response is validated
 * against it after the call, exactly as §7.2 describes for every adapter.
 *
 * What structured outputs does not support is removed from the grammar and enforced afterwards:
 * `maxItems` (free tags are cut to 10) and `minimum`/`maximum` (confidence is clamped).
 */
const UNSUPPORTED = ['maxItems', 'minimum', 'maximum', '$schema'];

function strict(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(strict);
  }
  if (node === null || typeof node !== 'object') {
    return node;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (!UNSUPPORTED.includes(key)) {
      out[key] = strict(value);
    }
  }
  if (out['type'] === 'object') {
    out['additionalProperties'] = false;
    out['required'] = Object.keys(
      (out['properties'] as Record<string, unknown>) ?? {},
    );
  }
  return out;
}

export const OUTPUT_JSON_SCHEMA = strict(
  z.toJSONSchema(AnalysisResultSchema),
) as Record<string, unknown>;

/** Applies the limits the grammar cannot express, then validates against the contract. */
export function parseAnalysisResult(json: unknown): AnalysisResult {
  if (json && typeof json === 'object') {
    const draft = json as Record<string, unknown>;
    if (Array.isArray(draft['free_tags'])) {
      draft['free_tags'] = draft['free_tags'].slice(0, 10);
    }
    if (typeof draft['confidence'] === 'number') {
      draft['confidence'] = Math.min(1, Math.max(0, draft['confidence']));
    }
  }
  return AnalysisResultSchema.parse(json);
}
