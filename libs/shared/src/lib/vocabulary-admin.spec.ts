import {
  VocabularyValueCreateSchema,
  VocabularyValuePatchSchema,
  vocabularyKeyFrom,
} from './vocabulary-admin';

describe('vocabularyKeyFrom', () => {
  it('turns a label into a key that reads well in a URL', () => {
    expect(vocabularyKeyFrom('Client X Relaunch')).toBe('client-x-relaunch');
    expect(vocabularyKeyFrom('  Müller & Söhne — Straße 2027 ')).toBe('muller-sohne-strasse-2027');
    expect(vocabularyKeyFrom('***')).toBe('');
  });
});

describe('VocabularyValueCreateSchema', () => {
  const label = { en: 'Client X', de: 'Kunde X' };

  it('takes a key, both labels and an optional description', () => {
    expect(VocabularyValueCreateSchema.parse({ value: 'client-x', label })).toEqual({
      value: 'client-x',
      label,
      description: null,
    });
  });

  it('refuses a key that would not read well as facet:value', () => {
    for (const value of ['Client-X', 'client x', 'client:x', '-client', 'client--x', '']) {
      expect(VocabularyValueCreateSchema.safeParse({ value, label }).success).toBe(false);
    }
  });

  it('requires both labels', () => {
    expect(
      VocabularyValueCreateSchema.safeParse({ value: 'client-x', label: { en: 'Client X', de: ' ' } })
        .success,
    ).toBe(false);
  });
});

describe('VocabularyValuePatchSchema', () => {
  it('changes labels or description, never the key', () => {
    expect(VocabularyValuePatchSchema.safeParse({ label: { en: 'A', de: 'B' } }).success).toBe(true);
    expect(VocabularyValuePatchSchema.safeParse({ description: null }).success).toBe(true);
    expect(VocabularyValuePatchSchema.safeParse({ value: 'other' }).success).toBe(false);
    expect(VocabularyValuePatchSchema.safeParse({}).success).toBe(false);
  });
});
