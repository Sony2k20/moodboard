import { VOCABULARY } from '@moodboard/shared';

/**
 * Bumped whenever this prompt or the vocabulary it renders changes. Every `analysis_run` records
 * it, which is what makes "re-classify everything below version N" possible (§5.5, §7.5).
 */
export const PROMPT_VERSION = 3;

/** `project` is curated by humans per client and never guessed by a model (analysis-result.schema). */
const CLASSIFIED_FACETS = VOCABULARY.filter((facet) => facet.key !== 'project');

function renderVocabulary(): string {
  return CLASSIFIED_FACETS.map((facet) => {
    const cardinality = facet.isMultiValue
      ? 'zero or more values'
      : 'exactly one value';
    const values = facet.values
      .map((value) => {
        const label = (facet.valueLabels as Record<string, { en: string }>)[
          value
        ]?.en;
        return label && label.toLowerCase() !== value.replace(/-/g, ' ')
          ? `${value} (${label})`
          : value;
      })
      .join(', ');
    return `- ${facet.key} — ${cardinality}. ${facet.description.en}\n  Values: ${values}`;
  }).join('\n');
}

/**
 * Stable across requests, so it is cacheable once batch re-analysis arrives (§7.3, §7.5). Nothing
 * per-asset belongs in here.
 */
export const SYSTEM_PROMPT = `You classify design references for a design team's mood board. The metadata you produce is how the team and their AI agents find references later, so precision matters more than coverage.

Facets — use only the listed values:
${renderVocabulary()}

Guidelines:
- Assign a multi-value facet only where it is clearly visible. An empty list is better than a guess.
- motion: a still image cannot show movement. Use "none" unless several frames are provided or motion is unambiguous (for example, a visible video player).
- title: 3-8 words in English naming what is shown, the way a designer would label the reference (for example "Fintech pricing table, dark" or "Editorial magazine hero with serif display"). No quotes, no trailing period, no marketing language.
- description: 2-4 factual sentences in English: what is shown, layout, colour, typography, notable details. It is used for full-text search, so name concrete things; no marketing language.
- imagery and finish: decide them from the rendering, not the subject. Photographs of leaves are "photography", not "illustration"; a raised card with a drop shadow is "soft-shadow"; overlapping planes with visible depth are "layered".
- design_notes: how it looks, for a designer who has to rebuild it without seeing it. Short, concrete, visual — one or two sentences per field, about 150 words in total. Name materials, textures, shadows and their direction, gradients, corner radii, shape language, how pictures are cropped and lit, how buttons, icons and cards are styled, the composition (splits, diagonals, overlaps, proportions). Do not repeat facet values or the description. Leave a field empty ("") when there is nothing worth noting.
- free_tags: up to 10 short lowercase tags for what the facets cannot express (brand names, specific techniques, subject matter). Do not repeat facet values.
- ocr_text: the legible text in the image, or null if there is none worth keeping.
- confidence: your overall confidence in this classification, from 0 to 1.`;
