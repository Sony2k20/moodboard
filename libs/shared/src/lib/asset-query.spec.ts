import {
  AssetQuerySchema,
  assetQueryParams,
  uncertainFacetKeys,
  unconfirmedFacetKeys,
} from './asset-query';

describe('AssetQuerySchema', () => {
  it('reads a query string key given once or several times', () => {
    expect(AssetQuerySchema.parse({ facet: 'style:editorial' }).facet).toEqual([
      { facet: 'style', value: 'editorial' },
    ]);
    expect(
      AssetQuerySchema.parse({ facet: ['style:editorial', 'theme:dark'] }).facet,
    ).toEqual([
      { facet: 'style', value: 'editorial' },
      { facet: 'theme', value: 'dark' },
    ]);
  });

  it('defaults to an empty query with the default page size', () => {
    expect(AssetQuerySchema.parse({})).toEqual({ facet: [], tag: [], review: 'off', limit: 60 });
  });

  it('treats an empty search as no search', () => {
    expect(AssetQuerySchema.parse({ q: '   ' }).q).toBeUndefined();
    expect(AssetQuerySchema.parse({ q: ' pricing ' }).q).toBe('pricing');
  });

  it('refuses malformed filters instead of returning an empty result', () => {
    expect(AssetQuerySchema.safeParse({ facet: 'editorial' }).success).toBe(false);
    expect(AssetQuerySchema.safeParse({ author: 'ada' }).success).toBe(false);
    expect(AssetQuerySchema.safeParse({ cursor: '2026-10-30' }).success).toBe(false);
    expect(AssetQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
    expect(AssetQuerySchema.safeParse({ sort: 'title' }).success).toBe(false);
    expect(AssetQuerySchema.safeParse({ review: 'yes' }).success).toBe(false);
  });

  it('round-trips through its URL form', () => {
    const query = AssetQuerySchema.parse({
      facet: ['style:editorial', 'ui_pattern:empty-state'],
      q: 'warm earthy',
      tag: 'Dark-Mode',
      review: '1',
    });
    expect(query.review).toBe('uncertain');
    const all = AssetQuerySchema.parse({ review: 'all' });
    expect(AssetQuerySchema.parse(assetQueryParams(all))).toEqual(all);
    expect(AssetQuerySchema.parse(assetQueryParams(query))).toEqual(query);
    expect(assetQueryParams(query)).not.toHaveProperty('limit');
  });
});

describe('unconfirmedFacetKeys', () => {
  it('counts a facet with ai values and neither a human value nor a decision', () => {
    expect(
      unconfirmedFacetKeys(
        [
          { facet: 'mood', origin: 'ai' },
          { facet: 'mood', origin: 'ai' },
          { facet: 'style', origin: 'ai' },
          { facet: 'theme', origin: 'human' },
          { facet: 'density', origin: 'ai' },
          { facet: 'density', origin: 'human' },
        ],
        ['style'],
      ),
    ).toEqual(['mood']);
  });

  it('never counts an empty facet, decided or not', () => {
    expect(unconfirmedFacetKeys([], ['mood'])).toEqual([]);
  });
});

describe('uncertainFacetKeys (0013)', () => {
  it('keeps the undecided facets below the threshold or of unknown confidence', () => {
    expect(
      uncertainFacetKeys(
        [
          { facet: 'mood', origin: 'ai', confidence: 0.5 },
          { facet: 'theme', origin: 'ai', confidence: 0.95 },
          { facet: 'layout', origin: 'ai', confidence: 0.7 },
          { facet: 'finish', origin: 'ai', confidence: null },
          { facet: 'style', origin: 'ai', confidence: 0.3 },
          { facet: 'density', origin: 'human', confidence: null },
        ],
        ['style'],
      ),
    ).toEqual(['mood', 'finish']);
  });

  it('refuses a cursor rank on anything but digits', () => {
    expect(
      AssetQuerySchema.safeParse({ cursor: '412~1730000000000000~00000000-0000-4000-8000-000000000001' })
        .success,
    ).toBe(true);
    expect(
      AssetQuerySchema.safeParse({ cursor: '0.4~1730000000000000~00000000-0000-4000-8000-000000000001' })
        .success,
    ).toBe(false);
  });
});
