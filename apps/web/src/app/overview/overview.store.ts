import { HttpErrorResponse } from '@angular/common/http';
import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  AssetCard,
  AssetDetail,
  AssetQuery,
  assetQueryParams,
  AssetQuerySchema,
  AssetSearchResult,
  MAX_BULK_ASSETS,
  unconfirmedFacetKeys,
} from '@moodboard/shared';
import { AssetsApi, BulkRequest } from '../assets/assets-api.service';

/** After an upload, how long to keep polling for the classification to arrive. */
const CLASSIFY_WINDOW_MS = 3 * 60 * 1000;
const POLL_MS = 4000;

const EMPTY_QUERY: AssetQuery = AssetQuerySchema.parse({});

/** What a tile shows under its image (0012). A per-viewer setting, so it lives in the browser. */
export type GridView = 'images' | 'facets';
const VIEW_KEY = 'moodboard.overview.view';

function readView(): GridView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'facets' ? 'facets' : 'images';
  } catch {
    return 'images';
  }
}

/**
 * The overview's state (0005). The URL is the source of truth for the query — back, reload and a
 * copied link all show the same result — and this store only follows it: `follow()` is called
 * with the URL's parameters, the `toggle…`/`set…` methods change the URL.
 */
@Injectable({ providedIn: 'root' })
export class OverviewStore {
  private readonly api = inject(AssetsApi);
  private readonly router = inject(Router);
  /** Responses that arrive after a newer request started are dropped. */
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  readonly query = signal<AssetQuery>(EMPTY_QUERY);
  readonly items = signal<readonly AssetCard[]>([]);
  readonly total = signal(0);
  readonly counts = signal<AssetSearchResult['counts']>({
    facets: [],
    authors: [],
  });
  readonly nextCursor = signal<string | null>(null);
  readonly loading = signal(false);
  readonly error = signal<'invalid' | 'failed' | null>(null);
  /** Where "back to the overview" goes from a detail page: the last search, not a blank one. */
  readonly lastUrl = signal('/');

  /** Multi-select (0006): tiles toggle selection instead of opening the detail page. */
  readonly selecting = signal(false);
  readonly selected = signal<ReadonlySet<string>>(new Set());
  readonly bulkError = signal<'forbidden' | 'failed' | null>(null);

  readonly view = signal<GridView>(readView());

  readonly hasFilters = computed(() => {
    const q = this.query();
    return q.facet.length > 0 || q.tag.length > 0 || !!q.q || !!q.author;
  });

