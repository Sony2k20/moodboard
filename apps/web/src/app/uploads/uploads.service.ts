import {
  HttpClient,
  HttpErrorResponse,
  HttpEventType,
} from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';

export type UploadError = 'tooLarge' | 'unsupported' | 'failed';

export interface UploadItem {
  readonly key: number;
  readonly name: string;
  readonly progress: number;
  readonly error: UploadError | null;
}

/**
 * Uploads (0004). One request per file, so a bad file fails alone. What was uploaded shows up in
 * the overview, which listens to `completed` (0005).
 */
@Injectable({ providedIn: 'root' })
export class UploadsService {
  private readonly http = inject(HttpClient);
  private nextKey = 0;

  readonly uploads = signal<UploadItem[]>([]);
  /** Counts finished uploads; the overview refreshes whenever it changes. */
  readonly completed = signal(0);

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
            this.completed.update((n) => n + 1);
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

  private patch(key: number, change: Partial<UploadItem>): void {
    this.uploads.update((list) =>
      list.map((item) => (item.key === key ? { ...item, ...change } : item)),
    );
  }
}
