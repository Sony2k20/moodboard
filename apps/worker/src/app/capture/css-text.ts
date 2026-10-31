import { CountedValue } from '@moodboard/shared';

/**
 * What the stylesheets say that computed styles cannot (0011 release 2): `:hover` rules, the
 * `@keyframes` behind an animation, and the custom properties declared on `:root`. Parsed from
 * the text CDP returns — the CSSOM cannot read cross-origin sheets, and most sites load theirs
 * from a CDN.
 *
 * A scanner, not a CSS parser: rules nested inside a style rule (CSS nesting) are not followed,
 * and a brace inside a string can confuse it. Both cost a few rules, never the capture.
 */

interface StyleRule {
  readonly selector: string;
  readonly declarations: readonly (readonly [
    property: string,
    value: string,
  ])[];
}

export interface StylesheetFindings {
  readonly hover: CountedValue[];
  /** Every `@keyframes` block, compacted, by name. */
  readonly keyframes: ReadonlyMap<string, string>;
  /** Custom property names declared on `:root` or `html`, in order of appearance. */
  readonly rootProperties: readonly string[];
}

/** Properties a `:hover` rule changes that a designer would call a hover effect. */
const HOVER_PROPERTIES = new Set([
  'transform',
  'translate',
  'scale',
  'rotate',
  'box-shadow',
  'color',
  'background',
  'background-color',
  'border-color',
  'opacity',
  'filter',
]);

const GROUPING_AT_RULES =
  /^@(media|supports|layer|container|document|scope)\b/i;
const KEYFRAMES = /^@(-webkit-|-moz-)?keyframes\s+(["']?)([^\s"'{]+)\2/i;
const ROOT_SELECTOR = /^(:root|html)$/i;
const MAX_KEYFRAMES_CSS = 400;

export function analyseStylesheets(
  texts: readonly string[],
): StylesheetFindings {
  const hover = new Map<string, number>();
  const keyframes = new Map<string, string>();
  const rootProperties: string[] = [];
  const seenRoot = new Set<string>();

  for (const text of texts) {
    walk(stripComments(text), {
      rule(rule) {
        const selectors = rule.selector.split(',').map((s) => s.trim());
        if (selectors.some((s) => s.includes(':hover'))) {
          const changes = rule.declarations
            .filter(([property]) => HOVER_PROPERTIES.has(property))
            .map(([property, value]) => `${property}: ${value}`);
          if (changes.length > 0) {
            const key = changes.join('; ');
            hover.set(key, (hover.get(key) ?? 0) + 1);
          }
        }
        if (selectors.some((s) => ROOT_SELECTOR.test(s))) {
          for (const [property] of rule.declarations) {
            if (property.startsWith('--') && !seenRoot.has(property)) {
              seenRoot.add(property);
              rootProperties.push(property);
            }
          }
        }
      },
      keyframes(name, body) {
        keyframes.set(name, compact(body).slice(0, MAX_KEYFRAMES_CSS));
      },
    });
  }

  return {
    hover: [...hover]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count),
    keyframes,
    rootProperties,
  };
}

interface Visitor {
  rule(rule: StyleRule): void;
  keyframes(name: string, body: string): void;
}

/** Walks `prelude { body }` blocks, descending into grouping at-rules such as `@media`. */
function walk(css: string, visitor: Visitor): void {
  let index = 0;
  while (index < css.length) {
    const open = nextOutsideString(css, index, '{;');
    if (open === -1) {
      return;
    }
    const prelude = css.slice(index, open).trim();
    if (css[open] === ';') {
      // A statement at-rule (`@import`, `@charset`) or debris; nothing to keep.
      index = open + 1;
      continue;
    }
    const close = matchingBrace(css, open);
    const body = css.slice(open + 1, close === -1 ? css.length : close);
    index = close === -1 ? css.length : close + 1;

    const frames = KEYFRAMES.exec(prelude);
    if (frames) {
      visitor.keyframes(frames[3], `{${body}}`);
    } else if (GROUPING_AT_RULES.test(prelude)) {
      walk(body, visitor);
    } else if (!prelude.startsWith('@') && prelude.length > 0) {
      visitor.rule({ selector: prelude, declarations: declarationsOf(body) });
    }
  }
}

function declarationsOf(body: string): Array<[string, string]> {
  // Nested rules are cut off rather than misread as declarations.
  const flat = body.replace(/[^;{}]*\{[^{}]*\}/g, '');
  return flat
    .split(';')
    .map((part) => {
      const colon = part.indexOf(':');
      if (colon === -1) {
        return null;
      }
      const property = part.slice(0, colon).trim().toLowerCase();
      const value = compact(part.slice(colon + 1)).replace(
        /\s*!important$/i,
        '',
      );
      return property && value ? ([property, value] as [string, string]) : null;
    })
    .filter((d): d is [string, string] => d !== null);
}

function nextOutsideString(css: string, from: number, chars: string): number {
  let quote: string | null = null;
  for (let i = from; i < css.length; i++) {
    const c = css[i];
    if (quote) {
      if (c === '\\') {
        i++;
      } else if (c === quote) {
        quote = null;
      }
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (chars.includes(c)) {
      return i;
    }
  }
  return -1;
}

function matchingBrace(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const at = nextOutsideString(css, i, '{}');
    if (at === -1) {
      return -1;
    }
    i = at;
    depth += css[at] === '{' ? 1 : -1;
    if (depth === 0) {
      return at;
    }
  }
  return -1;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function compact(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};:,])\s*/g, '$1')
    .trim();
}
