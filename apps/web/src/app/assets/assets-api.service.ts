import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  AssetDetail,
  AssetQuery,
  assetQueryParams,
  AssetSearchResult,
  AssetTextPatch,
  BulkResult,
  TrashItem,
  VocabularyFacet,
} from '@moodboard/shared';
import { firstValueFrom, shareReplay } from 'rxjs';

/** A bulk action as the web sends it; facet values as `facet:value` keys (0006). */
export type BulkRequest =
  | { action: 'tags'; ids: string[]; add?: string[]; remove?: string[] }
  | { action: 'facets'; ids: string[]; add?: string[]; remove?: string[] }
  | { action: 'trash'; ids: string[] };

/** The api's asset endpoints. Query and result shapes come from `@moodboard/shared`. */
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
    return firstValueFrom(this.http.get<AssetDetail>(this.url(id)));
  }

  vocabulary(): Promise<VocabularyFacet[]> {
    return firstValueFrom(this.vocabulary$);
  }

  // Edits answer with the asset as stored, so the page shows what the guards made of it.

  updateText(id: string, patch: AssetTextPatch): Promise<AssetDetail> {
    return firstValueFrom(this.http.patch<AssetDetail>(this.url(id), patch));
  }

  setFacet(id: string, facet: string, values: readonly string[]): Promise<AssetDetail> {
    return firstValueFrom(
      this.http.put<AssetDetail>(`${this.url(id)}/facets/${encodeURIComponent(facet)}`, {
        values,
      }),
    );
  }

  setTags(id: string, tags: readonly string[]): Promise<AssetDetail> {
    return firstValueFrom(this.http.put<AssetDetail>(`${this.url(id)}/tags`, { tags }));
  }

  bulk(request: BulkRequest): Promise<BulkResult> {
    return firstValueFrom(this.http.post<BulkResult>('/api/assets/bulk', request));
  }

  trash(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(this.url(id)));
  }

  restore(id: string): Promise<AssetDetail> {
    return firstValueFrom(this.http.post<AssetDetail>(`${this.url(id)}/restore`, {}));
  }

  trashList(): Promise<TrashItem[]> {
    return firstValueFrom(this.http.get<TrashItem[]>('/api/trash'));
  }

  private url(id: string): string {
    return `/api/assets/${encodeURIComponent(id)}`;
  }
}
