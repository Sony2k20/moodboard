import { Component, DestroyRef, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Vocabulary } from '../assets/vocabulary';
import { OverviewStore } from './overview.store';

const SEARCH_DEBOUNCE_MS = 300;
/** Open on first visit: the facets a design search most often starts with. */
const INITIALLY_OPEN = ['ui_pattern', 'style', 'mood', 'theme'];

/**
 * Search, facets and author (0005). Every value shows how many assets the result would have with
 * it added; a value that would empty the result is disabled, not hidden, so the vocabulary stays
 * visible as a whole.
 */
@Component({
  selector: 'mb-filter-panel',
  imports: [TranslocoPipe],
  templateUrl: './filter-panel.html',
  styleUrl: './filter-panel.css',
})
export class FilterPanel {
  protected readonly store = inject(OverviewStore);
  protected readonly vocabulary = inject(Vocabulary);
  private readonly open = signal(new Set(INITIALLY_OPEN));
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancelSearch());
  }

  protected isOpen(facet: string): boolean {
    return this.open().has(facet) || this.selectedIn(facet) > 0;
  }

  protected onToggle(facet: string, event: Event): void {
    const isOpen = (event.target as HTMLDetailsElement).open;
    this.open.update((open) => {
      const next = new Set(open);
      if (isOpen) {
        next.add(facet);
      } else {
        next.delete(facet);
      }
      return next;
    });
  }

  protected selectedIn(facet: string): number {
    return this.store.query().facet.filter((f) => f.facet === facet).length;
  }

  protected onSearch(value: string): void {
    this.cancelSearch();
    this.searchTimer = setTimeout(
      () => this.store.setSearch(value),
      SEARCH_DEBOUNCE_MS,
    );
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

  private cancelSearch(): void {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
  }
}
