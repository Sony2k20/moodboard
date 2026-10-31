import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  computed,
  DestroyRef,
  effect,
  HostListener,
  inject,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  AssetCard,
  AssetDetail,
  AssetQuery,
  AssetQuerySchema,
  uncertainFacetKeys,
  unconfirmedFacetKeys,
  VocabularyFacet,
} from '@moodboard/shared';
import { AssetsApi } from '../assets/assets-api.service';
import { Vocabulary } from '../assets/vocabulary';

interface FacetRow {
  readonly facet: VocabularyFacet;
  readonly values: AssetDetail['facets'];
  readonly unconfirmed: boolean;
  /** A step of this queue: uncertain, or in "all guesses" any unconfirmed facet (0013). */
  readonly step: boolean;
}

/** `uncertain`: only what the model doubts (0013). `all`: every undecided guess, as in 0012. */
export type QueueMode = 'uncertain' | 'all';

/** What happened to an asset in this session. Never stored: a skipped asset comes back. */
type Mark = 'done' | 'skipped';

const PAGE = 50;
/** Load the next page this many assets before the end, so `→` never waits at the edge. */
const AHEAD = 3;

/**
 * Review mode (0012, release 2): the current filter's assets that still hold a model's guess, one
 * at a time. By default only the guesses the model is unsure about are steps, least confident
 * asset first (0013); the confident ones sit in one line and can be opened. Each facet is
 * confirmed as a whole through the ordinary facet write (0006), so a confirmation is a decision
 * that survives every re-analysis (§5.6). Built for the keyboard; every key has a button, so it
 * also works by tapping.
 */
@Component({
  selector: 'mb-review',
  imports: [RouterLink, TranslocoPipe],
  templateUrl: './review.html',
  styleUrl: './review.css',
  host: { '[attr.aria-busy]': 'saving()' },
})
export class ReviewPage {
  private readonly api = inject(AssetsApi);
  private readonly router = inject(Router);
  protected readonly vocabulary = inject(Vocabulary);

  /** The filter the queue was opened with; "back" returns to the gallery with it. */
  protected readonly filter = signal<Record<string, string | string[]>>({});
  protected readonly mode = signal<QueueMode>('uncertain');
  protected readonly queue = signal<readonly AssetCard[]>([]);
  protected readonly total = signal(0);
  private readonly nextCursor = signal<string | null>(null);
  private query: AssetQuery | null = null;
  private loadingMore = false;
  protected readonly state = signal<'loading' | 'ready' | 'invalid' | 'failed'>('loading');

  /** Position in the queue; `queue.length` is the end of it. */
  protected readonly index = signal(0);
  protected readonly marks = signal<ReadonlyMap<string, Mark>>(new Map());

  protected readonly card = computed(() => this.queue()[this.index()] ?? null);
  protected readonly asset = resource({
    params: () => this.card()?.id,
    loader: ({ params }) => this.api.detail(params),
  });

  /** For a website: the viewport (poster) or the whole page. */
  protected readonly fullPage = signal(false);
  /** A facet picked by clicking its row; otherwise the first undecided one is current. */
  private readonly focus = signal<string | null>(null);
  protected readonly draft = signal<ReadonlySet<string>>(new Set());
  protected readonly saving = signal(false);
  protected readonly saveError = signal(false);

  protected readonly rows = computed<FacetRow[]>(() => {
    const asset = this.asset.value();
    if (!asset || asset.id !== this.card()?.id) {
      return [];
    }
    const unconfirmed = new Set(unconfirmedFacetKeys(asset.facets, asset.decidedFacets));
    const steps = new Set(this.stepKeys(asset));
    return this.vocabulary
      .facets()
      .filter((facet) => facet.values.length > 0)
      .map((facet) => ({
        facet,
        values: asset.facets.filter((v) => v.facet === facet.key),
        unconfirmed: unconfirmed.has(facet.key),
        step: steps.has(facet.key),
      }));
  });

