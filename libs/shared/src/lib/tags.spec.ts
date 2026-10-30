import { normaliseTags } from './tags';

describe('normaliseTags', () => {
  it('lower-cases, collapses whitespace and removes duplicates', () => {
    expect(
      normaliseTags(['Gold  Accents', 'gold accents', ' Serif ', '']),
    ).toEqual(['gold accents', 'serif']);
  });

  it('drops tags too long to be a tag', () => {
    expect(normaliseTags(['x'.repeat(65), 'ok'])).toEqual(['ok']);
  });
});
