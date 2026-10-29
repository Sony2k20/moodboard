/**
 * Palette extraction for `asset_color` (§5.3): k-means in CIE Lab, so the clusters follow
 * perceived colour difference rather than RGB distance. Pure and dependency-free — the caller
 * hands in raw RGB pixels from a small downscale.
 */
export interface PaletteColor {
  readonly hex: string;
  readonly lab: readonly [number, number, number];
  /** Share of the pixels in this cluster, 0..1. */
  readonly ratio: number;
}

type Lab = [number, number, number];

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c: number): number {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
}

// D65 reference white.
const XN = 0.95047;
const YN = 1.0;
const ZN = 1.08883;
const EPSILON = 216 / 24389;
const KAPPA = 24389 / 27;

export function rgbToLab(r: number, g: number, b: number): Lab {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const x = (lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375) / XN;
  const y = (lr * 0.2126729 + lg * 0.7151522 + lb * 0.072175) / YN;
  const z = (lr * 0.0193339 + lg * 0.119192 + lb * 0.9503041) / ZN;
  const f = (t: number) =>
    t > EPSILON ? Math.cbrt(t) : (KAPPA * t + 16) / 116;
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToHex([l, a, b]: readonly [number, number, number]): string {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (t: number) =>
    t ** 3 > EPSILON ? t ** 3 : (116 * t - 16) / KAPPA;
  const x = inv(fx) * XN;
  const y = (l > KAPPA * EPSILON ? fy ** 3 : l / KAPPA) * YN;
  const z = inv(fz) * ZN;
  const r = linearToSrgb(x * 3.2404542 + y * -1.5371385 + z * -0.4985314);
  const g = linearToSrgb(x * -0.969266 + y * 1.8760108 + z * 0.041556);
  const bl = linearToSrgb(x * 0.0556434 + y * -0.2040259 + z * 1.0572252);
  return `#${[r, g, bl].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const distance = (p: Lab, q: Lab) =>
  (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;

/**
 * `pixels` is RGB, three bytes per pixel. Deterministic: seeded by k-means++ with a fixed
 * pseudo-random sequence, so re-running the step on the same image gives the same palette.
 * Clusters below 1 % of the image are dropped — they are noise, not palette.
 */
export function extractPalette(
  pixels: Uint8Array,
  k = 6,
  iterations = 12,
): PaletteColor[] {
  const points: Lab[] = [];
  for (let i = 0; i + 2 < pixels.length; i += 3) {
    points.push(rgbToLab(pixels[i], pixels[i + 1], pixels[i + 2]));
  }
  if (points.length === 0) {
    return [];
  }

  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

  const centroids: Lab[] = [points[Math.floor(random() * points.length)]];
  while (centroids.length < Math.min(k, points.length)) {
    const weights = points.map((p) =>
      Math.min(...centroids.map((c) => distance(p, c))),
    );
    const total = weights.reduce((sum, w) => sum + w, 0);
    if (total === 0) {
      break;
    }
    let target = random() * total;
    const index = weights.findIndex((w) => (target -= w) <= 0);
    centroids.push(points[index === -1 ? points.length - 1 : index]);
  }

  const assignment = new Array<number>(points.length).fill(0);
  for (let round = 0; round < iterations; round++) {
    points.forEach((p, i) => {
      let best = 0;
      for (let c = 1; c < centroids.length; c++) {
        if (distance(p, centroids[c]) < distance(p, centroids[best])) {
          best = c;
        }
      }
      assignment[i] = best;
    });
    centroids.forEach((_, c) => {
      const members = points.filter((__, i) => assignment[i] === c);
      if (members.length > 0) {
        centroids[c] = [0, 1, 2].map(
          (axis) =>
            members.reduce((sum, m) => sum + m[axis], 0) / members.length,
        ) as Lab;
      }
    });
  }

  // Merge clusters a viewer would not tell apart (ΔE76 below 12): k-means splits a large flat
  // area into near-identical shades, and downscaling adds blended edge pixels next to it.
  const clusters = centroids
    .map((lab, c) => ({ lab, count: assignment.filter((a) => a === c).length }))
    .filter((cluster) => cluster.count > 0)
    .sort((a, b) => b.count - a.count);
  const merged: Array<{ lab: Lab; count: number }> = [];
  for (const cluster of clusters) {
    const near = merged.find(
      (m) => Math.sqrt(distance(m.lab, cluster.lab)) < MERGE_DELTA_E,
    );
    if (near) {
      const total = near.count + cluster.count;
      near.lab = [0, 1, 2].map(
        (axis) =>
          (near.lab[axis] * near.count + cluster.lab[axis] * cluster.count) /
          total,
      ) as Lab;
      near.count = total;
    } else {
      merged.push({ ...cluster });
    }
  }

  return merged
    .map(({ lab, count }) => ({
      hex: labToHex(lab),
      lab,
      ratio: count / points.length,
    }))
    .filter((color) => color.ratio >= 0.01)
    .sort((a, b) => b.ratio - a.ratio);
}

const MERGE_DELTA_E = 12;