  /** The steps of this asset: what "Confirm all" saves, and what has to be done for ✓. */
  protected readonly pending = computed(() => this.rows().filter((row) => row.step));
  /** Unconfirmed, but sure enough not to be a step (0013): one line, each chip can be opened. */
  protected readonly confident = computed(() =>
    this.rows().filter((row) => row.unconfirmed && !row.step),
  );
  /** Decided or a person's: collapsed into one line. Facets nobody filled are not listed. */
  protected readonly confirmed = computed(() => {
    const decided = this.asset.value()?.decidedFacets ?? [];
    return this.rows().filter(
      (row) => !row.unconfirmed && (row.values.length > 0 || decided.includes(row.facet.key)),
    );
  });
  /** A focused row (a step or an opened confident guess), else the first step. */
  protected readonly current = computed(() => {
    const focused = this.rows().find(
      (row) => row.unconfirmed && row.facet.key === this.focus(),
    );
    return focused ?? this.pending()[0] ?? null;
  });
  /** The steps, plus a confident guess while it is open, in vocabulary order. */
  protected readonly shown = computed(() => {
    const current = this.current();
    return this.rows().filter((row) => row.step || row === current);
  });

  protected readonly image = computed(() => {
    const asset = this.asset.value();
    const files = asset?.files ?? [];
    const find = (kind: string) => files.find((f) => f.kind === kind);
    if (asset?.type === 'website') {
      return { viewport: find('poster') ?? find('thumb_lg'), full: find('original') };
    }
    return { viewport: find('thumb_lg') ?? find('thumb_md'), full: find('original') };
  });

  protected readonly doneCount = computed(
    () => [...this.marks().values()].filter((mark) => mark === 'done').length,
  );
  protected readonly skippedCount = computed(
    () => [...this.marks().values()].filter((mark) => mark === 'skipped').length,
  );

  constructor() {
    const subscription = inject(ActivatedRoute).queryParamMap.subscribe((params) => {
      const raw: Record<string, string | string[]> = {};
      for (const key of params.keys) {
        // The queue sets these itself; a pasted link with them still opens the same queue.
        if (['review', 'cursor', 'limit'].includes(key)) {
          continue;
        }
        const values = params.getAll(key);
        raw[key] = values.length === 1 ? values[0] : values;
      }
      this.filter.set(raw);
      this.mode.set(params.get('review') === 'all' ? 'all' : 'uncertain');
      void this.start(raw);
    });
    inject(DestroyRef).onDestroy(() => subscription.unsubscribe());

    // A new asset or a new current facet starts from the values it holds.
    const draftKey = computed(() => `${this.card()?.id}:${this.current()?.facet.key}`);
    effect(() => {
      draftKey();
      untracked(() => {
        this.draft.set(new Set(this.current()?.values.map((v) => v.value) ?? []));
      });
    });
    effect(() => {
      this.card();
      untracked(() => {
        this.focus.set(null);
        this.fullPage.set(false);
        this.saveError.set(false);
      });
    });
  }

