import { TYPE_VALUES } from '@moodboard/shared';
import { OUTPUT_JSON_SCHEMA, parseAnalysisResult } from './output-schema';
import { PROMPT_VERSION, SYSTEM_PROMPT } from './prompt';

type Node = Record<string, unknown>;
const facets = (OUTPUT_JSON_SCHEMA['properties'] as Node)['facets'] as Node;
const facetProps = facets['properties'] as Record<string, Node>;

const valid = {
  title: 'Editorial hero, dark, serif display',
  description: 'A dark hero section with oversized serif type.',
  facets: {
    type: 'website',
    ui_pattern: ['hero'],
    style: ['editorial'],
    mood: ['dramatic'],
    theme: 'dark',
    density: 'airy',
    typography: ['serif', 'oversized'],
    layout: ['centered'],
    motion: ['none'],
    industry: [],
    imagery: ['photography'],
    finish: ['soft-shadow'],
  },
  design_notes: {
    composition: '',
    imagery: '',
    surfaces: '',
    shapes: '',
    typography: '',
    components: '',
    details: '',
  },
  free_tags: ['gold accents'],
  ocr_text: null,
  confidence: 0.8,
};

describe('OUTPUT_JSON_SCHEMA', () => {
  it('keeps the vocabulary as enum, so the grammar cannot produce a value outside it', () => {
    expect(facetProps['type']['enum']).toEqual([...TYPE_VALUES]);
    expect((facetProps['style']['items'] as Node)['enum']).toContain(
      'editorial',
    );
  });

  it('is strict: every object closed, every property required', () => {
    const notes = (OUTPUT_JSON_SCHEMA['properties'] as Node)['design_notes'] as Node;
    for (const node of [OUTPUT_JSON_SCHEMA, facets, notes]) {
      expect(node['additionalProperties']).toBe(false);
      expect(node['required']).toEqual(Object.keys(node['properties'] as Node));
    }
  });

  it('leaves out what structured outputs does not support', () => {
    const text = JSON.stringify(OUTPUT_JSON_SCHEMA);
    for (const key of ['maxItems', 'minimum', 'maximum', '$schema']) {
      expect(text).not.toContain(`"${key}"`);
    }
  });
});

describe('parseAnalysisResult', () => {
  it('accepts a valid result', () => {
    expect(parseAnalysisResult(structuredClone(valid)).facets.theme).toBe(
      'dark',
    );
  });

  it('enforces afterwards what the grammar cannot: 10 tags, confidence in 0..1', () => {
    const result = parseAnalysisResult({
      ...structuredClone(valid),
      free_tags: Array.from({ length: 14 }, (_, i) => `t${i}`),
      confidence: 1.3,
    });
    expect(result.free_tags).toHaveLength(10);
    expect(result.confidence).toBe(1);
  });

  it('requires a title (0007)', () => {
    const { title: _, ...withoutTitle } = structuredClone(valid);
    expect(() => parseAnalysisResult(withoutTitle)).toThrow();
    expect(
      ((OUTPUT_JSON_SCHEMA['properties'] as Node)['title'] as Node)['type'],
    ).toBe('string');
  });

  it('rejects a value outside the vocabulary', () => {
    expect(() =>
      parseAnalysisResult({
        ...structuredClone(valid),
        facets: { ...valid.facets, theme: 'sepia' },
      }),
    ).toThrow();
  });
});

describe('prompt', () => {
  it('lists every classified facet and never the human-curated project facet', () => {
    for (const key of Object.keys(valid.facets)) {
      expect(SYSTEM_PROMPT).toContain(`- ${key} —`);
    }
    expect(SYSTEM_PROMPT).not.toContain('- project —');
    expect(PROMPT_VERSION).toBe(3);
  });
});
