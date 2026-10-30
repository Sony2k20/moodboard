/**
 * Free-form tags as stored: trimmed, lower-cased, whitespace collapsed, at most 64 characters,
 * no duplicates. The worker writes the model's tags through this and the api a person's, so the
 * same word never ends up as two tags (§5.2).
 */
export function normaliseTags(raw: readonly string[]): string[] {
  return [
    ...new Set(
      raw
        .map((t) => t.trim().toLowerCase().replace(/\s+/g, ' '))
        .filter((t) => t.length > 0 && t.length <= 64),
    ),
  ];
}
