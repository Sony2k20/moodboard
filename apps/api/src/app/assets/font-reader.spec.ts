import { sniffFontFormat } from '@moodboard/shared';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFont, UnreadableFontError } from './font-reader';

/** Inter (OFL-1.1), from the `@fontsource-variable/inter` dev dependency. */
const INTER = join(
  __dirname,
  '../../../../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
);

describe('readFont', () => {
  const bytes = readFileSync(INTER);

  it('reads the facts a variable WOFF2 states about itself', () => {
    expect(sniffFontFormat(bytes)).toBe('woff2');
    const meta = readFont(bytes);
    expect(meta).toMatchObject({
      family: 'Inter',
      fullName: 'Inter Regular',
      weight: 400,
      italic: false,
      monospace: false,
    });
    expect(meta.glyphCount).toBeGreaterThan(100);
    expect(meta.axes).toEqual([{ tag: 'wght', name: 'Weight', min: 100, default: 400, max: 900 }]);
    expect(meta.features).toEqual(expect.arrayContaining(['kern', 'tnum']));
    expect([...meta.features].sort()).toEqual(meta.features);
  });

  it('refuses a file with a font signature that is not a font', () => {
    const fake = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(200, 7)]);
    expect(sniffFontFormat(fake)).toBe('woff2');
    expect(() => readFont(fake)).toThrow(UnreadableFontError);
  });

  it('refuses a truncated font', () => {
    expect(() => readFont(bytes.subarray(0, 400))).toThrow(UnreadableFontError);
  });
});
