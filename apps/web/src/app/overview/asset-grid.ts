import {
  afterNextRender,
  afterRenderEffect,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
  viewChildren,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AssetCard } from '@moodboard/shared';
import { Vocabulary } from '../assets/vocabulary';
import { GridView } from './overview.store';

/** Grid row unit and gap in px; must match `asset-grid.css`. */
const ROW = 4;
const GAP = 12;
/** Before the thumbnail exists, a tile has no size of its own. */
const FALLBACK_RATIO = 3 / 4;
/** Start loading the next page this far before the end is visible, so scrolling rarely waits. */
const LOOKAHEAD_PX = 800;

/**
 * Masonry look in reading order (0005): a CSS grid with small rows, each tile spanning as many as
 * it is tall. Tiles fill left to right, and an appended page extends the grid instead of
 * reshuffling it — unlike CSS columns, which fill top to bottom.
 *
 * The height is measured, not computed from the image ratio (0012): in the "Facets" view a tile
 * carries a list of chips under its image, and only the browser knows how tall that wraps. The
 * image box itself keeps its aspect ratio before the thumbnail loads, so measuring never jumps.
 */
@Component({
  selector: 'mb-asset-grid',
  imports: [RouterLink, TranslocoPipe],
  templateUrl: './asset-grid.html',
  styleUrl: './asset-grid.css',
})
export class AssetGrid {
  protected readonly vocabulary = inject(Vocabulary);

  readonly items = input.required<readonly AssetCard[]>();
  readonly hasMore = input(false);
  /** The end of the grid came into view. */
  readonly more = output<void>();
  /** In multi-select (0006) a click toggles the tile instead of opening it. */
  readonly selecting = input(false);
  readonly selected = input<ReadonlySet<string>>(new Set());
  readonly toggle = output<string>();
  /** The asset open in the inspector (0012), highlighted in the grid. */
  readonly current = input<string | null>(null);
  readonly view = input<GridView>('images');
  /** "Retry" on a failed website capture (0011). */
  readonly retry = output<string>();

  private readonly sentinel = viewChild.required<ElementRef<HTMLElement>>('sentinel');
  private readonly tiles = viewChildren<ElementRef<HTMLElement>>('tile');
  private readonly nearEnd = signal(false);
  protected readonly retrying = signal<ReadonlySet<string>>(new Set());

  constructor() {
    const destroyRef = inject(DestroyRef);
    // Re-evaluated when items arrive too: a page that does not fill the screen leaves the end in
    // view, and the observer would not report it a second time. The flag may be stale by then —
    // it was set while the grid was still empty — so the position is measured after rendering.
    effect(() => {
      if (this.nearEnd() && this.hasMore() && this.items().length > 0) {
        untracked(() =>
          requestAnimationFrame(() => {
            const top = this.sentinel().nativeElement.getBoundingClientRect().top;
            if (top < window.innerHeight + LOOKAHEAD_PX) {
              this.more.emit();
            }
          }),
        );
      }
    });

    const span = (tile: HTMLElement) => {
      const height = tile.getBoundingClientRect().height;
      if (height > 0) {
        tile.style.gridRowEnd = `span ${Math.ceil((height + GAP) / ROW)}`;
      }
    };
    const resize =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            for (const entry of entries) {
              span(entry.target as HTMLElement);
            }
          });
    // Observing a tile twice is a no-op, so every render can simply observe them all; a removed
    // tile is dropped by the observer itself.
    afterRenderEffect(() => {
      for (const tile of this.tiles()) {
        resize?.observe(tile.nativeElement);
        span(tile.nativeElement);
      }
    });

    afterNextRender(() => {
      const intersect = new IntersectionObserver(
        (entries) => this.nearEnd.set(entries.some((e) => e.isIntersecting)),
        { rootMargin: `${LOOKAHEAD_PX}px 0px` },
      );
      intersect.observe(this.sentinel().nativeElement);
      destroyRef.onDestroy(() => intersect.disconnect());
    });
    destroyRef.onDestroy(() => resize?.disconnect());
  }

  /** RouterLink ignores `preventDefault`, so in multi-select the template drops the link instead. */
  protected onClick(event: MouseEvent, id: string): void {
    if (this.selecting()) {
      event.preventDefault();
      this.toggle.emit(id);
    }
  }

  protected onRetry(id: string): void {
    this.retrying.update((ids) => new Set([...ids, id]));
    this.retry.emit(id);
  }

  protected ratio(item: AssetCard): number {
    const { width, height } = item.thumbnail ?? {};
    return width && height ? height / width : FALLBACK_RATIO;
  }

  /** A website without a picture yet, or whose capture failed, is recognised by its host (0011). */
  protected host(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }
}
