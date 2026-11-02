import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  BoardCreate,
  BoardDetail,
  BoardItemPatch,
  BoardItemsAdd,
  BoardPatch,
  BoardSummary,
} from '@moodboard/shared';
import { firstValueFrom } from 'rxjs';

/**
 * The api's board endpoints (0019). Every change answers with the board as it is now — items,
 * derived values, tokens and prompt — so the page never computes any of them itself.
 */
@Injectable({ providedIn: 'root' })
export class BoardsApi {
  private readonly http = inject(HttpClient);

  list(): Promise<BoardSummary[]> {
    return firstValueFrom(this.http.get<BoardSummary[]>('/api/boards'));
  }

  create(board: BoardCreate): Promise<{ id: string }> {
    return firstValueFrom(this.http.post<{ id: string }>('/api/boards', board));
  }

  detail(id: string): Promise<BoardDetail> {
    return firstValueFrom(this.http.get<BoardDetail>(this.url(id)));
  }

  update(id: string, patch: BoardPatch): Promise<BoardDetail> {
    return firstValueFrom(this.http.patch<BoardDetail>(this.url(id), patch));
  }

  remove(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(this.url(id)));
  }

  addItems(id: string, items: BoardItemsAdd): Promise<{ added: number }> {
    return firstValueFrom(this.http.post<{ added: number }>(`${this.url(id)}/items`, items));
  }

  updateItem(id: string, itemId: string, patch: BoardItemPatch): Promise<BoardDetail> {
    return firstValueFrom(
      this.http.patch<BoardDetail>(`${this.url(id)}/items/${encodeURIComponent(itemId)}`, patch),
    );
  }

  removeItem(id: string, itemId: string): Promise<BoardDetail> {
    return firstValueFrom(
      this.http.delete<BoardDetail>(`${this.url(id)}/items/${encodeURIComponent(itemId)}`),
    );
  }

  reorder(id: string, itemIds: readonly string[]): Promise<BoardDetail> {
    return firstValueFrom(this.http.put<BoardDetail>(`${this.url(id)}/order`, { itemIds }));
  }

  private url(id: string): string {
    return `/api/boards/${encodeURIComponent(id)}`;
  }
}
