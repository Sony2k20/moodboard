import { Component, computed, effect, inject, input, OnDestroy, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { FontMeta, SPECIMEN_LINES, SPECIMEN_PANGRAM } from '@moodboard/shared';

/** The sizes of the waterfall, in pixels. */
const WATERFALL = [12, 16, 24, 36, 48, 72] as const;

/** The default sample per interface language; a person's own text replaces it. */
const PANGRAMS: Record<string, string> = {
  en: SPECIMEN_PANGRAM,
  de: 'Victor jagt zwölf Boxkämpfer quer über den großen Sylter Deich',
};

let families = 0;

/**
 * Live rendering of an uploaded font (0017). The file is loaded with `FontFace` under a family
 * name of its own, so two fonts with the same family name on one page never mix and nothing of
 * the application's own type changes. Every variable axis gets a slider and every feature the
 * file has a switch; both go into `font-variation-settings` and `font-feature-settings`.
 */
@Component({
  selector: 'mb-font-specimen',
  imports: [TranslocoPipe],
  templateUrl: './font-specimen.html',
  styleUrl: './font-specimen.css',
})
export class FontSpecimen implements OnDestroy {
  readonly font = input.required<FontMeta>();
  readonly url = input.required<string>();

  private readonly transloco = inject(TranslocoService);
  protected readonly family = `mb-specimen-${++families}`;
  protected readonly state = signal<'loading' | 'ready' | 'failed'>('loading');
  protected readonly text = signal<string | null>(null);
  protected readonly size = signal(56);
  protected readonly axes = signal<Record<string, number>>({});
  protected readonly features = signal<ReadonlySet<string>>(new Set());
  protected readonly waterfall = WATERFALL;
  protected readonly lines = SPECIMEN_LINES;
  private loaded: FontFace | null = null;

  protected readonly sample = computed(
    () => this.text() ?? PANGRAMS[this.transloco.getActiveLang()] ?? SPECIMEN_PANGRAM,
  );

  /** What every rendering of the font on this page is styled with. */
  protected readonly style = computed(() => {
    const axes = Object.entries(this.axes());
    const features = [...this.features()];
    return {
      'font-family': `"${this.family}", var(--fallback-font, sans-serif)`,
      'font-variation-settings': axes.length
        ? axes.map(([tag, value]) => `"${tag}" ${value}`).join(', ')
        : 'normal',
      'font-feature-settings': features.length
        ? features.map((tag) => `"${tag}" 1`).join(', ')
        : 'normal',
    };
  });

  constructor() {
    effect(() => {
      const font = this.font();
      this.axes.set(Object.fromEntries(font.axes.map((axis) => [axis.tag, axis.default])));
      void this.load(this.url(), font);
    });
  }

  protected setAxis(tag: string, value: string): void {
    this.axes.update((axes) => ({ ...axes, [tag]: Number(value) }));
  }

  protected toggleFeature(tag: string, on: boolean): void {
    this.features.update((current) => {
      const next = new Set(current);
      if (on) {
        next.add(tag);
      } else {
        next.delete(tag);
      }
      return next;
    });
  }

  protected resetAxes(): void {
    this.axes.set(Object.fromEntries(this.font().axes.map((axis) => [axis.tag, axis.default])));
  }

  ngOnDestroy(): void {
    if (this.loaded) {
      document.fonts.delete(this.loaded);
    }
  }

  private async load(url: string, font: FontMeta): Promise<void> {
    this.state.set('loading');
    try {
      // A variable font is declared over its whole weight range, so `wght` is not clamped to 400.
      const weight = font.axes.find((a) => a.tag === 'wght');
      const face = new FontFace(this.family, `url("${url}")`, {
        weight: weight ? `${weight.min} ${weight.max}` : 'normal',
        style: 'normal',
      });
      await face.load();
      if (this.loaded) {
        document.fonts.delete(this.loaded);
      }
      document.fonts.add(face);
      this.loaded = face;
      this.state.set('ready');
    } catch {
      this.state.set('failed');
    }
  }
}
