import { SPECIMEN_LINES, SPECIMEN_PANGRAM } from '@moodboard/shared';
import * as fontkit from 'fontkit';

export const SPECIMEN_WIDTH = 1600;
export const SPECIMEN_HEIGHT = 1000;
const MARGIN = 80;

interface Line {
  readonly text: string;
  /** Font size in pixels, before shrinking to fit the width. */
  readonly size: number;
  readonly color: string;
}

/**
 * Draws a font's specimen as SVG from the font's own glyph outlines (0017): no browser and no
 * installed font, so the picture shows exactly the uploaded file. Each line is laid out by the
 * font's shaping (kerning, ligatures) and shrunk to the width when it would not fit.
 */
export function specimenSvg(font: fontkit.Font, title: string): string {
  const lines: Line[] = [
    { text: title, size: 120, color: '#111111' },
    { text: SPECIMEN_PANGRAM, size: 60, color: '#111111' },
    ...SPECIMEN_LINES.map((text) => ({ text, size: 46, color: '#333333' })),
  ];
  const ascent = font.ascent / font.unitsPerEm;
  const descent = Math.abs(font.descent) / font.unitsPerEm;
  const available = SPECIMEN_WIDTH - 2 * MARGIN;

  const laidOut = lines.map((line) => {
    const run = font.layout(line.text);
    const advance = run.positions.reduce((sum, p) => sum + p.xAdvance, 0);
    const fitted = advance > 0 ? Math.min(line.size, (available * font.unitsPerEm) / advance) : line.size;
    return { line, run, size: fitted };
  });

  // Line heights from the font's own metrics, then centred vertically in the canvas.
  const gap = 28;
  const heights = laidOut.map(({ size }) => size * (ascent + descent));
  const total = heights.reduce((a, b) => a + b, 0) + gap * (heights.length - 1);
  let top = Math.max(MARGIN / 2, (SPECIMEN_HEIGHT - total) / 2);

  const paths: string[] = [];
  laidOut.forEach(({ line, run, size }, index) => {
    const scale = size / font.unitsPerEm;
    const baseline = top + size * ascent;
    let pen = 0;
    run.glyphs.forEach((glyph, i) => {
      const position = run.positions[i];
      const d = safePath(glyph);
      if (d) {
        const x = MARGIN + (pen + position.xOffset) * scale;
        const y = baseline - position.yOffset * scale;
        paths.push(
          `<path fill="${line.color}" transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(5)} ${(-scale).toFixed(5)})" d="${d}"/>`,
        );
      }
      pen += position.xAdvance;
    });
    top += heights[index] + gap;
  });

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SPECIMEN_WIDTH}" height="${SPECIMEN_HEIGHT}" viewBox="0 0 ${SPECIMEN_WIDTH} ${SPECIMEN_HEIGHT}">`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
    ...paths,
    '</svg>',
  ].join('');
}

/** A glyph whose outline cannot be read is left out rather than failing the whole specimen. */
function safePath(glyph: fontkit.Glyph): string | null {
  try {
    const d = glyph.path.toSVG();
    // Only path commands and numbers: nothing from the file reaches the SVG unchecked.
    return d && /^[MLQCZmlqcz0-9eE.,\s-]+$/.test(d) ? d : null;
  } catch {
    return null;
  }
}
