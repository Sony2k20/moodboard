import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  AssetDetail,
  AssetQuery,
  assetQueryParams,
  AssetSearchResult,
  VocabularyFacet,
} from '@moodboard/shared';
import { firstValueFrom, shareReplay } from 'rxjs';

/** The read side of the api (0005). Query and result shapes come from `@moodboard/shared`. */
@Injectable({ providedIn: 'root' })
export class AssetsApi {
  private readonly http = inject(HttpClient);

  /** The vocabulary changes rarely; one request per page load is enough. */
  private readonly vocabulary$ = this.http
    .get<VocabularyFacet[]>('/api/vocabulary')
    .pipe(shareReplay(1));

  search(query: Partial<AssetQuery>): Promise<AssetSearchResult> {
    return firstValueFrom(
      this.http.get<AssetSearchResult>('/api/assets', {
        params: new HttpParams({ fromObject: assetQueryParams(query) }),
      }),
    );
  }

  detail(id: string): Promise<AssetDetail> {
    return firstValueFrom(
      this.http.get<AssetDetail>(`/api/assets/${encodeURIComponent(id)}`),
    );
  }

  vocabulary(): Promise<VocabularyFacet[]> {
    return firstValueFrom(this.vocabulary$);
  }
}
