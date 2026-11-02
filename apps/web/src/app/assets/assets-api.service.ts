import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  AnalysisRequest,
  AnalysisRequestResult,
  AnalysisSummary,
  AssetDetail,
  ComponentCode,
  AssetQuery,
  assetQueryParams,
  AssetSearchResult,
  AssetTextPatch,
  BulkResult,
  TrashItem,
  VocabularyFacet,
  VocabularyValueCreate,
  VocabularyValuePatch,
} from '@moodboard/shared';
import { firstValueFrom, Observable, of, shareReplay } from 'rxjs';

/** A bulk action as the web sends it; facet values as `facet:value` keys (0006). */
export type BulkRequest =
  | { action: 'tags'; ids: string[]; add?: string[]; remove?: string[] }
  | { action: 'facets'; ids: string[]; add?: string[]; remove?: string[] }
  | { action: 'trash'; ids: string[] };

/** The api's asset endpoints. Query and result shapes come from `@moodboard/shared`. */
@Injectable({ providedIn: 'root' })
export class AssetsApi {
  private readonly http = inject(HttpClient);

  /** The vocabulary changes rarely: one request per page load, again after an admin edit (0014). */
  private vocabulary$ = this.loadVocabulary();

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

  // Maintaining the curated facets (0014), admins only. Each answers with the whole vocabulary.

  createValue(facet: string, value: VocabularyValueCreate): Promise<VocabularyFacet[]> {
    return this.vocabularyWrite(
      this.http.post<VocabularyFacet[]>(`${this.valuesUrl(facet)}`, value),
    );
  }

  updateValue(
    facet: string,
    value: string,
    patch: VocabularyValuePatch,
  ): Promise<VocabularyFacet[]> {
    return this.vocabularyWrite(
      this.http.patch<VocabularyFacet[]>(
        `${this.valuesUrl(facet)}/${encodeURIComponent(value)}`,
        patch,
      ),
    );
  }

  deleteValue(facet: string, value: string): Promise<VocabularyFacet[]> {
    return this.vocabularyWrite(
      this.http.delete<VocabularyFacet[]>(`${this.valuesUrl(facet)}/${encodeURIComponent(value)}`),
    );
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

  // Components as code (0018).

  createComponent(code: ComponentCode & { title?: string }): Promise<{ id: string }> {
    return firstValueFrom(this.http.post<{ id: string }>('/api/assets/components', code));
  }

  updateComponent(id: string, code: ComponentCode): Promise<AssetDetail> {
    return firstValueFrom(this.http.put<AssetDetail>(`${this.url(id)}/component`, code));
  }

  retryCapture(id: string): Promise<{ id: string }> {
    return firstValueFrom(this.http.post<{ id: string }>(`${this.url(id)}/capture`, {}));
  }

  // Re-analysis (0015). The summary is for admins; a selection anyone may re-run.

  analysis(): Promise<AnalysisSummary> {
    return firstValueFrom(this.http.get<AnalysisSummary>('/api/analysis'));
  }

  requestAnalysis(request: AnalysisRequest): Promise<AnalysisRequestResult> {
    return firstValueFrom(
      this.http.post<AnalysisRequestResult>('/api/analysis/requests', request),
    );
  }

  trashList(): Promise<TrashItem[]> {
    return firstValueFrom(this.http.get<TrashItem[]>('/api/trash'));
  }

  private url(id: string): string {
    return `/api/assets/${encodeURIComponent(id)}`;
  }

  private valuesUrl(facet: string): string {
    return `/api/vocabulary/${encodeURIComponent(facet)}/values`;
  }

  private loadVocabulary(): Observable<VocabularyFacet[]> {
    return this.http.get<VocabularyFacet[]>('/api/vocabulary').pipe(shareReplay(1));
  }

  /** The answer is the stored vocabulary; it replaces the cached one for every later reader. */
  private async vocabularyWrite(request: Observable<VocabularyFacet[]>): Promise<VocabularyFacet[]> {
    const vocabulary = await firstValueFrom(request);
    this.vocabulary$ = of(vocabulary);
    return vocabulary;
  }
}
