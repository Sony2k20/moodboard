import { AnalysisResultSchema } from './analysis-result.schema';
import { LocalizedTextSchema } from './localized-text';
import { flattenVocabulary, VOCABULARY } from './vocabulary';

describe('vocabulary', () => {
  it('gives every value an English and a German label', () => {
    for (const entry of flattenVocabulary()) {
      expect(() => LocalizedTextSchema.parse(entry.label)).not.toThrow();
    }
  });

  it('keeps facet keys and values machine-readable', () => {
    // These feed the Zod enums, the LLM prompt and the MCP filters, so they stay lower-case
    // ASCII with hyphens — never translated, never renamed casually (§13.3).
    for (const entry of flattenVocabulary()) {
      expect(entry.facetKey).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(entry.value).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    }
  });

  it('keeps "playful" in both style and mood', () => {
    // Intentional, not a duplicate: in `style` it describes the visual language, in `mood` the
    // effect on the viewer (§6). This test exists so nobody "cleans it up".
    const owners = VOCABULARY.filter((facet) =>
      (facet.values as readonly string[]).includes('playful'),
    ).map((facet) => facet.key);

    expect(owners).toEqual(['style', 'mood']);
  });

  it('accepts every vocabulary value in the analysis result schema', () => {
    // The point of deriving the enums from the vocabulary: the contract cannot drift from it.
    const result = AnalysisResultSchema.safeParse({
      title: 'Editorial hero, dark',
      description: 'A dark editorial hero with oversized type.',
      facets: {
        type: 'website',
        ui_pattern: ['hero', 'nav'],
        style: ['editorial', 'minimal'],
        mood: ['calm'],
        theme: 'dark',
        density: 'airy',
        typography: ['serif', 'oversized'],
        layout: ['split'],
        motion: ['scroll-reveal'],
        industry: ['media'],
        imagery: ['photography', '3d-render'],
        finish: ['texture', 'layered'],
      },
      design_notes: {
        composition: 'Diagonal split hero.',
        imagery: '',
        surfaces: '',
        shapes: '',
        typography: '',
        components: '',
        details: '',
      },
      facet_confidence: {
        type: 0.95,
        ui_pattern: 0.9,
        style: 0.6,
        mood: 0.5,
        theme: 0.95,
        density: 0.8,
        typography: 0.85,
        layout: 0.7,
        motion: 0.9,
        industry: 0.4,
        imagery: 0.8,
        finish: 0.6,
      },
      free_tags: ['kerning'],
      ocr_text: null,
      confidence: 0.82,
    });

    expect(result.success).toBe(true);
  });

  it('rejects a facet value that is not in the vocabulary', () => {
    const result = AnalysisResultSchema.safeParse({
      description: 'x',
      facets: {
        type: 'website',
        ui_pattern: [],
        style: ['art-deco'],
        mood: [],
        theme: 'dark',
        density: 'airy',
        typography: [],
        layout: [],
        motion: [],
        industry: [],
      },
      free_tags: [],
      ocr_text: null,
      confidence: 0.5,
    });

    expect(result.success).toBe(false);
  });
});
