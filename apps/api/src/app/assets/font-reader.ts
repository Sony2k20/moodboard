import { FontAxis, FontMeta } from '@moodboard/shared';
import * as fontkit from 'fontkit';

/** A file the font library cannot read as one font. The upload is refused with `415`. */
export class UnreadableFontError extends Error {}

const MAX_NAME = 300;
const MAX_LICENSE = 4000;

interface Os2 {
  readonly usWeightClass?: number;
  readonly fsSelection?: { readonly italic?: boolean };
}

/**
 * Reads what a font file says about itself (0017): the name table, OS/2 weight and style, the
 * variable axes and the layout features. Parsing it is also the check that the upload is a font
 * at all — a signature alone would let any file with four right bytes through.
 */
export function readFont(bytes: Buffer): FontMeta {
  let font: fontkit.Font;
  try {
    const parsed = fontkit.create(bytes);
    if ('fonts' in parsed) {
      throw new UnreadableFontError('Font collections are not accepted; upload one font file');
    }
    font = parsed;
    // Touch the tables everything later relies on, so a broken file fails here, not in the worker.
    void font.numGlyphs;
    void font.unitsPerEm;
  } catch (error) {
    if (error instanceof UnreadableFontError) {
      throw error;
    }
    throw new UnreadableFontError(`Not a readable font: ${String(error)}`);
  }

  const name = (key: string, max = MAX_NAME) => {
    let value: string | null = null;
    try {
      value = font.getName(key, 'en') ?? null;
    } catch {
      value = null;
    }
    const text = value?.replace(/\0/g, '').trim();
    return text ? text.slice(0, max) : null;
  };

  const family = name('preferredFamily') ?? name('fontFamily');
  if (!family) {
    throw new UnreadableFontError('The font names no family');
  }
  const os2 = (font as unknown as Record<string, Os2 | undefined>)['OS/2'];
  const post = (font as unknown as { post?: { isFixedPitch?: number } }).post;

  const axes: FontAxis[] = Object.entries(safe(() => font.variationAxes, {})).flatMap(
    ([tag, axis]) =>
      axis
        ? [{ tag, name: axis.name || tag, min: axis.min, default: axis.default, max: axis.max }]
        : [],
  );
  const features = [...new Set(safe(() => font.availableFeatures, [] as string[]))]
    .filter((tag) => /^[A-Za-z0-9 ]{4}$/.test(tag))
    .sort();

  const subfamily = name('preferredSubfamily') ?? name('fontSubfamily');
  return {
    family,
    subfamily,
    fullName: name('fullName') ?? [family, subfamily].filter(Boolean).join(' '),
    postscriptName: name('postscriptName'),
    version: name('version'),
    designer: name('designer'),
    manufacturer: name('manufacturer'),
    license: name('license', MAX_LICENSE),
    licenseUrl: name('licenseURL'),
    weight: typeof os2?.usWeightClass === 'number' ? os2.usWeightClass : null,
    italic: Boolean(os2?.fsSelection?.italic) || /italic|oblique/i.test(subfamily ?? ''),
    monospace: Boolean(post?.isFixedPitch),
    glyphCount: font.numGlyphs,
    axes,
    features,
  };
}

function safe<T>(read: () => T, fallback: T): T {
  try {
    return read() ?? fallback;
  } catch {
    return fallback;
  }
}
