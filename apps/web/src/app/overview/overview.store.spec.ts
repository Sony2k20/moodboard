import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AssetCard, AssetSearchResult } from '@moodboard/shared';
import { OverviewStore } from './overview.store';

const card = (id: string, change: Partial<AssetCard> = {}): AssetCard => ({
  id,
  title: id,
  type: 'image',
  status: 'ready',
  classified: true,
  createdAt: '2026-10-30T08:00:00.000Z',
  author: { id: 'u1', displayName: 'Ada' },
  thumbnail: null,
  facets: [],
  tags: [],
  ...change,
});

const result = (
  items: AssetCard[],
  nextCursor: string | null = null,
): AssetSearchResult => ({
  items,
  nextCursor,
  total: items.length,
  counts: {
    facets: [{ facet: 'style', value: 'swiss', count: 2 }],
    authors: [],
  },
});

describe('OverviewStore', () => {
  let http: HttpTestingController;
  let store: OverviewStore;
  let router: Router;

  const search = () =>
    http.expectOne((req) => req.method === 'GET' && req.url === '/api/assets');
  const flush = async (req: TestRequest, body: AssetSearchResult) => {
    req.flush(body);
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(() => {
    jest.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(OverviewStore);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    jest.useRealTimers();
    http.verify();
  });

  it('sends the URL query to the api with the same parameter names', async () => {
    const done = store.follow({ facet: ['style:swiss', 'theme:dark'], q: 'grid' });
    const req = search();
    expect(req.request.params.getAll('facet')).toEqual(['style:swiss', 'theme:dark']);
    expect(req.request.params.get('q')).toBe('grid');
    await flush(req, result([card('a')]));
    await done;

    expect(store.items().map((i) => i.id)).toEqual(['a']);
    expect(store.count('style', 'swiss')).toBe(2);
    expect(store.count('style', 'editorial')).toBe(0);
  });

  it('shows a malformed link as invalid without asking the api', async () => {
    await store.follow({ facet: 'swiss' });
    http.expectNone('/api/assets');
    expect(store.error()).toBe('invalid');
  });

  it('turns a toggled facet into the URL, keeping the rest of the query', async () => {
    const navigate = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    const done = store.follow({ facet: 'style:swiss', q: 'grid' });
    await flush(search(), result([]));
    await done;

    store.toggleFacet('style', 'editorial');
    expect(navigate).toHaveBeenLastCalledWith(['/'], {
      queryParams: { facet: ['style:swiss', 'style:editorial'], q: 'grid' },
    });

    store.toggleFacet('style', 'swiss');
    expect(navigate).toHaveBeenLastCalledWith(['/'], {
      queryParams: { q: 'grid' },
    });
  });

  it('appends the next page by cursor without duplicates', async () => {
    const done = store.follow({});
    await flush(search(), result([card('a'), card('b')], 'c1'));
    await done;

    const more = store.loadMore();
    const req = search();
    expect(req.request.params.get('cursor')).toBe('c1');
    await flush(req, result([card('b'), card('c')]));
    await more;

    expect(store.items().map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(store.nextCursor()).toBeNull();
  });

  it('polls while an asset is pending, and stops once it is settled', async () => {
    const done = store.follow({});
    await flush(search(), result([card('a', { status: 'pending', classified: false })]));
    await done;

    jest.advanceTimersByTime(4000);
    await flush(search(), result([card('a')]));

    jest.advanceTimersByTime(10_000);
    http.expectNone('/api/assets');
  });
});
