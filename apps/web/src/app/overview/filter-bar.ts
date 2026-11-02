import {
  Component,
  computed,
  DestroyRef,
  ElementRef,
  HostListener,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Vocabulary } from '../assets/vocabulary';
import { BoardsApi } from '../boards/boards-api.service';
import { OverviewStore } from './overview.store';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * The facets people browse by (0020), shown without asking. The rest wait behind "More filters";
 * a facet added to the vocabulary later joins them there.
 */
const PRIMARY_FACETS: readonly string[] = ['type', 'ui_pattern', 'style', 'mood', 'theme'];

/**
 * Search, one pill per facet, author and the active filters (0012, replacing the 0005 sidebar).
 * A pill opens its facet's values under the row rather than as a popover, so the row can scroll
 * sideways on a phone without clipping what it opens. The semantics are 0005's: values within a
 * facet are OR, facets with each other AND, and a value that would empty the result is disabled,
 * not hidden. Only the primary facets show at first (0020); a facet in use always does.
 */
@Component({
  selector: 'mb-filter-bar',
  imports: [TranslocoPipe],
  templateUrl: './filter-bar.html',
  styleUrl: './filter-bar.css',
})
export class FilterBar {
  protected readonly store = inject(OverviewStore);
  protected readonly vocabulary = inject(Vocabulary);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly boards = inject(BoardsApi);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  protected readonly smartFailed = signal(false);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  /** The facet whose values are open, at most one. */
  protected readonly open = signal<string | null>(null);
  /** "More filters" is open: every facet and the author. */
  protected readonly more = signal(false);

  protected readonly facets = computed(() =>
    this.vocabulary.facets().filter((facet) => facet.values.length > 0),
  );
  protected readonly visibleFacets = computed(() =>
    this.more()
      ? this.facets()
      : this.facets().filter(
          (facet) => PRIMARY_FACETS.includes(facet.key) || this.selectedIn(facet.key) > 0,
        ),
  );
  protected readonly hasHidden = computed(
    () =>
      this.visibleFacets().length < this.facets().length ||
      (this.store.counts().authors.length > 1 && !this.store.query().author),
  );
  protected readonly openFacet = computed(
    () => this.visibleFacets().find((facet) => facet.key === this.open()) ?? null,
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancelSearch());
  }

  /** The current filter as a smart board (0019): its items are always this filter's result. */
  protected async saveSmartBoard(): Promise<void> {
    const title = prompt(this.transloco.translate('boards.smart.title'))?.trim();
    if (!title) {
      return;
    }
    this.smartFailed.set(false);
    try {
      const { id } = await this.boards.create({ title, filter: this.store.filterParams() });
      await this.router.navigate(['/boards', id]);
    } catch {
      this.smartFailed.set(true);
    }
  }

  protected toggle(facet: string): void {
    this.open.update((open) => (open === facet ? null : facet));
  }

  protected toggleMore(): void {
    this.more.update((more) => !more);
  }

  protected selectedIn(facet: string): number {
    return this.store.query().facet.filter((f) => f.facet === facet).length;
  }

  protected authorName(id: string): string {
    return this.store.counts().authors.find((a) => a.id === id)?.displayName ?? '…';
  }

  protected onSearch(value: string): void {
    this.cancelSearch();
    this.searchTimer = setTimeout(() => this.store.setSearch(value), SEARCH_DEBOUNCE_MS);
  }

  protected submitSearch(event: Event, value: string): void {
    event.preventDefault();
    this.cancelSearch();
    this.store.setSearch(value);
  }

  protected onAuthor(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.store.setAuthor(value || undefined);
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.open.set(null);
    }
  }

  /** Closes the open values first; only a second Escape reaches the inspector. */
  @HostListener('keydown.escape', ['$event'])
  protected onEscape(event: Event): void {
    if (this.open()) {
      event.stopPropagation();
      this.open.set(null);
    }
  }

  private cancelSearch(): void {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
  }
}
