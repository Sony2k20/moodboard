import { AssetDetail, FacetFilter, VocabularyFacet } from './asset-query';
import {
  BoardConflict,
  BoardDerived,
  BoardItem,
  BoardRole,
  BoardTokens,
  DerivedColor,
  DerivedSource,
  TypePairing,
} from './board';
import { CountedValue } from './capture-technique';
import { deltaE, hexToLab, labToHex, Lab } from './color';

/**
 * What a board says as a whole (0019, §10.1), computed rather than inferred by a model:
 * consolidating a palette from five images is arithmetic, and done here it is deterministic and
 * the same for the board page and every agent.
 */

/** How much an item's signals count. `avoid` items feed only avoid lists and conflicts. */
const WEIGHT_FACTOR = { primary: 1, secondary: 0.5, avoid: 0 } as const;

/** Colours closer than this (CIE76) are one colour — the same threshold as `asset_color`. */
const MERGE_DELTA_E = 12;
const MAX_PALETTE = 8;

/** Facets that say what a reference is, not how it looks: not part of a direction. */
const NOT_DIRECTION = new Set(['type', 'project', 'industry']);

type Item = Pick<BoardItem, 'role' | 'weight' | 'asset'>;

const isActive = (item: Item) => item.weight !== 'avoid';

/** Active items of a role — or, when the board has none, active `overall` items. */
function itemsFor(items: readonly Item[], role: BoardRole): { source: DerivedSource; items: Item[] } {
  const own = items.filter((i) => isActive(i) && i.role === role);
  if (own.length > 0) {
    return { source: 'role', items: own };
  }
  const overall = items.filter((i) => isActive(i) && i.role === 'overall');
  return overall.length > 0 ? { source: 'overall', items: overall } : { source: null, items: [] };
}

export function deriveBoard(items: readonly Item[]): BoardDerived {
  const palette = itemsFor(items, 'color');
  const type = itemsFor(items, 'typography');
  const motion = itemsFor(items, 'motion');
  const avoidColors = items.filter(
    (i) => i.weight === 'avoid' && (i.role === 'color' || i.role === 'overall'),
  );

  return {
    palette: {
      source: palette.source,
      colors: mergePalette(palette.items),
      avoid: mergePalette(avoidColors.map((i) => ({ ...i, weight: 'primary' as const }))),
    },
    typePairings: {
      source: type.source,
      pairings: type.items
        .map((i) => typePairing(i.asset))
        .filter((p) => p.heading || p.body || p.family || p.styles.length > 0),
    },
    motionSummary: motionSummary(motion.source, motion.items),
    commonFacets: commonFacets(items.filter((i) => i.weight === 'primary')),
    conflicts: conflicts(items),
  };
}

function mergePalette(items: readonly Item[]): DerivedColor[] {
  const merged: { lab: Lab; weight: number; assetIds: string[] }[] = [];
  for (const item of items) {
    const factor = WEIGHT_FACTOR[item.weight];
    for (const color of item.asset.colors) {
      const lab = hexToLab(color.hex);
      if (!lab || factor === 0) {
        continue;
      }
      const weight = color.ratio * factor;
      const near = merged.find((m) => deltaE(m.lab, lab) < MERGE_DELTA_E);
      if (near) {
        // The heavier colour keeps its place; the lighter one only adds weight and a source.
        if (weight > near.weight) {
          near.lab = lab;
        }
        near.weight += weight;
        if (!near.assetIds.includes(item.asset.id)) {
          near.assetIds.push(item.asset.id);
        }
      } else {
        merged.push({ lab, weight, assetIds: [item.asset.id] });
      }
    }
  }
  const kept = merged.sort((a, b) => b.weight - a.weight).slice(0, MAX_PALETTE);
  const total = kept.reduce((sum, c) => sum + c.weight, 0) || 1;
  return kept.map((c) => ({
    hex: labToHex(c.lab),
    share: Math.round((c.weight / total) * 1000) / 1000,
    assetIds: c.assetIds,
  }));
}

