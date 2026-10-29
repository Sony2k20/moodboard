import { extractPalette, labToHex, rgbToLab } from './palette';

function image(
  ...regions: Array<[number, [number, number, number]]>
): Uint8Array {
  return new Uint8Array(
    regions.flatMap(([count, rgb]) =>
      Array.from({ length: count }, () => rgb).flat(),
    ),
  );
}

describe('palette', () => {
  it('round-trips sRGB through Lab', () => {
    for (const hex of ['#000000', '#ffffff', '#ff0000', '#1e90ff', '#808080']) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      expect(labToHex(rgbToLab(r, g, b))).toBe(hex);
    }
  });

  it('puts white at L=100 and black at L=0', () => {
    expect(rgbToLab(255, 255, 255)[0]).toBeCloseTo(100, 1);
    expect(rgbToLab(0, 0, 0)[0]).toBeCloseTo(0, 5);
  });

  it('finds the dominant colours with their shares, largest first', () => {
    const palette = extractPalette(
      image([700, [255, 255, 255]], [300, [220, 20, 60]]),
    );
    expect(palette.map((c) => c.hex)).toEqual(['#ffffff', '#dc143c']);
    expect(palette[0].ratio).toBeCloseTo(0.7, 5);
    expect(palette[1].ratio).toBeCloseTo(0.3, 5);
  });

  it('drops clusters below 1 % as noise', () => {
    const palette = extractPalette(image([995, [0, 0, 0]], [5, [0, 255, 0]]));
    expect(palette.map((c) => c.hex)).toEqual(['#000000']);
  });

  it('is deterministic', () => {
    const pixels = image(
      [400, [10, 120, 200]],
      [350, [250, 200, 40]],
      [250, [30, 30, 30]],
    );
    expect(extractPalette(pixels)).toEqual(extractPalette(pixels));
  });

  it('copes with an empty image', () => {
    expect(extractPalette(new Uint8Array())).toEqual([]);
  });
});
