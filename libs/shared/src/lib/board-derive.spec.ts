import { AssetDetail } from './asset-query';
import { BoardItem } from './board';
import { boardPrompt, boardTokens, deriveBoard, firstFamily, parseTransition } from './board-derive';
import { CaptureTechRecord, EMPTY_CSS_TECHNIQUE } from './capture-technique';

type Facet = AssetDetail['facets'][number];
const f = (facet: string, value: string): Facet => ({ facet, value, origin: 'ai', confidence: 0.9 });

const asset = (id: string, change: Partial<AssetDetail> = {}): AssetDetail => ({
  id,
  title: id,
  titleOrigin: 'human',
  type: 'image',
  status: 'ready',
  statusReason: null,
  description: null,
  descriptionOrigin: 'ai',
  sourceUrl: null,
  createdAt: '2026-11-02T08:00:00.000Z',
  updatedAt: '2026-11-02T08:00:00.000Z',
  author: { id: 'u', displayName: 'Ada' },
  files: [],
  facets: [],
  tags: [],
  colors: [],
  classification: null,
  decidedFacets: [],
  designNotes: null,
  designNotesOrigin: 'ai',
  captureTech: null,
  font: null,
  component: null,
  ...change,
});

const item = (a: AssetDetail, role: BoardItem['role'], weight: BoardItem['weight'] = 'primary', note: string | null = null): BoardItem => ({
  id: `item-${a.id}-${role}`,
  role,
  weight,
  note,
  asset: a,
});

