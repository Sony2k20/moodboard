import { AssetDetail, VocabularyFacet } from './asset-query';
import { buildPrompt } from './build-prompt';

const label = (en: string) => ({ en, de: en });
const facet = (key: string, values: string[]): VocabularyFacet => ({
  key,
  isMultiValue: true,
  label: label(key),
  description: null,
  values: values.map((value) => ({
    value,
    label: label(value[0].toUpperCase() + value.slice(1).replace(/-/g, ' ')),
    description: null,
  })),
});
const vocabulary = [
  facet('ui_pattern', ['hero', 'pricing', 'empty-state']),
  facet('style', ['minimal', 'editorial', 'swiss']),
  facet('mood', ['calm']),
  facet('theme', ['dark']),
  facet('typography', ['serif']),
  facet('layout', ['split']),
  facet('motion', ['none', 'parallax']),
  facet('imagery', ['photography', 'illustration']),
  facet('finish', ['flat', 'texture', 'layered']),
];

const asset = (change: Partial<AssetDetail> = {}): AssetDetail => ({
  id: 'a',
  title: 'Editorial hero',
  titleOrigin: 'ai',
  type: 'image',
  status: 'ready',
  description: 'A dark editorial hero with a serif headline.',
  descriptionOrigin: 'ai',
  sourceUrl: null,
  createdAt: '2026-10-30T08:00:00.000Z',
  updatedAt: '2026-10-30T08:00:00.000Z',
  author: { id: 'u', displayName: 'Ada' },
  files: [],
  facets: [
    { facet: 'ui_pattern', value: 'hero', origin: 'ai', confidence: 0.8 },
    { facet: 'style', value: 'minimal', origin: 'ai', confidence: 0.8 },
    { facet: 'style', value: 'editorial', origin: 'human', confidence: null },
    { facet: 'theme', value: 'dark', origin: 'ai', confidence: 0.8 },
    { facet: 'motion', value: 'none', origin: 'ai', confidence: 0.8 },
  ],
  tags: [{ name: 'gold accents', origin: 'ai' }],
  colors: [
    { hex: '#d9643a', ratio: 0.2 },
    { hex: '#0d1117', ratio: 0.7 },
  ],
  classification: null,
  decidedFacets: [],
  designNotes: null,
  designNotesOrigin: 'ai',
  ...change,
});

describe('buildPrompt', () => {
  it('turns the metadata into a build prompt', () => {
    expect(buildPrompt(asset(), vocabulary)).toBe(
      [
        'Build a hero section in the visual style of the attached reference ("Editorial hero").',
        '',
        'Style: editorial, minimal. Theme: dark.',
        'Palette (by share): #0d1117 (background, 70%), #d9643a (accent, 20%).',
        'Motion: none — a static reference.',
        'What the reference shows: A dark editorial hero with a serif headline.',
        'Keywords: gold accents.',
        '',
        'Match the composition, colour proportions and type hierarchy. Do not copy its text, logos or images.',
        'The reference image is attached: follow it wherever this text is unclear.',
      ].join('\n'),
    );
  });

  it('puts a value a person set before the model’s', () => {
    expect(buildPrompt(asset(), vocabulary)).toContain('Style: editorial, minimal.');
  });

  it('leaves out what is empty instead of guessing', () => {
    const prompt = buildPrompt(
      asset({ facets: [], colors: [], tags: [], description: null, title: null }),
      vocabulary,
    );
    expect(prompt).toBe(
      [
        'Build a user interface in the visual style of the attached reference.',
        '',
        'Match the composition, colour proportions and type hierarchy. Do not copy its text, logos or images.',
        'The reference image is attached: follow it wherever this text is unclear.',
      ].join('\n'),
    );
  });

  it('names several patterns as one layout, with readable labels', () => {
    const prompt = buildPrompt(
      asset({
        facets: [
          { facet: 'ui_pattern', value: 'pricing', origin: 'ai', confidence: 0.8 },
          { facet: 'ui_pattern', value: 'empty-state', origin: 'ai', confidence: 0.8 },
          { facet: 'motion', value: 'parallax', origin: 'ai', confidence: 0.8 },
        ],
      }),
      vocabulary,
    );
    expect(prompt).toMatch(/^Build a pricing and empty state layout/);
    expect(prompt).toContain('Motion: parallax.');
  });

  it('carries imagery, finish and the visual details, with the rules they imply (0009)', () => {
    const prompt = buildPrompt(
      asset({
        facets: [
          { facet: 'imagery', value: 'photography', origin: 'ai', confidence: 0.8 },
          { facet: 'finish', value: 'texture', origin: 'ai', confidence: 0.8 },
          { facet: 'finish', value: 'layered', origin: 'ai', confidence: 0.8 },
        ],
        designNotes: {
          composition: 'Hero split by a diagonal from top right to bottom left.',
          imagery: '',
          surfaces: 'Sand-like relief texture; cards raised with soft drop shadows.',
          shapes: '',
          typography: '',
          components: 'Glossy beige gradient pill button; icons in white circular badges.',
          details: '',
        },
      }),
      vocabulary,
    );
    expect(prompt).toContain('Imagery: photography. Finish: texture, layered.');
    expect(prompt).toContain(
      [
        'Visual details:',
        '- Composition: Hero split by a diagonal from top right to bottom left.',
        '- Surfaces: Sand-like relief texture; cards raised with soft drop shadows.',
        '- Components: Glossy beige gradient pill button; icons in white circular badges.',
      ].join('\n'),
    );
    expect(prompt).toContain('use photographs too');
    expect(prompt).toContain('do not flatten the design');
  });

  it('adds no photo or depth rule to a flat illustrated reference', () => {
    const prompt = buildPrompt(
      asset({
        facets: [
          { facet: 'imagery', value: 'illustration', origin: 'ai', confidence: 0.8 },
          { facet: 'finish', value: 'flat', origin: 'ai', confidence: 0.8 },
        ],
      }),
      vocabulary,
    );
    expect(prompt).not.toContain('photographs');
    expect(prompt).not.toContain('flatten');
    expect(prompt).not.toContain('Visual details');
  });
});
