import {
  afterNextRender,
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
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AssetCard } from '@moodboard/shared';

/** Grid row unit and gap in px; must match `asset-grid.css`. */
const ROW = 4;
const GAP = 12;
/** Before the thumbnail exists, a tile has no size of its own. */
const FALLBACK_RATIO = 3 / 4;
/** Start loading the next page this far before the end is visible, so scrolling rarely waits. */
const LOOKAHEAD_PX = 800;

/**
 * Masonry look in reading order (0005): a CSS grid with small rows, each tile spanning as many as
 * its image is tall at the current column width. Tiles fill left to right, and an appended page
 * extends the grid instead of reshuffling it — unlike CSS columns, which fill top to bottom.
 */
@Component({
  selector: 'mb-asset-grid',
  imports: [RouterLink, TranslocoPipe],
  templateUrl: './asset-grid.html',
  styleUrl: './asset-grid.css',
})
export class AssetGrid {
  readonly items = input.required<readonly AssetCard[]>();
  readonly hasMore = input(false);
  /** The end of the grid came into view. */
  readonly more = output<void>();

  private readonly grid = viewChild.required<ElementRef<HTMLElement>>('grid');
  private readonly sentinel =
    viewChild.required<ElementRef<HTMLElement>>('sentinel');
  protected readonly column = signal(240);
  private readonly nearEnd = signal(false);

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
    afterNextRender(() => {
      const grid = this.grid().nativeElement;
      const resize = new ResizeObserver(() => {
        const first = getComputedStyle(grid).gridTemplateColumns.split(' ')[0];
        const width = parseFloat(first);
        if (width > 0) {
          this.column.set(width);
        }
      });
      resize.observe(grid);

      const intersect = new IntersectionObserver(
        (entries) => this.nearEnd.set(entries.some((e) => e.isIntersecting)),
        { rootMargin: `${LOOKAHEAD_PX}px 0px` },
      );
      intersect.observe(this.sentinel().nativeElement);

      destroyRef.onDestroy(() => {
        resize.disconnect();
        intersect.disconnect();
      });
    });
  }

  protected ratio(item: AssetCard): number {
    const { width, height } = item.thumbnail ?? {};
    return width && height ? height / width : FALLBACK_RATIO;
  }

  protected span(item: AssetCard): number {
    return Math.ceil((this.column() * this.ratio(item) + GAP) / ROW);
  }
}
