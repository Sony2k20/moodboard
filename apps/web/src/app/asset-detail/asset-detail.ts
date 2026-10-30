import { DatePipe, PercentPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, resource } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AssetDetail } from '@moodboard/shared';
import { AssetsApi } from '../assets/assets-api.service';
import { Vocabulary } from '../assets/vocabulary';
import { OverviewStore } from '../overview/overview.store';

interface FacetGroup {
  readonly facet: string;
  readonly values: AssetDetail['facets'];
}

/**
 * One asset, read-only (0005): what `get_asset` will return, laid out for a person. `0006` turns
 * this page editable instead of building a second one.
 */
@Component({
  selector: 'mb-asset-detail',
  imports: [RouterLink, TranslocoPipe, DatePipe, PercentPipe],
  templateUrl: './asset-detail.html',
  styleUrl: './asset-detail.css',
})
export class AssetDetailPage {
  /** Bound from the route parameter. */
  readonly id = input.required<string>();

  private readonly api = inject(AssetsApi);
  protected readonly vocabulary = inject(Vocabulary);
  private readonly overview = inject(OverviewStore);
  private readonly router = inject(Router);

  /** Back to the search this asset was opened from, not to a blank overview. */
  protected readonly backLink = computed(() =>
    this.router.parseUrl(this.overview.lastUrl()),
  );

  protected readonly asset = resource({
    params: () => this.id(),
    loader: ({ params }) => this.api.detail(params),
  });

  protected readonly notFound = computed(() => {
    const error = this.asset.error();
    return error instanceof HttpErrorResponse && [400, 404].includes(error.status);
  });

  protected readonly image = computed(() => {
    const files = this.asset.value()?.files ?? [];
    return {
      large: files.find((f) => f.kind === 'thumb_lg') ?? files.find((f) => f.kind === 'thumb_md'),
      original: files.find((f) => f.kind === 'original'),
    };
  });

  /** Facets in vocabulary order, values grouped under their facet. */
  protected readonly groups = computed<FacetGroup[]>(() => {
    const groups = new Map<string, AssetDetail['facets'][number][]>();
    for (const value of this.asset.value()?.facets ?? []) {
      groups.set(value.facet, [...(groups.get(value.facet) ?? []), value]);
    }
    return [...groups].map(([facet, values]) => ({ facet, values }));
  });

  protected facetLink(facet: string, value: string): Record<string, string> {
    return { facet: `${facet}:${value}` };
  }
}
