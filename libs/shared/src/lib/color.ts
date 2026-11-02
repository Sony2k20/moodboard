/**
 * sRGB ↔ CIE Lab (D65), so colour proximity is perceptual rather than RGB-based (§5.3). Used by
 * the worker's palette extraction and by a board's consolidated palette (0019).
 */
export type Lab = [number, number, number];

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

/** `#rrggbb` → Lab; `null` for anything else. */
export function hexToLab(hex: string): Lab | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) {
    return null;
  }
  const n = parseInt(match[1], 16);
  return rgbToLab((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

/** CIE76 ΔE: Euclidean distance in Lab. */
export function deltaE(p: readonly number[], q: readonly number[]): number {
  return Math.sqrt((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2);
}