const tech = (change: Partial<CaptureTechRecord> = {}): CaptureTechRecord => ({
  fonts: ['Fraunces', 'Inter'],
  libraries: ['GSAP'],
  css: { ...EMPTY_CSS_TECHNIQUE, transition: [{ value: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1) 0s', count: 4 }] },
  tokens: {
    customProperties: [],
    colors: [],
    radii: [{ value: '12px', count: 9 }, { value: '4px', count: 2 }],
    shadows: [],
    fontSizes: [{ value: '16px', count: 30 }, { value: '48px', count: 2 }],
  },
  elements: { h1: { fontFamily: '"Fraunces", serif' }, body: { fontFamily: 'Inter, sans-serif' } },
  pageTitle: null,
  viewport: '1440x900@2',
  capturedAt: '2026-11-02T08:00:00.000Z',
  ...change,
});

describe('deriveBoard', () => {
  it('consolidates the palette from the colour items, merging close colours by weight', () => {
    const derived = deriveBoard([
      item(asset('a', { colors: [{ hex: '#0d1117', ratio: 0.7 }, { hex: '#d9643a', ratio: 0.3 }] }), 'color'),
      // Close to #0d1117 (ΔE < 12): merged into it, not a second dark.
      item(asset('b', { colors: [{ hex: '#111418', ratio: 0.6 }, { hex: '#f4f1ea', ratio: 0.4 }] }), 'color', 'secondary'),
      item(asset('c', { colors: [{ hex: '#ff00ff', ratio: 1 }] }), 'layout'),
    ]);
    expect(derived.palette.source).toBe('role');
    expect(derived.palette.colors.map((c) => c.hex)).toEqual(['#0d1117', '#d9643a', '#f4f1ea']);
    expect(derived.palette.colors[0].assetIds).toEqual(['a', 'b']);
    expect(derived.palette.colors.reduce((s, c) => s + c.share, 0)).toBeCloseTo(1, 2);
  });

  it('falls back to overall items, and lists the colours of avoid items apart', () => {
    const derived = deriveBoard([
      item(asset('a', { colors: [{ hex: '#ffffff', ratio: 1 }] }), 'overall'),
      item(asset('x', { colors: [{ hex: '#ff0000', ratio: 1 }] }), 'overall', 'avoid'),
    ]);
    expect(derived.palette).toMatchObject({ source: 'overall', colors: [{ hex: '#ffffff' }], avoid: [{ hex: '#ff0000' }] });
    expect(deriveBoard([]).palette.source).toBeNull();
  });

  it('takes type pairings from captures and font assets', () => {
    const derived = deriveBoard([
      item(asset('site', { captureTech: tech(), facets: [f('typography', 'serif')] }), 'typography'),
      item(asset('font', { font: { family: 'Söhne' } as AssetDetail['font'] }), 'typography'),
    ]);
    expect(derived.typePairings.pairings).toEqual([
      { assetId: 'site', heading: 'Fraunces', body: 'Inter', family: null, styles: ['serif'] },
      { assetId: 'font', heading: null, body: null, family: 'Söhne', styles: [] },
    ]);
  });

  it('summarises motion from the motion items', () => {
    const derived = deriveBoard([
      item(asset('a', { captureTech: tech(), facets: [f('motion', 'parallax'), f('motion', 'fade')] }), 'motion'),
      item(asset('b', { facets: [f('motion', 'fade')] }), 'motion'),
    ]);
    expect(derived.motionSummary).toMatchObject({
      source: 'role',
      values: [{ value: 'fade', count: 2 }, { value: 'parallax', count: 1 }],
      libraries: ['GSAP'],
      transitions: ['transform 0.3s cubic-bezier(0.4, 0, 0.2, 1) 0s'],
    });
  });

  it('finds the facets every primary shares, leaving out what a reference is', () => {
    const derived = deriveBoard([
      item(asset('a', { facets: [f('type', 'website'), f('style', 'editorial'), f('style', 'swiss'), f('theme', 'dark')] }), 'layout'),
      item(asset('b', { facets: [f('type', 'image'), f('style', 'editorial'), f('theme', 'dark')] }), 'overall'),
      item(asset('c', { facets: [f('style', 'brutalist')] }), 'overall', 'secondary'),
    ]);
    expect(derived.commonFacets).toEqual([
      { facet: 'style', value: 'editorial' },
      { facet: 'theme', value: 'dark' },
    ]);
  });

  it('names conflicts: primaries split on a single-value facet, and a wanted value an avoid item carries', () => {
    const derived = deriveBoard([
      item(asset('a', { facets: [f('theme', 'dark'), f('style', 'editorial'), f('style', 'swiss')] }), 'overall'),
      item(asset('b', { facets: [f('theme', 'light'), f('style', 'editorial')] }), 'layout'),
      item(asset('x', { facets: [f('style', 'swiss'), f('type', 'image')] }), 'overall', 'avoid'),
    ]);
    expect(derived.conflicts).toEqual([
      { kind: 'split', facet: 'theme', values: [{ value: 'dark', assetIds: ['a'] }, { value: 'light', assetIds: ['b'] }] },
      { kind: 'avoided', facet: 'style', value: 'swiss', primary: ['a'], avoid: ['x'] },
    ]);
  });
});

describe('boardTokens', () => {
  it('builds the four formats from what was measured, and leaves out what was not', () => {
    const items = [
      item(asset('a', { colors: [{ hex: '#0d1117', ratio: 0.7 }, { hex: '#d9643a', ratio: 0.3 }] }), 'color'),
      item(asset('site', { captureTech: tech() }), 'typography'),
    ];
    const tokens = boardTokens(deriveBoard(items), items);
    expect(tokens.json).toEqual({
      color: { 'palette-1': '#0d1117', 'palette-2': '#d9643a' },
      font: { heading: 'Fraunces', body: 'Inter' },
      radius: { '1': '12px', '2': '4px' },
      fontSize: { '1': '16px', '2': '48px' },
      duration: { '1': '300ms' },
      easing: { '1': 'cubic-bezier(0.4,0,0.2,1)' },
    });
    expect(tokens.w3c).toMatchObject({
      color: { 'palette-1': { $type: 'color', $value: '#0d1117' } },
      font: { heading: { $type: 'fontFamily', $value: 'Fraunces' } },
      easing: { '1': { $type: 'cubicBezier', $value: [0.4, 0, 0.2, 1] } },
    });
    expect(tokens.css).toContain('  --color-palette-1: #0d1117;');
    expect(tokens.css).toContain('  --font-heading: Fraunces, sans-serif;');
    expect(tokens.css).toContain('  --duration-1: 300ms;');
    expect(tokens.tailwind).toMatch(/^@theme \{/);
    expect(tokens.tailwind).toContain('  --text-2: 48px;');
    expect(tokens.tailwind).not.toContain('duration');
  });

  it('is empty for an empty board', () => {
    expect(boardTokens(deriveBoard([]), [])).toEqual({ json: {}, w3c: {}, css: ':root {\n\n}\n', tailwind: '@theme {\n\n}\n' });
  });
});

describe('helpers', () => {
  it('reads the first family of a stack', () => {
    expect(firstFamily('"Inter Variable", Inter, sans-serif')).toBe('Inter Variable');
    expect(firstFamily(undefined)).toBeNull();
  });

  it('parses a transition into duration and easing', () => {
    expect(parseTransition('opacity .2s ease-in-out')).toEqual({ duration: '200ms', easing: 'ease-in-out' });
    expect(parseTransition('all 0s ease 0s')).toEqual({ duration: null, easing: 'ease' });
  });
});

describe('boardPrompt', () => {
  it('briefs each reference by its role, lists counter-examples and conflicts', () => {
    const items = [
      item(asset('a', { title: 'Dark hero', facets: [f('theme', 'dark')] }), 'layout', 'primary', 'only the split'),
      item(asset('b', { title: 'Light card', facets: [f('theme', 'light')] }), 'color', 'secondary'),
      item(asset('x', { title: 'Loud one' }), 'overall', 'avoid'),
    ];
    const prompt = boardPrompt(
      { title: 'Pricing relaunch', briefing: 'A calmer pricing page.', items, derived: deriveBoard(items) },
      [],
    );
    expect(prompt).toContain('Design brief "Pricing relaunch".');
    expect(prompt).toContain('What should come out of this:\nA calmer pricing page.');
    expect(prompt).toContain('1. "Dark hero" (asset a) — take the layout and composition only. Note: only the split. It reads as: theme dark.');
    expect(prompt).toContain('2. "Light card" (asset b) — take the colour palette only, as a secondary influence.');
    expect(prompt).toContain('Counter-examples — explicitly not like these:\n1. "Loud one" (asset x) — avoid the overall look.');
    expect(prompt).not.toContain('disagree');
  });
});
