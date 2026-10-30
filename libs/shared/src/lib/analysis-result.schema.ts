import { z } from 'zod';
import {
  DensityEnum,
  FinishEnum,
  ImageryEnum,
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
/**
 * How the reference looks, beyond what the facets can say (0009) — the material a rebuild needs.
 * Every key is always present; an empty string means nothing worth noting. Order is the order a
 * prompt reads them in.
 */
export const DESIGN_NOTE_KEYS = [
  'composition',
  'imagery',
  'surfaces',
  'shapes',
  'typography',
  'components',
  'details',
] as const;
export type DesignNoteKey = (typeof DESIGN_NOTE_KEYS)[number];

export const DesignNotesSchema = z.object({
  composition: z.string().describe('Grid, splits, diagonals, overlaps, proportions'),
  imagery: z
    .string()
    .describe('What the pictures show and how: photo, render or drawing, cropping, lighting'),
  surfaces: z.string().describe('Textures, gradients, shadows, elevation, borders'),
  shapes: z.string().describe('Corner radii, organic or cut shapes, masks'),
  typography: z.string().describe('Weights, case, relative sizes, colours of text'),
  components: z.string().describe('Buttons, icons, cards, inputs, badges: how each is styled'),
  details: z.string().describe('Decorative motifs and small touches worth copying'),
});
export type DesignNotes = z.infer<typeof DesignNotesSchema>;

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
    imagery: z.array(ImageryEnum),
    finish: z.array(FinishEnum),
  }),
  design_notes: DesignNotesSchema,
  free_tags: z.array(z.string()).max(10),
  ocr_text: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
