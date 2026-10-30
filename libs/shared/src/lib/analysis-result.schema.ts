import { z } from 'zod';
import {
  DensityEnum,
  IndustryEnum,
  LayoutEnum,
  MoodEnum,
  MotionEnum,
  StyleEnum,
  ThemeEnum,
  TypeEnum,
  TypographyEnum,
  UiPatternEnum,
} from './vocabulary';

/**
 * The contract for a classification result (concept §7.2).
 *
 * This schema — not an API wrapper — is what makes the LLM provider replaceable. The Anthropic
 * adapter hands it to `zodOutputFormat()` and gets schema-validated output back; adapters for
 * providers without a structured-output mode validate against the same schema after the call and
 * throw on violation. The contract is identical either way.
 *
 * Every enum here is derived from the vocabulary, so a vocabulary change breaks compilation
 * rather than producing an invalid facet at runtime.
 *
 * `project` is deliberately absent: it is curated by humans per client, never guessed by a model.
 */
export const AnalysisResultSchema = z.object({
  title: z
    .string()
    .describe('3-8 words, English, names what is shown; used where nobody chose a title'),
  description: z
    .string()
    .describe('2-4 sentences, factual, English, for full-text search'),
  facets: z.object({
    type: TypeEnum,
    ui_pattern: z.array(UiPatternEnum),
    style: z.array(StyleEnum),
    mood: z.array(MoodEnum),
    theme: ThemeEnum,
    density: DensityEnum,
    typography: z.array(TypographyEnum),
    layout: z.array(LayoutEnum),
    motion: z.array(MotionEnum),
    industry: z.array(IndustryEnum),
  }),
  free_tags: z.array(z.string()).max(10),
  ocr_text: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