/** `"Inter Variable", Inter, sans-serif` → `Inter Variable`. */
export function firstFamily(stack: string | undefined): string | null {
  const first = stack?.split(',')[0]?.trim().replace(/^["']|["']$/g, '');
  return first ? first : null;
}

function typePairing(asset: AssetDetail): TypePairing {
  const elements = asset.captureTech?.elements;
  const fonts = asset.captureTech?.fonts ?? [];
  const heading = firstFamily(elements?.h1?.fontFamily ?? elements?.h2?.fontFamily) ?? fonts[0] ?? null;
  const body = firstFamily(elements?.body?.fontFamily) ?? fonts[1] ?? fonts[0] ?? null;
  return {
    assetId: asset.id,
    heading,
    body,
    family: asset.font?.family ?? null,
    styles: asset.facets.filter((f) => f.facet === 'typography').map((f) => f.value),
  };
}

function motionSummary(source: DerivedSource, items: readonly Item[]): BoardDerived['motionSummary'] {
  const values = new Map<string, number>();
  const libraries = new Set<string>();
  const transitions: CountedValue[] = [];
  const keyframes = new Set<string>();
  for (const { asset } of items) {
    for (const f of asset.facets.filter((f) => f.facet === 'motion')) {
      values.set(f.value, (values.get(f.value) ?? 0) + 1);
    }
    asset.captureTech?.libraries.forEach((l) => libraries.add(l));
    transitions.push(...(asset.captureTech?.css.transition ?? []));
    asset.captureTech?.css.keyframes.forEach((k) => keyframes.add(k.name));
  }
  return {
    source,
    values: [...values]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
    libraries: [...libraries].sort(),
    transitions: mergeCounted([transitions], 5),
    keyframes: [...keyframes].slice(0, 10),
  };
}

const key = (f: FacetFilter) => `${f.facet}:${f.value}`;

function commonFacets(primary: readonly Item[]): FacetFilter[] {
  if (primary.length === 0) {
    return [];
  }
  const [first, ...rest] = primary;
  return first.asset.facets
    .filter((f) => !NOT_DIRECTION.has(f.facet))
    .filter((f) => rest.every((i) => i.asset.facets.some((g) => key(g) === key(f))))
    .map(({ facet, value }) => ({ facet, value }));
}

function conflicts(items: readonly Item[]): BoardConflict[] {
  const primary = items.filter((i) => i.weight === 'primary');
  const avoid = items.filter((i) => i.weight === 'avoid');
  const found: BoardConflict[] = [];

  const byFacet = new Map<string, Map<string, string[]>>();
  for (const { asset } of primary) {
    for (const f of asset.facets) {
      const values = byFacet.get(f.facet) ?? new Map<string, string[]>();
      values.set(f.value, [...(values.get(f.value) ?? []), asset.id]);
      byFacet.set(f.facet, values);
    }
  }
  for (const [facet, values] of byFacet) {
    if (SPLIT_FACETS.has(facet) && values.size > 1) {
      found.push({
        kind: 'split',
        facet,
        values: [...values].map(([value, assetIds]) => ({ value, assetIds })),
      });
    }
  }

  for (const [facet, values] of byFacet) {
    if (NOT_DIRECTION.has(facet)) {
      continue;
    }
    for (const [value, primaryIds] of values) {
      const avoidIds = avoid
        .filter((i) => i.asset.facets.some((f) => f.facet === facet && f.value === value))
        .map((i) => i.asset.id);
      if (avoidIds.length > 0) {
        found.push({ kind: 'avoided', facet, value, primary: primaryIds, avoid: avoidIds });
      }
    }
  }
  return found;
}

/**
 * The single-value facets of the vocabulary (§6), on which two primaries can contradict each
 * other. Different values of a multi-value facet are no disagreement, and `type` is no axis: a
 * board may combine a website with a font.
 */
const SPLIT_FACETS = new Set(['theme', 'density']);

/** Counted values from several sources, summed and ordered by count. */
function mergeCounted(lists: readonly (readonly CountedValue[])[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const list of lists) {
    for (const { value, count } of list) {
      counts.set(value, (counts.get(value) ?? 0) + count);
    }
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([value]) => value);
}

// ---------------------------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------------------------

const EASINGS: Record<string, [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};

/** `transform 0.3s cubic-bezier(.4,0,.2,1) 0s` → `300ms` and `cubic-bezier(.4,0,.2,1)`. */
export function parseTransition(transition: string): { duration: string | null; easing: string | null } {
  const duration = /(\d*\.?\d+)(ms|s)\b/.exec(transition);
  const ms = duration ? Number(duration[1]) * (duration[2] === 's' ? 1000 : 1) : 0;
  const easing = /cubic-bezier\([^)]*\)|\b(ease-in-out|ease-in|ease-out|ease|linear)\b/.exec(transition);
  return { duration: ms > 0 ? `${Math.round(ms)}ms` : null, easing: easing ? easing[0].replace(/\s+/g, '') : null };
}

function bezier(easing: string): [number, number, number, number] | null {
  if (EASINGS[easing]) {
    return EASINGS[easing];
  }
  const parts = /^cubic-bezier\(([^)]*)\)$/.exec(easing)?.[1].split(',').map(Number);
  return parts?.length === 4 && parts.every((n) => Number.isFinite(n))
    ? (parts as [number, number, number, number])
    : null;
}

