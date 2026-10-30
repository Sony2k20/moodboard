import { AssetQuerySchema, assetQueryParams } from './asset-query';

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
