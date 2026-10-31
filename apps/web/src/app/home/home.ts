import { PercentPipe } from '@angular/common';
import {
  Component,
  DestroyRef,
  effect,
  HostListener,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { parseCaptureUrl } from '@moodboard/shared';
import { AssetGrid } from '../overview/asset-grid';
import { BulkBar } from '../overview/bulk-bar';
import { FilterBar } from '../overview/filter-bar';
import { Inspector } from '../overview/inspector';
import { OverviewStore } from '../overview/overview.store';
import { UploadsService } from '../uploads/uploads.service';

/** `?asset=` names the asset open in the inspector (0012); anything else is no selection. */
const ASSET_ID = /^[0-9a-f-]{36}$/i;

/**
 * The start page is the overview (0005): filters and grid, with the upload as a bar on top.
 * Dropping works anywhere on the page, pasting too. A selected tile opens the inspector beside
 * the grid (0012); the selection is in the URL, so a reload or a shared link reopens it.
 */
@Component({
  selector: 'mb-home',
  imports: [TranslocoPipe, PercentPipe, AssetGrid, BulkBar, FilterBar, Inspector],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home {
  protected readonly uploads = inject(UploadsService);
  protected readonly store = inject(OverviewStore);
  protected readonly dragging = signal(false);
  protected readonly urlInvalid = signal(false);
  protected readonly inspected = signal<string | null>(null);
  private readonly router = inject(Router);

  constructor() {
    // Opening or closing the inspector changes only `asset`; the search stays as it is.
    let followed: string | null = null;
    const subscription = inject(ActivatedRoute).queryParamMap.subscribe(
      (params) => {
        const raw: Record<string, string | string[]> = {};
        for (const key of params.keys) {
          if (key === 'asset') {
            continue;
          }
          const values = params.getAll(key);
          raw[key] = values.length === 1 ? values[0] : values;
        }
        const asset = params.get('asset');
        this.inspected.set(asset && ASSET_ID.test(asset) ? asset : null);
        const key = JSON.stringify(raw);
        if (key === followed) {
          this.store.lastUrl.set(this.router.url);
          return;
        }
        followed = key;
        void this.store.follow(raw);
      },
    );
    inject(DestroyRef).onDestroy(() => subscription.unsubscribe());

    // A finished upload belongs at the top of the grid.
    let seen = this.uploads.completed();
    effect(() => {
      const completed = this.uploads.completed();
      if (completed !== seen) {
        seen = completed;
        untracked(() => void this.store.refresh());
      }
    });
  }

  protected closeInspector(): void {
    void this.router.navigate([], {
      queryParams: { asset: null },
      queryParamsHandling: 'merge',
    });
  }

  /** Paste anywhere on the page: screenshots go straight from the clipboard into the board. */
  @HostListener('document:paste', ['$event'])
  protected onPaste(event: ClipboardEvent): void {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest('input, textarea, [contenteditable]')
    ) {
      return;
    }
    const files = [...(event.clipboardData?.files ?? [])];
    if (files.length > 0) {
      event.preventDefault();
      this.uploads.upload(files);
      return;
    }
    // A copied link from the address bar: the page behind it is captured (0011). Only a text
    // that is nothing but one URL, so pasting a sentence somewhere does not start a capture.
    const text = event.clipboardData?.getData('text/plain').trim() ?? '';
    const url = /^https?:\/\/\S+$/i.test(text) ? parseCaptureUrl(text) : null;
    if (url) {
      event.preventDefault();
      this.uploads.capture(url);
    }
  }

  /** The URL field next to the drop zone. Anything the api would refuse is refused here first. */
  protected onCapture(input: HTMLInputElement): void {
    const url = parseCaptureUrl(input.value);
    this.urlInvalid.set(!url);
    if (url) {
      this.uploads.capture(url);
      input.value = '';
    }
  }

  @HostListener('document:dragover', ['$event'])
  protected onDragOver(event: DragEvent): void {
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
      this.dragging.set(true);
    }
  }

  @HostListener('document:dragleave', ['$event'])
  protected onDragLeave(event: DragEvent): void {
    // Leaving a child element fires too; only leaving the window counts.
    if (!event.relatedTarget) {
      this.dragging.set(false);
    }
  }

  @HostListener('document:drop', ['$event'])
  protected onDrop(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) {
      return;
    }
    event.preventDefault();
    this.dragging.set(false);
    this.uploads.upload([...event.dataTransfer.files]);
  }

  protected onPick(input: HTMLInputElement): void {
    this.uploads.upload([...(input.files ?? [])]);
    input.value = '';
  }
}
