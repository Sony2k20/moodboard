import { Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { MAX_BULK_ASSETS } from '@moodboard/shared';
import { Vocabulary } from '../assets/vocabulary';
import { OverviewStore } from './overview.store';

/**
 * Actions on the selected tiles (0006): tags, facet values, trash. Each asset goes through the
 * same edit as a single change, so adding `style:editorial` here means what it means on the
 * detail page — the facet becomes a person's.
 */
@Component({
  selector: 'mb-bulk-bar',
  imports: [TranslocoPipe],
  templateUrl: './bulk-bar.html',
  styleUrl: './bulk-bar.css',
})
export class BulkBar {
  protected readonly store = inject(OverviewStore);
  protected readonly vocabulary = inject(Vocabulary);
  private readonly transloco = inject(TranslocoService);
  protected readonly max = MAX_BULK_ASSETS;

  protected readonly busy = signal(false);
  protected readonly facetKey = signal('');
  protected readonly facets = computed(() =>
    this.vocabulary.facets().filter((f) => f.values.length > 0),
  );
  protected readonly values = computed(
    () => this.facets().find((f) => f.key === this.facetKey())?.values ?? [],
  );

  protected async tag(name: string, mode: 'add' | 'remove'): Promise<void> {
    if (!name.trim()) {
      return;
    }
    await this.run({ action: 'tags', [mode]: [name] });
  }

  protected async facet(value: string, mode: 'add' | 'remove'): Promise<void> {
    if (!this.facetKey() || !value) {
      return;
    }
    await this.run({ action: 'facets', [mode]: [`${this.facetKey()}:${value}`] });
  }

  protected async trash(): Promise<void> {
    const count = this.store.selected().size;
    if (!confirm(this.transloco.translate('bulk.confirmTrash', { count }))) {
      return;
    }
    await this.run({ action: 'trash' });
  }

  private async run(request: Parameters<OverviewStore['bulk']>[0]): Promise<void> {
    this.busy.set(true);
    try {
      await this.store.bulk(request);
    } finally {
      this.busy.set(false);
    }
  }
}
