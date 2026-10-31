import {
  CaptureTechnique,
  EMPTY_CSS_TECHNIQUE,
  hasTechnique,
  techniqueForModel,
} from './capture-technique';

const tech = (change: Partial<CaptureTechnique> = {}): CaptureTechnique => ({
  fonts: ['Inter'],
  libraries: ['GSAP'],
  css: {
    ...EMPTY_CSS_TECHNIQUE,
    transition: [{ value: 'opacity 0.3s ease 0s', count: 4 }],
  },
  tokens: null,
  elements: { h1: { fontFamily: 'Inter', fontSize: '64px' } },
  ...change,
});

describe('techniqueForModel', () => {
  it('leaves out what is empty', () => {
    expect(JSON.parse(techniqueForModel(tech()))).toEqual({
      fonts: ['Inter'],
      libraries: ['GSAP'],
      transitions: ['opacity 0.3s ease 0s ×4'],
      elements: { h1: { fontFamily: 'Inter', fontSize: '64px' } },
    });
  });

  it('shortens the longest list until the JSON fits, keeping the most frequent values', () => {
    const customProperties = Array.from({ length: 200 }, (_, i) => ({
      name: `--token-${i}`,
      value: `#${String(i).padStart(6, '0')}`,
    }));
    const json = techniqueForModel(
      tech({
        tokens: {
          customProperties,
          colors: [],
          radii: [],
          shadows: [],
          fontSizes: [],
        },
      }),
      1000,
    );
    expect(json.length).toBeLessThanOrEqual(1000);
    const parsed = JSON.parse(json);
    expect(parsed.customProperties[0]).toBe('--token-0: #000000');
    expect(parsed.fonts).toEqual(['Inter']);
    expect(parsed.elements).toBeDefined();
  });
});

describe('hasTechnique', () => {
  it('is false for a capture that measured nothing', () => {
    expect(
      hasTechnique({
        fonts: [],
        libraries: [],
        css: EMPTY_CSS_TECHNIQUE,
        tokens: null,
        elements: null,
      }),
    ).toBe(false);
    expect(hasTechnique(tech())).toBe(true);
  });
});
