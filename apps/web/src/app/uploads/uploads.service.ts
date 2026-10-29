import {
  HttpClient,
  HttpErrorResponse,
  HttpEventType,
} from '@angular/common/http';
import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface AssetSummary {
  readonly id: string;
  readonly title: string | null;
  readonly status: 'pending' | 'ready' | 'failed';
  readonly classified: boolean;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly thumbnailUrl: string | null;
}

export type UploadError = 'tooLarge' | 'unsupported' | 'failed';

export interface UploadItem {
  readonly key: number;
  readonly name: string;
  readonly progress: number;
  readonly error: UploadError | null;
}

/** After an upload, how long to keep polling for the classification to arrive. */
const CLASSIFY_WINDOW_MS = 3 * 60 * 1000;
const POLL_MS = 4000;

/**
 * Uploads and the "latest uploads" list (0004). One request per file, so a bad file fails alone.
 * The list polls while something is still moving — pending, or recently uploaded and not yet
 * classified — and stops otherwise.
 */
@Injectable({ providedIn: 'root' })
export class UploadsService {
  private readonly http = inject(HttpClient);
  private nextKey = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  readonly uploads = signal<UploadItem[]>([]);
  readonly recent = signal<AssetSummary[]>([]);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopPolling());
  }

  upload(files: readonly File[]): void {
    for (const file of files) {
      const key = this.nextKey++;
      this.uploads.update((list) => [
        ...list,
        { key, name: file.name || 'clipboard', progress: 0, error: null },
      ]);
      const body = new FormData();
      body.append('file', file, file.name || 'clipboard.png');
      this.http
        .post<{
          id: string;
        }>('/api/assets', body, { reportProgress: true, observe: 'events' })
        .subscribe({
          next: (event) => {
            if (event.type === HttpEventType.UploadProgress && event.total) {
              this.patch(key, { progress: event.loaded / event.total });
            }
          },
          complete: () => {
            this.uploads.update((list) =>
              list.filter((item) => item.key !== key),
            );
            void this.refresh();
          },
          error: (error: unknown) => {
            const status =
              error instanceof HttpErrorResponse ? error.status : 0;
            this.patch(key, {
              error:
                status === 413
                  ? 'tooLarge'
                  : status === 415
                    ? 'unsupported'
                    : 'failed',
            });
          },
        });
    }
  }

  dismiss(key: number): void {
    this.uploads.update((list) => list.filter((item) => item.key !== key));
  }

  async refresh(): Promise<void> {
    this.stopPolling();
    try {
      this.recent.set(
        await firstValueFrom(
          this.http.get<AssetSummary[]>('/api/assets?limit=30'),
        ),
      );
    } catch {
      // The next upload or page load tries again; a failed refresh is not worth an error banner.
    }
    const now = Date.now();
    const moving = this.recent().some(
      (asset) =>
        asset.status === 'pending' ||
        (asset.status === 'ready' &&
          !asset.classified &&
          now - Date.parse(asset.createdAt) < CLASSIFY_WINDOW_MS),
    );
    if (moving) {
      this.timer = setTimeout(() => void this.refresh(), POLL_MS);
    }
  }

  private stopPolling(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private patch(key: number, change: Partial<UploadItem>): void {
    this.uploads.update((list) =>
      list.map((item) => (item.key === key ? { ...item, ...change } : item)),
    );
  }
}