  private readonly countByKey = computed(
    () =>
      new Map(
        this.counts().facets.map((c) => [`${c.facet}:${c.value}`, c.count]),
      ),
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopPolling());
  }

  /** Reads the URL's query parameters and loads the first page if the query changed. */
  async follow(raw: Record<string, string | string[] | undefined>): Promise<void> {
    this.lastUrl.set(this.router.url);
    const parsed = AssetQuerySchema.safeParse(raw);
    if (!parsed.success) {
      this.stopPolling();
      this.items.set([]);
      this.error.set('invalid');
      return;
    }
    // Coming back from a detail page to the same search keeps what was scrolled in, so the
    // router can restore the scroll position; the refresh picks up what changed meanwhile.
    const same =
      JSON.stringify(assetQueryParams(parsed.data)) ===
      JSON.stringify(assetQueryParams(this.query()));
    this.query.set(parsed.data);
    if (same && this.items().length > 0 && !this.error()) {
      await this.refresh();
      return;
    }
    await this.load();
  }

  async load(): Promise<void> {
    const generation = ++this.generation;
    this.stopPolling();
    this.loading.set(true);
    try {
      const result = await this.api.search(this.query());
      if (generation !== this.generation) {
        return;
      }
      this.apply(result, result.items);
      this.nextCursor.set(result.nextCursor);
      this.error.set(null);
    } catch (error) {
      if (generation === this.generation) {
        this.items.set([]);
        this.error.set(
          error instanceof HttpErrorResponse && error.status === 400
            ? 'invalid'
            : 'failed',
        );
      }
    } finally {
      if (generation === this.generation) {
        this.loading.set(false);
        this.schedulePoll();
      }
    }
  }

  async loadMore(): Promise<void> {
    const cursor = this.nextCursor();
    if (!cursor || this.loading()) {
      return;
    }
    const generation = this.generation;
    this.loading.set(true);
    try {
      const result = await this.api.search({ ...this.query(), cursor });
      if (generation !== this.generation) {
        return;
      }
      const known = new Set(this.items().map((item) => item.id));
      this.apply(result, [
        ...this.items(),
        ...result.items.filter((item) => !known.has(item.id)),
      ]);
      this.nextCursor.set(result.nextCursor);
    } catch {
      // The sentinel triggers again on the next scroll.
    } finally {
      if (generation === this.generation) {
        this.loading.set(false);
      }
    }
  }

  /**
   * Re-reads the first page without losing what was scrolled in: fresh items replace their old
   * versions, new ones go on top, pages loaded further down stay.
   */
  async refresh(): Promise<void> {
    const generation = this.generation;
    this.stopPolling();
    try {
      const result = await this.api.search(this.query());
      if (generation !== this.generation) {
        return;
      }
      const fresh = result.items;
      const old = this.items();
      if (old.length <= fresh.length || fresh.length === 0) {
        this.apply(result, fresh);
        this.nextCursor.set(result.nextCursor);
      } else {
        const ids = new Set(fresh.map((item) => item.id));
        const boundary = fresh[fresh.length - 1].createdAt;
        this.apply(result, [
          ...fresh,
          ...old.filter((item) => !ids.has(item.id) && item.createdAt < boundary),
        ]);
      }
    } catch {
      // The next poll or upload tries again; a failed refresh is not worth an error banner.
    } finally {
      if (generation === this.generation) {
        this.schedulePoll();
      }
    }
  }

  /** How many matching assets carry this value, the facet's own selection disregarded. */
  count(facet: string, value: string): number {
    return this.countByKey().get(`${facet}:${value}`) ?? 0;
  }

  isSelected(facet: string, value: string): boolean {
    return this.query().facet.some((f) => f.facet === facet && f.value === value);
  }

  toggleFacet(facet: string, value: string): void {
    const selected = this.query().facet;
    this.navigate({
      facet: this.isSelected(facet, value)
        ? selected.filter((f) => !(f.facet === facet && f.value === value))
        : [...selected, { facet, value }],
    });
  }

  toggleTag(tag: string): void {
    const tags = this.query().tag;
    this.navigate({
      tag: tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag],
    });
  }

  setAuthor(author: string | undefined): void {
    this.navigate({ author });
  }

  setSearch(q: string): void {
    this.navigate({ q: q.trim() || undefined });
  }

  clear(): void {
    void this.router.navigate(['/']);
  }

  setView(view: GridView): void {
    this.view.set(view);
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // Storage blocked: the choice holds for this page load.
    }
  }

  /**
   * An asset was edited in the inspector (0012): its tile takes the stored state at once — the
   * counter, the chips, the title — without reloading pages that were scrolled in.
   */
  patch(detail: AssetDetail): void {
    this.items.update((items) =>
      items.map((item) =>
        item.id === detail.id
          ? {
              ...item,
              title: detail.title,
              status: detail.status,
              statusReason: detail.statusReason,
              facets: detail.facets.map(({ facet, value, origin }) => ({ facet, value, origin })),
              tags: detail.tags.map((t) => t.name),
              unconfirmedFacets: unconfirmedFacetKeys(detail.facets, detail.decidedFacets).length,
            }
          : item,
      ),
    );
  }

  /** Another capture attempt for a failed website (0011), from its tile. */
  async retryCapture(id: string): Promise<void> {
    try {
      await this.api.retryCapture(id);
    } finally {
      await this.refresh();
    }
  }

  setSelecting(on: boolean): void {
    this.selecting.set(on);
    this.selected.set(new Set());
    this.bulkError.set(null);
  }

  toggleSelected(id: string): void {
    this.selected.update((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < MAX_BULK_ASSETS) {
        next.add(id);
      }
      return next;
    });
  }

  /** Runs a bulk action on the selection, then reloads: counts and the grid both change. */
  async bulk(
    request:
      | { action: 'tags'; add?: string[]; remove?: string[] }
      | { action: 'facets'; add?: string[]; remove?: string[] }
      | { action: 'trash' },
  ): Promise<boolean> {
    const ids = [...this.selected()];
    if (ids.length === 0) {
      return false;
    }
    this.bulkError.set(null);
    try {
      await this.api.bulk({ ...request, ids } as BulkRequest);
      if (request.action === 'trash') {
        this.selected.set(new Set());
      }
      await this.load();
      return true;
    } catch (error) {
      this.bulkError.set(
        error instanceof HttpErrorResponse && error.status === 403 ? 'forbidden' : 'failed',
      );
      return false;
    }
  }

  /** Changes the query; the asset open in the inspector (0012) stays open. */
  private navigate(change: Partial<AssetQuery>): void {
    const next = { ...this.query(), ...change, cursor: undefined };
    const asset = this.router.parseUrl(this.router.url).queryParamMap.get('asset');
    void this.router.navigate(['/'], {
      queryParams: { ...assetQueryParams(next), ...(asset ? { asset } : {}) },
    });
  }

  private apply(result: AssetSearchResult, items: readonly AssetCard[]): void {
    this.items.set(items);
    this.total.set(result.total);
    this.counts.set(result.counts);
  }

  /** Polls while something is still moving: pending, or just uploaded and not yet classified. */
  private schedulePoll(): void {
    this.stopPolling();
    const now = Date.now();
    const moving = this.items().some(
      (item) =>
        item.status === 'pending' ||
        (!item.classified && now - Date.parse(item.createdAt) < CLASSIFY_WINDOW_MS),
    );
    if (moving) {
      this.timer = setTimeout(() => void this.refresh(), POLL_MS);
    }
  }

  private stopPolling(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
