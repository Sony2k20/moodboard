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
        'Details: gold accents.',
        '',
        'Match the composition, colour proportions and type hierarchy. Do not copy its text, logos or images.',
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
});
