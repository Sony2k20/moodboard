/**
 * Matching for the command palette (0016): case-insensitive substring and word-prefix, no fuzzy
 * matching. Every word typed has to be found in one of an entry's texts — `theme dark` finds the
 * value whose facet says "Theme" and whose label says "Dark".
 *
 * The rank orders results: 0 when a text starts with the whole query, then per word 1 for a word
 * start and 2 for anywhere inside a word. Lower is better; `null` is no match.
 */
export function paletteRank(query: string, texts: readonly string[]): number | null {
  const q = normalise(query);
  if (!q) {
    return 0;
  }
  const haystacks = texts.map(normalise).filter(Boolean);
  if (haystacks.some((text) => text.startsWith(q))) {
    return 0;
  }
  let rank = 0;
  for (const word of q.split(' ')) {
    let best: number | null = null;
    for (const text of haystacks) {
      const at = text.indexOf(word);
      if (at === -1) {
        continue;
      }
      const wordStart = at === 0 || /[\s\-_:/]/.test(text[at - 1]);
      const score = wordStart ? 1 : 2;
      best = best === null ? score : Math.min(best, score);
    }
    if (best === null) {
      return null;
    }
    rank += best;
  }
  return rank;
}

/** Lower case, accents folded, whitespace collapsed: `Ästhetik` and `asthetik` meet. */
function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
