import {
  Component,
  computed,
  DestroyRef,
  ElementRef,
  HostListener,
  inject,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Vocabulary } from '../assets/vocabulary';
import { OverviewStore } from './overview.store';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Search, one pill per facet, author and the active filters (0012, replacing the 0005 sidebar).
 * A pill opens its facet's values under the row rather than as a popover, so the row can scroll
 * sideways on a phone without clipping what it opens. The semantics are 0005's: values within a
 * facet are OR, facets with each other AND, and a value that would empty the result is disabled,
 * not hidden.
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
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  /** The facet whose values are open, at most one. */
  protected readonly open = signal<string | null>(null);

  protected readonly facets = computed(() =>
    this.vocabulary.facets().filter((facet) => facet.values.length > 0),
  );
  protected readonly openFacet = computed(
    () => this.facets().find((facet) => facet.key === this.open()) ?? null,
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancelSearch());
  }

  protected toggle(facet: string): void {
    this.open.update((open) => (open === facet ? null : facet));
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
