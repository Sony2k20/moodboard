import { DESIGN_NOTE_KEYS, DesignNoteKey } from './analysis-result.schema';
import { AssetDetail, VocabularyFacet } from './asset-query';

/**
 * A prompt for Claude Code or Claude Design to build a UI in the style of one reference (0008).
 *
 * Assembled from the metadata rather than written by a model: free, instant, and current — a
 * facet a person corrects is in the next prompt. English in either UI language, because it is
 * input for a model, like the description (§13.3). Empty facets are left out, never guessed.
 */
export function buildPrompt(
  asset: AssetDetail,
  vocabulary: readonly VocabularyFacet[],
): string {
  const facets = new Map(vocabulary.map((f) => [f.key, f]));

  /** English labels of a facet's values, the ones a person set first. */
  const values = (key: string): string[] => {
    const facet = facets.get(key);
    return asset.facets
      .filter((v) => v.facet === key)
      .sort((a, b) => Number(b.origin === 'human') - Number(a.origin === 'human'))
      .map((v) => {
        const label = facet?.values.find((x) => x.value === v.value)?.label.en ?? v.value;
        return label.toLowerCase();
      });
  };
  const line = (label: string, list: string[]) =>
    list.length > 0 ? `${label}: ${list.join(', ')}.` : null;
  const pair = (...parts: (string | null)[]) => {
    const kept = parts.filter((p): p is string => p !== null);
    return kept.length > 0 ? kept.join(' ') : null;
  };

  const patterns = values('ui_pattern');
  const subject =
    patterns.length > 0
      ? `a ${joinNatural(patterns)} ${patterns.length > 1 ? 'layout' : 'section'}`
      : 'a user interface';

  const palette = [...asset.colors]
    .sort((a, b) => b.ratio - a.ratio)
    .map((c, i) => `${c.hex} (${i === 0 ? 'background' : 'accent'}, ${Math.round(c.ratio * 100)}%)`);

  const motion = values('motion');
  const motionLine =
    motion.length === 0
      ? null
      : motion.every((m) => m === 'none')
        ? 'Motion: none — a static reference.'
        : line('Motion', motion.filter((m) => m !== 'none'));

  const tags = asset.tags.map((t) => t.name);
  const imagery = asset.facets.filter((v) => v.facet === 'imagery').map((v) => v.value);
  const finish = asset.facets.filter((v) => v.facet === 'finish').map((v) => v.value);

  const body = [
    pair(line('Layout', values('layout')), line('Density', values('density'))),
    pair(line('Style', values('style')), line('Mood', values('mood')), line('Theme', values('theme'))),
    pair(line('Imagery', values('imagery')), line('Finish', values('finish'))),
    line('Typography', values('typography')),
    palette.length > 0 ? `Palette (by share): ${palette.join(', ')}.` : null,
    motionLine,
    line('Industry', values('industry')),
    asset.description ? `What the reference shows: ${asset.description}` : null,
    tags.length > 0 ? `Keywords: ${tags.join(', ')}.` : null,
  ].filter((l): l is string => l !== null);

  // 0009: how it looks, in the model's words — the part facets cannot carry.
  const notes = DESIGN_NOTE_KEYS.flatMap((key) => {
    const text = asset.designNotes?.[key]?.trim();
    return text ? [`- ${NOTE_LABELS[key]}: ${text}`] : [];
  });

  // 0009: what a rebuild from text alone got wrong — photos drawn as illustrations, depth flattened.
  const rules = [
    imagery.includes('photography')
      ? 'Where the reference uses photographs, use photographs too (placeholder photos are fine) — not illustrations or icons.'
      : null,
    imagery.includes('3d-render')
      ? 'Where it uses 3D renders, keep their lighting and volume; do not replace them with flat vector art.'
      : null,
    finish.some((f) => ['texture', 'grain', 'soft-shadow', 'layered', 'gradient', 'glow'].includes(f))
      ? 'Reproduce the textures, gradients, shadows and layering described above; do not flatten the design.'
      : null,
    'Match the composition, colour proportions and type hierarchy. Do not copy its text, logos or images.',
  ].filter((l): l is string => l !== null);

  return [
    `Build ${subject} in the visual style of the attached reference${asset.title ? ` ("${asset.title}")` : ''}.`,
    ...(body.length > 0 ? ['', ...body] : []),
    ...(notes.length > 0 ? ['', 'Visual details:', ...notes] : []),
    '',
    ...rules,
    'The reference image is attached: follow it wherever this text is unclear.',
  ].join('\n');
}

const NOTE_LABELS: Record<DesignNoteKey, string> = {
  composition: 'Composition',
  imagery: 'Imagery',
  surfaces: 'Surfaces',
  shapes: 'Shapes',
  typography: 'Typography',
  components: 'Components',
  details: 'Details',
};

function joinNatural(items: string[]): string {
  return items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
