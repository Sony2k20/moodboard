import { z } from 'zod';

/**
 * A translatable string, stored as `jsonb` on the vocabulary tables (concept §13.5).
 *
 * Exactly these two languages, both required. A missing translation would surface as an empty
 * filter label in the UI, which is worse than a wrong one because it looks like a bug in the
 * data rather than a gap in the translation.
 */
export const LocalizedTextSchema = z.object({
  en: z.string().min(1),
  de: z.string().min(1),
});

export type LocalizedText = z.infer<typeof LocalizedTextSchema>;

/** The UI languages. The machine-readable keys in the vocabulary are never translated (§13.3). */
export const LOCALES = ['en', 'de'] as const;
export const LocaleSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof LocaleSchema>;
export const DEFAULT_LOCALE: Locale = 'en';