const quoteFamily = (family: string) => (/[\s"']/.test(family) ? `"${family.replace(/"/g, '')}"` : family);

/**
 * Tokens from the derived values and the measured technique of the active items. A value missing
 * from every item is left out, never invented.
 */
export function boardTokens(derived: BoardDerived, items: readonly Item[]): BoardTokens {
  const active = items.filter(isActive);
  const techs = active.map((i) => i.asset.captureTech).filter((t) => t !== null);
  const numbered = (prefix: string, values: readonly string[]) =>
    Object.fromEntries(values.map((v, i) => [`${prefix}${i + 1}`, v]));

  const pairing = derived.typePairings.pairings[0];
  const heading = pairing?.heading ?? pairing?.family ?? null;
  const body = pairing?.body ?? pairing?.family ?? null;

  const fontSizes = mergeCounted(techs.map((t) => t.tokens?.fontSizes ?? []), 6).sort(
    (a, b) => parseFloat(a) - parseFloat(b),
  );
  const parsed = mergeCounted(techs.map((t) => t.css.transition), 10).map(parseTransition);
  const durations = [...new Set(parsed.flatMap((p) => (p.duration ? [p.duration] : [])))]
    .sort((a, b) => parseFloat(a) - parseFloat(b))
    .slice(0, 3);
  const easings = [...new Set(parsed.flatMap((p) => (p.easing && bezier(p.easing) ? [p.easing] : [])))].slice(0, 3);

  const json: Record<string, Record<string, string>> = {
    color: numbered('palette-', derived.palette.colors.map((c) => c.hex)),
    font: {
      ...(heading ? { heading } : {}),
      ...(body ? { body } : {}),
    },
    radius: numbered('', mergeCounted(techs.map((t) => t.tokens?.radii ?? []), 4)),
    shadow: numbered('', mergeCounted(techs.map((t) => t.tokens?.shadows ?? []), 3)),
    fontSize: numbered('', fontSizes),
    duration: numbered('', durations),
    easing: numbered('', easings),
  };
  for (const group of Object.keys(json)) {
    if (Object.keys(json[group]).length === 0) {
      delete json[group];
    }
  }

  const W3C_TYPES: Record<string, string> = {
    color: 'color',
    font: 'fontFamily',
    radius: 'dimension',
    fontSize: 'dimension',
    duration: 'duration',
    easing: 'cubicBezier',
    shadow: 'shadow',
  };
  const w3c: Record<string, unknown> = Object.fromEntries(
    Object.entries(json).map(([group, values]) => [
      group,
      Object.fromEntries(
        Object.entries(values).map(([name, value]) => [
          name,
          group === 'font'
            ? { $type: 'fontFamily', $value: value }
            : group === 'easing'
              ? { $type: 'cubicBezier', $value: bezier(value) }
              : group === 'shadow'
                // A shadow's W3C value is structured; the CSS string is kept as it was measured.
                ? { $value: value }
                : { $type: W3C_TYPES[group], $value: value },
        ]),
      ),
    ]),
  );

  const CSS_NAMES: Record<string, string> = {
    color: 'color',
    font: 'font',
    radius: 'radius',
    shadow: 'shadow',
    fontSize: 'font-size',
    duration: 'duration',
    easing: 'easing',
  };
  const cssValue = (group: string, value: string) =>
    group === 'font' ? `${quoteFamily(value)}, sans-serif` : value;
  const cssLines = Object.entries(json).flatMap(([group, values]) =>
    Object.entries(values).map(([name, value]) => `  --${CSS_NAMES[group]}-${name}: ${cssValue(group, value)};`),
  );

  // Tailwind v4 reads theme variables by namespace; durations have none.
  const TAILWIND_NAMES: Record<string, string> = {
    color: 'color',
    font: 'font',
    radius: 'radius',
    shadow: 'shadow',
    fontSize: 'text',
    easing: 'ease',
  };
  const tailwindLines = Object.entries(json)
    .filter(([group]) => TAILWIND_NAMES[group])
    .flatMap(([group, values]) =>
      Object.entries(values).map(
        ([name, value]) => `  --${TAILWIND_NAMES[group]}-${name}: ${cssValue(group, value)};`,
      ),
    );

  return {
    json,
    w3c,
    css: `:root {\n${cssLines.join('\n')}\n}\n`,
    tailwind: `@theme {\n${tailwindLines.join('\n')}\n}\n`,
  };
}

// ---------------------------------------------------------------------------------------------
// The briefing prompt
// ---------------------------------------------------------------------------------------------

const ROLE_TEXT: Record<BoardRole, string> = {
  overall: 'the overall look',
  color: 'the colour palette only',
  layout: 'the layout and composition only',
  typography: 'the typography only',
  motion: 'the motion and interaction only',
  imagery: 'the imagery only',
  copy: 'the copy and tone only',
};

/**
 * The board as a briefing for Claude Code or Claude Design (0019), assembled like the build prompt
 * of one asset (0008): free, instant, current, English in either UI language (§13.3).
 */
export function boardPrompt(
  board: { title: string; briefing: string; items: readonly BoardItem[]; derived: BoardDerived },
  vocabulary: readonly VocabularyFacet[],
): string {
  const label = (facet: string, value: string) =>
    (vocabulary.find((f) => f.key === facet)?.values.find((v) => v.value === value)?.label.en ?? value).toLowerCase();
  const facetText = (filters: readonly FacetFilter[]) =>
    filters.map((f) => `${f.facet} ${label(f.facet, f.value)}`).join(', ');
  const name = (asset: AssetDetail) => (asset.title ? `"${asset.title}"` : 'untitled reference');
  const refLine = (item: BoardItem, n: number) => {
    const look = facetText(item.asset.facets.filter((f) => ['style', 'mood', 'theme', 'layout'].includes(f.facet)));
    return [
      `${n}. ${name(item.asset)} (asset ${item.asset.id}) — take ${ROLE_TEXT[item.role]}${item.weight === 'secondary' ? ', as a secondary influence' : ''}.`,
      item.note ? ` Note: ${item.note}${/[.!?]$/.test(item.note) ? '' : '.'}` : '',
      look ? ` It reads as: ${look}.` : '',
    ].join('');
  };

  const wanted = board.items.filter(isActive);
  const avoided = board.items.filter((i) => i.weight === 'avoid');
  const d = board.derived;
  const pairing = d.typePairings.pairings[0];

  const lines = [
    `Design brief "${board.title}".`,
    '',
    board.briefing ? `What should come out of this:\n${board.briefing}` : 'No written briefing — infer the goal from the references.',
    '',
    'References, each for one aspect. Take from a reference only what its role names; do not blend the rest of it in.',
    ...wanted.map((item, i) => refLine(item, i + 1)),
    ...(avoided.length > 0
      ? ['', 'Counter-examples — explicitly not like these:', ...avoided.map((item, i) => refLine(item, i + 1).replace(' — take ', ' — avoid '))]
      : []),
    '',
    d.commonFacets.length > 0 ? `Shared by every primary reference — the direction: ${facetText(d.commonFacets)}.` : null,
    d.palette.colors.length > 0
      ? `Palette (consolidated, by weight): ${d.palette.colors.map((c) => `${c.hex} ${Math.round(c.share * 100)}%`).join(', ')}.`
      : null,
    d.palette.avoid.length > 0 ? `Colours to stay away from: ${d.palette.avoid.map((c) => c.hex).join(', ')}.` : null,
    pairing
      ? `Typography: ${[
          pairing.heading ? `headings in ${pairing.heading}` : null,
          pairing.body ? `body in ${pairing.body}` : null,
          pairing.family ? `the font ${pairing.family}` : null,
          pairing.styles.length > 0 ? `style ${pairing.styles.map((s) => label('typography', s)).join(', ')}` : null,
        ]
          .filter(Boolean)
          .join('; ')}.`
      : null,
    d.motionSummary.values.length > 0 || d.motionSummary.libraries.length > 0
      ? `Motion: ${[
          ...d.motionSummary.values.map((v) => label('motion', v.value)),
          ...d.motionSummary.libraries.map((l) => `uses ${l}`),
          ...d.motionSummary.transitions.slice(0, 2).map((t) => `transition ${t}`),
        ].join(', ')}.`
      : null,
    ...(d.conflicts.length > 0
      ? [
          '',
          'Conflicts in this board — ask the person which way to go; do not average them:',
          ...d.conflicts.map((c) =>
            c.kind === 'split'
              ? `- The primary references disagree on ${c.facet}: ${c.values.map((v) => label(c.facet, v.value)).join(' vs ')}.`
              : `- ${c.facet} ${label(c.facet, c.value)} is wanted by a primary reference and also carried by a counter-example.`,
          ),
        ]
      : []),
    '',
    'Call get_asset with an asset id for a reference\'s image, measured technique or code. Match composition, colour proportions and type hierarchy; do not copy text, logos or images.',
  ];
  return lines.filter((l): l is string => l !== null).join('\n').replace(/\n{3,}/g, '\n\n');
}
