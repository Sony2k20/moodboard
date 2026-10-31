import { AssetQuerySchema, assetQueryParams, unconfirmedFacetKeys } from './asset-query';

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
    expect(AssetQuerySchema.parse({})).toEqual({ facet: [], tag: [], limit: 60 });
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
  });

  it('round-trips through its URL form', () => {
    const query = AssetQuerySchema.parse({
      facet: ['style:editorial', 'ui_pattern:empty-state'],
      q: 'warm earthy',
      tag: 'Dark-Mode',
    });
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
