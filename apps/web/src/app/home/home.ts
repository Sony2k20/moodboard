import { DatePipe, PercentPipe } from '@angular/common';
import { Component, HostListener, inject, OnInit, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UploadsService } from '../uploads/uploads.service';

/**
 * The start page: a drop zone and the latest uploads (0004). Not the overview — the grid,
 * filters and detail view are the next step.
 */
@Component({
  selector: 'mb-home',
  imports: [TranslocoPipe, PercentPipe, DatePipe],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home implements OnInit {
  protected readonly uploads = inject(UploadsService);
  protected readonly dragging = signal(false);

  ngOnInit(): void {
    void this.uploads.refresh();
  }

  /** Paste anywhere on the page: screenshots go straight from the clipboard into the board. */
  @HostListener('document:paste', ['$event'])
  protected onPaste(event: ClipboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, [contenteditable]')) {
      return;
    }
    const files = [...(event.clipboardData?.files ?? [])];
    if (files.length > 0) {
      event.preventDefault();
      this.uploads.upload(files);
    }
  }

  protected onDragOver(event: DragEvent): void {
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
      this.dragging.set(true);
    }
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    this.uploads.upload([...(event.dataTransfer?.files ?? [])]);
  }

  protected onPick(input: HTMLInputElement): void {
    this.uploads.upload([...(input.files ?? [])]);
    input.value = '';
  }
}
