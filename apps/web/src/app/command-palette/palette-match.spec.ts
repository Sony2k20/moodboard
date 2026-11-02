import { paletteRank } from './palette-match';

describe('paletteRank', () => {
  it('matches everything on an empty query', () => {
    expect(paletteRank('  ', ['Dark'])).toBe(0);
  });

  it('ranks a text that starts with the query first', () => {
    expect(paletteRank('dar', ['Dark', 'dark', 'Theme'])).toBe(0);
    expect(paletteRank('dark', ['Theme', 'Dark mode'])).toBe(0);
  });

  it('needs every word somewhere, ranking word starts before inner matches', () => {
    expect(paletteRank('theme dark', ['Dark', 'dark', 'Theme', 'theme'])).toBe(2);
    expect(paletteRank('theme ark', ['Dark', 'Theme'])).toBe(3);
    expect(paletteRank('theme light', ['Dark', 'Theme'])).toBeNull();
  });

  it('treats hyphens and colons as word boundaries, so keys match like labels', () => {
    expect(paletteRank('state', ['empty-state'])).toBe(1);
    expect(paletteRank('dark', ['theme:dark'])).toBe(1);
  });

  it('ignores case and accents', () => {
    expect(paletteRank('asthetik', ['Ästhetik'])).toBe(0);
    expect(paletteRank('DUNKEL', ['Dunkel'])).toBe(0);
  });
});
