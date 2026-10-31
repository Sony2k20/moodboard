/**
 * The measured technique of a captured website (0011 release 2, §8.2 step 8): what the browser
 * could measure on the live page, so nobody has to guess it from the picture. Stored in
 * `capture_tech`, sent to the model as text, and returned by `get_asset`.
 *
 * Values are CSS as the browser computed it — font names, colours, easings — and are never
 * translated (§13.3).
 */

/** A value and how many visible elements (or rules) carried it, most frequent first. */
export interface CountedValue {
  readonly value: string;
  readonly count: number;
}

/** `capture_tech.css_properties`. */
export interface CssTechnique {
  /** Computed `transition` of visible elements with a non-zero duration. */
  readonly transition: readonly CountedValue[];
  /** `<keyframes name> <duration> <timing>` of running or finished animations. */
  readonly animation: readonly CountedValue[];
  readonly transform: readonly CountedValue[];
  /** Declarations of `:hover` rules that change transform, shadow or colour — `hover-transform`. */
  readonly hover: readonly CountedValue[];
  /** The `@keyframes` behind `animation`, compacted. */
  readonly keyframes: readonly {
    readonly name: string;
    readonly css: string;
  }[];
}

/** `capture_tech.tokens`. */
export interface DesignTokens {
  /** `:root` custom properties with their computed value, at most 200. */
  readonly customProperties: readonly {
    readonly name: string;
    readonly value: string;
  }[];
  readonly colors: readonly CountedValue[];
  readonly radii: readonly CountedValue[];
  readonly shadows: readonly CountedValue[];
  readonly fontSizes: readonly CountedValue[];
}

export const ELEMENT_ROLES = [
  'h1',
  'h2',
  'body',
  'button',
  'link',
  'card',
] as const;
export type ElementRole = (typeof ELEMENT_ROLES)[number];

/** Computed style of one representative element. Defaults (no shadow, no radius) are left out. */
export interface ElementStyle {
  readonly fontFamily?: string;
  readonly fontSize?: string;
  readonly fontWeight?: string;
  readonly lineHeight?: string;
  readonly letterSpacing?: string;
  readonly color?: string;
  readonly background?: string;
  readonly borderRadius?: string;
  readonly boxShadow?: string;
  readonly padding?: string;
  readonly transition?: string;
}

/** `capture_tech.elements`. */
export type ElementStyles = Partial<Record<ElementRole, ElementStyle>>;

export interface CaptureTechnique {
  /** Families that loaded or are in use on visible text, most used first. */
  readonly fonts: readonly string[];
  /** GSAP, ScrollTrigger, Lenis, AOS, Framer Motion, Swiper, Locomotive Scroll. */
  readonly libraries: readonly string[];
  readonly css: CssTechnique;
  readonly tokens: DesignTokens | null;
  readonly elements: ElementStyles | null;
}

/** A captured website's technique as the api returns it. */
export interface CaptureTechRecord extends CaptureTechnique {
  readonly pageTitle: string | null;
  /** `1440x900@2`. */
  readonly viewport: string;
  readonly capturedAt: string;
}

export const EMPTY_CSS_TECHNIQUE: CssTechnique = {
  transition: [],
  animation: [],
  transform: [],
  hover: [],
  keyframes: [],
};

/** `Inter 16px/24px 600, radius 999px, shadow …` — for the build prompt and the detail page. */
export function describeElementStyle(style: ElementStyle): string {
  const font = [
    style.fontFamily,
    style.fontSize && style.lineHeight
      ? `${style.fontSize}/${style.lineHeight}`
      : style.fontSize,
    style.fontWeight,
  ]
    .filter(Boolean)
    .join(' ');
  return [
    font || null,
    style.letterSpacing ? `letter-spacing ${style.letterSpacing}` : null,
    style.color ? `colour ${style.color}` : null,
    style.background ? `background ${style.background}` : null,
    style.borderRadius ? `radius ${style.borderRadius}` : null,
    style.boxShadow ? `shadow ${style.boxShadow}` : null,
    style.padding ? `padding ${style.padding}` : null,
    style.transition ? `transition ${style.transition}` : null,
  ]
    .filter(Boolean)
    .join(', ');
}

/** About 4k characters of JSON for the model (0011); the full record stays in the database. */
export const MODEL_TECHNIQUE_CHARS = 4000;

/**
 * The technique as compact JSON for the classification context, at most `maxChars` long. The
 * longest list loses its tail half until it fits — the lists are sorted by frequency, so what
 * goes is what mattered least.
 */
export function techniqueForModel(
  tech: CaptureTechnique,
  maxChars = MODEL_TECHNIQUE_CHARS,
): string {
  const lists: Record<string, unknown[]> = {
    fonts: [...tech.fonts],
    libraries: [...tech.libraries],
    transitions: tech.css.transition.map(counted),
    animations: tech.css.animation.map(counted),
    keyframes: tech.css.keyframes.map((k) => `@keyframes ${k.name} ${k.css}`),
    transforms: tech.css.transform.map(counted),
    hover: tech.css.hover.map(counted),
    colors: (tech.tokens?.colors ?? []).map(counted),
    radii: (tech.tokens?.radii ?? []).map(counted),
    shadows: (tech.tokens?.shadows ?? []).map(counted),
    fontSizes: (tech.tokens?.fontSizes ?? []).map(counted),
    customProperties: (tech.tokens?.customProperties ?? []).map(
      (p) => `${p.name}: ${p.value}`,
    ),
  };
  let elements: ElementStyles | undefined = tech.elements ?? undefined;
  const serialise = () =>
    JSON.stringify({
      ...Object.fromEntries(
        Object.entries(lists).filter(([, list]) => list.length > 0),
      ),
      ...(elements && Object.keys(elements).length > 0 ? { elements } : {}),
    });

  let json = serialise();
  while (json.length > maxChars) {
    const longest = Object.values(lists)
      .filter((list) => list.length > 0)
      .sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)[0];
    if (longest) {
      longest.length = Math.floor(longest.length / 2);
    } else if (elements) {
      elements = undefined;
    } else {
      break;
    }
    json = serialise();
  }
  return json;
}

const counted = (c: CountedValue) => `${c.value} ×${c.count}`;

/** Whether a capture measured anything at all — a release-1 capture or a canvas page did not. */
export function hasTechnique(tech: CaptureTechnique): boolean {
  return (
    tech.fonts.length > 0 ||
    tech.libraries.length > 0 ||
    Object.values(tech.css).some((list) => list.length > 0) ||
    (tech.tokens !== null &&
      Object.values(tech.tokens).some((list) => list.length > 0)) ||
    (tech.elements !== null && Object.keys(tech.elements).length > 0)
  );
}
