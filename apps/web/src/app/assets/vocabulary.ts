import { computed, inject, Injectable, resource } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import { LocalizedText, VocabularyFacet } from '@moodboard/shared';
import { AssetsApi } from './assets-api.service';

/**
 * Facet and value labels in the active language. Keys stay keys everywhere else — in the URL, in
 * the api, in the data (§13.3); only what is shown goes through here.
 */
@Injectable({ providedIn: 'root' })
export class Vocabulary {
  private readonly api = inject(AssetsApi);
  private readonly lang = toSignal(inject(TranslocoService).langChanges$, {
    initialValue: 'en',
  });

  private readonly loaded = resource({ loader: () => this.api.vocabulary() });

  readonly facets = computed<readonly VocabularyFacet[]>(
    () => this.loaded.value() ?? [],
  );

  private readonly byKey = computed(
    () => new Map(this.facets().map((facet) => [facet.key, facet])),
  );

  text(text: LocalizedText | null | undefined): string {
    if (!text) {
      return '';
    }
    return this.lang() === 'de' ? text.de : text.en;
  }

  facetLabel(facet: string): string {
    return this.text(this.byKey().get(facet)?.label) || facet;
  }

  valueLabel(facet: string, value: string): string {
    const entry = this.byKey()
      .get(facet)
      ?.values.find((v) => v.value === value);
    return this.text(entry?.label) || value;
  }
}
