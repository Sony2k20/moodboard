/**
 * Fonts as assets (0017). One uploaded file is one asset: its facts come out of the file, its
 * picture is a specimen drawn from the file's own outlines.
 */

export const FONT_FORMATS = {
  woff2: { mime: 'font/woff2', extension: 'woff2' },
  woff: { mime: 'font/woff', extension: 'woff' },
  ttf: { mime: 'font/ttf', extension: 'ttf' },
  otf: { mime: 'font/otf', extension: 'otf' },
} as const;

export type FontFormat = keyof typeof FONT_FORMATS;

/** Large CJK families reach a few MB; 10 MB leaves room without inviting archives. */
export const MAX_FONT_BYTES = 10 * 1024 * 1024;

/**
 * Identifies a font by its leading bytes, like `sniffUploadFormat` does for images. Collections
 * (`ttcf`) are not accepted: one file is one asset (0017).
 */
export function sniffFontFormat(bytes: Uint8Array): FontFormat | null {
  if (bytes.length < 4) {
    return null;
  }
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (tag === 'wOF2') {
    return 'woff2';
  }
  if (tag === 'wOFF') {
    return 'woff';
  }
  if (tag === 'OTTO') {
    return 'otf';
  }
  if (tag === 'true' || (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0)) {
    return 'ttf';
  }
  return null;
}

/** A variable font's design axis, as its `fvar` table declares it. */
export interface FontAxis {
  /** Four-letter tag: `wght`, `wdth`, `opsz`, or a custom upper-case one. */
  readonly tag: string;
  readonly name: string;
  readonly min: number;
  readonly default: number;
  readonly max: number;
}

/**
 * What the file says about itself (`asset_font`). A fact about the file, not a judgement, so it
 * carries no origin: nobody corrects a font's family name, and a re-analysis never touches it.
 */
export interface FontMeta {
  readonly family: string;
  readonly subfamily: string | null;
  readonly fullName: string | null;
  readonly postscriptName: string | null;
  readonly version: string | null;
  readonly designer: string | null;
  readonly manufacturer: string | null;
  readonly license: string | null;
  readonly licenseUrl: string | null;
  /** OS/2 `usWeightClass`, 100–900. */
  readonly weight: number | null;
  readonly italic: boolean;
  readonly monospace: boolean;
  readonly glyphCount: number;
  readonly axes: readonly FontAxis[];
  /** OpenType feature tags in GSUB and GPOS: `liga`, `ss01`, `tnum`, … */
  readonly features: readonly string[];
}

/** The specimen's lines: drawn by the worker, and the default text on the detail page. */
export const SPECIMEN_PANGRAM = 'The quick brown fox jumps over the lazy dog';
export const SPECIMEN_LINES = [
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'abcdefghijklmnopqrstuvwxyz',
  '0123456789 & ? ! @ ( ) % € $',
] as const;