  @HostListener('document:keydown', ['$event'])
  protected onKey(event: KeyboardEvent): void {
    const target = event.target;
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      (target instanceof Element && target.closest('input, textarea, select'))
    ) {
      return;
    }
    if (event.key === 'Enter') {
      // Also on a focused button, whose own click would otherwise run a second time.
      event.preventDefault();
      void (event.shiftKey ? this.confirmAll() : this.confirm());
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.next();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.previous();
    } else if (event.key === 's' || event.key === 'S') {
      this.skip();
    } else if (event.key === 'Escape') {
      this.back();
    } else if (/^[1-9]$/.test(event.key)) {
      const row = this.current();
      const option = row?.facet.values[Number(event.key) - 1];
      if (row && option) {
        this.toggle(row.facet, option.value);
      }
    }
  }

  protected toggle(facet: VocabularyFacet, value: string): void {
    this.draft.update((current) => {
      if (!facet.isMultiValue) {
        return new Set(current.has(value) ? [] : [value]);
      }
      const next = new Set(current);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  }

  protected pick(row: FacetRow): void {
    if (row.unconfirmed) {
      this.focus.set(row.facet.key);
    }
  }

  /** Saves the current facet with the chosen values; the next undecided one becomes current. */
  protected confirm(): Promise<void> {
    const row = this.current();
    if (!row) {
      return Promise.resolve();
    }
    const values = this.draftValues(row.facet);
    return this.save(async (id) => this.api.setFacet(id, row.facet.key, values));
  }

  /**
   * Saves every step: the current one with the chosen values, the others with the values they
   * hold. A confident guess is saved only while it is open — the rest stay `ai` (0013). One write
   * per facet, as "Confirm all" in the inspector.
   */
  protected confirmAll(): Promise<void> {
    const current = this.current();
    const rows = this.pending().concat(current && !current.step ? [current] : []);
    if (rows.length === 0) {
      return Promise.resolve();
    }
    return this.save(async (id) => {
      let latest: AssetDetail | null = null;
      try {
        for (const row of rows) {
          const values =
            row === current ? this.draftValues(row.facet) : row.values.map((v) => v.value);
          latest = await this.api.setFacet(id, row.facet.key, values);
        }
      } catch (error) {
        if (latest) {
          this.apply(latest);
        }
        throw error;
      }
      return latest;
    });
  }

  protected skip(): void {
    const card = this.card();
    if (!card) {
      return;
    }
    if (this.marks().get(card.id) !== 'done') {
      this.mark(card.id, 'skipped');
    }
    this.next();
  }

  protected next(): void {
    this.go(this.index() + 1);
  }

  protected previous(): void {
    this.go(this.index() - 1);
  }

  protected go(index: number): void {
    if (this.saving() || index < 0 || index > this.queue().length) {
      return;
    }
    this.index.set(index);
    if (index >= this.queue().length - AHEAD) {
      void this.loadMore();
    }
  }

  protected back(): void {
    void this.router.navigate(['/'], { queryParams: this.filter() });
  }

  protected markOf(card: AssetCard, position: number): Mark | 'current' | 'open' {
    if (position === this.index()) {
      return 'current';
    }
    return this.marks().get(card.id) ?? 'open';
  }

  /** The link to this queue in the other mode, with the same filter. */
  protected modeParams(mode: QueueMode): Record<string, string | string[]> {
    return { ...this.filter(), review: mode === 'all' ? 'all' : '1' };
  }

  /** The key that toggles an option, for the first nine. */
  protected key(position: number): string | null {
    return position < 9 ? String(position + 1) : null;
  }

  private async start(raw: Record<string, string | string[]>): Promise<void> {
    const parsed = AssetQuerySchema.safeParse({
      ...raw,
      review: this.mode() === 'all' ? 'all' : '1',
      limit: String(PAGE),
    });
    if (!parsed.success) {
      this.state.set('invalid');
      return;
    }
    // Opening the same queue again (a reload) keeps nothing of the last pass: skipped is
    // session-only, and what was confirmed has left the queue.
    this.query = parsed.data;
    this.state.set('loading');
    this.marks.set(new Map());
    this.index.set(0);
    try {
      const result = await this.api.search(parsed.data);
      if (this.query !== parsed.data) {
        return;
      }
      this.queue.set(result.items);
      this.total.set(result.total);
      this.nextCursor.set(result.nextCursor);
      this.state.set('ready');
    } catch (error) {
      this.state.set(
        error instanceof HttpErrorResponse && error.status === 400 ? 'invalid' : 'failed',
      );
    }
  }

  private async loadMore(): Promise<void> {
    const cursor = this.nextCursor();
    const query = this.query;
    if (!cursor || !query || this.loadingMore) {
      return;
    }
    this.loadingMore = true;
    try {
      const result = await this.api.search({ ...query, cursor });
      if (query !== this.query) {
        return;
      }
      const known = new Set(this.queue().map((card) => card.id));
      this.queue.update((queue) => [
        ...queue,
        ...result.items.filter((card) => !known.has(card.id)),
      ]);
      this.nextCursor.set(result.nextCursor);
    } catch {
      // The next step forward tries again.
    } finally {
      this.loadingMore = false;
    }
  }

  /** Vocabulary order, not click order — as the inspector saves. */
  private draftValues(facet: VocabularyFacet): string[] {
    return facet.values.map((v) => v.value).filter((v) => this.draft().has(v));
  }

  private async save(write: (id: string) => Promise<AssetDetail | null>): Promise<void> {
    const id = this.card()?.id;
    if (!id || this.saving()) {
      return;
    }
    this.saving.set(true);
    this.saveError.set(false);
    try {
      const updated = await write(id);
      if (updated) {
        this.apply(updated);
      }
    } catch {
      this.saveError.set(true);
    } finally {
      this.saving.set(false);
    }
  }

  private apply(updated: AssetDetail): void {
    if (updated.id === this.card()?.id) {
      this.asset.value.set(updated);
      this.focus.set(null);
    }
    if (this.stepKeys(updated).length === 0) {
      this.mark(updated.id, 'done');
    }
  }

  /** The facets this queue asks about — the same rule the api queues by. */
  private stepKeys(asset: AssetDetail): string[] {
    return this.mode() === 'all'
      ? unconfirmedFacetKeys(asset.facets, asset.decidedFacets)
      : uncertainFacetKeys(asset.facets, asset.decidedFacets);
  }

  private mark(id: string, mark: Mark): void {
    this.marks.update((marks) => new Map(marks).set(id, mark));
  }
}
