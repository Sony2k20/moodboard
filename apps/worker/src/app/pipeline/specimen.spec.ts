import * as fontkit from 'fontkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { SPECIMEN_HEIGHT, SPECIMEN_WIDTH, specimenSvg } from './specimen';

/** Inter (OFL-1.1), from the `@fontsource-variable/inter` dev dependency. */
const INTER = join(
  __dirname,
  '../../../../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
);

describe('specimenSvg', () => {
  const font = fontkit.create(readFileSync(INTER)) as fontkit.Font;

  it('draws every line from the font’s outlines, nothing but paths', () => {
    const svg = specimenSvg(font, 'Inter Regular');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).not.toMatch(/<text|<image|<script|href=/);
    // Title, pangram, both alphabets and the figures: well over a hundred inked glyphs.
    expect((svg.match(/<path /g) ?? []).length).toBeGreaterThan(100);
  });

  it('shrinks a line that would not fit instead of cutting it off', () => {
    const svg = specimenSvg(font, 'An extraordinarily long family name that cannot fit at 120 px');
    const xs = [...svg.matchAll(/translate\(([\d.]+) /g)].map((m) => Number(m[1]));
    expect(Math.max(...xs)).toBeLessThan(SPECIMEN_WIDTH);
  });

  it('renders to an image of the specimen size with ink on paper', async () => {
    const png = await sharp(Buffer.from(specimenSvg(font, 'Inter'))).png().toBuffer();
    const { width, height } = await sharp(png).metadata();
    expect([width, height]).toEqual([SPECIMEN_WIDTH, SPECIMEN_HEIGHT]);
    const { channels } = await sharp(png).stats();
    // White paper, dark glyphs: the darkest pixel is near black.
    expect(channels[0].min).toBeLessThan(40);
    expect(channels[0].max).toBe(255);
  });
});
