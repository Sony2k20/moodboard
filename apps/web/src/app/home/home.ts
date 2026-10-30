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
import { ActivatedRoute } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { parseCaptureUrl } from '@moodboard/shared';
import { AssetGrid } from '../overview/asset-grid';
import { BulkBar } from '../overview/bulk-bar';
import { FilterPanel } from '../overview/filter-panel';
import { OverviewStore } from '../overview/overview.store';
import { UploadsService } from '../uploads/uploads.service';

/**
 * The start page is the overview (0005): filters and grid, with the upload as a bar on top.
 * Dropping works anywhere on the page, pasting too.
 */
@Component({
  selector: 'mb-home',
  imports: [TranslocoPipe, PercentPipe, AssetGrid, BulkBar, FilterPanel],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home {
  protected readonly uploads = inject(UploadsService);
  protected readonly store = inject(OverviewStore);
  protected readonly dragging = signal(false);
  protected readonly urlInvalid = signal(false);

  constructor() {
    const subscription = inject(ActivatedRoute).queryParamMap.subscribe(
      (params) => {
        const raw: Record<string, string | string[]> = {};
        for (const key of params.keys) {
          const values = params.getAll(key);
          raw[key] = values.length === 1 ? values[0] : values;
        }
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
